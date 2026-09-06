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
// 빌드 산출물 대조·게시 노트 정리는 순수 함수로 떼어 뒀다 — 픽스처로 시험할 수 있게
// (server/test/artifactcheck.test.ts). 게시는 직렬 자원이라 진짜로 돌려 볼 수 없는 자리다.
import { 산출물검사, 게시노트정리 } from "./lib/artifactcheck.mjs";

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
const notes원본 = arg("notes", "");
const force = process.argv.includes("--force");

// ★★ 에디션 (2026-08-23) — `--edition lite`면 라이트 설치본을 라이트 채널로 올린다.
//
// ⚠ 왜 채널을 갈라야 하나: 그전엔 서버가 「전 에디션 통틀어 가장 높은 판」을 최신으로 줬다.
//   라이트(1.3.0)를 그냥 올렸으면 라이트 사용자가 업데이트를 물을 때 **프로 5.70.0**이
//   내려와 라이트 설치가 프로로 갈아치워진다. 판 번호가 안 겹친다고 안심할 수도 없다 —
//   `release-lite/`에 `GIJO AS Lite Setup 5.17.0`이 실재한다(실제로 겹친 적이 있다).
// ⚠ 라이트는 판 번호가 **다른 파일**에 있다: electron-builder.lite.json의 extraMetadata.version.
//   package.json의 프로 번호를 그대로 쓰면 엉뚱한 이름으로 올라간다.
const 에디션 = process.argv.includes("--edition")
  ? String(process.argv[process.argv.indexOf("--edition") + 1] || "").trim()
  : (arg("edition", "") || "pro");
if (!["pro", "lite"].includes(에디션)) {
  throw new Error(`--edition은 pro 또는 lite여야 합니다(받은 값: ${에디션})`);
}
const pkg = JSON.parse(fs.readFileSync(path.join(clientDir, "package.json"), "utf-8"));
const 라이트설정 = 에디션 === "lite"
  ? JSON.parse(fs.readFileSync(path.join(clientDir, "electron-builder.lite.json"), "utf-8"))
  : null;
const version = 에디션 === "lite" ? String(라이트설정.extraMetadata.version) : pkg.version;
const installerPath = 에디션 === "lite"
  ? path.join(clientDir, "release-lite", `GIJO AS Lite Setup ${version}.exe`)
  : path.join(clientDir, "release", `GIJO AS Setup ${version}.exe`);

// ── 게시 노트에서 판 번호 접두를 뗀다 (2026-09-07) ──────────────────────────
// ⚠ 왜: `.claude/commands/GIJOAS게시.md`가 `--notes "<버전 - 변경 요약>"`이라 안내해 노트가
//   「5.91.1 — …」로 시작하는데, 서버는 version을 **따로** 준다. 화면은 둘을 나란히 그린다
//   (settings.html:394·398 업데이트 판 · 2435-2436 「게시된 배포판」 표의 `버전 | 메모` 두 칸)
//   — 그래서 사람 눈에는 판 번호가 **두 번** 찍힌다.
// ⚠ 화면이 아니라 여기를 고치는 이유: 화면 변경은 게시 범위(시안 → 승인)라 지금 손댈 자리가 아니다.
//   원천에서 한 번만 말하게 하면 두 화면이 함께 낫는다. 뗀 것은 아래에서 사람에게 알린다.
const { notes, 다듬음: 노트다듬음 } = 게시노트정리(notes원본, version);

async function main() {
  if (!username || !password) {
    throw new Error("관리자 계정이 필요합니다 — --user/--password 또는 GIJO_ADMIN_USER/GIJO_ADMIN_PASSWORD 환경변수로 주세요.");
  }
  if (!fs.existsSync(installerPath)) {
    throw new Error(`설치파일이 없습니다: ${installerPath} — 먼저 npm run dist로 빌드하세요.`);
  }

  // ── 빌드 산출물 대조 (2026-09-07) — **「있다」는 완성의 증거가 아니다** ──────────
  //
  // ⚠ 2026-09-06 실사고: `npm run dist`가 중간에 죽었는데 release/에 **273KB짜리 exe**가 남아
  //   있었고, 그것을 완성본으로 오판했다. 위 existsSync는 그 파일도 통과시킨다.
  // ⚠ 로그인 **앞에** 둔다 — 여기서 멈추면 --force 세션을 잡을 일도, 남을 밀어낼 일도 없다.
  //   latest.yml이 없는 우리 빌드에서는 statSync + blockmap(270KB)만 읽으므로 260MB를 안 읽는다.
  // 판정 내용과 「안 재는 것」은 client/scripts/lib/artifactcheck.mjs 머리말에 적혀 있다.
  const 산출물 = 산출물검사(installerPath);
  if (!산출물.ok) {
    throw new Error(
      ["빌드 산출물이 성하지 않습니다 — 게시를 멈춥니다.",
        ...산출물.문제.map((m) => "  ✗ " + m),
        "  (잰 것: " + JSON.stringify(산출물.잰것) + ")"].join("\n"),
    );
  }
  console.log(
    `[publish-release] 빌드 산출물 대조 ✓ — ${Number(산출물.잰것.크기).toLocaleString()}바이트 · ` +
    `blockmap 조각 ${Number(산출물.잰것.blockmap?.합 ? 산출물.잰것.blockmap.조각수 : 0).toLocaleString()}개 합 일치` +
    (산출물.잰것.latestYml?.있음 ? " · latest.yml sha512 일치" : " · latest.yml 없음(이 빌드는 원래 안 만듭니다)"),
  );
  if (노트다듬음) {
    console.log(`[publish-release] 게시 노트에서 판 번호 접두(${version})를 뗐습니다 — 화면이 버전을 따로 그려 두 번 찍힙니다.`);
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

  // ── 세션 반납 (2026-09-06) — **게시가 끝나면 자기 세션을 돌려준다** ─────────────
  //
  // ★ 왜(실측): 이 스크립트는 위에서 --force로 로그인한다(계정당 1세션이라 남을 밀어낸다).
  //   그런데 게시가 끝나도 로그아웃을 안 해서 그 세션이 서버에 **유휴 만료(30분)까지 유령으로**
  //   남았다. 다음 게시·다음 측정은 「이미 다른 곳에서 로그인 중」을 만나 **자기 자신을 또 강제로**
  //   밀어내야 하고, 그 강제는 감사 기록에도 남는다.
  //   ⚠ 같은 결함을 UI 관문(tools/publish-gate-ui.mjs)에서 2026-09-05에 이미 고쳤는데(K5·K5-2)
  //     게시 스크립트는 그때 같이 안 봤다 — 「세 번째면 소스 감시」라 감시를 붙였다
  //     (server/test/shipscripts.test.ts 「게시 스크립트 — 끝나면 세션을 반납한다」).
  // ⚠ 서버(server/src/auth/auth.ts:495)는 **본문의 refreshToken으로** 세션을 지운다.
  //   Authorization 헤더만 보내면 200 OK가 오는데 세션은 그대로 산다 — 「고쳤다」가 거짓이 되는 자리다.
  //   그래서 헤더와 본문을 **둘 다** 보낸다(client/src/api/auth.ts logout과 같은 규약).
  // ⚠ 반납 실패는 **경고만** — 이미 올라간 게시를 실패로 뒤집지 않는다(30분 뒤 유휴 만료된다).
  if (!login.refreshToken) {
    console.log("[publish-release] ⚠ 로그인 응답에 refreshToken이 없습니다 — 반납할 표가 없어 세션이 30분간 남습니다.");
  }
  let 반납함 = false;
  const 세션반납 = async (왜) => {
    if (반납함) return;
    반납함 = true;
    // ★ 표가 없으면 **완료라고 말하지 않는다**(2026-09-06 검토관 적발).
    //   서버는 본문에 refreshToken이 없으면 아무것도 지우지 않고 그대로 `{ok:true}` 200을 준다.
    //   그런데 아래는 `r.ok`만 보고 「반납 완료」를 찍는다 — 바로 위 ⚠에서 경고한
    //   「200 OK인데 세션은 산다」를 **자기 성공 문구가 다시 만드는** 자리다.
    //   지금 서버는 로그인 때 늘 refreshToken을 주므로 여기 닿지 않지만, 닿는 날엔 거짓말이 된다.
    if (!login.refreshToken) {
      console.log("[publish-release] ⚠ 세션 반납 못 함(" + 왜 + ") — 로그인 응답에 refreshToken이 없어" +
        " 서버가 지울 표가 없습니다. 세션은 유휴 만료(30분)까지 남습니다.");
      return;
    }
    try {
      const r = await fetch(`${serverUrl}/api/auth/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${login.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: login.refreshToken ?? null }),
      });
      if (!r.ok) throw new Error("HTTP " + r.status);
      console.log("[publish-release] 세션 반납 완료(" + 왜 + ") — 다음 게시가 --force로 자기를 밀어낼 일이 없습니다.");
    } catch (e) {
      console.log("[publish-release] ⚠ 세션 반납 실패(" + 왜 + "): " + e.message +
        " — 서버에 30분간 남습니다(게시 결과 자체는 위에 찍힌 그대로입니다).");
    }
  };
  // Ctrl+C로 끊어도 반납한다 — 300MB 업로드 도중이 흔한 자리다(관문 K5-2와 같은 이유).
  process.on("SIGINT", async () => { await 세션반납("SIGINT"); process.exit(1); });

  try {
    const buf = fs.readFileSync(installerPath);

    // ★ **크기를 먼저 잰다**(2026-08-22 게시 전 검토관). 서버 수신 한계는
    //   `server/src/engine/clientrelease.ts`의 express.raw `limit: "500mb"` 하나뿐이다.
    //   ⚠ 넘으면 그 미들웨어가 413을 던지는데 서버에 전역 오류 핸들러가 없어 **Express 기본 HTML**이
    //     나가고, 아래 `.then(r => r.json())`이 「Unexpected token '<'」로 터진다 —
    //     게시가 마지막 단계에서 죽는데 **원인이 크기라는 말이 아무 데도 안 나온다.**
    //   OCR 동봉으로 설치본이 170MB → 300MB대가 됐으니 여유가 줄었다. 한글로 먼저 끊는다.
    const 한계MB = 500;
    const 크기MB = buf.length / 1024 / 1024;
    if (크기MB > 한계MB) {
      throw new Error(
        `설치본이 너무 큽니다 — ${크기MB.toFixed(1)}MB (서버 수신 한계 ${한계MB}MB).\n` +
        `  이대로 올리면 마지막 단계에서 원인 모를 오류로 죽습니다.\n` +
        `  늘리려면 server/src/engine/clientrelease.ts의 express.raw limit을 올리고 서버를 배포하세요.`
      );
    }
    if (크기MB > 한계MB * 0.85) {
      console.log(`[publish-release] ⚠ 설치본 ${크기MB.toFixed(1)}MB — 수신 한계(${한계MB}MB)의 85%를 넘었습니다. 곧 한계에 닿습니다.`);
    }

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
    // ⚠ 같은 에디션 안에서 찾는다 — 다른 에디션이 그 번호를 쓰고 있으면 서버가 분명히 막는다.
    const 이미 = (목록?.releases ?? []).find((r) => r.version === version && (r.edition === "lite" ? "lite" : "pro") === 에디션);
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
      `${serverUrl}/api/client/releases?version=${encodeURIComponent(version)}&notes=${encodeURIComponent(notes)}&edition=${encodeURIComponent(에디션)}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${login.accessToken}`, "Content-Type": "application/octet-stream" },
        body: buf,
      }
    ).then((r) => r.json());

    if (publish.error) throw new Error(`게시 실패: ${publish.error}`);
    console.log(`[publish-release] 완료 — ${publish.release.version} · sha256=${publish.release.sha256.slice(0, 12)}…`);
  } finally {
    // ⚠ 성공·실패 어느 쪽으로 빠져나가도 여기를 지난다 — 직선 문장 하나면 오류 경로에서 안 돈다.
    await 세션반납("끝");
  }
}

main().catch((e) => {
  console.error("[publish-release] 오류:", e.message);
  // ★ `process.exit(1)`이 아니라 **exitCode만 세운다**(2026-09-06 검토관 적발 · 실측으로 원인 좁힘).
  //
  // ⚠ 무엇이 났나: 게시가 실패하면 종료코드가 1이 아니라 **127**로 끝나면서
  //   `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 94`가
  //   함께 찍혔다(win · node v24.18.0 · 4회 중 4회). 127은 셸에서 보통 「명령을 못 찾음」이라
  //   감싸는 절차·자동화가 **원인을 오독한다** — 게시가 실패한 것을 「스크립트가 없다」로 읽는다.
  //   ⚠ 이 결함은 세션 반납을 넣기 **전부터** 있었다(수리 전 판 188bb04f도 같은 127).
  //
  // ⚠ 원인(최소 재현으로 좁힘): **fetch를 여러 번 한 뒤 process.exit()으로 끊으면** 종료 도중
  //   libuv async 핸들 단언에 걸린다. 버퍼 크기와는 무관했다 —
  //   · fetch 4번(로그인·목록·업로드·로그아웃) + exit  → 127 + 단언  (1KB로 줄여도 같음)
  //   · fetch 2번 + exit                              → 1, 단언 없음
  //   · fetch 4번 + **exitCode만 세움**                → 1, 단언 없음  ← 이 방식
  //   exitCode만 세우면 node가 이벤트 루프를 스스로 정리하고 나간다(실측 1.6초, 매달리지 않음).
  //
  // ⚠ SIGINT 쪽(위)은 그대로 process.exit이다 — 250MB 업로드가 진행 중일 때 **당장 끊는 것**이
  //   사람의 뜻이라 루프가 비기를 기다릴 수 없다. 거기서 127이 나와도 사람이 방금 Ctrl+C를 누른
  //   자리라 원인을 오해할 여지가 없다.
  process.exitCode = 1;
});
