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

// 이식 필수 항목(있으면 옮긴다). 없는 건 조용히 건너뛰되 매니페스트에 표시한다.
const TARGETS = [
  { key: "db", path: path.join(DATA_DIR, "gijo-as.sqlite"), kind: "file", note: "운영 DB(자산·취약점·KPI·감사·온톨로지 등)" },
  { key: "rag", path: path.join(DATA_DIR, "memory.lancedb"), kind: "dir", note: "RAG 벡터(LanceDB) — bge 임베딩 포함" },
  { key: "backups", path: path.join(DATA_DIR, "backups"), kind: "dir", note: "자동 백업" },
  { key: "datasets", path: path.join(DATA_DIR, "datasets"), kind: "dir", note: "학습 데이터셋" },
  { key: "models", path: MODELS_DIR, kind: "dir", note: "GGUF 채팅 + bge-m3 임베딩" },
];

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
    console.log(t.present ? `✓ ${t.key.padEnd(9)} ${t.sizeHuman.padStart(10)} · ${t.fileCount}개 · hash ${t.listHash} — ${t.note}` : `· ${t.key.padEnd(9)} (없음) — ${t.note}`);
  }
  console.log("\n실제 전송(예):");
  console.log(`  rsync -aP "${DATA_DIR}/" mac:~/gijo-as/server/data/`);
  console.log(`  rsync -aP "${MODELS_DIR}/" mac:~/gijo-as/server/models/`);
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
    if (!t.present) { console.log(`✗ ${t.key} 없음 — ${t.path}`); if (t.key === "db" || t.key === "rag" || t.key === "models") ok = false; continue; }
    console.log(`✓ ${t.key.padEnd(9)} ${t.sizeHuman.padStart(10)} · ${t.fileCount}개 · hash ${t.listHash}`);
  }
  console.log(ok ? "\n필수 항목(db·rag·models) 존재 확인. export 매니페스트의 hash와 대조해 온전성을 확인하세요." : "\n⚠ 필수 항목 누락 — 전송을 다시 확인하세요.");
  process.exit(ok ? 0 : 1);
} else {
  console.log("사용법: node scripts/migrate-data-to-mac.mjs <export|verify> [--out <dir>]");
  process.exit(1);
}
