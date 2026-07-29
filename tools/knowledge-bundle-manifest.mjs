// tools/knowledge-bundle-manifest.mjs — 기본 지식 번들 반입 심사용 매니페스트 출력.
// [전중후 계획서 정렬: 전-4] 폐쇄망(에어갭) 고객사는 외부 자료 반입 전 보안 심사를 한다.
// 조사(2026-07-29) 확인: 업계 최소선은 "파일별 SHA-256 목록 + 원출처 고지"이고, 국가정보보안
// 기본지침 제40조는 반입 시 승인·기록 보관을 요구한다. 이 스크립트는 서버 없이 리포지토리
// 파일만으로 심사 제출용 목록을 만든다(운영 상태는 /api/knowledge-bundle/status가 실측).
//
// 사용: node tools/knowledge-bundle-manifest.mjs [--json]
//   기본 = 사람이 읽는 표(심사 서류 첨부용) / --json = 기계 판독용.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(repoRoot, "server", "docs-manifest.json");

// 버전·고지문은 서버 코드가 단일 출처다 — 여기 복사해 두면 반드시 어긋난다. 소스에서 추출한다.
const bundleSrc = fs.readFileSync(path.join(repoRoot, "server", "src", "engine", "knowledgebundle.ts"), "utf-8");
const version = bundleSrc.match(/KNOWLEDGE_BUNDLE_VERSION\s*=\s*"([^"]+)"/)?.[1];
if (!version) throw new Error("knowledgebundle.ts에서 버전을 찾지 못했습니다");
const attrBlock = bundleSrc.match(/BUNDLE_ATTRIBUTIONS\s*=\s*\[([\s\S]*?)\]\s*as const/)?.[1] ?? "";
const attributions = [...attrBlock.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
const rows = (manifest.files ?? []).map(({ file, why }) => {
  const p = path.join(repoRoot, file);
  if (!fs.existsSync(p)) return { file, sha256: null, bytes: null, why: why ?? "" };
  const buf = fs.readFileSync(p);
  return { file, sha256: crypto.createHash("sha256").update(buf).digest("hex"), bytes: buf.length, why: why ?? "" };
});
const missing = rows.filter((r) => !r.sha256).map((r) => r.file);
// 심사 서류에 구멍이 있으면 안 된다 — 파일이 없으면 표를 만들지 않고 세운다.
if (missing.length) {
  console.error(`오류: 매니페스트 문서 누락 — ${missing.join(", ")}`);
  process.exit(1);
}

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ bundleVersion: version, generatedAt: new Date().toISOString(), files: rows, attributions }, null, 2));
} else {
  console.log(`# GIJO AS 기본 지식 번들 반입 매니페스트`);
  console.log(`버전: ${version} · 생성: ${new Date().toISOString().slice(0, 10)} · 문서 ${rows.length}종\n`);
  console.log(`| 문서 | SHA-256 | 크기(바이트) |`);
  console.log(`|---|---|---|`);
  for (const r of rows) console.log(`| ${r.file} | ${r.sha256} | ${r.bytes.toLocaleString()} |`);
  console.log(`\n검증 방법: 반입측에서 각 파일의 sha256 해시를 계산해 위 표와 대조 (전부 일치해야 반입).`);
  console.log(`\n## 원출처 고지(재배포 조건)`);
  for (const a of attributions) console.log(`- ${a}`);
}
