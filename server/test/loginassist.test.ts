// 로그인 도움 셋 — 승인 시안 2차(2026-09-02) 구현분의 감시.
//
// ■ 왜 이 시험이 있나
//   셋 다 **조용히 깨지는 부류**다. 연결 확인 단추가 안 붙어도 로그인은 되고, 중복 로그인에
//   위치가 안 떠도 화면은 멀쩡하고, 안내 문구가 되돌아가도 오류가 안 난다.
//   같은 날 「프로 첫 화면 대시보드」가 죽은 코드인데 시험은 초록이던 사고를 겪었으므로,
//   **글자가 아니라 이어짐**을 잰다 — 서버가 실어 보내고 화면이 그것을 읽는지까지.
//
// 계획서: 전-7(보여 주기) — 첫인상이 로그인 화면에서 시작한다.
import { describe, it, expect } from "vitest";
import fs from "node:fs";

const 읽기 = (p: string) => fs.readFileSync(new URL(p, import.meta.url), "utf8");
const 로그인 = 읽기("../../client/src/renderer/pages/login.html");
const 인증 = 읽기("../src/auth/auth.ts");
const 사용자 = 읽기("../src/auth/users.ts");
const 클라인증 = 읽기("../../client/src/api/auth.ts");

describe("F2-01·F8-02 — 주소 칸이 자기 안내와 모순되지 않는다", () => {
  it("★ 「비워 두세요」가 사라졌다 — 앱이 늘 채우는 칸이라 지킬 수 없는 안내였다", () => {
    // main이 auth:getState로 주소를 넣어 주므로 이 칸은 **비어 있는 일이 없다.**
    // 그런데 안내는 「동봉된 서버면 비워 두세요」였다 — 담당자가 따를 수 없는 말이다.
    const 칸 = 로그인.match(/<input id="serverUrl"[^>]*>/);
    expect(칸, "서버 주소 칸을 못 찾았다 — 이 시험이 헛돈다").toBeTruthy();
    expect(칸![0], "지킬 수 없는 안내가 되돌아왔다(앱이 이 칸을 늘 채운다)").not.toContain("비워");
  });
});

describe("F2-03 — 로그인 전에 이 주소가 GIJO 서버인지 확인할 수 있다", () => {
  it("확인 단추와 상태 자리가 있다", () => {
    expect(로그인, "연결 확인 단추가 없다").toContain('id="srvCheck"');
    expect(로그인, "확인 결과를 적을 자리가 없다").toContain('id="srvState"');
  });

  it("★ 새 장치를 만들지 않았다 — 설정이 이미 쓰는 연결 확인을 그대로 쓴다", () => {
    expect(로그인, "checkServerHealth를 안 쓴다 — 새 통로를 팠나").toContain("checkServerHealth");
  });

  it("★★ 붙었다고 다 GIJO로 치지 않는다 — 응답 모양까지 본다", () => {
    // 아무 웹서버나 200을 준다. 「붙었다=GIJO다」로 판정하면 엉뚱한 주소를 확인됐다고 말한다.
    // ⚠ **주석이 아니라 실제 호출**을 기준으로 자른다 — 첫 등장은 위쪽 설명 주석이라,
    //   그것을 기준으로 자르면 코드를 하나도 안 보고 초록이 날 수 있다(잰 것이 없는데 초록).
    const i호출 = 로그인.indexOf("await window.gijo.checkServerHealth()");
    expect(i호출, "연결 확인 호출부를 못 찾았다 — 이 시험이 헛돈다").toBeGreaterThan(0);
    const 구간 = 로그인.slice(i호출, i호출 + 700);
    // ⚠ 2026-09-03: 이 단언이 **느슨함을 굳히고 있었다.** r.status·r.name·r.version은 원천(app.ts)에
    //   없는 필드라 죽은 가지였고, 남는 r.ok는 아무 서버나 주는 값이다 — 사내 다른 서비스 주소도
    //   「GIJO 확인됨」이 됐다. **이름표(service)를 보는지** 잰다.
    expect(구간, "GIJO 이름표(service)를 안 보고 성공으로 친다").toContain('r.service === "gijo-as-server"');
    expect(구간, "GIJO가 아닐 때를 안 알린다").toContain("GIJO 서버가 아닙니다");
  });

  it("★ 화면이 뜰 때 자동으로 서버를 두드리지 않는다 — 누를 때만", () => {
    // 자동 호출이면 꺼져 있는 서버에 매번 붙고, 담당자는 누른 적 없는 오류를 본다.
    const 구간 = 로그인.slice(로그인.indexOf('id="srvCheck"'), 로그인.indexOf('id="srvCheck"') + 2000);
    expect(구간, "연결 확인 자리를 못 찾았다").toBeTruthy();
    expect(로그인, "확인이 클릭이 아닌 곳에 걸렸다").toMatch(/srvBtn\.addEventListener\("click"/);
  });

  it("주소를 고치면 이전 확인 결과를 지운다 — 옛 결과가 새 주소를 보증하면 안 된다", () => {
    expect(로그인, "주소 변경 시 상태를 안 지운다").toMatch(/serverInput\.addEventListener\("input"/);
  });
});

describe("F2-07 — 중복 로그인이 「어디서·언제」를 말한다", () => {
  it("★★ 서버가 실어 보낸다 — 새 컬럼 없이 세션 기록에 이미 있던 값이다", () => {
    const 구간 = 인증.slice(인증.indexOf('error: "already_logged_in"') - 900, 인증.indexOf('error: "already_logged_in"') + 500);
    expect(구간, "409 자리를 못 찾았다 — 이 시험이 헛돈다").toBeTruthy();
    expect(구간, "기존 접속 정보를 안 보낸다").toContain("기존접속");
    expect(구간, "접속 위치를 안 보낸다").toContain("ip");
    expect(구간, "언제부터인지 안 보낸다").toContain("since");
  });

  it("★ 토큰이 아니라 **기록**에서 값을 꺼낸다 — findActiveSession은 문자열을 준다", () => {
    // 구현 중 실제로 이 반환값을 기록으로 착각했다가 적용 전에 잡았다.
    // 토큰에 .ip를 물으면 조용히 undefined가 되어 「위치를 못 구했다」가 늘 참이 된다.
    expect(인증, "토큰에서 곧바로 필드를 읽는다 — 늘 빈 값이 된다").toMatch(
      /const 살아있는세션 = 살아있는토큰 \? refreshTokens\.get\(살아있는토큰\)/
    );
  });

  it("화면까지 이어져 있다 — 타입·표시 자리·호출", () => {
    // ⚠ 2026-09-03 게시 전 검토가 **이 시험의 허점을 잡았다** — 타입에 글자가 있는지만 봐서,
    //   loginFailure가 그 값을 **실제로 안 넘기는데도** 초록이었다. 이 파일 머리말의
    //   「글자가 아니라 이어짐을 잰다」를 스스로 어긴 자리다. 이제 넘기는 코드까지 본다.
    expect(클라인증, "응답 타입에 기존접속이 없다").toContain("기존접속?:");
    expect(클라인증, "타입만 있고 실제로 안 넘긴다 — 화면은 늘 빈 줄이 된다").toMatch(/기존접속: data\.기존접속/);
    expect(로그인, "표시할 자리가 없다").toContain('id="dupWhere"');
    expect(로그인, "받은 값을 안 그린다").toMatch(/중복표시\((r|result)\.기존접속\)/);
  });

  it("★ 값이 없으면 줄을 안 그린다 — 「알 수 없음」을 지어내지 않는다", () => {
    const 구간 = 로그인.slice(로그인.indexOf("function 중복표시"), 로그인.indexOf("function 중복표시") + 700);
    expect(구간, "중복표시를 못 찾았다").toBeTruthy();
    expect(구간, "빈 값일 때도 줄을 그린다").toMatch(/조각\.length \? "block" : "none"/);
  });
});

describe("F8-04 — 임시 비밀번호를 그대로 쓰는 계정을 알아볼 근거", () => {
  it("★ 마지막으로 바꾼 시각을 저장한다", () => {
    expect(사용자, "passwordChangedAt 컬럼이 없다").toContain("passwordChangedAt");
  });

  it("★★ 강제로 막지 않는다 — 권유까지다(막는 문은 범위가 훨씬 크다)", () => {
    // 로그인을 막는 게이트를 만들면 게시 관문·QA·복구 경로가 전부 걸린다.
    // 이번 범위는 「건너뛸 수 있는 권유」이므로, 로그인 차단 코드가 생기면 이 시험이 알린다.
    expect(인증, "비밀번호 미교체로 로그인을 막는 코드가 생겼다 — 이번 범위를 넘는다")
      .not.toMatch(/passwordChangedAt[\s\S]{0,200}res\.status\(4\d\d\)/);
  });
});
