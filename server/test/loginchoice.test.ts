// 로그인 화면에서 고른 「구동 모드 · AI 위치」가 **실제로 어디론가 간다**는 것을 지킨다.
// (승인 시안 4차 구현, 2026-08-18 사장님 「로그인창 오른쪽으로 배치 하자」)
//
// ⚠ 이 시험이 있는 이유 — 이 저장소가 반복해 겪은 두 가지다:
//   ① **그 값을 누가 넣는가·누가 읽는가**: `gijo:recoveryRemaining`은 login.html이 쓰는데
//      **읽는 곳이 없었다**(settings는 서버 값을 읽는다). 소비자 없는 값은 조용히 죽는다.
//      → 2026-09-02(F2-10) app.html에 읽는 자리를 만들고, 아래 시험으로 짝을 묶었다.
//      새로 만든 `gijo:loginChoiceFailed`는 **생산자와 소비자를 시험으로 묶는다.**
//   ② **하지 않은 일을 했다고 말함**: 프로를 골랐는데 권한이 없어 적용이 안 됐을 때
//      아무 말도 안 하면 담당자는 「프로겠지」라고 믿는다. 가짜 성공은 QA가 못 잡는다.
import { describe, it, expect } from "vitest";
import fs from "node:fs";

const 읽기 = (p: string) => fs.readFileSync(new URL(p, import.meta.url), "utf8");
const 로그인 = 읽기("../../client/src/renderer/pages/login.html");
const 셸 = 읽기("../../client/src/renderer/pages/app.html");

const KEY = "gijo:loginChoiceFailed";

describe("로그인 화면의 모드·위치 고르기", () => {
  it("두 칸 배치다 — 고를 것이 왼쪽, 자격증명이 오른쪽", () => {
    // ⚠ 예전엔 무료 제공이 **카드 아래**에 세로로 쌓여 1280×800에서 스크롤이 났다.
    //   사장님이 「로그인창 오른쪽으로 배치 하자」고 정했고 시안이 승인됐다.
    expect(로그인, "두 칸 격자가 없다").toMatch(/grid-template-areas:\s*"side card"/);
    expect(로그인, "왼쪽 패널이 없다").toContain('id="sidePanel"');
    // 좁아지면 한 칸으로 접혀야 한다 — 창을 900px까지 줄일 수 있다.
    expect(로그인, "좁을 때 접는 갈래가 없다").toMatch(/@media \(max-width: 960px\)/);
    expect(로그인, "좁을 때 한 칸으로 안 바뀐다").toMatch(/grid-template-areas:\s*"side"\s*"card"/);
  });

  it("무료 제공이 왼쪽 패널 안으로 들어갔다 — 카드 아래에 쌓지 않는다", () => {
    const 패널시작 = 로그인.indexOf('id="sidePanel"');
    const 카드시작 = 로그인.indexOf('<div class="card">');
    const 무료 = 로그인.indexOf('id="freeBox"');
    expect(패널시작, "왼쪽 패널을 못 찾았다").toBeGreaterThan(0);
    expect(무료, "무료 제공 구역이 사라졌다").toBeGreaterThan(패널시작);
    expect(무료, "무료 제공이 아직 카드 쪽에 있다").toBeLessThan(카드시작);
  });

  it("모드 3택 · AI 위치 3택이 다 있다", () => {
    for (const m of ["standard", "pro", "lite"]) {
      expect(로그인, `구동 모드 ${m} 버튼이 없다`).toContain(`data-mode="${m}"`);
    }
    for (const l of ["local", "remote", "cloud"]) {
      expect(로그인, `AI 위치 ${l} 버튼이 없다`).toContain(`data-loc="${l}"`);
    }
  });

  it("★ 라이트·클라우드는 **다른 무게**로 그린다 — 나란한 버튼이면 거짓말이 된다", () => {
    // 라이트는 티어가 아니라 에디션이라 데이터 폴더가 갈리고 앱을 다시 켜야 한다.
    // 클라우드는 글이 회사 밖으로 나간다. 셋을 같은 모양으로 두면 「눌렀으니 됐다」가 된다.
    // ⚠ 2026-09-02(승인 시안)에 **수단이 바뀌었다.** 점선(border-style:dashed)을 걷고
    //   위쪽 3px 색 띠로 바꿨다 — 점선은 UI 관용구로 「여기에 끌어다 놓으세요」(드롭존)를 뜻해
    //   **못 고르는 것처럼** 읽혔기 때문이다(정확히 반대 신호였다).
    //   이 시험이 지키는 것은 「점선이냐」가 아니라 **「셋을 같은 모양으로 두지 않았느냐」**다.
    //   그래서 수단을 못박지 않고, 라이트·클라우드가 **다른 테두리 처리를 받는지**만 본다.
    expect(로그인, "라이트·클라우드가 다른 테두리로 안 그려진다").toMatch(
      /\.mp-btn\[data-mode="lite"\],\s*\.mp-btn\[data-loc="cloud"\]\s*\{[^}]*border-(style|top-width)/
    );
    // 색까지 갈라 준다 — 라이트는 teal, 클라우드는 amber(그 뜻이 화면 곳곳에서 같다).
    expect(로그인, "라이트·클라우드의 구분 색이 없다").toMatch(
      /\.mp-btn\[data-mode="lite"\][\s\S]{0,120}--g-teal[\s\S]{0,200}\.mp-btn\[data-loc="cloud"\][\s\S]{0,120}--g-amber/
    );
    expect(로그인, "라이트를 눌렀을 때 티어로 잡아 버린다").toMatch(
      /if \(m === "lite"\)[\s\S]{0,600}고른모드\.값 = null/
    );
  });

  it("★ 프로를 없는 이득으로 팔지 않는다 — 스탠다드와 엔진 값이 같다", () => {
    // 2026-08-18 사장님 결정 ⓑ(남기되 사실대로 적는다). tierhonesty.test.ts와 같은 규칙이다.
    const 프로안내 = /프로는 지금 스탠다드와 엔진 동작이 같습니다/;
    expect(로그인, "프로 안내가 「같다」고 말하지 않는다").toMatch(프로안내);
    expect(로그인, "로그인 화면이 프로를 「빨라진다」로 판다").not.toMatch(/프로[^\n]{0,40}(빨라|더 빠|성능이 좋)/);
  });

  it("★ 적용은 로그인 직후 한 번 — 고르는 순간에 서버를 부르지 않는다", () => {
    // 로그인 전엔 인증이 없다. 고르는 순간에 부르면 반드시 실패하고, 그 실패를 사람이 못 읽는다.
    expect(로그인, "로그인 마무리에서 적용하지 않는다").toMatch(/finishLogin[\s\S]{0,400}고른것적용\(\)/);
    // 클릭 처리 안에서 티어·원격을 직접 부르면 안 된다.
    const 클릭구간 = 로그인.slice(로그인.indexOf('#mpRow .mp-btn").forEach'), 로그인.indexOf("async function 고른것적용"));
    expect(클릭구간, "고르는 순간에 setLlmTier를 부른다 — 로그인 전이라 반드시 실패한다").not.toContain("setLlmTier");
    expect(클릭구간, "고르는 순간에 remoteLlmSet을 부른다").not.toContain("remoteLlmSet");
  });

  it("★★ 적용 실패를 **읽는 곳이 있다** — 생산자와 소비자를 묶는다", () => {
    // ⚠ 이 저장소에서 「소비자만 있고 생산자 없는 값」·「생산자만 있고 소비자 없는 값」이
    //   하루에 셋 나온 적이 있다. 새로 만든 열쇠는 반드시 짝을 시험으로 묶는다.
    expect(로그인, `login.html이 ${KEY}에 안 적는다`).toContain(`"${KEY}"`);
    expect(셸, `app.html이 ${KEY}를 안 읽는다 — 아무도 안 읽는 값이 된다`).toContain(`"${KEY}"`);
    // 읽고 나면 지워야 한다 — 안 지우면 다음 로그인마다 옛 실패가 다시 뜬다.
    expect(셸, "읽은 뒤 지우지 않는다 — 옛 실패가 매번 다시 뜬다").toMatch(
      new RegExp(`getItem\\("${KEY}"\\)[\\s\\S]{0,200}removeItem\\("${KEY}"\\)`)
    );
    // 그리고 사람에게 **보여야** 한다. 담아만 두면 안 알린 것과 같다.
    // ⚠ 거리(글자 수)로 재지 않는다 — 2026-09-02에 주석이 늘자 900자를 넘겨 **멀쩡한 코드가**
    //   빨간불이 됐다. 거리는 코드가 아니라 **설명의 길이**에 걸린다. 함수 몸통을 잘라 그 안을 본다.
    const 알림함수 = 셸.slice(
      셸.indexOf("function 로그인선택_못한것알리기"),
      셸.indexOf("\n  function ", 셸.indexOf("function 로그인선택_못한것알리기") + 10),
    );
    expect(알림함수.length, "알림 함수 몸통을 못 잘랐다 — 이름이 바뀌었나").toBeGreaterThan(100);
    expect(알림함수, "실패를 사람에게 안 알린다").toContain("gijoTell(");
    // ⚠ **정의를 호출로 세지 말 것.** 처음엔 `boot() … 로그인선택_못한것알리기()`로 봤는데,
    //   호출을 지워도 바로 아래 **함수 정의**(`function 로그인선택_못한것알리기()`)가 걸려
    //   시험이 초록으로 남았다(2026-08-18 뒤집기 확인에서 드러남 — 어제 clientglobals가
    //   주석을 매칭해 통과한 것과 같은 함정이다). 줄 단위 **호출문**만 센다.
    const 호출 = (셸.match(/^[ \t]*로그인선택_못한것알리기\(\);[ \t]*$/gm) || []).length;
    expect(호출, "함수만 있고 아무도 안 부른다 — 죽은 코드다").toBeGreaterThanOrEqual(1);
  });

  it("★★ 복구 코드 남은 개수도 **읽는 곳이 있다**(F2-10) — 담아만 두면 안 알린 것과 같다", () => {
    const 열쇠 = "gijo:recoveryRemaining";
    expect(로그인, `login.html이 ${열쇠}에 안 적는다`).toContain(`"${열쇠}"`);
    expect(셸, `app.html이 ${열쇠}를 안 읽는다 — 아무도 안 읽는 값이 된다`).toContain(`"${열쇠}"`);
    // 담아만 두면 안 알린 것과 같다 — 사람에게 **보이는** 자리까지 이어져야 한다.
    expect(셸, "남은 개수를 사람에게 안 알린다").toMatch(
      new RegExp(`getItem\\("${열쇠}"\\)[\\s\\S]{0,900}gijoTell\\(`)
    );
    // ⚠ **띄운 뒤에** 지운다. 먼저 지우면 띄우다 터졌을 때 키가 이미 사라져 영영 못 본다.
    expect(셸, "띄우기 전에 지운다 — 한 번 실패하면 알림이 영영 사라진다").toMatch(
      new RegExp(`gijoTell\\([\\s\\S]{0,600}removeItem\\("${열쇠}"\\)`)
    );
    // 「모름(빈 문자열)」과 「0개」를 가른다 — 모르는 것을 0으로 보이면 조용한 폴백이다.
    //   (login.html이 `String(r.recoveryRemaining ?? "")`로 적어 빈 문자열이 들어올 수 있다.)
    expect(로그인, "빈 값이 들어갈 수 있다는 전제가 사라졌다").toMatch(/recoveryRemaining \?\? ""/);
    expect(셸, "숫자인지 아닌지를 가르지 않는다 — 빈 값이 0개로 보인다").toMatch(/\/\^\\d\+\$\//);
  });

  it("★ 못 한 일을 「했다」고 말하지 않는다 — 원격 주소가 없으면 그렇게 적는다", () => {
    // 주소가 없는데 remoteLlmSet(true)을 부르면 켜진 척만 한다.
    expect(로그인, "주소 없이 원격을 켜 버린다").toMatch(
      /if \(!cur \|\| !cur\.url\) 못한것\.push/
    );
    // 클라우드는 사외 전송이라 로그인 창에서 조용히 켜지 않는다.
    expect(로그인, "클라우드를 로그인 창에서 조용히 켠다").toMatch(/클라우드\)?: 로그인 뒤 설정/);
  });

  it("라이트 판에서는 왼쪽 패널을 통째로 감춘다", () => {
    // 라이트에서 「라이트를 받으세요」도, 「표준·프로를 고르세요」도 말이 안 된다.
    expect(로그인, "라이트에서 왼쪽 패널을 안 감춘다").toMatch(
      /현재 === "lite"[\s\S]{0,400}sidePanel[\s\S]{0,120}display = "none"/
    );
  });
});
