// client/build/mac-adhoc-sign.cjs — mac 앱을 **ad-hoc 재서명**한다 (electron-builder afterSign 훅).
//
// 왜 필요한가(2026-08-09 Mac 실측): dmg를 설치하고 실행하면 macOS가 경고가 아니라
// **앱을 삭제**한다.
//     "악성 코드가 차단되고 휴지통으로 이동함
//      'GIJO AS.app'에 악성 코드가 포함되어 있어서 열리지 않았습니다"
//
// 원인은 「서명이 없어서」가 아니라 「서명이 깨져서」다. build.mac의 identity:null이
// electron-builder의 서명 단계를 통째로 건너뛰게 하고, 그 결과 **Electron 원본의
// ad-hoc 링커 서명이 그대로 남는다.** syspolicyd 로그가 그걸 그대로 보여줬다:
//     Identifier       = Electron    ← 번들은 ai.gijo.as 인데 서명 식별자는 Electron
//     Sealed Resources = none        ← 리소스 봉인 없음
//     codesign --verify → "code has no resources but signature indicates they must be present"
// macOS는 이 상태를 **"정품 앱을 누가 뜯어고쳤다"**로 읽는다. 그래서 지우는 것이다.
//
// 해결은 인증서 없이 된다(Mac에서 실증):
//     codesign --force --deep --sign - "GIJO AS.app"
//       Identifier: Electron → ai.gijo.as ✅ · Sealed Resources 봉인 ✅ · verify 통과 ✅
//       실행 정상 · XProtect 격리 시도 0건 ✅
//
// ⚠ 이 훅이 없으면 **dmg 안에 깨진 서명이 그대로 들어가고, 고객은 재서명할 수 없다.**
//   빌드하는 쪽에서 고쳐야 하는 이유다.
// ⚠ spctl은 여전히 rejected다 — 공증(notarization)을 안 했으니 정상이고, 첫 실행만
//   「우클릭 → 열기」로 넘어간다. 우리가 고친 것은 **경고가 아니라 삭제**다.
//   Apple Developer Program($99/년)은 여전히 선택이다.
const { execFileSync, spawnSync } = require("node:child_process");
const path = require("node:path");

exports.default = async function afterSign(context) {
  // mac이 아니면 할 일이 없다 — Windows·Linux 빌드에서 조용히 지나간다.
  if (context.electronPlatformName !== "darwin") return;

  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);

  // ★ 2026-08-17: 자체서명 인증서(GIJO AS Lite Signing)로 서명한다 — 재빌드해도 서명이 같아
  //   macOS 키체인 '항상 허용'(Safe Storage 접근)이 유지된다(ad-hoc은 매번 cdhash가 바뀌어 재요청).
  //   인증서가 없는 환경(CI 등)이면 ad-hoc으로 폴백한다. 이름 바꾸려면 GIJO_SIGN_ID 환경변수.
  // --force: 남아 있는 Electron 원본 서명을 덮어쓴다 · --deep: 프레임워크·헬퍼까지.
  const SIGN_ID = process.env.GIJO_SIGN_ID || "GIJO AS Lite Signing";
  try {
    execFileSync("codesign", ["--force", "--deep", "--sign", SIGN_ID, appPath], { stdio: "inherit" });
    console.log(`[mac-adhoc-sign] 인증서 서명: ${SIGN_ID} — ${appPath}`);
  } catch (e) {
    console.warn(`[mac-adhoc-sign] 인증서(${SIGN_ID}) 서명 실패 → ad-hoc 폴백`);
    execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], { stdio: "inherit" });
  }

  // ⚠ 서명하고 **확인까지 한다.** 서명 명령이 성공해도 봉인이 어긋날 수 있고,
  //   그러면 고객 기계에서야 드러난다 — 빌드에서 잡는 편이 100배 싸다.
  execFileSync("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath], { stdio: "inherit" });

  // 식별자가 실제로 바뀌었는지 본다(Electron으로 남아 있으면 삭제가 재발한다).
  // ⚠ codesign -dv는 **stderr로 쓴다.** execFileSync는 stdout만 돌려주므로 그대로 쓰면
  //   info가 늘 빈 문자열이고 아래 감시가 **항상 통과한다** — 2026-08-09 Mac에서 실측
  //   (stdout 길이 0 · Identifier 추출 undefined). 두 갈래를 모두 받아야 한다.
  const r = spawnSync("codesign", ["-dv", appPath], { encoding: "utf8" });
  const info = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const id = /Identifier=(\S+)/.exec(info)?.[1];
  // 못 읽은 경우도 실패로 본다 — 「확인 못 했다」를 「괜찮다」로 넘기면 이 훅을 만든 의미가 없다.
  if (!id) {
    throw new Error(`[mac-adhoc-sign] 서명 식별자를 읽지 못했다 — 확인 없이 내보낼 수 없다.\n${info.trim()}`);
  }
  if (id === "Electron") {
    throw new Error(`[mac-adhoc-sign] 식별자가 아직 Electron이다 — 재서명이 안 먹었다. 이대로 내보내면 macOS가 앱을 지운다.`);
  }
  console.log(`[mac-adhoc-sign] ✓ 식별자 ${id} · 봉인 확인`);
};
