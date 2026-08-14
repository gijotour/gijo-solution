// smartmd-preload.ts — **Smart MD Studio 창에만** 붙는 최소 preload.
//
// ⚠ 왜 따로 있나 (검토관 지적 H6 — 실제 위험이었다)
//   처음에는 Smart MD 창에도 제품 preload(dist/preload.js)를 붙였다. 「preload를 두 벌 두면
//   어긋난다」가 이유였는데, 그 결과가 훨씬 나빴다:
//     · 제품 preload는 로드 시점에 `auth:getState`로 **로그인 토큰을 복원한다**(api/core.ts).
//       그래서 그 창의 `window.gijo`는 **로그인 사용자로 인증된 상태**가 된다.
//     · 그 표면에는 터미널 실행(terminal.exec)·파일 읽기(fs:readFile)·외부 링크 열기·
//       서버의 **전 라우트**(설정 변경·계정 관리 포함)가 들어 있다. sandbox:true는
//       contextBridge로 내준 표면을 막지 않는다.
//     · 그런데 그 창에 실리는 코드는 **다른 저장소**에서 받아온 것이다
//       (scripts/fetch-smartmd.mjs가 기본 브랜치 최신을 clone한다).
//   즉 저쪽 저장소에 push 한 번이 **보안 제품 안의 인증된 API 전부**를 얻는 구조였다.
//   보안 제품에서 이건 팔 수 없는 모양이다. 그래서 이 창에는 **딱 두 가지만** 내준다.
//
// ■ 무엇만 내주나 — Smart MD가 실제로 찾는 것뿐
//   `window.gijoDesktop` = { isElectron, platform, exportPdf, onMenuCommand }
//   (원본 gijo-smart-md-studio/preload.js와 같은 모양. 없으면 브라우저 방식으로 폴백하도록
//    저쪽 코드가 이미 짜여 있어, 이 표면이 줄어도 편집기는 온전히 돈다.)
//   ⚠ GIJO 서버·터미널·파일·인증에 닿는 통로는 **하나도 없다.**
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("gijoDesktop", {
  isElectron: true,
  platform: process.platform,
  // 이 창을 PDF로 뜬다. main이 창을 확인하고 자기 자신만 인쇄한다.
  exportPdf: () => ipcRenderer.invoke("smartmd:exportPdf"),
  // 우리 창에는 앱 메뉴가 없다 — 부르지 않는다(Smart MD 화면 안에 버튼이 다 있다).
  onMenuCommand: (_callback: (command: string) => void) => { /* no-op */ },
});
