// tools/knowledge-bundle/build.mjs — 지식 번들(.gijobundle)을 만들어 서명한다. (계획서 후-3 1·2단계)
//
// ■ 무엇을 담나
//   ① 온톨로지 표준 시드 트리플(KISA·ATLAS·OWASP·NIST·CWE·ATT&CK 등 9출처)
//   ② 지식 문서(docs-manifest.json에 실린 것 중 knowledge/ 계열)
//   내용은 **살아 있는 서버에서 뽑는다** — 소스 코드를 다시 해석하지 않는다.
//   시드가 TS 모듈이라 "코드가 곧 지식"인 상태인데, 구독 번들은 **데이터로** 배송해야
//   제품을 다시 빌드하지 않고 지식만 갱신할 수 있다. 그 전환의 첫 걸음이 이 추출이다.
//
// ■ 서명
//   manifest를 결정적 JSON으로 만들어 Ed25519로 서명한다. manifest는 payload의 sha256을
//   들고 있으므로 서명 하나가 내용 전체를 덮는다(bundleverify.ts의 두 겹 검증 참고).
//
// 사용:
//   node tools/knowledge-bundle/build.mjs --version 2026.10-1 \
//        [--key D:\GIJO-AS-signing\gijo-2026c.private.pem] [--key-id gijo-2026c] [--out <경로>]
//   환경변수: GIJO_SERVER_URL(기본 http://localhost:4000), QA_USER/QA_PASS(admin 계정)
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };

const BASE = process.env.GIJO_SERVER_URL ?? "http://localhost:4000";
const version = arg("--version");
// ⚠ 기본 키를 두 번 갈았다(2026-08-09, 같은 날): gijo-2026 → 2026b → **2026c**.
//   둘 다 개인키 파일이 대화창에 첨부돼 나간 것이 원인이다. 옛 키로 서명하면 제품이
//   우리 번들을 거부한다 — bundleverify.ts의 신뢰 목록에서 빠졌기 때문이다.
const keyId = arg("--key-id", "gijo-2026c");
const keyPath = arg("--key", `D:\\GIJO-AS-signing\\${keyId}.private.pem`);
const BUNDLE_FORMAT = "gijobundle/1";

if (!version) { console.error("✗ --version 이 필요합니다(예: 2026.10-1)"); process.exit(2); }
if (!/^\d{4}\.\d{2}-\d+$/.test(version)) {
  console.error(`✗ 버전 형식이 CalVer가 아닙니다: ${version} (예: 2026.10-1)`);
  process.exit(2);
}
if (!fs.existsSync(keyPath)) {
  console.error(`✗ 서명 개인키가 없습니다: ${keyPath}`);
  console.error("  먼저 node tools/knowledge-bundle/keygen.mjs 로 만드세요.");
  process.exit(2);
}

// bundleverify.ts와 **같은 규칙**이어야 한다 — 다르면 우리가 만든 번들을 우리가 거부한다.
function canonicalJson(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return "[" + v.map(canonicalJson).join(",") + "]";
  return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonicalJson(v[k])).join(",") + "}";
}
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

async function login() {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: process.env.QA_USER ?? "claude-deploy", password: process.env.QA_PASS, force: true }),
  });
  if (!r.ok) throw new Error(`로그인 실패 ${r.status}`);
  return (await r.json()).accessToken;
}

const token = await login();
const H = { authorization: `Bearer ${token}` };

// ── ① 온톨로지 — 표준 시드 출처만 뽑는다 ────────────────────────────────────────
// ⚠ 고객이 손으로 넣은 지식은 **담지 않는다.** 번들은 우리가 발행하는 것이고,
//   남의 사내 지식이 섞여 나가면 그건 유출이다.
const status = await (await fetch(`${BASE}/api/knowledge-bundle/status`, { headers: H })).json();
const sources = status.ontology?.sources ?? [];
if (!sources.length) { console.error("✗ 서버에 표준 시드 온톨로지가 없습니다 — 번들 적용 상태를 먼저 확인하세요."); process.exit(2); }

const ontology = [];
for (const source of sources) {
  const rows = await (await fetch(`${BASE}/api/ontology/triples?source=${encodeURIComponent(source)}`, { headers: H })).json();
  for (const t of rows.triples ?? rows ?? []) {
    ontology.push({ subject: t.subject, predicate: t.predicate, object: t.object, scope: t.scope, source: t.source });
  }
}
// 순서를 고정한다 — 같은 내용이면 같은 파일이 나와야 재현·대조가 된다.
ontology.sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b)));

// ── ② 문서 — 지식 문서만 ────────────────────────────────────────────────────────
const manifestPath = process.env.GIJO_DOCS_MANIFEST ?? "server/docs-manifest.json";
const docFiles = (JSON.parse(fs.readFileSync(manifestPath, "utf8")).files ?? [])
  .filter((f) => /^knowledge\//.test(f.file) || f.knowledge === true);

const docs = [];
for (const f of docFiles) {
  const base = path.basename(f.file);
  let buf = null;
  for (const dir of ["server/docs", "docs", "."]) {
    try { buf = fs.readFileSync(path.resolve(dir, f.file)); break; } catch { /* 다음 후보 */ }
  }
  if (!buf) { console.warn(`  ⚠ 파일을 못 찾아 건너뜁니다: ${f.file}`); continue; }
  docs.push({ file: base, sha256: sha256(buf), contentBase64: buf.toString("base64") });
}
docs.sort((a, b) => a.file.localeCompare(b.file));

if (!ontology.length && !docs.length) { console.error("✗ 담을 내용이 없습니다."); process.exit(2); }

// ── ③ 매니페스트 + 서명 ─────────────────────────────────────────────────────────
const payload = { ontology, docs };
const manifest = {
  version,
  issuedAt: new Date().toISOString(),
  producer: "GIJO AS knowledge bundle builder",
  counts: { triples: ontology.length, docs: docs.length },
  attributions: status.attributions ?? [],
  payloadSha256: sha256(canonicalJson(payload)),
};

const privateKey = crypto.createPrivateKey(fs.readFileSync(keyPath, "utf8"));
const sig = crypto.sign(null, Buffer.from(canonicalJson(manifest), "utf8"), privateKey).toString("base64");

const file = { format: BUNDLE_FORMAT, manifest, signature: { alg: "Ed25519", keyId, sig }, payload };
const out = arg("--out", path.join("release", `gijo-knowledge-${version}.gijobundle`));
fs.mkdirSync(path.dirname(out), { recursive: true });
// level 9 — 배송은 한 번이고 받는 쪽은 폐쇄망이라 크기가 곧 불편이다.
fs.writeFileSync(out, zlib.gzipSync(Buffer.from(JSON.stringify(file), "utf8"), { level: 9 }));

const kb = Math.round(fs.statSync(out).size / 1024);
console.log(`번들을 만들었습니다 — ${version}`);
console.log(`  지식 ${ontology.length}건(출처 ${sources.length}종) · 문서 ${docs.length}건`);
console.log(`  서명 ${keyId} (Ed25519)`);
console.log(`  ${out} · ${kb}KB`);
console.log(`\n반입: node tools/knowledge-bundle/import.mjs --file "${out}"`);
