// 클라우드 LLM — 「내 질문이 학습에 쓰이나」에 제품이 답한다.
//
// [오픈망 고객용] 2026-09-02. 사장님 「4번은 오픈망고객용으로 필요해」 — 클라우드 연동은
// 제품 기능으로 남는다. 그러면 **고객이 반드시 물어볼 질문**에 제품이 답할 수 있어야 한다.
//
// ■ 이 시험이 막는 것
//  ★ **뭉뚱그리기.** 「클라우드로 나가도 학습에 안 쓰입니다」라고 한 줄로 적고 싶어지는데,
//    그건 **Google 무료 등급에서 거짓**이다. 구글 약관 원문(2026-09-02 확인):
//      Unpaid Services — "Google uses the content you submit to the Services and any generated
//      responses to provide, improve, and develop Google products and services." /
//      "Human reviewers may read, annotate, and process your API input and output." /
//      "Do not submit sensitive, confidential, or personal information to the Unpaid Services."
//    Anthropic·OpenAI는 기본 미학습이 명문이지만 **Google은 등급으로 갈린다.**
//    그래서 안내는 **제공자별로 갈라져 있어야** 하고, 일괄 안심 문구를 쓰면 안 된다.
//  ★ **등급을 아는 척하기.** 제품은 키가 무료인지 유료인지 **모른다** — cloudllm.ts가
//    응답 헤더를 아예 안 읽고 본문·토큰 수만 본다. 「지금 무료 등급입니다」류를 그리면 거짓이다.
//  ★ **키 넣는 자리의 경고가 사라지는 것.** 설명은 screenguide로 보내되, 경고 한 줄은
//    키를 넣는 그 화면에 있어야 한다(딴 데 있으면 아무도 안 본다).

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const 뿌리 = path.resolve(__dirname, "..");
const screenguide = fs.readFileSync(path.join(뿌리, "src/engine/screenguide.ts"), "utf8");
const cloudllm = fs.readFileSync(path.join(뿌리, "src/engine/cloudllm.ts"), "utf8");
const settings = fs.readFileSync(
  path.resolve(뿌리, "../client/src/renderer/pages/settings.html"),
  "utf8"
);

/** 「클라우드 LLM」 안내 한 덩이만 떼어 본다 — 다른 항목의 글이 섞이면 판정이 흐려진다. */
function 클라우드안내(): string {
  const i = screenguide.indexOf('"클라우드 LLM":');
  expect(i, "screenguide에 「클라우드 LLM」 항목이 있어야 한다").toBeGreaterThan(0);
  const j = screenguide.indexOf('\n', screenguide.indexOf('",', i));
  return screenguide.slice(i, j > i ? j : i + 6000);
}

describe("클라우드 데이터 취급 안내 — 제공자별로 갈라져 있다", () => {
  const 안내 = 클라우드안내();

  it("세 제공자를 **각각** 언급한다 — 뭉뚱그리지 않는다", () => {
    for (const v of ["Anthropic", "OpenAI", "Gemini"]) {
      expect(안내, `${v} 언급`).toContain(v);
    }
  });

  it("★ Google은 **등급에 따라 다르다**고 말한다 (무료는 학습에 쓰인다)", () => {
    expect(안내).toMatch(/무료\s*등급/);
    expect(안내).toMatch(/유료\s*등급/);
    // 「사람이 읽을 수 있다」는 구글 약관의 핵심 문장이다 — 이것이 빠지면 위험이 축소된다.
    expect(안내).toMatch(/사람\s*검토자가?\s*읽|사람이\s*읽/);
  });

  it("★ 「학습에 안 쓰인다」를 **조건 없이** 단정하지 않는다", () => {
    // 제공자·등급 조건이 붙지 않은 일괄 안심 문구를 금지한다.
    const 위험 = [
      /클라우드[^.\n]{0,20}학습에\s*쓰이지\s*않습니다/,
      /어떤\s*경우에도[^.\n]{0,30}학습/,
      /절대\s*학습에\s*(쓰이지|사용되지)\s*않/,
    ];
    for (const re of 위험) expect(안내, `${re}`).not.toMatch(re);
  });

  it("보관(저장)과 학습을 **따로** 말한다 — 「학습 안 함 = 아무것도 안 남음」이 아니다", () => {
    expect(안내).toMatch(/보관|남습니다|남습니다\./);
    expect(안내).toMatch(/30일/);   // Anthropic·OpenAI 남용 감시 기본값
    expect(안내).toMatch(/55일/);   // Google 유료 등급 금지행위 탐지
  });

  it("제품이 **등급을 모른다**고 정직하게 말한다", () => {
    expect(안내).toMatch(/알 수 없|모릅니다|판별할 수 없/);
  });

  it("확인 날짜를 밝힌다 — 약관은 바뀐다", () => {
    expect(안내).toMatch(/20\d\d-\d\d-\d\d/);
  });

  it("직접 입력(사내 서버)은 외부 약관과 무관하다고 밝힌다", () => {
    expect(안내).toMatch(/직접\s*입력/);
    expect(안내).toMatch(/무관/);
  });
});

describe("제품이 등급을 아는 척하지 않는다", () => {
  it("cloudllm이 응답 **헤더를 읽지 않는다** — 등급 판정 근거가 없다", () => {
    // 언젠가 헤더로 등급을 재게 되면 이 시험이 실패한다. 그때는 안내도 함께 고쳐야 한다
    // (그러라고 실패시키는 것이다 — 조용히 어긋나지 않게).
    expect(cloudllm).not.toMatch(/res(ponse)?\.headers\.get\(/);
  });
});

describe("키 넣는 자리에 경고가 있다", () => {
  it("API 키 입력칸 **앞**에 경고가 있다 — 넣고 나서 알면 늦다", () => {
    const 경고 = settings.indexOf("질문 본문이 선택한 제공자 서버로 전송됩니다");
    const 키칸 = settings.indexOf('id="cloudApiKeyInput"');
    expect(경고, "경고 문구").toBeGreaterThan(0);
    expect(키칸).toBeGreaterThan(0);
    expect(경고, "경고가 키칸보다 앞에").toBeLessThan(키칸);
  });

  it("화면 경고는 **짧다** — 긴 설명은 screenguide 몫이다", () => {
    const i = settings.indexOf("⚠ 켜면 <b>질문 본문이");
    const j = settings.indexOf("</div>", i);
    const 글 = settings.slice(i, j).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    expect(글.length, `화면 경고 ${글.length}자`).toBeLessThan(260);
  });

  it("화면 경고에도 **제미나이 무료 등급**은 짚는다 — 가장 큰 위험이다", () => {
    const i = settings.indexOf("⚠ 켜면 <b>질문 본문이");
    const 글 = settings.slice(i, i + 700);
    expect(글).toMatch(/무료\s*등급/);
  });
});
