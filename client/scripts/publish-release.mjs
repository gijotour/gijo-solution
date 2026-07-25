// client/scripts/publish-release.mjs
// `npm run dist`로 만든 NSIS 설치파일을 GIJO AS 서버(이 제품의 배포처 — 외부 서비스 없음)에
// 게시한다. 서버에 로그인해 관리자 토큰을 받고, release/GIJO AS Setup {version}.exe를
// application/octet-stream으로 그대로 업로드한다.
//
// 사용: node scripts/publish-release.mjs --notes "버그 수정" [--server http://localhost:4000] [--user jyh] [--password changeme] [--force]
// 자격증명은 인자 대신 환경변수로도 준다 — 게시 전용 GIJO_PUBLISH_USER/PASSWORD가 우선,
// 없으면 GIJO_ADMIN_USER/PASSWORD로 폴백한다.
// --force: 그 계정이 이미 다른 곳(앱 등)에 로그인 중이면 강제 전환(그 세션은 끊긴다).

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.resolve(scriptDir, "..");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const serverUrl = (arg("server", process.env.GIJO_SERVER_URL || "http://localhost:4000")).replace(/\/+$/, "");
// 게시 전용 계정(GIJO_PUBLISH_*)을 먼저 본다 — 게시할 때마다 --force로 로그인하는데, 그 계정으로
// 앱에 로그인해 두면 그 세션이 끊긴다(2026-07-26 실사고: 작업 중이던 앱이 로그인 화면으로 튕겼다).
// 게시에만 쓰는 계정을 따로 두면 사람이 쓰는 세션은 어떤 것도 끊기지 않는다.
const username = arg("user", process.env.GIJO_PUBLISH_USER || process.env.GIJO_ADMIN_USER || "");
const password = arg("password", process.env.GIJO_PUBLISH_PASSWORD || process.env.GIJO_ADMIN_PASSWORD || "");
const notes = arg("notes", "");
const force = process.argv.includes("--force");

const pkg = JSON.parse(fs.readFileSync(path.join(clientDir, "package.json"), "utf-8"));
const version = pkg.version;
const installerPath = path.join(clientDir, "release", `GIJO AS Setup ${version}.exe`);

async function main() {
  if (!username || !password) {
    throw new Error("관리자 계정이 필요합니다 — --user/--password 또는 GIJO_ADMIN_USER/GIJO_ADMIN_PASSWORD 환경변수로 주세요.");
  }
  if (!fs.existsSync(installerPath)) {
    throw new Error(`설치파일이 없습니다: ${installerPath} — 먼저 npm run dist로 빌드하세요.`);
  }

  console.log(`[publish-release] 로그인: ${serverUrl} (${username})`);
  const login = await fetch(`${serverUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password, ...(force ? { force: true } : {}) }),
  }).then((r) => r.json());
  if (!login.accessToken) {
    if (login.error === "already_logged_in") {
      throw new Error("이미 다른 곳에 로그인돼 있습니다(중복 로그인 방지) — --force를 추가해 강제 전환하세요(그 세션은 끊깁니다).");
    }
    throw new Error(`로그인 실패: ${JSON.stringify(login)}`);
  }

  const buf = fs.readFileSync(installerPath);
  console.log(`[publish-release] 게시: ${version} (${(buf.length / 1024 / 1024).toFixed(1)}MB) ← ${installerPath}`);
  const publish = await fetch(
    `${serverUrl}/api/client/releases?version=${encodeURIComponent(version)}&notes=${encodeURIComponent(notes)}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${login.accessToken}`, "Content-Type": "application/octet-stream" },
      body: buf,
    }
  ).then((r) => r.json());

  if (publish.error) throw new Error(`게시 실패: ${publish.error}`);
  console.log(`[publish-release] 완료 — ${publish.release.version} · sha256=${publish.release.sha256.slice(0, 12)}…`);
}

main().catch((e) => {
  console.error("[publish-release] 오류:", e.message);
  process.exit(1);
});
