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
import * as crypto from "node:crypto"; // 같은 번호로 다른 내용을 올리는 것을 막기 위한 대조용
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

  // ── UI 실화면 관문(2026-08-20, tools/publish-gate-ui.mjs) ────────────────
  // 정적 게이트가 원리상 못 잡는 「로드는 됐는데 안 눌리는」 부류를 게시 직전에 실측한다
  // (2026-08-19~20 실사고 2건이 전부 이 부류). --skip-ui-gate로만 건너뛴다 —
  // 건너뛴 사유는 게시 커밋에 적을 것. 관문이 exit 3이면 앱이 떠 있는 것 — 닫고 다시.
  if (!process.argv.includes("--skip-ui-gate")) {
    const { spawnSync } = await import("node:child_process");
    console.log("[publish-release] UI 실화면 관문 실행(tools/publish-gate-ui.mjs)…");
    const gate = spawnSync(process.execPath, [path.join(clientDir, "..", "tools", "publish-gate-ui.mjs")],
      { stdio: "inherit", env: process.env });
    if (gate.status !== 0) {
      throw new Error(`UI 관문 실패(exit ${gate.status}) — 게시 중단. exit 3은 선행 점검(원인 4가지는 관문 메시지 참조 — 비번 없음·win-unpacked 없음·앱 떠 있음·9227 점유), exit 1은 실화면 검사 실패. 수리 후 다시(불가피할 때만 --skip-ui-gate).`);
    }
  } else {
    console.log("[publish-release] ⚠ --skip-ui-gate — UI 실화면 관문을 건너뜁니다(사유를 게시 기록에 남기세요).");
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

  // ★ 같은 번호로 **다른 내용**을 게시하지 못하게 막는다.
  //
  // ⚠ 2026-08-01 실사고: 4.16.1을 게시한 뒤 버튼 3곳을 더 고치고 **번호를 안 올린 채**
  //   다시 빌드했다. 번호 하나가 두 벌을 가리키게 됐고, 게시본에는 그 수정이 없었다.
  //   "4.16.1"이라는 말이 무엇을 뜻하는지 아무도 확신할 수 없게 된다 — 담당자가 버전을
  //   대며 문의해도 어느 쪽인지 모른다.
  //
  // ⚠ **sha256으로 "같은 코드인지"를 판정할 수는 없다**(2026-08-01 실측). 같은 코드를 다시
  //   빌드해도 NSIS가 시각 등을 심어 바이트가 달라진다(b1c34e… → 34d1fd…). 그러니
  //   "내용이 같으면 통과"라는 판정은 성립하지 않는다 — **이미 게시된 번호는 그냥 막는다.**
  //   정말 같은 번호로 다시 올려야 하면 --republish를 명시한다(사람이 뜻을 밝히는 것).
  const 이번sha = crypto.createHash("sha256").update(buf).digest("hex");
  const 목록 = await fetch(`${serverUrl}/api/client/releases`, {
    headers: { Authorization: `Bearer ${login.accessToken}` },
  })
    .then((r) => r.json())
    .catch(() => null);
  const 이미 = (목록?.releases ?? []).find((r) => r.version === version);
  if (이미 && !process.argv.includes("--republish")) {
    throw new Error(
      `${version}은 **이미 게시돼 있습니다.**\n` +
        `  게시된 것: sha256=${String(이미.sha256 ?? "?").slice(0, 12)}…\n` +
        `  지금 것  : sha256=${이번sha.slice(0, 12)}…\n` +
        `한 번호는 한 벌만 가리켜야 합니다 — client/package.json의 version을 올리고 다시 빌드하세요.\n` +
        `(빌드는 매번 바이트가 달라지므로 sha가 다르다고 코드가 다른 것은 아닙니다.\n` +
        ` 정말 같은 번호로 덮어야 하면 --republish를 붙이세요.)`,
    );
  }
  if (이미) console.log(`[publish-release] ⚠ ${version}을 --republish로 덮어씁니다 — 받은 사람마다 다른 벌을 쓸 수 있습니다.`);

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
