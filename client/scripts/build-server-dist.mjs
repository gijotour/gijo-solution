// client/scripts/build-server-dist.mjs
// 단일 데스크톱 모드(9.3절) 패키징용 서버 사본을 만든다. electron-builder는 client/ 바깥의
// ../server를 볼 수 없으므로(files는 client/ 기준 상대경로만 허용), server/dist + 프로덕션
// node_modules만 client/server-dist/에 복사해 함께 패키징한다.
//
// better-sqlite3(db.ts)는 네이티브 애드온이라 여기서 만드는 사본은 Electron의 내장 Node
// ABI로 재빌드해야 한다 — 사용자 PC에 별도 Node.js 설치를 요구하지 않기 위해 main.ts가
// ELECTRON_RUN_AS_NODE로 이 서버를 스폰하기 때문. server/ 자체(시스템 Node ABI, npm test용)는
// 건드리지 않는다.

import { execFileSync } from "node:child_process";
import { rebuild } from "@electron/rebuild";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as fs from "node:fs";
import * as path from "node:path";

const require = createRequire(import.meta.url);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.resolve(scriptDir, "..");
const serverDir = path.resolve(clientDir, "..", "server");
const outDir = path.join(clientDir, "server-dist");

// Windows에서 npm은 .cmd 배치 파일이라 shell 없이 execFileSync로 직접 실행하면 EINVAL이 난다.
// shell:true가 필요하지만, 여기 넘기는 인자는 전부 고정 리터럴("run","build","ci","--omit=dev")이라
// 외부 입력이 셸로 흘러들 경로가 없다 — 이 스크립트가 실제로 노출하는 인젝션 위험은 없다.
function run(cmd, args, cwd) {
  console.log(`[build-server-dist] $ ${cmd} ${args.join(" ")} (cwd=${cwd})`);
  execFileSync(cmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
}

console.log("[build-server-dist] 1/4 서버 TypeScript 빌드...");
run("npm", ["run", "build"], serverDir);

console.log("[build-server-dist] 2/4 server-dist/ 초기화 및 복사...");
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
fs.cpSync(path.join(serverDir, "dist"), path.join(outDir, "dist"), { recursive: true });
fs.copyFileSync(path.join(serverDir, "package.json"), path.join(outDir, "package.json"));
fs.copyFileSync(path.join(serverDir, "package-lock.json"), path.join(outDir, "package-lock.json"));

// 제품 문서 기본 코퍼스(docsbundle.ts가 첫 기동 때 지식베이스에 인입한다). 설치본에는
// 리포지토리가 없으므로 매니페스트에 열거된 문서만 골라 server-dist/docs/에 실어 보낸다 —
// 여기 복사되지 않은 문서는 고객사에 나가지 않는다(내부 개발 문서 유출 차단이 목적).
console.log("[build-server-dist] 2.5/5 제품 문서 코퍼스 복사...");
const manifestName = "docs-manifest.json";
const manifestSrc = path.join(serverDir, manifestName);
if (fs.existsSync(manifestSrc)) {
  fs.copyFileSync(manifestSrc, path.join(outDir, manifestName));
  const manifest = JSON.parse(fs.readFileSync(manifestSrc, "utf-8"));
  const repoRoot = path.resolve(serverDir, "..");
  const docsOut = path.join(outDir, "docs");
  fs.mkdirSync(docsOut, { recursive: true });
  const missing = [];
  for (const entry of manifest.files ?? []) {
    const src = path.join(repoRoot, entry.file);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(docsOut, entry.file));
    else missing.push(entry.file);
  }
  // 문서가 빠지면 설치본의 지식베이스가 그만큼 비어 채로 나간다 — 조용히 넘기면 배포 후에야
  // "설명을 못 한다"로 드러나므로 빌드를 세운다.
  if (missing.length) throw new Error(`[build-server-dist] 매니페스트 문서 누락: ${missing.join(", ")}`);
  console.log(`[build-server-dist] 제품 문서 ${(manifest.files ?? []).length}건 복사 완료`);
} else {
  console.warn(`[build-server-dist] ${manifestName} 없음 — 제품 문서 코퍼스 없이 패키징합니다`);
}

console.log("[build-server-dist] 3/4 프로덕션 전용 의존성 설치...");
run("npm", ["ci", "--omit=dev"], outDir);

console.log("[build-server-dist] 4/4 네이티브 모듈을 Electron ABI로 재빌드...");
const electronVersion = require("electron/package.json").version;
await rebuild({ buildPath: outDir, electronVersion, onlyModules: ["better-sqlite3"], force: true });

console.log("[build-server-dist] 5/5 불필요한 파일 정리 (용량 최적화)...");
const prunePaths = [
  path.join(outDir, "node_modules", "onnxruntime-web"),
  path.join(outDir, "node_modules", "onnxruntime-node", "bin", "napi-v3", "darwin"),
  path.join(outDir, "node_modules", "onnxruntime-node", "bin", "napi-v3", "linux"),
  path.join(outDir, "node_modules", "onnxruntime-node", "bin", "napi-v3", "win32", "arm64")
];

for (const prunePath of prunePaths) {
  if (fs.existsSync(prunePath)) {
    console.log(`[build-server-dist] 삭제 중: ${prunePath}`);
    fs.rmSync(prunePath, { recursive: true, force: true });
  }
}

console.log(`[build-server-dist] 완료: ${outDir}`);

