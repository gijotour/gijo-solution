// citeguard — **지어낸 인용을 코드가 뗀다**의 짝 시험 (2026-09-05).
//
// 왜 이 시험이 있나: 이 가드는 사람에게 나가는 답을 **지운다**. 지나치면 정상 인용을 잃고,
//   모자라면 없는 출처가 결재판까지 간다. 그래서 ① 순수 함수 사례표 ② 관문(gates.mjs)과의
//   잣대 대조 ③ 배선 소스 감시 ④ **실물 재료**(사다리 표본 + 실전 답 기록)로 오탐·적발을 직접 잰다.
//   ④가 핵심이다 — 만든 사람이 고른 예문만 보면 「내 규칙이 내 예문을 맞힌다」밖에 못 본다.
//
// ★ 2026-09-05 수리 라운드(검토관 적발 10건)에서 늘어난 것:
//   · ⓪ 실증 우선 — 번호가 틀려도 **원문 그대로면 살린다**(참인 문장을 지우던 자리)
//   · 대조하한 23자 — 창 20 · 걸음 4의 산수(20~22자 정상 인용을 오제거하던 자리)
//   · 꼴 넓히기 + 실전 답 152개로 **오탐 0** 실측(넓히면 정상 답을 지운다는 반대 위험을 같이 잰다)
//   · 사이말·중첩 따옴표·잘린 인용 · 코드블록 삼킴 · 원답유지(보류) 세기 · 손질을 뗀 줄로 한정
import { describe, it, expect, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  guardCitations, 근거겹침, 원문꼬리표, 제품인용꼬리표, 뗀인용요약, 대조하한, OVERLAP_CHARS, 겹침걸음,
} from "../src/engine/citeguard";
import { chat, setRagProvider, resetChatHistoryForTests } from "../src/engine/llm";
import {
  원문꼬리표 as 관문원문꼬리표, 제품인용꼬리표 as 관문제품인용꼬리표, 창작인용,
} from "../../tools/team-bench/gates.mjs";

const 조각 = [
  "보안 패치 설치 후 시스템 재시작이 필요한 경우가 존재하며 설치에 따른 영향도 검사가 필요함. 패치는 발표 후 가능한 한 빨리 설치할 것을 권장함.",
  "기본 관리자 계정명은 널리 알려져 있어 공격자가 계정을 추측하기 쉬우므로 설치 직후 변경해야 한다.",
];
/** 어느 조각과도 안 겹치는 **지어낸** 문장 — ②를 재려면 ⓪(실증)에 안 걸리는 재료라야 한다. */
const 지어낸문장 = "릴레이 기능을 제한하지 않으면 외부 악성 사용자가 내부 네트워크를 통해 메일을 전달할 수 있습니다.";

describe("① 조각이 0건이면 인용 꼬리표를 전부 뗀다", () => {
  it("「[n]에 따르면 …」 — 가리킬 [n]이 없으므로 통째로", () => {
    const 답 = '관리자 계정명을 바꾸는 것이 좋습니다. 기본값은 공격자가 이미 알고 있기 때문입니다. [1]에 따르면 "기본 관리자 계정명을 그대로 두면 공격자가 쉽게 타겟을 특정할 수 있습니다."';
    const r = guardCitations(답, []);
    expect(r.removed).toHaveLength(1);
    expect(r.removed[0].kind).toBe("블록없음");
    expect(r.text).not.toContain("[1]에 따르면");
    expect(r.text).toContain("관리자 계정명을 바꾸는 것이 좋습니다");
  });

  it("「원문:」 옛 꼴도 같은 처분 — 회전이 바뀌어도 가드가 산다", () => {
    const 답 = '컨트롤 프로토콜은 인증과 암호화가 없어 위험합니다. 사용을 자제하는 것이 좋습니다. 원문: "이 프로토콜은 인증과 암호화를 제공하지 않아 도청과 위조에 그대로 노출된다."';
    const r = guardCitations(답, []);
    expect(r.removed.map((x) => x.kind)).toEqual(["블록없음"]);
    expect(r.text).not.toContain("원문:");
  });

  it("한 답에 여러 개면 여러 개 다 뗀다(모델이 번호를 줄줄이 붙이는 실제 꼴)", () => {
    const 답 = '기본 계정명은 반드시 변경해야 합니다. 공격 표면이 줄어들기 때문입니다. [1]에 따르면 "기본 계정명은 공격자가 시스템을 탐지하는 데 유용한 정보를 제공합니다." [2]에서는 "관리자 계정명을 변경하지 않으면 내부 및 외부 공격 모두에 취약해집니다."';
    const r = guardCitations(답, []);
    expect(r.removed).toHaveLength(2);
    expect(r.text).not.toMatch(/\[\d\]/);
  });
});

describe("⓪ 실증 우선 — 내용이 실제로 있으면 번호가 틀려도 살린다", () => {
  // ★ 첫 판의 결함(검토관 실측): ②(범위밖)가 ③(겹침)보다 앞이라 **원문 그대로 옮긴 인용이**
  //   번호 하나 때문에 인용문째 사라졌다. 계수기에는 「범위밖 1건」으로 남아 가드가 일한 것처럼
  //   보였다 — 참인 문장을 지우고 초록으로 보이는 것이 이 가드가 낼 수 있는 최악의 결과다.
  it("★ [5]인데 조각은 2개 — 그런데 인용문이 조각 본문 그대로면 안 뗀다", () => {
    const 답 = `패치 설치는 재시작을 부를 수 있습니다. [5]에 따르면 "${조각[0]}"`;
    const r = guardCitations(답, 조각);
    expect(r.removed).toHaveLength(0);
    expect(r.text).toBe(답);
  });

  it("번호만 틀린 정상 인용도 살린다 — [2]라 적었지만 실제로 [1] 본문이다", () => {
    const 답 = '패치 설치는 재시작을 부를 수 있습니다. [2]에 따르면 "보안 패치 설치 후 시스템 재시작이 필요한 경우가 존재하며 설치에 따른 영향도 검사가 필요함."';
    expect(guardCitations(답, 조각).removed).toHaveLength(0);
  });

  it("★ 번호 없는 원천(온톨로지·용어 정의·📎첨부)에서 옮긴 인용도 살린다", () => {
    // 프롬프트 ⓐ가 「'관련 규칙·관계'(온톨로지)가 붙어 있으면 그것도 근거로」라고 안내한다.
    // 대조 원천을 조각으로만 잡으면 **프롬프트가 시킨 대로 한 답**을 지우게 된다.
    const 온톨로지 = "관련 규칙·관계\n- 악용이 확인된 취약점은 심각도와 무관하게 최우선으로 조치한다(KEV 규칙).";
    const 답 = '우선순위는 KEV가 먼저입니다. 원문: "악용이 확인된 취약점은 심각도와 무관하게 최우선으로 조치한다"';
    expect(guardCitations(답, [], [온톨로지]).removed, "온톨로지 인용을 뗐다").toHaveLength(0);
    expect(guardCitations(답, []).removed, "원천을 안 주면 지어낸 것으로 본다").toHaveLength(1);
  });
});

describe("② 번호가 범위 밖이면 뗀다 — 실증 못 한 인용만", () => {
  it("조각 2개인데 [5]를 가리켰고 인용문도 어디에도 없다", () => {
    const r = guardCitations(`패치는 빨리 설치해야 합니다. [5]에 따르면 "${지어낸문장}"`, 조각);
    expect(r.removed[0].kind).toBe("범위밖");
    expect(r.removed[0].n).toBe(5);
  });

  it("[0]도 범위 밖 — 번호는 1부터다(ragBlock 규약)", () => {
    const 답 = `설명입니다. 그리고 또 설명을 이어서 적습니다. [0]에 따르면 "${지어낸문장}"`;
    expect(guardCitations(답, 조각).removed[0].kind).toBe("범위밖");
  });

  it("대조할 수 없는 짧은 인용이라도 번호가 없는 번호면 뗀다(찾아볼 수 없는 자리다)", () => {
    const r = guardCitations('다중 인증을 켜야 합니다. 계정 탈취를 크게 줄여 줍니다. [9]에 따르면 "MFA 필수"', 조각);
    expect(r.removed[0].kind).toBe("범위밖");
  });
});

describe("③④ 겹침이 없으면 뗀다 — 자기 말을 원문이라 우긴 것도", () => {
  it("어느 조각과도 안 겹치는 인용", () => {
    const 답 = `릴레이 기능은 제한해야 합니다. 외부에서 악용될 수 있기 때문입니다. [1]에 따르면 "${지어낸문장}"`;
    expect(guardCitations(답, 조각).removed[0].kind).toBe("겹침없음");
  });

  it("★ 자기 앞 문장을 그대로 따옴표에 넣은 꼴(실물 r4-v4 bare i2와 같은 모양)", () => {
    const 앞 = "패치 설치 전에 백업을 수행하여 데이터 손실이나 시스템 장애 발생 시 복구가 가능하도록 준비하는 것이 중요합니다.";
    const r = guardCitations(`${앞} [1]에 따르면 "${앞}"`, 조각);
    expect(r.removed[0].kind).toBe("자기인용");
    expect(r.text).toBe(앞);
  });

  it("★ 정상 인용은 살린다 — 조각 본문을 그대로 옮겼으면 손대지 않는다", () => {
    const 답 = '패치 설치는 재시작을 부를 수 있습니다. [1]에 따르면 "보안 패치 설치 후 시스템 재시작이 필요한 경우가 존재하며 설치에 따른 영향도 검사가 필요함."';
    const r = guardCitations(답, 조각);
    expect(r.removed).toHaveLength(0);
    expect(r.text).toBe(답);
  });
});

describe("★ 대조하한 23자 — 창 20 · 걸음 4의 산수", () => {
  // ★ 검토관 실측: 판정 문턱이 20자였는데 대조기는 4칸씩 밀어, **정확히 옮긴 20~22자 인용**이
  //   자리에 따라 「겹침없음」이 됐다(20자 26% · 21자 50% · 22자 76%만 잡힘). 23자부터 100%.
  it("잣대가 산수와 맞는다(20 + 4 − 1 = 23)", () => {
    expect(대조하한).toBe(OVERLAP_CHARS + 겹침걸음 - 1);
    expect(대조하한).toBe(23);
  });

  it("★ 조각의 **어느 자리에서** 20자를 그대로 옮겨도 오제거가 없다", () => {
    const 무공백 = 조각[1].replace(/\s+/g, "");
    const 뗀자리: number[] = [];
    for (let p = 0; p + 20 <= 무공백.length; p++) {
      const 답 = `기본 계정명은 바꾸는 것이 좋습니다. [1]에 따르면 "${무공백.slice(p, p + 20)}"`;
      if (guardCitations(답, 조각).removed.length > 0) 뗀자리.push(p);
    }
    expect(뗀자리, `20자 정확 인용을 뗀 자리(${뗀자리.join(",")})`).toHaveLength(0);
  });

  it("23자 이상은 제대로 판정한다 — 지어낸 것은 뗀다", () => {
    const 답 = `설명을 적습니다. 그리고 이어 적습니다. [1]에 따르면 "${지어낸문장}"`;
    expect(guardCitations(답, 조각).removed).toHaveLength(1);
  });
});

describe("★ 꼴 넓히기 — 표현을 조금 바꾼 창작 인용도 잡는다(조각 0건)", () => {
  const 지어낸 = "기본 관리자 계정명을 그대로 두면 공격자가 쉽게 타겟을 특정할 수 있습니다.";
  const 꼴 = [
    `[1]의 내용은 "${지어낸}"`, `[1] 문서에는 "${지어낸}"`, `[1]에서 "${지어낸}"`,
    `참고 자료 [1]: "${지어낸}"`, `출처: "${지어낸}"`, `근거: "${지어낸}"`,
    `사내 문서에 따르면, "${지어낸}"`, `문서에 따르면 "${지어낸}"`,
    `[1]에 따르면 ‘${지어낸}’`, `[1]에 따르면 『${지어낸}』`, `[1]에 따르면 《${지어낸}》`,
  ];
  it.each(꼴)("뗀다: %s", (꼬리) => {
    const r = guardCitations(`설명을 먼저 적습니다. 그리고 이어서 적습니다. ${꼬리}`, []);
    expect(r.removed).toHaveLength(1);
    expect(r.text).toBe("설명을 먼저 적습니다. 그리고 이어서 적습니다.");
  });

  it("★ 꼬리표와 따옴표 사이에 말이 끼어도 **인용문까지** 뗀다", () => {
    // 첫 판은 꼬리표만 떼고 지어낸 인용문을 남겼다 — 출처만 사라지고 주장은 제품 단정이 됐다.
    const r = guardCitations('설명을 적습니다. 이어서 적습니다. [1]에 따르면 다음과 같이 규정합니다: "모든 관리자 계정에는 다중 인증을 반드시 적용해야 한다."', []);
    expect(r.removed).toHaveLength(1);
    expect(r.text).not.toContain("다중 인증을 반드시");
    expect(r.text).not.toContain("규정합니다");
  });

  it("★ 인용 안에 따옴표가 또 있으면 고아 따옴표를 안 남긴다", () => {
    const r = guardCitations('설명을 적습니다. 이어서 적습니다. [1]에 따르면 "관리자 계정은 "필수"로 다중 인증을 적용해야 한다고 규정한다."', []);
    expect(r.removed).toHaveLength(1);
    expect(r.text).toBe("설명을 적습니다. 이어서 적습니다.");
  });

  it("★ 닫는 따옴표 없이 잘린 인용(토큰 한도)도 끝까지 뗀다 — 실물 3건의 꼴", () => {
    const r = guardCitations('기본 계정명은 바꿔야 합니다. 이어서 설명합니다. [22]에 따르면 "기본 계정명을 그대로 두면 공격자가 시스템에 대한 접근을', []);
    expect(r.removed).toHaveLength(1);
    expect(r.text).toBe("기본 계정명은 바꿔야 합니다. 이어서 설명합니다.");
  });
});

describe("⑤ 안 건드리는 것들 — 늘려 잡으면 정상 답을 지운다", () => {
  it("chunks가 null이면 판정 보류 — RAG를 안 돌린 호출(도구 답 합성 등)", () => {
    const 답 = '정리했습니다. 아래가 결과입니다. [1]에 따르면 "이건 판정할 근거가 아예 없는 자리입니다."';
    expect(guardCitations(답, null).removed).toHaveLength(0);
    expect(guardCitations(답, null).text).toBe(답);
  });

  it("코드블록 안은 한 글자도 안 건드린다(사용자가 요청한 원문)", () => {
    const 답 = '설정 파일은 아래와 같습니다. 그대로 쓰시면 됩니다.\n```\n# 원문: "lorem ipsum dolor sit amet consectetur"\n```';
    const r = guardCitations(답, []);
    expect(r.removed).toHaveLength(0);
    expect(r.text).toBe(답);
  });

  it("★ 코드블록 밖에서 뗐어도 코드블록 안의 빈 줄·들여쓰기는 그대로다", () => {
    const 설정 = "```\n[server]\n  port = 4000\n\n\n  host = 0.0.0.0\n```";
    const r = guardCitations(`설정은 아래와 같습니다. [1]에 따르면 "이건 근거가 0건인 자리의 지어낸 인용이다."\n${설정}`, []);
    expect(r.removed).toHaveLength(1);
    expect(r.text, "코드블록 안의 빈 줄이 손질에 눌렸다").toContain(설정);
  });

  it("★ 지울 구간이 코드블록을 **삼키면** 아예 판정을 보류한다", () => {
    // 첫 판은 꼬리표 **위치**만 보호해서, 인용 토막이 코드펜스를 넘어가면 코드블록째 지웠다.
    const 답 = '설정은 아래와 같습니다. 원문: "아래 설정을 그대로 쓰십시오\n```\nport = 4000\nhost = 0.0.0.0\n```\n끝"';
    const r = guardCitations(답, []);
    expect(r.removed).toHaveLength(0);
    expect(r.text).toBe(답);
  });

  it("23자 미만 따옴표는 겹침으로 판정하지 않는다 — 대조가 불가능하다", () => {
    const 답 = '다중 인증을 켜야 합니다. 계정 탈취를 크게 줄여 줍니다. [1]에 따르면 "MFA 필수"';
    expect(guardCitations(답, 조각).removed).toHaveLength(0);
  });

  it("따옴표 없는 풀어쓴 참조는 번호만 본다 — 글자 대조가 불가능한 것을 대조한 척하지 않는다", () => {
    const 답 = "[1]에 따르면 기본 계정명은 바꾸는 것이 좋습니다. 공격 표면이 줄어듭니다.";
    expect(guardCitations(답, 조각).removed).toHaveLength(0);
  });

  it("도구 경로의 「[1] tool: …」 번호는 인용 꼬리표가 아니다", () => {
    const 답 = "조회 결과를 정리했습니다.\n[1] tool: list_assets — 자산 58건\n[2] tool: list_vulns — 취약점 12건";
    expect(guardCitations(답, []).removed).toHaveLength(0);
  });

  it("★ 번호 없는 표식은 **따옴표가 붙었을 때만** — 「원문:」은 한국어 낱말이기도 하다", () => {
    // 첫 판은 조각 0건이면 따옴표가 없어도 떼서, 정상 산문에서 낱말만 지웠다.
    const 답 = "문서의 원문: 부분을 보시면 됩니다. 원문 대조가 필요하면 알려주세요.";
    expect(guardCitations(답, []).removed).toHaveLength(0);
    expect(guardCitations(답, []).text).toBe(답);
  });

  it("★ 빈 답 방지 — 다 떼서 **글자가 하나도** 안 남으면 원답을 그대로 두되 **세어 남긴다**", () => {
    const 답 = '원문: "이 답은 통째로 인용 하나뿐이라 떼면 아무것도 안 남는다."';
    const r = guardCitations(답, []);
    expect(r.removed).toHaveLength(0);
    expect(r.text).toBe(답);
    // ★ 첫 판은 여기서 아무것도 안 남겨, 가드가 유일하게 못 막는 부류가 기록에서도 사라졌다.
    expect(r.보류, "원답유지를 안 셌다 — 나중에 셀 수조차 없다").toHaveLength(1);
    expect(r.보류[0].kind).toBe("블록없음");
  });

  it("★ 짧아도 진짜 답이 남으면 뗀다 — 길이 문턱을 두면 지어낸 출처가 함께 통과한다", () => {
    // 문턱을 「20자 미만이면 되돌린다」로 뒀다가 이 사례에서 없는 출처가 그대로 나갔다.
    const r = guardCitations(`패치는 빨리 설치해야 합니다. [5]에 따르면 "${지어낸문장}"`, 조각);
    expect(r.removed).toHaveLength(1);
    expect(r.text).toBe("패치는 빨리 설치해야 합니다.");
  });

  it("빈 답·공백은 그대로", () => {
    expect(guardCitations("", []).text).toBe("");
    expect(guardCitations("   ", []).removed).toHaveLength(0);
  });
});

describe("★ 뗀 자리 손질 — 뗀 줄에만 걸고, 본문 표기는 안 바꾼다", () => {
  // ★ 검토관 돌연변이 실측: 첫 판의 손질은 **글 전체**에 걸렸는데 시험이 하나도 없어,
  //   통째로 지워도 33개가 전부 초록이었다. 그리고 실제로 「가 · 나」를 「가· 나」로 바꿨다.
  it("★ 가운뎃점 표기를 안 바꾸고, 뗀 자리 겹공백은 정리한다", () => {
    const 답 = '취약점 · 자산 · 로그를 함께 봅니다. [1]에 따르면 "이건 근거가 0건인 자리의 지어낸 인용 문장이다." 그리고 이어서 설명합니다.';
    const r = guardCitations(답, []);
    expect(r.removed).toHaveLength(1);
    expect(r.text, "제품이 늘 쓰는 「가 · 나」 표기가 깨졌다").toContain("취약점 · 자산 · 로그");
    expect(r.text, "뗀 자리에 겹공백이 남았다").not.toMatch(/ {2,}/);
  });

  it("★ 뗀 줄이 아닌 줄은 한 글자도 안 바꾼다(들여쓰기·정렬 공백 보존)", () => {
    const 답 = '앞줄  두 칸  그대로.\n원문: "지어낸 인용 문장을 여기에 스무 자가 넘게 적어 둔다."\n뒷줄  두 칸  그대로.';
    const r = guardCitations(답, []);
    expect(r.removed).toHaveLength(1);
    expect(r.text).toContain("앞줄  두 칸  그대로.");
    expect(r.text).toContain("뒷줄  두 칸  그대로.");
  });
});

describe("★ 잣대 단일 출처 — 관문(gates.mjs)과 갈리면 여기서 터진다", () => {
  it("꼬리표 정규식 두 개가 관문의 것과 **글자 그대로** 같다", () => {
    expect(원문꼬리표.source).toBe(관문원문꼬리표.source);
    expect(제품인용꼬리표.source).toBe(관문제품인용꼬리표.source);
  });

  it("근거겹침은 옮겨온 뒤에도 같은 답을 낸다(공백 무시·20자 창)", () => {
    expect(근거겹침("악용이 확인된 취약점은 심각도와 무관하게 최우선으로 조치", "악용이 확인된 취약점은 심각도와 무관하게 최우선으로 조치한다")).toBeTruthy();
    expect(근거겹침("전혀 다른 내용의 문장입니다", 조각[0])).toBeNull();
    expect(근거겹침("짧다", 조각[0]), "20자 미만은 판정 불가(null)").toBeNull();
  });
});

describe("★ 배선 감시 — 출구 한 곳에서 실제로 불린다", () => {
  const llm = fs.readFileSync(path.join(__dirname, "../src/engine/llm.ts"), "utf8");

  it("chat()이 RAG 조각과 **번호 없는 원천**을 출구까지 나른다", () => {
    expect(llm, "ragContextFor가 chunks를 안 돌려준다").toMatch(/자료없음: chunks\.length === 0, chunks, 추가원천 \}/);
    expect(llm, "제공자 없음·검색 실패를 chunks:null로 안 가른다").toMatch(/자료없음: false, chunks: null, 추가원천: \[\] \}/);
    expect(llm, "온톨로지 블록을 대조 원천으로 안 싣는다").toContain("parts.push(onto); 추가원천.push(onto);");
  });

  it("가드가 **복창 방어선 뒤 · 배너 앞**에서 불린다(설계관이 정한 자리)", () => {
    expect(llm, "guardCitations 호출이 없다").toContain("guardCitations(reply, ragResult?.chunks ?? null, [...(ragResult?.추가원천 ?? []), grounding, 첨부])");
    const 가드 = llm.indexOf("guardCitations(reply");
    const 복창 = llm.indexOf("복창 지속 — 답변 대체");
    const 배너 = llm.indexOf("if (ragResult?.자료없음 && reply");
    expect(복창, "복창 최종 방어선을 못 찾았다").toBeGreaterThan(0);
    expect(배너, "자료없음 배너를 못 찾았다").toBeGreaterThan(0);
    expect(가드, "가드가 복창 방어선보다 앞이다 — 재생성 답이 가드를 안 지난다").toBeGreaterThan(복창);
    expect(가드, "가드가 배너 뒤다 — 코드가 붙인 배너 글자가 자기인용 판정을 오염시킨다").toBeLessThan(배너);
  });

  it("계수기 — 뗐을 때 **그리고 못 뗐을 때(보류)도** llm:event(kind=cite)를 남긴다", () => {
    expect(llm).toMatch(/인용가드\.removed\.length > 0 \|\| 인용가드\.보류\.length > 0[\s\S]{0,900}kind: "cite"/);
    expect(llm, "감독 detail에 뗀 사유 요약이 안 실린다").toMatch(/detail: 뗀인용요약\(인용가드\.removed, 인용가드\.보류\)/);
    const act = fs.readFileSync(path.join(__dirname, "../src/engine/llmactivity.ts"), "utf8");
    expect(act, "kind 유니언에 cite가 없다").toContain('"search" | "guard" | "cite"');
  });

  it("팀원 프롬프트에 인용 꼴(ⓐ)·자료 없을 때(ⓑ) 지시가 있다", () => {
    expect(llm, "ⓐ 인용 꼴 지시가 없다").toMatch(/\[n\]에 따르면 .{0,12}옮긴 문장/);
    expect(llm, "ⓐ가 「실제로 붙어 있는 번호만」을 안 말한다").toContain("실제로 붙어 있는 번호만");
    expect(llm, "ⓑ 자료 없을 때 지시가 없다").toMatch(/참고 자료가 없거나 질문과 무관하면 근거를 지어내지 말고/);
    // ⚠ ⓑ가 배너 문구를 시키면 자료없음중복가드(앞 60자)에 걸려 **코드 배너가 안 붙는다**
    //   — ⚠ 표식이 사라져 평가 게이트 배너_RE·서랍 점검이 같은 답을 다르게 읽는다.
    const 없을때지시 = /"- 참고 자료가 없거나 질문과 무관하면[^"]*"/.exec(llm)?.[0] ?? "";
    expect(없을때지시.length, "ⓑ 줄을 못 찾았다").toBeGreaterThan(20);
    expect(없을때지시, "ⓑ가 배너 문구를 모델에게 시킨다 — ⚠ 표식이 사라진다").not.toMatch(/없습니다|자료에는 없|자료를 넣어/);
  });

  it("정직 문구가 프롬프트 조각 예외에 들어가 「복창」으로 안 몰린다", () => {
    expect(llm).toMatch(/const 정체성문구 = \[[^\]]*"등록된 사내 자료에는 관련 내용이 없습니다"/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ★★ 실물 재료 — 사다리 표본·실전 답 기록으로 **직접 잰다**(만든 사람이 고른 예문은 증거가 약하다).
//    grounded = 조각을 실제로 준 자리(정상 인용이 있다) → 오탐이 0이어야 한다.
//    bare·persona = 조각을 안 준 자리(창작만 가능) → 꼬리표가 있으면 떼야 한다.
const 재료뿌리 = path.join(__dirname, "..", "..", "tools", "team-bench", "results-ladder");
const 표본 = (p: string): Record<string, unknown>[] => {
  const f = path.join(재료뿌리, p);
  return fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, "utf8")) as Record<string, unknown>[]) : [];
};
const 훑기 = (d: string, re: RegExp, out: string[] = []): string[] => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const q = path.join(d, e.name);
    if (e.isDirectory()) 훑기(q, re, out);
    else if (re.test(e.name)) out.push(q);
  }
  return out;
};

describe("★★ 실물 재료 실측 (tools/team-bench/results-ladder)", () => {
  it("재료를 실제로 읽었다(감시가 헛돌지 않는지)", () => {
    expect(표본("day2/r4-v4/ep2/samples-grounded.json").length).toBeGreaterThanOrEqual(10);
  });

  it("★ 오탐 0 — grounded 표본의 정상 인용을 하나도 안 뗀다", () => {
    const 사례: string[] = [];
    let 총 = 0;
    for (const f of 훑기(재료뿌리, /^samples-grounded\.json$/)) {
      for (const s of JSON.parse(fs.readFileSync(f, "utf8")) as Record<string, unknown>[]) {
        총++;
        const r = guardCitations(String(s.text ?? ""), [String(s.chunk ?? "")].filter(Boolean));
        for (const x of r.removed) 사례.push(`${f.replace(재료뿌리, "")}#${s.i} ${x.kind}: ${x.quote.slice(0, 40)}`);
      }
    }
    expect(총, "표본을 못 읽었다").toBeGreaterThanOrEqual(24);
    expect(사례, `정상 인용을 뗐다(오탐):\n${사례.join("\n")}`).toHaveLength(0);
  });

  it("★ 적발 — 근거 0건 자리의 인용 꼬리표를 전부 뗀다", () => {
    const 놓친: string[] = [];
    let 대상 = 0;
    for (const f of 훑기(재료뿌리, /^samples-(bare|persona)\.json$/)) {
      for (const s of JSON.parse(fs.readFileSync(f, "utf8")) as Record<string, unknown>[]) {
        const t = String(s.text ?? "");
        if (!/원문\s*[:：]|\[\d+\]\s*(에\s*따르면|에서는|에\s*의하면)/.test(t)) continue;
        대상++;
        if (guardCitations(t, []).removed.length === 0) 놓친.push(`${f.replace(재료뿌리, "")}#${s.i}: ${t.slice(0, 80)}`);
      }
    }
    expect(대상, "창작 인용 표본을 못 찾았다 — 재료가 바뀌었다").toBeGreaterThanOrEqual(30);
    expect(놓친, `근거 없는 인용을 놓쳤다:\n${놓친.join("\n")}`).toHaveLength(0);
  });

  it("★★ 관문이 창작이라 부르는 것은 제품 가드도 **빠짐없이** 뗀다(실물 204답으로 잰다)", () => {
    // ★ 첫 판은 이 약속을 **예문 2개로만** 확인해 참인 줄 알았다. 실물로 세니 관문 46건 중
    //   1건(「사내 문서에 따르면, "…"」)을 제품이 그대로 내보내고 있었다 — 모집단을 「제품 꼬리표가
    //   든 답」으로 좁혀 세면 이 누락이 숫자에 안 보인다(모집단 함정).
    const 관문만: string[] = [];
    let 대상 = 0, 관문 = 0;
    for (const f of 훑기(재료뿌리, /^samples-(bare|persona)\.json$/)) {
      for (const s of JSON.parse(fs.readFileSync(f, "utf8")) as Record<string, unknown>[]) {
        const t = String(s.text ?? ""); if (!t) continue;
        대상++;
        if (창작인용({ text: t, question: String(s.question ?? s.q ?? "") }).length === 0) continue;
        관문++;
        if (guardCitations(t, []).removed.length === 0) 관문만.push(`${f.replace(재료뿌리, "")}#${s.i}: ${t.slice(0, 100)}`);
      }
    }
    expect(대상, "실물 표본을 못 읽었다").toBeGreaterThanOrEqual(150);
    expect(관문, "관문이 창작으로 본 답이 없다 — 예문이 아니라 재료가 낡았다").toBeGreaterThanOrEqual(30);
    expect(관문만, `관문은 잡고 제품은 내보낸다(약속 위반):\n${관문만.join("\n")}`).toHaveLength(0);
  });
});

describe("★★ 실전 답 기록으로 잰 오탐 — 넓힌 잣대가 정상 답을 지우지 않는가", () => {
  // ★ 왜 이 시험이 있나: 꼴을 넓히면 **반대 위험**(정상 답 훼손)이 커진다. 실제로 관문 방식
  //   (표식 낱말 + 10자 안에 따옴표)을 그대로 쓰면 실전 답에서 안내 문구 9건이 인용으로 걸렸다
  //   (「…새로 들어온 **문서** 알려줘"라고 물으면…」). 그래서 표식 바로 뒤 도입 어구만 본다.
  //   여기서는 **가장 사나운 조건(chunks=0)**으로 실전 답 전체를 훑어 0건을 못박는다.
  const f = path.join(__dirname, "..", "..", ".tmp-reports", "ops-sim.json");
  it.skipIf(!fs.existsSync(f))("실전 답 전체에서 한 글자도 안 바꾼다", () => {
    const rows = JSON.parse(fs.readFileSync(f, "utf8")) as Record<string, unknown>[];
    const 건드림: string[] = [];
    let 총 = 0;
    for (const r of rows) {
      const t = String(r.out ?? ""); if (!t) continue;
      총++;
      const g = guardCitations(t, []);
      if (g.text !== t || g.removed.length > 0) 건드림.push(`${String(r.q ?? "").slice(0, 30)} :: ${g.removed[0]?.quote.slice(0, 50) ?? "손질만"}`);
    }
    expect(총, "실전 답 기록이 비었다").toBeGreaterThanOrEqual(100);
    expect(건드림, `실전 답을 건드렸다(오탐):\n${건드림.join("\n")}`).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ★★ chat()을 **실제로 통과시켜** 본다 — 소스 감시는 「호출이 적혀 있다」까지만 증명한다.
//    여기서는 조각이 런타임에 실제로 출구까지 닿는지(ragProvider → ragContextFor → 가드)를 잰다.
//    모델은 스텁이다(실 LLM은 이 저장소의 시험이 스폰하지 않는다) — 재는 것은 **배선**이다.
describe("★★ chat() 실통과 — 조각이 런타임에 가드까지 닿는가", () => {
  const 스텁모델 = (답: string) => {
    const m = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: 답 } }] }) });
    vi.stubGlobal("fetch", m);
    return m;
  };

  afterEach(() => {
    vi.unstubAllGlobals();
    setRagProvider(null as unknown as Parameters<typeof setRagProvider>[0]);
    resetChatHistoryForTests();
  });

  it("근거가 0건이면 모델이 만든 「[1]에 따르면 …」이 답에서 사라진다", async () => {
    setRagProvider(async () => ({ chunks: [], 약한근거만: false }));
    스텁모델('관리자 계정명은 바꾸는 것이 좋습니다. 기본값은 널리 알려져 있습니다. [1]에 따르면 "기본 관리자 계정명을 그대로 두면 공격자가 쉽게 타겟을 특정할 수 있습니다."');
    const 답 = await chat({ agentId: "orchestrator", message: "기본 계정명을 왜 바꾸나요?", remember: true });
    expect(답, "지어낸 인용이 그대로 나갔다 — 배선이 안 닿았다").not.toContain("[1]에 따르면");
    expect(답, "본문까지 지웠다").toContain("관리자 계정명은 바꾸는 것이 좋습니다");
  });

  it("★ 조각을 실제로 준 자리에서는 같은 꼴을 **안** 뗀다(오탐 방지가 런타임에서도 산다)", async () => {
    const 조각본문 = "기본 관리자 계정명은 널리 알려져 있어 공격자가 계정을 추측하기 쉬우므로 설치 직후 변경해야 한다.";
    setRagProvider(async () => ({ chunks: [조각본문], 약한근거만: false }));
    스텁모델(`관리자 계정명은 바꾸는 것이 좋습니다. [1]에 따르면 "${조각본문}"`);
    const 답 = await chat({ agentId: "orchestrator", message: "기본 계정명을 왜 바꾸나요?", remember: true });
    expect(답, "정상 인용을 뗐다").toContain("[1]에 따르면");
  });

  it("★ 번호가 틀려도 조각 본문 그대로면 런타임에서도 살아남는다", async () => {
    const 조각본문 = "기본 관리자 계정명은 널리 알려져 있어 공격자가 계정을 추측하기 쉬우므로 설치 직후 변경해야 한다.";
    setRagProvider(async () => ({ chunks: [조각본문], 약한근거만: false }));
    스텁모델(`관리자 계정명은 바꾸는 것이 좋습니다. [7]에 따르면 "${조각본문}"`);
    const 답 = await chat({ agentId: "orchestrator", message: "기본 계정명을 왜 바꾸나요?", remember: true });
    expect(답, "참인 인용을 번호 하나 때문에 지웠다").toContain(조각본문);
  });

  it("remember:false(도구 답 합성 등)는 가드를 안 지난다 — 근거를 모르는 자리다", async () => {
    스텁모델('정리했습니다. 아래가 결과입니다. [1]에 따르면 "이 자리는 RAG를 아예 안 돌린 곳이다."');
    const 답 = await chat({ agentId: "orchestrator", message: "정리해줘", remember: false });
    expect(답).toContain("[1]에 따르면");
  });
});

describe("감독 요약 한 줄", () => {
  it("건수와 사유 종류만 싣는다 — 인용 원문(사내 문서 본문)은 안 싣는다", () => {
    const 요약 = 뗀인용요약([
      { kind: "블록없음", quote: "사내 기밀 문서의 본문 한 문장", reason: "x" },
      { kind: "블록없음", quote: "또 다른 본문", reason: "x" },
      { kind: "자기인용", quote: "제 말", reason: "x" },
    ]);
    expect(요약).toContain("3건");
    expect(요약).toContain("블록없음 2");
    expect(요약).not.toContain("사내 기밀");
  });

  it("★ 못 뗀 것(원답유지)도 한 줄에 실린다 — 안 실으면 그 부류가 기록에서 사라진다", () => {
    const 요약 = 뗀인용요약([], [{ kind: "블록없음", quote: "통째로 인용뿐인 답", reason: "x" }]);
    expect(요약).toContain("원답유지 1건");
    expect(요약).not.toContain("통째로 인용뿐");
  });
});
