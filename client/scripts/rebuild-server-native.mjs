// client/scripts/rebuild-server-native.mjs
// 단일 데스크톱 모드(9.3절)에서 main.ts가 서버를 ELECTRON_RUN_AS_NODE로 스폰하면, 서버의
// 네이티브 모듈(현재는 better-sqlite3 하나)이 Electron에 내장된 Node의 ABI로 컴파일돼 있어야
// 로드된다. `npm install`로 받은 기본 바이너리는 시스템 Node ABI라 그대로 두면
// ERR_DLOPEN_FAILED로 서버가 즉시 죽는다 — 이 스크립트가 그 바이너리를 Electron ABI로
// 다시 빌드해준다.
//
// 주의: 이 스크립트를 돌리고 나면 server/ 쪽의 `npm test`나 `node dist/index.js`(시스템 Node로
// 직접 실행)는 반대로 깨진다 — 같은 node_modules를 두 ABI가 동시에 쓸 수 없기 때문. 테스트를
// 다시 돌리려면 `cd ../server && npm rebuild better-sqlite3`로 시스템 Node ABI로 되돌릴 것.
// (진짜 해결책은 패키징 파이프라인에서 배포용 서버 사본에만 이 리빌드를 적용하는 것 —
// 지금은 dev 환경에서 단일 데스크톱 모드를 수동으로 검증할 때 쓰는 용도.)

import { rebuild } from "@electron/rebuild";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

const require = createRequire(import.meta.url);
const electronVersion = require("electron/package.json").version;
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const buildPath = path.resolve(scriptDir, "..", "..", "server");

console.log(`[rebuild-server-native] Electron ${electronVersion} 기준으로 ${buildPath}의 네이티브 모듈을 재빌드합니다...`);

await rebuild({
  buildPath,
  electronVersion,
  onlyModules: ["better-sqlite3"],
  force: true,
});

console.log("[rebuild-server-native] 완료. server/node_modules/better-sqlite3가 이제 Electron ABI로 빌드됨.");
console.log("[rebuild-server-native] 되돌리려면: cd ../server && npm rebuild better-sqlite3");
