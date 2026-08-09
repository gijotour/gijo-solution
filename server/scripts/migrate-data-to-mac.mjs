// server/scripts/migrate-data-to-mac.mjs
// GIJO AS 올인원(mac) 이식 — 운영 데이터 일습을 한 폴더로 묶어 내보낸다(export)/받는다(verify).
// 이식 단위는 딱 두 디렉터리다:
//   - data/    : 운영 DB(gijo-as.sqlite) + RAG 벡터(memory.lancedb) + 백업/데이터셋/릴리즈
//   - models/  : 채팅 GGUF + 임베딩 bge-m3 GGUF (Metal에서 그대로 동작)
// 두 디렉터리의 파일 포맷은 크로스플랫폼 호환이라 "복사 = 이식"이다. bge 임베딩은 memory.lancedb에
// 이미 벡터로 저장돼 있으므로 mac에서 재인입할 필요가 없다(저장된 벡터를 그대로 옮긴다).
//
// 사용:
//   내보내기(운영/WSL에서):  node scripts/migrate-data-to-mac.mjs export --out /tmp/gijo-migrate
//   검증(mac에서 복사 후):    node scripts/migrate-data-to-mac.mjs verify
//
// export는 rsync/copy 없이 매니페스트(크기·개수·해시 요약)만 만든다 — 실제 전송은 rsync/USB로
// 하고(수백 MB~수 GB의 GGUF는 네트워크보다 물리 매체가 빠를 수 있다), 이 스크립트는 "무엇을
// 옮겨야 하는지 + 옮긴 게 온전한지"를 책임진다.

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

const serverDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const cmd = process.argv[2];
const outFlag = process.argv.indexOf("--out");
const outDir = outFlag !== -1 ? process.argv[outFlag + 1] : null;

const DATA_DIR = process.env.GIJO_DATA_DIR || path.join(serverDir, "data");
const MODELS_DIR = process.env.GIJO_MODELS_DIR || path.join(serverDir, "models");

// 이식 항목. 없는 건 조용히 건너뛰되 매니페스트에 표시한다.
//
// ⚠ need 등급이 핵심이다(2026-08-09). 예전에는 목록만 고르고 정작 안내하는 rsync는
//   `data/` **폴더 전체**를 퍼갔다 — 실측 26GB가 갔고 실제 필요분은 658MB였다
//   (윈도우 설치본 19GB·백업 4.6GB·LanceDB 오염본 1.4GB가 딸려갔다).
//   이제 등급별로 rsync 줄을 따로 뽑는다. 폴더 전체를 긁는 명령은 만들지 않는다.
//     must  — 없으면 제품이 못 뜬다
//     opt   — 필요할 때만(기본 제외)
const TARGETS = [
  { key: "db", need: "must", path: path.join(DATA_DIR, "gijo-as.sqlite"), kind: "file", note: "운영 DB(자산·취약점·KPI·감사·온톨로지 등)" },
  { key: "rag", need: "must", path: path.join(DATA_DIR, "memory.lancedb"), kind: "dir", note: "RAG 벡터(LanceDB) — bge 임베딩 포함" },
  { key: "models", need: "must", path: MODELS_DIR, kind: "dir", note: "GGUF 채팅 + bge-m3 임베딩" },
  { key: "datasets", need: "opt", path: path.join(DATA_DIR, "datasets"), kind: "dir", note: "학습 데이터셋 — 학습을 돌릴 때만" },
  { key: "backups", need: "opt", path: path.join(DATA_DIR, "backups"), kind: "dir", note: "자동 백업 — 원본이 운영에 있으니 보통 안 옮긴다" },
];

/** 평문 SQLite 파일은 이 16바이트로 시작한다. 아니면 저장 암호화된 것이다. */
function isEncrypted(dbPath) {
  try {
    const fd = fs.openSync(dbPath, "r");
    try {
      const buf = Buffer.alloc(16);
      fs.readSync(fd, buf, 0, 16, 0);
      return buf.toString("latin1") !== "SQLite format 3\0";
    } finally { fs.closeSync(fd); }
  } catch { return false; }
}

/**
 * 잠긴 DB를 옮길 때 무엇이 더 필요한지 말한다.
 * ⚠ 이걸 안 하면 **말없이 못 여는 DB**가 복사된다 — 2026-08-09 mac이 여기 걸렸다.
 *   봉인 파일(secrets/db.key.json)은 목록에 **일부러 넣지 않았다.** 그건 열쇠라서,
 *   데이터와 같이 자동으로 실려 다니면 안 된다(옮기는 순간 그 기계도 DB를 여는 기계가 된다).
 */
function 암호화_안내(dbPath) {
  if (!isEncrypted(dbPath)) return;
  console.log(`
⚠ 이 DB는 **저장 암호화**되어 있습니다 — 그냥 복사하면 새 기계에서 열리지 않습니다.
  (원래 그러라고 만든 기능입니다. 디스크·백업이 밖으로 나가도 안 열리게 하는 것.)

  새 기계에서 열려면 순서가 있습니다. 순서를 바꾸면 안 열립니다:
    1) 운영에서 복구 열쇠 재발급 (설정 › 저장 암호화 › 「복구 열쇠 재발급」)
    2) **그다음에** server/secrets/db.key.json 을 새 기계로 복사
       ← 1번이 이 파일 내용을 바꾼다. 먼저 복사하면 옛 봉인이라 새 열쇠가 안 맞는다.
    3) 새 기계에서 복구 열쇠 입력 → 열린 뒤 그 기계에 다시 봉인

  ⚠ 이 스크립트는 봉인 파일을 **일부러 안 옮깁니다.** 그건 데이터가 아니라 열쇠입니다.
    옮기는 순간 그 기계도 운영 DB를 여는 기계가 됩니다 — 정말 필요할 때만 손으로 옮기세요.

  · 성능 측정·기능 시험만 할 거라면 **운영 DB 없이도 됩니다.**
    RAG(LanceDB)는 암호화 대상이 아니라 그대로 동작합니다.`.trimEnd());
}

function walk(p) {
  const out = [];
  const st = fs.statSync(p);
  if (st.isFile()) return [{ f: p, size: st.size }];
  for (const name of fs.readdirSync(p)) out.push(...walk(path.join(p, name)));
  return out;
}
function summarize(target) {
  if (!fs.existsSync(target.path)) return { ...target, present: false };
  const files = walk(target.path);
  const bytes = files.reduce((a, b) => a + b.size, 0);
  // 대용량(GGUF)까지 전부 해시하면 느리다 — 파일 목록+크기의 요약 해시로 온전성만 본다.
  const h = crypto.createHash("sha256");
  for (const f of files.sort((a, b) => a.f.localeCompare(b.f))) h.update(path.relative(target.path, f.f) + ":" + f.size + "\n");
  return { ...target, present: true, fileCount: files.length, bytes, sizeHuman: (bytes / 1024 / 1024).toFixed(1) + "MB", listHash: h.digest("hex").slice(0, 16) };
}

if (cmd === "export") {
  const manifest = { generatedAt: new Date().toISOString(), sourceHost: process.env.HOSTNAME || "unknown", dataDir: DATA_DIR, modelsDir: MODELS_DIR, targets: TARGETS.map(summarize) };
  console.log("── GIJO AS 이식 대상 ──");
  for (const t of manifest.targets) {
    const 등급 = t.need === "must" ? "필수" : "선택";
    console.log(t.present
      ? `${t.need === "must" ? "✓" : "○"} [${등급}] ${t.key.padEnd(9)} ${t.sizeHuman.padStart(10)} · ${t.fileCount}개 · hash ${t.listHash} — ${t.note}`
      : `· [${등급}] ${t.key.padEnd(9)} (없음) — ${t.note}`);
  }

  // 항목별로 뽑는다 — 폴더 전체를 긁는 명령은 주지 않는다(그게 26GB의 원인이었다).
  const 있는것 = manifest.targets.filter((t) => t.present);
  const must = 있는것.filter((t) => t.need === "must");
  const opt = 있는것.filter((t) => t.need === "opt");
  const 합 = (list) => (list.reduce((a, b) => a + b.bytes, 0) / 1024 / 1024).toFixed(1) + "MB";
  const 목적지 = (t) => (t.key === "models" ? "mac:~/gijo-as/server/models/" : `mac:~/gijo-as/server/data/${t.kind === "dir" ? path.basename(t.path) + "/" : ""}`);

  // data와 models를 갈라 보여 준다 — 성격이 다르다. models는 원래 크고(GGUF), 한 번 옮기면
  // 끝이다. 문제가 되는 건 data 쪽에 딸려가는 것들이다.
  const dataMust = must.filter((t) => t.key !== "models");
  const modelsMust = must.filter((t) => t.key === "models");

  console.log(`\n실제 전송 — data 필수 (${합(dataMust)}):`);
  for (const t of dataMust) console.log(`  rsync -aP "${t.path}${t.kind === "dir" ? "/" : ""}" ${목적지(t)}`);
  if (modelsMust.length) {
    console.log(`\n실제 전송 — models (${합(modelsMust)}) · 크지만 한 번만:`);
    for (const t of modelsMust) console.log(`  rsync -aP "${t.path}/" ${목적지(t)}`);
    console.log(`  · 이미 같은 GGUF가 있으면 건너뛰세요. rsync는 같은 파일을 다시 보내지 않습니다.`);
  }
  if (opt.length) {
    console.log(`\n선택 — 필요할 때만 (${합(opt)}):`);
    for (const t of opt) console.log(`  # ${t.note}\n  # rsync -aP "${t.path}/" ${목적지(t)}`);
  }
  console.log(`\n⚠ data/ 폴더를 통째로 rsync하지 마세요 — 백업·윈도우 설치본·LanceDB 옛 사본까지 딸려갑니다.`);
  console.log(`  data/에서 실제로 필요한 건 db+rag뿐입니다 — 지금 이 서버 기준 ${합(dataMust)}.`);
  console.log(`  (2026-08-09 mac 이식 실측: 통째로 26GB가 갔고 그중 대부분이 안 쓰이는 것이었습니다.)`);

  암호화_안내(path.join(DATA_DIR, "gijo-as.sqlite"));
  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "migrate-manifest.json"), JSON.stringify(manifest, null, 2));
    console.log(`\n매니페스트 저장: ${path.join(outDir, "migrate-manifest.json")} (mac에서 verify로 대조)`);
  }
} else if (cmd === "verify") {
  const here = TARGETS.map(summarize);
  console.log("── mac 로컬 이식 상태 ──");
  let ok = true;
  for (const t of here) {
    if (!t.present) {
      // 선택 항목이 없는 건 정상이다 — 없다고 빨간불을 켜면 진짜 문제가 묻힌다.
      console.log(`${t.need === "must" ? "✗" : "·"} ${t.key} 없음 — ${t.path}`);
      if (t.need === "must") ok = false;
      continue;
    }
    console.log(`✓ ${t.key.padEnd(9)} ${t.sizeHuman.padStart(10)} · ${t.fileCount}개 · hash ${t.listHash}`);
  }
  console.log(ok ? "\n필수 항목(db·rag·models) 존재 확인. export 매니페스트의 hash와 대조해 온전성을 확인하세요." : "\n⚠ 필수 항목 누락 — 전송을 다시 확인하세요.");

  // 파일이 다 있어도 **열리는지는 다른 문제**다 — 있다≠열린다. 여기서 미리 말한다.
  암호화_안내(path.join(DATA_DIR, "gijo-as.sqlite"));
  process.exit(ok ? 0 : 1);
} else {
  console.log("사용법: node scripts/migrate-data-to-mac.mjs <export|verify> [--out <dir>]");
  process.exit(1);
}
