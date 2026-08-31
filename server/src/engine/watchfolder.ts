// engine/watchfolder.ts — 📂 지켜보는 폴더 (위키처럼 특정 디렉토리 지정해 계속 확인)
//
// ■ 왜 (2026-08-31 사장님): 「내 문서 — 모든 데이터 업로드 확인 + **위키처럼 특정 디렉토리
//   지정해서 계속 확인도 가능하게**」. 담당자가 스캐너 결과·팀 문서를 떨어뜨리는 폴더를
//   지정해 두면, 서버가 주기적으로 들여다보고 새/바뀐 문서를 **기존 인입 창구 그대로**
//   지식으로 가져온다. 지정·해제는 대화창에서(「메뉴는 보기용·지시는 대화창」).
//
// ■ 설계 결정 (2026-08-31 설계관 검토 반영 — 전부 원문 근거):
//   · fs.watch를 쓰지 않는다 — WSL /mnt 경계·네트워크 드라이브에서 이벤트가 새는 것으로
//     악명 높다. **주기 폴링**(기본 5분, env 재정의)이며 alertschedule.ts 관례를 따른다.
//   · v1은 **문서 갈래 고정**(autoRouteUpload forceType:"document") — forceType 없이 부르면
//     자동 판별이 취약점 스캔(CSV/XML) 갈래로 라우팅해 **자산·findings 원장을 사람 확인
//     없이 바꾼다**(autoupload.ts 판별 로직). 스캔 파일 후보는 인입하지 않고 「발견 보고」만.
//   · 2단 스킵: stat(mtime+size) 무변화면 손도 안 댄다 → 변했으면 바이트 해시 대조 후
//     같으면 스킵(추출 비용 없이 멱등 — docsbundle 해시 관례, 키는 폴더id+상대경로).
//   · basename 충돌은 전부 skip+보고 — documentId=basename이라 하위폴더의 같은 이름이
//     같은 문서를 번갈아 덮으면 **무한 재인입 순환**이 된다(설계관 ①-3). 이미 있는 문서를
//     우리가 만들지 않았으면(doc 지도에 없으면) 덮지 않는다 — 남의 문서 보호.
//   · 등급: 갱신 전 **폴더 등록자의 눈**으로 열람불가핵심(req 없는 꼴, W1 분리)을 지난다.
//     막히면 덮지 않고 보고 — 「등급 문서를 감시 폴더가 덮는 6번째 창구」 봉쇄(등급 누출 계보).
//   · 경로: realpath로 접은 뒤(심볼릭 탈출 방지) 존재·디렉터리 확인, 금지 목록(서버 data/·
//     저장소·시스템 경로·드라이브 루트) 거부. win 운영=WSL이라 `D:\…` → `/mnt/d/…` 변환을
//     여기 **한 곳**에서만 한다(unifiedmem 관례 — 판정은 한 곳). 이 경로는 **서버 기계**의
//     경로다 — 분산 모드에서 사용자 PC 경로가 아님을 도구·안내가 말로 박는다(설계관 ④-3).
//   · 원본 보관 없음(keepOriginal:false) — 원본이 폴더에 살아 있다. 추출 .md는 남아
//     「내 문서」에서 보고 고칠 수 있다.
//   · 새 문서 배지·문서 소식(digest)·영수증은 기존 배관이 그대로 받는다 — uploadedBy=
//     등록자 이름·origin 기본(빈 값=업로드 부류)이라 추가 배관 0 (설계관 ③).

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { Express } from "express";
import { db, migrate } from "../db";
import { authMiddleware } from "../auth/auth";
import { autoRouteUpload } from "./autoupload";
import { 추출필요, 열람불가핵심 } from "./memory";
import { 영수증남기기 } from "./uploadreceipt";
import { findUserById } from "../auth/users";

migrate(
  "watch-folders-2026-08-31",
  `CREATE TABLE IF NOT EXISTS watch_folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL UNIQUE,
    label TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_by TEXT,
    created_by_name TEXT,
    created_at TEXT NOT NULL,
    last_scan_at TEXT,
    last_result TEXT
  )`
);

// ── app_state 열쇠(접두 watchfolder:) — 성공 후에만 기록한다(실패 시 다음 틱 자연 재시도) ──
const 상태읽기 = db.prepare("SELECT value FROM app_state WHERE key = ?");
const 상태쓰기 = db.prepare(
  "INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
);
const 상태지우기like = db.prepare("DELETE FROM app_state WHERE key LIKE ?");
const K_STAT = (id: number, rel: string) => `watchfolder:stat:${id}:${rel}`;
const K_HASH = (id: number, rel: string) => `watchfolder:hash:${id}:${rel}`;
// 값 = "<폴더경로>|<rel>" — 충돌 판정("이 문서를 우리가 만들었나")의 정본.
// ⚠ **folderId를 쓰지 않는다**(2026-08-31 검토관): 해제→재등록이 AUTOINCREMENT로 새 id를
//   받아, 자기가 인입한 문서를 영영 「다른 출처」로 오판하고 매 틱 전량 재읽기에 빠졌다.
//   경로는 재등록해도 같다(같은 폴더를 다시 등록하는 것이 그 시나리오의 전부다).
const K_DOC = (docId: string) => `watchfolder:doc:${docId}`;
const DOC값 = (folderPath: string, rel: string) => `${folderPath}|${rel}`;

// ── 한도 — 폴링은 조용히 무거워진다. 한도를 넘으면 **자르고 보고**한다(조용한 절단 금지) ──
const 깊이한도 = 4;
const 파일수한도 = 500;
const 크기한도 = 32 * 1024 * 1024; // 32MB — HTTP 상한(200MB)과 무관한 자체 상한(설계관 ①-4)
const 텍스트확장자 = new Set([".txt", ".md"]);
const 스캔후보확장자 = new Set([".csv", ".xml", ".nessus", ".json"]); // 인입 안 함 — 발견 보고만

/** win 운영=WSL: 사용자가 말한 `D:\보안팀\…`를 서버가 실제로 읽는 `/mnt/d/보안팀/…`로.
 *  판정·변환은 **여기 한 곳**(unifiedmem 관례) — DB에는 변환된 서버 경로를 저장하고
 *  사용자가 친 원문은 label 기본값으로 남긴다. */
export function 서버경로로(입력: string): string {
  const p = String(입력 || "").trim();
  if (process.platform === "linux" && /^[A-Za-z]:[\\/]/.test(p)) {
    return "/mnt/" + p[0].toLowerCase() + "/" + p.slice(3).replace(/\\/g, "/");
  }
  return p;
}

/** 경로 검증 — 실패 사유를 한글로 돌려준다(도구가 그대로 사람에게 보인다). */
export function 경로검증(입력: string): { ok: true; real: string } | { ok: false; error: string } {
  const 후보 = 서버경로로(입력);
  if (!후보) return { ok: false, error: "경로가 비어 있습니다." };
  let real: string;
  try {
    real = fs.realpathSync(path.resolve(후보)); // 심볼릭 링크를 접는다 — 탈출 방지
  } catch {
    return { ok: false, error: `서버에서 그 경로를 찾지 못했습니다: ${후보} — 이 경로는 **서버 기계**의 폴더여야 합니다(분산 설치에서는 내 PC가 아니라 서버 쪽).` };
  }
  let st: fs.Stats;
  try { st = fs.statSync(real); } catch { return { ok: false, error: `읽을 수 없는 경로입니다: ${real}` }; }
  if (!st.isDirectory()) return { ok: false, error: `폴더가 아니라 파일입니다: ${real} — 파일 하나는 내 문서 ＋ 업로드로 올려 주세요.` };
  // 금지 — 루트·서버 자신·시스템. 특히 data/(추출본 폴더)를 감시하면 추출 .md를 재인입하는
  // **자기 되먹임 루프**가 된다(설계관 ④-2).
  if (real === "/" || /^\/mnt\/[a-z]\/?$/.test(real) || /^[A-Za-z]:[\\/]?$/.test(real)) {
    return { ok: false, error: "드라이브·루트 전체는 지정할 수 없습니다 — 문서가 모이는 폴더를 콕 집어 주세요." };
  }
  // ⚠ **양방향으로 막는다**(2026-08-31 검토관 [높음]): 하위만 막으면 **조상**을 지정할 때
  //   걷기가 깊이 4 안에서 data/docs/extracted에 닿아 추출본 .md를 재인입하고, 그 인입이
  //   또 .md.md를 만들어 매 틱 증식한다(머리 주석이 봉쇄했다던 바로 그 루프).
  // ⚠ 산출물 뿌리는 리터럴 "data"가 아니라 **env(GIJO_INGEST_ROOT)**다 — memory.ts와 같은
  //   식으로 읽는다(잣대 두 벌 금지. datacleanup이 같은 실사고를 주석으로 남긴 자리다).
  const 접기 = (p: string) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
  const 데이터뿌리 = 접기(path.resolve(process.env.GIJO_INGEST_ROOT ?? "data"));
  const 서버뿌리 = 접기(path.resolve("."));
  for (const 금지 of [데이터뿌리, 서버뿌리]) {
    const 하위 = real === 금지 || real.startsWith(금지 + path.sep);
    const 조상 = 금지.startsWith(real + path.sep); // 감시 폴더가 금지 경로를 **품는다**
    if (하위 || 조상) {
      return { ok: false, error: `제품 자신의 폴더(서버·data)는 지정할 수 없습니다 — 추출본을 다시 읽는 순환이 됩니다(${조상 ? "지정하신 폴더가 제품 폴더를 품고 있습니다" : "제품 폴더 안입니다"}: ${금지}).` };
    }
  }
  if (/[\\/](etc|proc|sys|dev)([\\/]|$)/.test(real) || /[\\/]Windows([\\/]|$)/i.test(real) || /node_modules/.test(real)) {
    return { ok: false, error: "시스템 경로는 지정할 수 없습니다." };
  }
  return { ok: true, real };
}

export interface WatchFolderRow {
  id: number; path: string; label: string | null; active: number;
  created_by: string | null; created_by_name: string | null;
  created_at: string; last_scan_at: string | null; last_result: string | null;
}

export function addWatchFolder(args: { path: string; label?: string; userId: string; userName?: string }):
  { ok: true; folder: WatchFolderRow } | { ok: false; error: string } {
  const 검 = 경로검증(args.path);
  if (!검.ok) return { ok: false, error: 검.error };
  const 있음 = db.prepare("SELECT id FROM watch_folders WHERE path = ?").get(검.real) as { id: number } | undefined;
  if (있음) return { ok: false, error: `이미 지켜보는 폴더입니다(${검.real}).` };
  db.prepare(
    "INSERT INTO watch_folders (path, label, active, created_by, created_by_name, created_at) VALUES (?, ?, 1, ?, ?, ?)"
  ).run(검.real, args.label?.trim() || String(args.path).trim(), String(args.userId), args.userName ?? null, new Date().toISOString());
  const row = db.prepare("SELECT * FROM watch_folders WHERE path = ?").get(검.real) as WatchFolderRow;
  return { ok: true, folder: row };
}

export function removeWatchFolder(idOrPath: string): WatchFolderRow | null {
  const n = Number(idOrPath);
  const row = (Number.isInteger(n) && n > 0
    ? db.prepare("SELECT * FROM watch_folders WHERE id = ?").get(n)
    : db.prepare("SELECT * FROM watch_folders WHERE path = ?").get(서버경로로(idOrPath))) as WatchFolderRow | undefined;
  if (!row) return null;
  db.prepare("DELETE FROM watch_folders WHERE id = ?").run(row.id);
  // 스캔 기억(stat·hash)은 함께 지운다 — 다시 등록하면 처음부터. doc 지도는 남긴다
  // (인입된 문서는 살아 있으므로, 남겨야 「남의 문서 보호」 판정이 유지된다).
  상태지우기like.run(`watchfolder:stat:${row.id}:%`);
  상태지우기like.run(`watchfolder:hash:${row.id}:%`);
  return row;
}

export function listWatchFolders(): WatchFolderRow[] {
  return db.prepare("SELECT * FROM watch_folders ORDER BY id").all() as WatchFolderRow[];
}

/** 폴더가 인입해 둔 문서 수 — doc 지도(app_state)에서 센다(정본이 하나라 표를 안 늘린다). */
export function watchFolderDocCount(folderId: number): number {
  const row = db.prepare("SELECT path FROM watch_folders WHERE id = ?").get(folderId) as { path?: string } | undefined;
  if (!row?.path) return 0;
  // 경로 꼴(새) + id 꼴(옛) 둘 다 센다 — 판 이전 인입분이 0으로 보이지 않게.
  const r = db.prepare("SELECT COUNT(*) AS n FROM app_state WHERE key LIKE 'watchfolder:doc:%' AND (value LIKE ? OR value LIKE ?)")
    .get(`${row.path}|%`, `${folderId}|%`) as { n: number };
  return r.n;
}

interface 스캔결과 {
  ranAt: string; 새로: number; 갱신: number; 건너뜀: number;
  충돌: string[]; 등급막힘: string[]; 스캔후보: string[]; 비밀경고: string[]; 오류: string[]; 잘림: string | null;
}

function 파일걷기(뿌리: string): { rel: string; abs: string; size: number; mtimeMs: number }[] {
  const out: { rel: string; abs: string; size: number; mtimeMs: number }[] = [];
  const 걷기 = (dir: string, depth: number) => {
    if (depth > 깊이한도 || out.length >= 파일수한도) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.length >= 파일수한도) return;
      const abs = path.join(dir, e.name);
      // 2차 방어(경로검증의 양방향 차단이 1차) — 제품 산출물·의존성 폴더는 이름으로도 피한다.
      if (e.isDirectory()) { if (!e.name.startsWith(".") && !/^(node_modules|extracted)$/.test(e.name)) 걷기(abs, depth + 1); continue; }
      if (!e.isFile()) continue; // 심볼릭 링크 파일은 따라가지 않는다(탈출 방지)
      let st: fs.Stats; try { st = fs.statSync(abs); } catch { continue; }
      out.push({ rel: path.relative(뿌리, abs).replace(/\\/g, "/"), abs, size: st.size, mtimeMs: st.mtimeMs });
    }
  };
  걷기(뿌리, 0);
  return out;
}

/** 폴더 하나 스캔 — 결과를 last_result(JSON)로 남긴다. 시험이 직접 부른다(스케줄러와 분리). */
export async function scanWatchFolder(folder: WatchFolderRow): Promise<스캔결과> {
  const r: 스캔결과 = { ranAt: new Date().toISOString(), 새로: 0, 갱신: 0, 건너뜀: 0, 충돌: [], 등급막힘: [], 스캔후보: [], 비밀경고: [], 오류: [], 잘림: null };
  const 등록자 = folder.created_by ? findUserById(String(folder.created_by)) : undefined;
  // ★ 스캔 진입 시 경로를 **다시 검증**한다(2026-08-31 검토관 TOCTOU) — 등록 뒤 그 폴더를
  //   지우고 같은 이름의 심볼릭 링크(→ 금지 경로)로 바꿔치면 등록 때의 realpath 접기가 무효다.
  //   저장값과 realpath가 다르거나 금지에 걸리면 **읽지 않고 보고**한다.
  const 재검 = 경로검증(folder.path);
  if (!재검.ok || 재검.real !== folder.path) {
    r.오류.push(`경로가 등록 때와 다릅니다 — ${재검.ok ? `지금은 ${재검.real}를 가리킵니다` : 재검.error} · 안전을 위해 이번 확인을 건너뜁니다`);
    db.prepare("UPDATE watch_folders SET last_scan_at = ?, last_result = ? WHERE id = ?").run(r.ranAt, JSON.stringify(r), folder.id);
    return r;
  }
  const 파일들 = 파일걷기(folder.path);
  if (파일들.length >= 파일수한도) r.잘림 = `파일이 ${파일수한도}개를 넘어 그 뒤는 이번 틱에 못 봤습니다`;
  // basename 충돌 — 같은 스캔 안의 같은 이름은 전부 건너뛴다(번갈아 덮는 순환 방지).
  const 이름세기 = new Map<string, number>();
  for (const f of 파일들) 이름세기.set(path.basename(f.rel), (이름세기.get(path.basename(f.rel)) ?? 0) + 1);
  for (const f of 파일들) {
    const 이름 = path.basename(f.rel);
    const ext = (이름.match(/\.[^.]+$/)?.[0] ?? "").toLowerCase();
    if (스캔후보확장자.has(ext)) { if (r.스캔후보.length < 5) r.스캔후보.push(f.rel); continue; }
    if (!추출필요.has(ext) && !텍스트확장자.has(ext)) continue;
    // ★ 예약 접두 거부(2026-08-31 검토관) — documentId=basename이라 「personal:…」 이름 파일이
    //   개인 문서 네임스페이스를 차지한다. personal_docs에 짝 행이 없어 **등록자 포함 전원에게
    //   숨는 유령 문서**가 되고 지우기도 어렵다. 리눅스 파일명엔 콜론이 허용돼 실제로 가능하다.
    if (/^personal:/i.test(이름)) { r.오류.push(`${f.rel} — 「personal:」로 시작하는 이름은 개인 문서 자리라 반입하지 않습니다(이름을 바꿔 주세요)`); continue; }
    if (f.size > 크기한도) { r.오류.push(`${f.rel} — ${Math.round(f.size / 1048576)}MB(상한 32MB)`); continue; }
    const statKey = K_STAT(folder.id, f.rel);
    const statVal = `${Math.round(f.mtimeMs)}:${f.size}`;
    if ((상태읽기.get(statKey) as { value?: string } | undefined)?.value === statVal) { r.건너뜀++; continue; }
    if ((이름세기.get(이름) ?? 0) > 1) { if (r.충돌.length < 5) r.충돌.push(`${이름} — 같은 이름이 ${이름세기.get(이름)}곳`); continue; }
    try {
      const bytes = fs.readFileSync(f.abs);
      const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
      if ((상태읽기.get(K_HASH(folder.id, f.rel)) as { value?: string } | undefined)?.value === hash) {
        상태쓰기.run(statKey, statVal); r.건너뜀++; continue;
      }
      // 이미 있는 문서인가 — 우리(이 지도)가 만들지 않았으면 덮지 않는다(남의 문서 보호).
      const docId = 이름;
      const 지도 = (상태읽기.get(K_DOC(docId)) as { value?: string } | undefined)?.value ?? null;
      const 기존 = db.prepare("SELECT documentId FROM memory_documents WHERE documentId = ?").get(docId) as { documentId?: string } | undefined;
      // 옛 열쇠 꼴(folderId|rel)도 인정한다 — 이 판 이전에 인입한 문서가 갱신 때 「다른 출처」로
      // 오판되지 않게(한 번 지나면 아래에서 새 꼴로 덮인다).
      const 내것 = 지도 === DOC값(folder.path, f.rel) || 지도 === `${folder.id}|${f.rel}`;
      if (기존 && !내것) { if (r.충돌.length < 5) r.충돌.push(`${이름} — 이미 있는 문서(다른 출처)와 이름이 같아 건너뜀`); continue; }
      // 갱신이면 등록자의 눈으로 등급·개인격리 — 막히면 덮지 않는다(6번째 창구 봉쇄).
      if (기존 && 열람불가핵심(docId, { viewerId: folder.created_by ? String(folder.created_by) : null, clearance: 등록자?.clearance ?? null })) {
        if (r.등급막힘.length < 5) r.등급막힘.push(이름); continue;
      }
      const 결과 = await autoRouteUpload(docId, bytes.toString("base64"), "document", undefined, folder.created_by_name ?? undefined, { keepOriginal: false });
      if (결과.routedTo !== "memory") { r.오류.push(`${f.rel} — 인입 갈래가 예상 밖(${결과.routedTo})`); continue; }
      // ★ **routedTo만 보면 실패가 성공이 된다**(2026-08-31 검토관 [높음]) — 문서 갈래는
      //   임베딩 미기동·추출 실패에도 routedTo:"memory"를 돌려주고 ingested:false를 함께 싣는다
      //   (autoupload 보관결과). 그때 stat·hash를 기록하면 **파일이 다시 바뀌기 전까지 영영
      //   재시도가 없고**, 영수증은 「반입 완료」라는 거짓을 남긴다(머리 주석의 「성공 후에만
      //   기록한다」 계약이 바로 이 자리다).
      if (!결과.ingested) {
        r.오류.push(`${f.rel} — 지식 수집 보류(${결과.reason || "사유 미상"}) · 다음 확인 때 다시 시도합니다`);
        continue; // 기록하지 않는다 = 다음 틱 자연 재시도
      }
      상태쓰기.run(statKey, statVal);
      상태쓰기.run(K_HASH(folder.id, f.rel), hash);
      상태쓰기.run(K_DOC(docId), DOC값(folder.path, f.rel));
      if (기존) r.갱신++; else r.새로++;
      // 🔐 비밀경고(API 키·비밀번호 등) — 대화 업로드는 올린 사람에게 그 자리에서 알리는데,
      //   폴더 반입은 사람이 없다. 결과에 남겨 목록·판에서 보이게 한다(2026-08-31 검토관:
      //   「막지 않고 알린다」의 알림이 이 갈래에만 없었다 — 두 창구의 잣대가 갈리면 안 된다).
      if (결과.비밀경고?.length) {
        for (const w of 결과.비밀경고) if (r.비밀경고.length < 5) r.비밀경고.push(`${f.rel} — ${w.kind}(${w.masked})`);
      }
      영수증남기기({
        filename: docId, uploadedBy: folder.created_by_name ?? undefined,
        uploadedById: folder.created_by ? String(folder.created_by) : undefined,
        kind: "document", routedTo: "memory", decidedBy: "auto",
        // 값은 **원천이 준 것 그대로** — 하드코딩하면 추출 전멸(.md 없음)에도 「저장됨」이 남는다.
        originalSaved: !!결과.savedOriginal, mdSaved: !!결과.mdSaved, ingested: !!결과.ingested, bytes: f.size,
        detail: `📂 지켜보는 폴더 「${folder.label ?? folder.path}」 ${기존 ? "갱신" : "자동 반입"}: ${f.rel}`,
      });
    } catch (e) {
      r.오류.push(`${f.rel} — ${e instanceof Error ? e.message.slice(0, 120) : String(e).slice(0, 120)}`);
    }
  }
  db.prepare("UPDATE watch_folders SET last_scan_at = ?, last_result = ? WHERE id = ?")
    .run(r.ranAt, JSON.stringify(r), folder.id);
  return r;
}

// ★ 재진입 가드(2026-08-31 검토관) — 문서 갈래 인입은 추출(파이썬·OCR)+임베딩+분류까지 타서
//   파일이 많으면 한 틱(기본 5분)을 넘긴다. 가드가 없으면 다음 틱이 **아직 기록 전인 파일들**을
//   같은 docId로 병행 인입해 이중 반입·영수증 2장·last_result 상호 덮기가 난다.
//   (본보기로 삼은 alertschedule은 가벼운 DB 틱이라 가드가 없어도 됐던 것 — 전제가 다르다.)
let 스캔중 = false;
export function 스캔중인가(): boolean { return 스캔중; }
export async function scanAllWatchFolders(): Promise<void> {
  if (스캔중) { console.log("[watchfolder] 앞 확인이 아직 도는 중 — 이번 틱은 건너뜁니다"); return; }
  스캔중 = true;
  try {
    for (const f of listWatchFolders()) {
      if (!f.active) continue;
      try { await scanWatchFolder(f); } catch (e) {
        console.error("[watchfolder] 스캔 오류:", f.path, e instanceof Error ? e.message : e);
      }
    }
  } finally { 스캔중 = false; }
}

// ── 주기 스케줄러 — alertschedule.ts 관례(전역 timer·env 틱·unref·stop 짝) ─────────────
let timer: ReturnType<typeof setInterval> | null = null;
const TICK_MS = Number(process.env.GIJO_WATCHFOLDER_TICK_MS) || 300_000; // 기본 5분(설계관 ①-4)
export function startWatchFolderScheduler(): void {
  if (timer) return;
  timer = setInterval(() => { scanAllWatchFolders().catch((e) => console.error("[watchfolder] 틱 오류:", e instanceof Error ? e.message : e)); }, TICK_MS);
  if (typeof timer.unref === "function") timer.unref();
  console.log(`[watchfolder] 지켜보는 폴더 스케줄러 시작 (틱 ${Math.round(TICK_MS / 1000)}초)`);
}
export function stopWatchFolderScheduler(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
export function resetWatchFoldersForTests(): void {
  db.exec("DELETE FROM watch_folders");
  상태지우기like.run("watchfolder:%");
}

/** 내 문서 📂 판이 읽는 조회 창구 — 목록+최근 결과(JSON 풀어서)+들어온 문서 수.
 *  읽기 전용(등록·해제는 대화창 결재판만 — 「메뉴는 보기용·지시는 대화창」). */
export function registerWatchFolderRoutes(app: Express): void {
  app.get("/api/watch-folders", authMiddleware, (_req, res) => {
    const folders = listWatchFolders().map((f) => {
      let last: unknown = null;
      try { last = f.last_result ? JSON.parse(f.last_result) : null; } catch { last = null; }
      return {
        id: f.id, path: f.path, label: f.label, active: !!f.active,
        createdByName: f.created_by_name, createdAt: f.created_at,
        lastScanAt: f.last_scan_at, lastResult: last, docCount: watchFolderDocCount(f.id),
      };
    });
    res.json({ folders, tickSeconds: Math.round(TICK_MS / 1000) });
  });
}

/** 결정적 목록 글 — 도구(watch_folder_list)가 그대로 낸다(alertScheduleText 관례: 숫자·경로·
 *  최근 결과 한 줄씩, 모델이 지어낼 자리가 없다). */
export function watchFolderText(): string {
  const rows = listWatchFolders();
  if (!rows.length) {
    return "지켜보는 폴더가 없습니다.\n\n대화창에서 「D:\\보안팀\\스캔결과 폴더 지켜봐 줘」처럼 말하면 등록됩니다(관리자). ⚠ 경로는 **서버 기계**의 폴더입니다 — 분산 설치에서는 내 PC 경로가 아닙니다.";
  }
  const 줄들 = rows.map((f) => {
    let 최근 = "아직 스캔 전";
    if (f.last_result) {
      try {
        const j = JSON.parse(f.last_result) as 스캔결과;
        최근 = `새로 ${j.새로} · 갱신 ${j.갱신} · 건너뜀 ${j.건너뜀}` +
          (j.충돌.length ? ` · 이름 충돌 ${j.충돌.length}` : "") +
          (j.등급막힘.length ? ` · 등급 막힘 ${j.등급막힘.length}` : "") +
          (j.스캔후보.length ? ` · 스캔파일 후보 ${j.스캔후보.length}(자동 등록 안 함)` : "") +
          (j.오류.length ? ` · 오류 ${j.오류.length}` : "");
      } catch { /* 옛 형식 — 그대로 둔다 */ }
    }
    return `- [${f.id}] ${f.label ?? f.path}${f.active ? "" : " (중지)"}\n  경로: ${f.path}\n  들어온 문서 ${watchFolderDocCount(f.id)}건 · 마지막 확인 ${f.last_scan_at ? f.last_scan_at.slice(0, 16).replace("T", " ") : "-"} — ${최근}`;
  });
  return `📂 지켜보는 폴더 ${rows.length}개\n\n${줄들.join("\n")}`;
}
