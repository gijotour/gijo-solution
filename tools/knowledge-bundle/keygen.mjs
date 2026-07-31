// tools/knowledge-bundle/keygen.mjs — 지식 번들 발행 키쌍(Ed25519)을 만든다.
//
// ⚠ 개인키는 **저장소에 절대 들어가면 안 된다.** 이 키가 새면 누구나 "GIJO가 발행한"
//   번들을 만들 수 있고, 그 번들은 고객 제품에서 검증을 통과해 온톨로지를 통째로 바꾼다.
//   그래서 저장소 밖(기본 D:\GIJO-AS-signing)에 쓰고, 이 스크립트는 경로를 화면에만 알린다.
//
// 사용:  node tools/knowledge-bundle/keygen.mjs [--out <디렉터리>] [--key-id gijo-2027]
//   → <디렉터리>/<keyId>.private.pem  (빌드 환경에만)
//   → 공개키(SPKI base64)를 화면에 출력 → bundleverify.ts의 BUNDLE_PUBLIC_KEYS에 덧붙인다
//
// ⚠ 키를 갈 때 옛 공개키를 **지우지 말 것** — 이미 배포된 번들이 갑자기 검증 실패한다.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };

const outDir = arg("--out", "D:\\GIJO-AS-signing");
const keyId = arg("--key-id", `gijo-${new Date().getFullYear()}`);

if (path.resolve(outDir).toLowerCase().startsWith(path.resolve("D:\\Connect AI").toLowerCase())) {
  console.error("✗ 개인키를 저장소 안에 두려 합니다 — 다른 경로를 지정하세요.");
  process.exit(2);
}

const privPath = path.join(outDir, `${keyId}.private.pem`);
if (fs.existsSync(privPath)) {
  console.error(`✗ 이미 있습니다: ${privPath}`);
  console.error("  덮어쓰면 그 키로 서명한 기존 번들을 다시 만들 수 없습니다. 지우려면 직접 지우세요.");
  process.exit(2);
}

const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(privPath, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
try { fs.chmodSync(privPath, 0o600); } catch { /* Windows에선 무의미 */ }

const spki = publicKey.export({ type: "spki", format: "der" }).toString("base64");

console.log(`발행 키쌍을 만들었습니다 — keyId: ${keyId}`);
console.log(`\n개인키(빌드 환경 전용, 저장소에 넣지 말 것):\n  ${privPath}`);
console.log(`\n공개키 — server/src/engine/bundleverify.ts의 BUNDLE_PUBLIC_KEYS에 **덧붙이세요**(기존 키 삭제 금지):`);
console.log(`  { keyId: "${keyId}", spkiBase64: "${spki}" },`);
console.log(`\n⚠ 개인키를 잃으면 새 번들을 발행할 수 없습니다. 백업은 오프라인으로.`);
