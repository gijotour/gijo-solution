// engine/datacleanup.ts — 실사용 전환용 데이터 정리 (admin 전용, 감사 증적)
//
// 파일럿→실사용 전환 시 데모·테스트 데이터를 안전하게 비우는 정식 경로다. 원시 SQL을 손으로
// 돌리는 대신, 지원 대상 테이블만 화이트리스트로 열고 실행자·건수를 감사 로그에 남긴다.
// ⚠ 지식베이스(RAG/LanceDB)·온톨로지·감사로그·사용자·자산은 여기서 다루지 않는다 —
//   자산·사용자는 각자의 삭제 API(캐스케이드 포함)를 쓴다.

import * as fs from "fs";
import * as path from "path";
import type { Express, Request } from "express";
import { db } from "../db";
import { authMiddleware, adminMiddleware } from "../auth/auth";
import type { GijoUser } from "../auth/users";
import { asyncRoute } from "../util/asyncRoute";
import { recordAudit } from "./audit";

// 지원 대상 화이트리스트 — 키 이름으로만 지울 수 있다(임의 테이블명 주입 불가).
// ★ export한다(2026-08-22 검토관 [중]) — **표가 아니라 대장 자체를 시험이 본다.**
//   개수만 세면 「새 표를 만들고 여기 안 넣은 것」을 못 잡는데, 그게 이번 결함의 모양이었다.
export const TARGETS: Record<string, { label: string; tables: string[] }> = {
  cti_findings: { label: "위협 인텔 항목(CTI findings)", tables: ["cti_findings", "cti_sync"] },
  analysis_events: { label: "보안 분석 이벤트(분석허브)", tables: ["analysis_events", "analysis_event_status"] },
  // ── 실사용 전환 리셋(2026-08-19 사장님 「화면에 나오는 데이터는 삭제」) — 그룹 단위 ──
  // ⚠ 여기 **안 넣은 것**이 계약이다: 감사(audit_log — 법정 3년)·지식·학습(chat_logs·
  //   memory_documents·데이터셋·어댑터·incident_cases 침해사고 히스토리 — 결정 ① 2026-09-03: 사례는
  //   업무 데이터가 아니라 **제품 지식**이라 실사용 전환에서 지우지 않는다)·설정·계정(users·app_state·스케줄)·판단 기록
  //   (compliance_status — 담당자가 직접 넣었을 수 있음)·축적 자산(work_events 아낀 시간·
  //   answer_feedback 지적·action_check_history 판정·routine_feedback)은 지우지 않는다.
  //   resetlive.test.ts가 이 보존 계약을 값으로 지킨다.
  // ⚠ 순서: 자식 먼저 — scan_runs가 assets를 외래키로 참조해 부모를 먼저 지우면 constraint로
  //   터진다(시험이 잡음 — catch가 삼켜 자산만 남는 반쪽 삭제가 됐었다).
  assets: { label: "자산·스캔 이력·취약점 검토대장", tables: ["scan_runs", "finding_approvals", "assets"] },
  tasks: { label: "할 일·조치 항목", tables: ["tasks"] },
  products: { label: "보안제품 등록부·매뉴얼 대장", tables: ["product_docs", "security_products"] },
  maintenance: { label: "유지보수 일정·이력", tables: ["maintenance_events", "maintenance_items"] },
  hardening: { label: "검증(하드닝) 대상·스케줄·이력", tables: ["hardening_targets", "hardening_schedules", "hardening_runs"] },
  kpi_snapshots: { label: "KPI 일일 스냅샷(파생)", tables: ["security_kpi_snapshots"] },
  product_intro: { label: "제품 소개자료 대장", tables: ["product_intro", "product_intro_field"] }, // field=비교 항목(2026-08-28) — 대장과 함께 산다
  sessions: { label: "작업 내역(대화 세션)", tables: ["work_session_turns", "work_sessions"] },
  // ⚠ 자식(판 이력·첨부 대장) 먼저 — **2026-08-22 검토관 [중] 수리.** 그전엔 `personal_docs`
  //   하나뿐이라, 「개인 문서함 N건 삭제」라고 찍어 놓고 **직전 20판의 본문 전문**이
  //   personal_doc_versions에 그대로 남았다. 문서 행이 없어 화면으로는 못 보지만
  //   DB 백업·스냅샷에는 실려 나간다 — 「지웠다」가 거짓이 되는 자리다.
  //   (외래키는 없지만 순서를 지킨다 — 부모를 먼저 지우면 자식이 고아가 된다.)
  personal_docs: { label: "개인 문서함", tables: ["personal_doc_versions", "personal_doc_files", "personal_docs"] },
  // 반입 영수증 — 「누가 언제 무엇을 올렸나」의 기록. 업무 데이터이므로 실사용 전환에서 함께 지운다
  //   (시연 때 올린 파일 이름이 실운영 목록에 남으면 안 된다).
  upload_receipts: { label: "반입 영수증(올린 파일 기록)", tables: ["upload_receipts"] },
  observability: { label: "브리핑 스냅샷·느린 답 원장(파생)", tables: ["briefing_snapshot", "long_answers", "slow_answers"] },
  // ⚠ 자식(부품) 먼저 — 외래키가 걸려 있어 부모를 먼저 지우면 constraint로 터진다(assets 선례).
  sbom_reviews: { label: "타사 SBOM 검수 대장", tables: ["sbom_review_components", "sbom_reviews"] },
  // 스캔 팀원 해석 초안(2026-09-03) — 고객 보고서에서 나온 파생물이라 업무 데이터다(시연 보고서의 초안이 실운영에 남으면 안 된다).
  scan_drafts: { label: "스캔 해석 초안(스캔 팀원 산출)", tables: ["scan_drafts"] },
  // 부품표 해석 초안(2026-09-03) — 타사 SBOM 검수(업무 데이터)의 파생물
  bom_drafts: { label: "부품표 해석 초안(부품 팀원 산출)", tables: ["bom_drafts"] },
};

// 실사용 전환 리셋이 지우는 전체 목록 — TARGETS의 부분집합(감사·지식·설정은 애초에 목록에 없다).
export const RESET_TARGETS = [
  "assets", "tasks", "cti_findings", "analysis_events", "products", "maintenance",
  "hardening", "kpi_snapshots", "product_intro", "sessions", "personal_docs", "observability",
  // 반입 영수증(2026-08-22 검토관 [중]) — 시연 때 올린 파일 이름이 실운영 목록에 남으면 안 된다.
  "upload_receipts",
  // 검수 이력은 **업무 데이터**다 — 시연 데이터를 지울 때 함께 지워야 남의 회사 부품표가 안 남는다.
  "sbom_reviews",
  // 스캔 해석 초안 — 보고서에서 파생된 업무 데이터(2026-09-03)
  "scan_drafts",
  // 부품표 해석 초안 — 검수에서 파생된 업무 데이터(2026-09-03)
  "bom_drafts",
] as const;

// ── 라이브 모드(실사용 전환) 스위치 ─────────────────────────────────────────
// 표를 비워도 서버 재기동 때 seedXIfEmpty 6곳이 데모를 되살린다(정찰 2026-08-19 실측 함정).
// 리셋이 이 키를 켜면 시드가 전부 건너뛴다 — 「진짜 빈 상태」(사장님 선택). 시연이 필요해지면
// app_state에서 이 키를 지우고 재시작하면 샘플이 돌아온다(값 하나가 스위치다).
const LIVE_KEY = "gijo:live-mode";
export function 라이브모드(): boolean {
  try {
    const r = db.prepare("SELECT value FROM app_state WHERE key = ?").get(LIVE_KEY) as { value: string } | undefined;
    return r?.value === "1";
  } catch { return false; }
}
export function 라이브모드켬(): void {
  db.prepare("INSERT INTO app_state (key, value) VALUES (?, '1') ON CONFLICT(key) DO UPDATE SET value = '1'").run(LIVE_KEY);
}

export function cleanupTargets(): { id: string; label: string; rows: number }[] {
  return Object.entries(TARGETS).map(([id, t]) => ({
    id,
    label: t.label,
    rows: t.tables.reduce((n, tb) => {
      try {
        return n + (db.prepare(`SELECT COUNT(*) AS n FROM ${tb}`).get() as { n: number }).n;
      } catch {
        return n;
      }
    }, 0),
  }));
}

// ⚠ 지우기 전에 **파일로 뜬다**(2026-08-19 D7). 조건 없는 DELETE라 되돌릴 길이 스냅샷뿐이다.
//   전체 DB 백업(VACUUM INTO)은 크고 느려 기본 경로로 안 삼는다 — 지울 표만 JSONL로.
//   ⚠ 백업 폴더 본체(data/backups/)에는 「무엇도 쓰지 않는다」 원칙이 있고 pruneOldBackups가
//     .sqlite만 훑으므로, **별도 하위 폴더**(data/backups/cleanup/)로 가른다.
//   ⚠ 스냅샷 쓰기가 실패하면 **삭제까지 가지 않는다** — 못 남기면 안 지운다.
function snapshotTables(id: string, tables: string[]): string {
  const dir = path.join(process.env.GIJO_BACKUP_DIR || path.join("data", "backups"), "cleanup");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(dir, `cleanup-${stamp}-${id}.jsonl`);
  const lines: string[] = [];
  for (const tb of tables) {
    try {
      for (const row of db.prepare(`SELECT * FROM ${tb}`).all() as Record<string, unknown>[])
        lines.push(JSON.stringify({ _table: tb, ...row }));
    } catch { /* 없는 테이블(구버전) */ }
  }
  fs.writeFileSync(file, lines.join("\n") + "\n", "utf-8");
  if (lines.length > 0 && fs.statSync(file).size <= 2) throw new Error("스냅샷 파일이 비었습니다 — 삭제를 중단합니다");
  return file;
}

export function runCleanup(targetIds: string[]): { id: string; deleted: number; snapshot: string }[] {
  const out: { id: string; deleted: number; snapshot: string }[] = [];
  for (const id of targetIds) {
    const t = TARGETS[id];
    if (!t) continue;
    const snapshot = snapshotTables(id, t.tables); // 실패하면 여기서 던져 삭제까지 못 간다
    let deleted = 0;
    // ⚠ 표별 try/catch로 지우면 반쪽 삭제가 조용히 남는다 — 한 대상은 한 트랜잭션으로.
    //   삼키는 예외는 「없는 테이블」(구버전) **하나뿐** — 외래키 위반 같은 진짜 실패를 삼키면
    //   자산만 남는 반쪽 삭제가 조용히 생긴다(시험이 실제로 잡은 결함).
    const tx = db.transaction(() => {
      for (const tb of t.tables) {
        try { deleted += db.prepare(`DELETE FROM ${tb}`).run().changes; }
        catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (/no such table/i.test(msg)) continue;
          // 진짜 실패 — 트랜잭션 통째 롤백(반쪽 삭제 금지). 어느 표인지 말해야 고칠 수 있다.
          throw new Error(`「${tb}」 삭제 실패: ${msg}`);
        }
      }
    });
    tx();
    out.push({ id, deleted, snapshot });
  }
  return out;
}

// 화면에 보이는 산출물 **파일**(보고서 pdf·SBOM 내보내기·세션 아카이브) — DB 표가 없어
// 화이트리스트 방식으로 못 지운다(정찰 지적). 지우는 대신 **cleanup 폴더로 이동**한다 —
// 스냅샷과 같은 결(못 남기면 안 지운다 → 이동은 그 자체가 보존이다).
/** 문서 파일이 사는 뿌리 — 제품 전체가 이 한 곳을 본다(memory.ts INGEST_ROOT와 같은 규칙).
 *  ⚠ 여기서 `"data"`를 박으면 GIJO_INGEST_ROOT를 쓰는 설치에서 정리가 **헛돈다.** */
const 문서뿌리 = process.env.GIJO_INGEST_ROOT ?? "data";
/** ★★ **같은 결함이 같은 배열에 반쪽으로 남아 있었다** (2026-08-22 3라운드 검토관 [중]).
 *  「환경변수를 안 봐서 엉뚱한 자리를 뒤진다」를 GIJO_INGEST_ROOT만 고치고,
 *  **바로 두 줄 위**의 리포트·세션 아카이브는 하드코딩으로 남겼다.
 *  제품 코드는 그 둘을 실제로 존중한다(report.ts·ingestreport.ts·inspectionreport.ts·
 *  longanswer.ts·worksessions.ts) — 어긋나면 **0건 옮기고도 「성공」**이라 적힌다.
 *  ⚠ 이 자리들은 **제품이 쓰는 그 식과 글자 그대로 같아야** 한다. 하나를 바꾸면 둘 다 바꾼다. */
const 리포트뿌리 = process.env.GIJO_REPORT_DIR ?? path.join("data", "reports");
const 세션아카이브뿌리 = process.env.GIJO_SESSION_ARCHIVE_DIR ?? path.join("data", "session-archive");

const RESET_FILE_DIRS = [
  { dir: 리포트뿌리, label: "보고서 파일" },
  { dir: path.join("data", "exports"), label: "SBOM 내보내기" },
  { dir: 세션아카이브뿌리, label: "세션 아카이브(대화 기록과 짝)" },
  // ★ 업로드 원본·추출본(2026-08-22 추가, 검토관 확정).
  //   여기 없으면 **업무 데이터를 리셋해도 고객이 올린 원본 파일이 디스크에 그대로 남는다** —
  //   「원본은 켜야만 보관한다」는 프라이버시 기본값을 내세우는 제품이 정반대로 도는 자리였다.
  //   추출본(.md)도 같이 옮긴다. 그것이 AI가 실제로 읽은 글이라 남으면 내용이 그대로 남는 것과 같다.
  // ★★ **`GIJO_INGEST_ROOT`를 본다** (2026-08-22 2라운드 검토관 [낮음] 수리).
  //   문서 파일이 실제로 사는 곳은 `process.env.GIJO_INGEST_ROOT ?? "data"` 아래다
  //   (memory.ts:326 INGEST_ROOT · docattach.ts:24 · backup.ts:76 — 셋 다 그렇다).
  //   그런데 이 목록만 `"data"`를 박아 놓고 있었다. 그 환경변수를 쓰는 설치에서는
  //   **엉뚱한 자리를 뒤져 0건 옮기고도 「성공」으로 보고**한다 — 지웠다는데 남는다.
  //   ⚠ 첨부(attach)뿐 아니라 **원본·추출본도 같은 결함**이었다. 뿌리를 한 번에 고친다.
  { dir: path.join(문서뿌리, "docs", "uploads"), label: "업로드 원본 파일" },
  { dir: path.join(문서뿌리, "docs", "extracted"), label: "추출본(.md) — AI가 읽은 글" },
  // ★ 문서 편집기 첨부(2026-08-22 검토관 [중] 수리). 캡처 그림이 여기 쌓인다 —
  //   빠뜨리면 개인 문서를 지워도 **그림 파일이 디스크에 영원히 남는다.**
  //   정작 docattach.ts:113이 스스로 그렇게 경고해 두었는데 이 목록만 안 따라왔다.
  { dir: path.join(문서뿌리, "docs", "attach"), label: "문서 편집기 첨부(캡처 그림)" },
];
function moveResetFiles(stamp: string): { label: string; moved: number }[] {
  const out: { label: string; moved: number }[] = [];
  const base = path.join(process.env.GIJO_BACKUP_DIR || path.join("data", "backups"), "cleanup", `files-${stamp}`);
  for (const { dir, label } of RESET_FILE_DIRS) {
    let moved = 0;
    if (fs.existsSync(dir)) {
      const dst = path.join(base, path.basename(dir));
      fs.mkdirSync(dst, { recursive: true });
      for (const name of fs.readdirSync(dir)) {
        try { fs.renameSync(path.join(dir, name), path.join(dst, name)); moved++; } catch { /* 잠긴 파일은 남긴다 */ }
      }
    }
    out.push({ label, moved });
  }
  return out;
}

/** 실사용 전환 리셋 — 업무 데이터 전부 스냅샷 후 삭제 + 산출물 파일 이동 + 재시드 차단.
 *  감사·지식·학습·설정·계정·판단 기록은 TARGETS 화이트리스트에 없어 **닿을 수조차 없다**. */
export function runLiveReset(): {
  tables: { id: string; deleted: number; snapshot: string }[];
  files: { label: string; moved: number }[];
} {
  const tables = runCleanup([...RESET_TARGETS]); // 대상마다 스냅샷 먼저 — 실패하면 삭제 안 감
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const files = moveResetFiles(stamp);
  라이브모드켬(); // 마지막에 — 여기까지 왔으면 빈 상태가 유지되어야 한다
  return { tables, files };
}

export function registerDataCleanupRoutes(app: Express): void {
  // 정리 가능한 대상과 현재 건수 — 실행 전 확인용.
  app.get("/api/admin/data-cleanup", authMiddleware, adminMiddleware, (_req, res) => {
    res.json({ targets: cleanupTargets() });
  });
  // 실행 — 화이트리스트 대상만, 실행자·건수를 감사 로그에 남긴다.
  app.post(
    "/api/admin/data-cleanup",
    authMiddleware,
    adminMiddleware,
    asyncRoute(async (req, res) => {
      const ids = Array.isArray(req.body?.targets)
        ? (req.body.targets as unknown[]).filter((x): x is string => typeof x === "string" && x in TARGETS)
        : [];
      if (ids.length === 0) {
        res.status(400).json({ error: `targets가 필요합니다 — 지원: ${Object.keys(TARGETS).join(", ")}` });
        return;
      }
      const results = runCleanup(ids);
      const actor = (req as Request & { user?: GijoUser }).user?.displayName ?? null;
      recordAudit({
        kind: "write",
        actor,
        action: "데이터 정리(실사용 전환)",
        target: ids.join(","),
        detail: results.map((r) => `${TARGETS[r.id].label} ${r.deleted}건 삭제(스냅샷 ${r.snapshot.split(/[\/]/).pop()})`).join(" · "),
        result: "ok",
      });
      res.json({ results });
    })
  );
  // 실사용 전환 리셋 — 위 data-cleanup의 전체판 + 파일 이동 + 재시드 차단(사장님 2026-08-19).
  // ⚠ confirm: "RESET"을 요구한다 — admin이라도 실수 클릭 한 번으로 전 업무 데이터가 비면 안 된다.
  app.post(
    "/api/admin/reset-live-data",
    authMiddleware,
    adminMiddleware,
    asyncRoute(async (req, res) => {
      if (req.body?.confirm !== "RESET") {
        res.status(400).json({ error: 'confirm: "RESET"이 필요합니다 — 업무 데이터 전체를 비우는 작업입니다.' });
        return;
      }
      const r = runLiveReset();
      const actor = (req as Request & { user?: GijoUser }).user?.displayName ?? null;
      recordAudit({
        kind: "write",
        actor,
        action: "실사용 전환 리셋",
        target: RESET_TARGETS.join(","),
        detail: r.tables.map((t) => `${TARGETS[t.id].label} ${t.deleted}건`).join(" · ") +
          " · 파일: " + r.files.map((f) => `${f.label} ${f.moved}개 이동`).join(" · ") + " · 재시드 차단 켬",
        result: "ok",
      });
      res.json(r);
    })
  );
}
