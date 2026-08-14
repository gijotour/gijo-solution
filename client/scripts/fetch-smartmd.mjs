// scripts/fetch-smartmd.mjs — **GIJO Smart MD Studio를 클라이언트에 담는다**(무료 제공 도구).
//
// ■ 사장님 결정(2026-08-14): 「Smart MD는 클라이언트에서 로그인할 때 제공되는 무료 툴로
//   같이 배포하고 사용할 수 있게끔」. 별도 앱 설치가 아니라 **GIJO 클라 안의 별도 창**이다.
//
// ■ 왜 소스를 저장소에 안 두고 받아오나 (「같은 것을 여러 곳에 적으면 어긋난다」)
//   Smart MD는 사장님이 따로 업그레이드하는 **독립 제품**이다(gijo-smart-md-studio, MIT).
//   그 소스를 이 저장소에 복사해 두면 두 벌이 되고, 저쪽이 올라가도 이쪽은 낡는다.
//   그래서 **게시 직전에 원본에서 받아** client/smartmd/에 넣고, 그 폴더는 git이 추적하지 않는다.
//   원본이 단일 출처로 남는다.
//
// ■ 무엇을 담나 — 웹 자산만(index.html·css·js·vendor·assets·icon).
//   main.js·preload.js·package.json은 **담지 않는다**: 창을 여는 쪽이 우리 main.ts이고,
//   Smart MD가 기대하는 window.gijoDesktop(exportPdf 등)은 **그 창 전용 preload**
//   (client/src/smartmd-preload.ts)가 대신 준다 — 제품 preload가 아니다(2026-08-14 H6).
//   두 벌의 Electron 부팅 코드를 한 앱에 넣으면 어느 쪽이 도는지 헷갈린다.
//
// ■ ⚠ 어느 판을 담을지 — **고정할 수 있다**(2026-08-14 재검토 B-6)
//   기본은 기본 브랜치 최신이다. 그런데 게시본에 「그때그때 최신 커밋」이 자동으로 들어가면,
//   저쪽 저장소의 push 한 번이 다음 고객 설치본의 내용을 바꾼다 — 게시한 물건이 무엇인지
//   우리가 말할 수 없게 된다. 판을 못 박으려면:
//       GIJO_SMARTMD_REF=<태그 또는 커밋SHA> node scripts/fetch-smartmd.mjs
//   담은 판은 smartmd/GIJO-SMARTMD-VERSION.json에 커밋 해시로 남는다(게시 보고에 그 값을 적는다).
//
// 쓰기:  node scripts/fetch-smartmd.mjs            (기본 브랜치 최신)
//        node scripts/fetch-smartmd.mjs --keep     (이미 있으면 그대로 두고 끝냄)
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const 여기 = path.dirname(fileURLToPath(import.meta.url));
const 클라 = path.resolve(여기, "..");
const 목적지 = path.join(클라, "smartmd");
const 저장소 = process.env.GIJO_SMARTMD_REPO ?? "git@github.com:gijotour/gijo-smart-md-studio.git";

// 담을 것 — 없으면 실패로 친다(조용히 빠지면 「빈 창」이 뜬다).
const 필수 = ["index.html", "css", "js", "vendor"];
const 선택 = ["assets", "icon.png", "LICENSE"];

function 복사(src, dst) {
  fs.cpSync(src, dst, { recursive: true, force: true });
}

if (process.argv.includes("--keep") && fs.existsSync(path.join(목적지, "index.html"))) {
  console.log("Smart MD 자산이 이미 있습니다 — 그대로 둡니다(--keep).");
  process.exit(0);
}

const 임시 = fs.mkdtempSync(path.join(os.tmpdir(), "gijo-smartmd-"));
try {
  console.log(`Smart MD 원본을 받는 중… (${저장소})`);
  // ⚠ 실패 사유를 화면에 보인다(검토관 지적 L3). 예전엔 stderr를 pipe로 삼켜, 게시 기계
  //   (claude-deploy 계정)에서 SSH 키가 없어 실패해도 원인이 안 보였다. 게시는 이 단계가
  //   조용히 실패하면 **Smart MD 없는 설치본**을 내보내게 되므로, 여기서 시끄러운 편이 낫다.
  // ⚠ SSH가 안 되는 계정을 위해 https 폴백을 둔다 — 공개 저장소면 그쪽으로도 받아진다.
  try {
    execFileSync("git", ["clone", "--depth", "1", 저장소, 임시], { stdio: ["ignore", "inherit", "inherit"] });
  } catch (e) {
    const https판 = 저장소.replace(/^git@github\.com:/, "https://github.com/");
    if (https판 === 저장소) throw e;
    console.warn(`SSH로 못 받았습니다 — https로 다시 시도합니다(${https판})`);
    fs.rmSync(임시, { recursive: true, force: true });
    fs.mkdirSync(임시, { recursive: true });
    execFileSync("git", ["clone", "--depth", "1", https판, 임시], { stdio: ["ignore", "inherit", "inherit"] });
  }

  const 판 = (() => {
    try {
      const p = JSON.parse(fs.readFileSync(path.join(임시, "package.json"), "utf8"));
      return String(p.version ?? "");
    } catch { return ""; }
  })();

  for (const 이름 of 필수) {
    const src = path.join(임시, 이름);
    if (!fs.existsSync(src)) throw new Error(`원본에 ${이름}이(가) 없습니다 — Smart MD 구조가 바뀐 것 같습니다.`);
  }

  fs.rmSync(목적지, { recursive: true, force: true });
  fs.mkdirSync(목적지, { recursive: true });
  for (const 이름 of [...필수, ...선택]) {
    const src = path.join(임시, 이름);
    if (fs.existsSync(src)) 복사(src, path.join(목적지, 이름));
  }

  // 어느 판을 담았는지 남긴다 — 화면(ⓘ)과 인계 보고가 이 값을 읽는다.
  //   ⚠ 시각은 담는 사람이 아니라 **원본 커밋**에서 가져온다(빌드 시각은 판을 구분하지 못한다).
  // 판 고정(GIJO_SMARTMD_REF) — 태그·SHA를 주면 그 자리로 옮긴다. shallow clone이라 먼저 받아온다.
  const 고정 = (process.env.GIJO_SMARTMD_REF ?? "").trim();
  if (고정) {
    console.log(`판 고정: ${고정}`);
    execFileSync("git", ["-C", 임시, "fetch", "--depth", "1", "origin", 고정], { stdio: ["ignore", "inherit", "inherit"] });
    execFileSync("git", ["-C", 임시, "checkout", "--detach", "FETCH_HEAD"], { stdio: ["ignore", "inherit", "inherit"] });
  }

  const 커밋 = execFileSync("git", ["-C", 임시, "log", "-1", "--format=%H %ad", "--date=iso-strict"], { encoding: "utf8" }).trim();
  fs.writeFileSync(
    path.join(목적지, "GIJO-SMARTMD-VERSION.json"),
    JSON.stringify({ version: 판, commit: 커밋.split(" ")[0], committedAt: 커밋.split(" ")[1] ?? "", repo: 저장소 }, null, 2) + "\n",
    "utf8"
  );

  const 잰것 = fs.readdirSync(목적지).length;
  console.log(`✓ Smart MD ${판 || "(판 미상)"} 담김 — ${목적지} (최상위 ${잰것}개)`);
} finally {
  fs.rmSync(임시, { recursive: true, force: true });
}
