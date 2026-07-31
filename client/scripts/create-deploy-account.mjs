// client/scripts/create-deploy-account.mjs
// 배포 전용 관리자 계정(claude-deploy)을 생성한다. jyh 계정과 세션이 겹치지 않게 해서
// npm run publish-release 실행 시 매번 --force로 실 사용자 세션을 로그아웃시키는 문제를 없앤다.
//
// 사용: node scripts/create-deploy-account.mjs --user jyh --password <jyh 비밀번호> [--server http://localhost:4000]
// 새로 만들 계정의 비밀번호는 무작위로 생성해 화면에 한 번만 출력한다 — 꼭 적어두거나
// GIJO_ADMIN_PASSWORD 환경변수 등에 저장해 둘 것.

import * as crypto from "node:crypto";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const serverUrl = (arg("server", process.env.GIJO_SERVER_URL || "http://localhost:4000")).replace(/\/+$/, "");
const adminUser = arg("user", "");
const adminPassword = arg("password", "");
const newUsername = arg("new-user", "claude-deploy");
const newPassword = arg("new-password", crypto.randomBytes(15).toString("base64url"));
const force = process.argv.includes("--force");

async function main() {
  if (!adminUser || !adminPassword) {
    throw new Error("기존 관리자 계정이 필요합니다 — --user/--password로 주세요.");
  }

  console.log(`[create-deploy-account] 로그인: ${serverUrl} (${adminUser})`);
  const login = await fetch(`${serverUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: adminUser, password: adminPassword, ...(force ? { force: true } : {}) }),
  }).then((r) => r.json());
  if (!login.accessToken) {
    if (login.error === "already_logged_in") {
      throw new Error("이미 다른 곳에 로그인돼 있습니다 — --force를 추가해 강제 전환하세요(그 세션은 끊깁니다).");
    }
    throw new Error(`로그인 실패: ${JSON.stringify(login)}`);
  }

  const res = await fetch(`${serverUrl}/api/users`, {
    method: "POST",
    headers: { Authorization: `Bearer ${login.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      username: newUsername,
      password: newPassword,
      displayName: "배포 자동화 전용",
      role: "admin",
    }),
  }).then((r) => r.json());

  if (res.error) {
    throw new Error(`계정 생성 실패: ${res.error}`);
  }

  console.log(`[create-deploy-account] 생성 완료: ${newUsername}`);
  console.log(`[create-deploy-account] 비밀번호(한 번만 표시됨): ${newPassword}`);
  console.log(`[create-deploy-account] 앞으로는 이렇게 게시하세요:`);
  console.log(`  npm run publish-release -- --user ${newUsername} --password <위 비밀번호> --notes "..."`);
}

main().catch((e) => {
  console.error(`[create-deploy-account] 오류: ${e.message}`);
  process.exit(1);
});
