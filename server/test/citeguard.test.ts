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
  짧은대조하한, 원천에있나, 자료없음안내, 근거불일치안내, 출처이름들, 클라우드근거없음안내, 강조걷은글,
  귀속꼬리길이, 기관이름인가, 실적수치자리, 실적수치뽑기, 숫자가원천에있나,
} from "../src/engine/citeguard";
import { chat, setRagProvider, resetChatHistoryForTests, 자료없음중복가드, ragBlock, RAG_BLOCK_HEADER } from "../src/engine/llm";
import { formatScreenGuide } from "../src/engine/screenguide";
// ⚠ 제목 판정은 **제품 함수**를 그대로 부른다 — 시험이 제목을 지어내면 배선을 안 재게 된다.
import { 사람이읽는문서제목 } from "../src/engine/memory";
import { sanitizeRagChunks } from "../src/engine/ragsanitize";
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

  it("★★ 답이 통째로 인용이면 **원답을 내보내지 않는다** — 자료없음 안내로 바꾼다(H3)", () => {
    // ★ 라이브 실측(2026-09-05): 옛 판은 여기서 원답을 그대로 뒀고, 그래서 지어낸
    //   「클릭률 15%」가 담당자에게 그대로 갔다. 계수기에는 「원답유지 1건」으로만 남아
    //   **막은 것처럼 보였다** — 세는 것과 막는 것은 다르다.
    const 답 = '원문: "이 답은 통째로 인용 하나뿐이라 떼면 아무것도 안 남는다."';
    const r = guardCitations(답, []);
    expect(r.text, "지어낸 인용뿐인 원답이 그대로 나갔다").not.toBe(답);
    expect(r.text).toBe(자료없음안내);
    expect(r.보류, "이제 보류로 남기지 않는다 — 바꿨으니 removed에 실린다").toHaveLength(0);
    // ★ 2026-09-06 검토관(count) — 통째교체는 **removed에 얹지 않는다**. 여기까지 오려면 조각이
    //   하나 이상이라 그 인용은 이미 세었고, 통째 교체는 그 **결과**다. 얹으면 인용 1개짜리 답이
    //   「근거 없는 인용 2건 제거」로 나간다(결정적 +1). 신호는 칸으로 남는다.
    expect(r.removed.map((x) => x.kind), "통째교체가 뗀 인용으로 한 건 더 세어졌다").toEqual(["블록없음"]);
    expect(r.통째교체, "「답 전체를 바꿨다」 신호가 사라졌다").toBe(true);
  });

  it("★ 지어낸 숫자가 인용 안에 있어도 함께 사라진다(라이브 실물 「클릭률 15%」 꼴)", () => {
    const r = guardCitations('[1]에 따르면 "메일 제목에 이모지를 넣으면 클릭률이 15% 오른다고 조사됐다."', []);
    expect(r.text, "지어낸 숫자가 사용자에게 나갔다").not.toContain("15%");
    expect(r.text).toBe(자료없음안내);
  });

  it("★ 바꾼 안내는 **새 문구가 아니다** — llm.ts의 제품 거절 문장 그대로다(단일 출처)", () => {
    const llm = fs.readFileSync(path.join(__dirname, "../src/engine/llm.ts"), "utf8");
    expect(llm, "제품 거절 문장이 llm.ts에서 사라졌다 — 두 곳이 어긋났다").toContain(자료없음안내);
  });

  it("★ 바꾼 안내가 자료없음 배너와 「없습니다」를 겹치지 않는다(코드 배너가 안 붙는다)", () => {
    // 가드는 배너보다 **앞**에서 돈다. 바꾼 답 앞 60자가 중복가드에 걸려야 배너가 안 붙는다.
    expect(자료없음중복가드.test(자료없음안내.slice(0, 60)), "배너가 겹쳐 붙어 「없습니다」가 두 번 나온다").toBe(true);
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

// ─────────────────────────────────────────────────────────────────────────────
// ★★ 2026-09-05 2차 수리(구멍 4개) — H1 자국 · H2 짧은 인용 · H3 통째 교체 · H4 맨 [n]
//    넷 다 **라이브/격리 실측에서 나온 것**이지 상상한 사례가 아니다.

/** 뗀 자리에 껍데기가 남았는가 — 세 꼴(빈 괄호·홀로 남은 굵게·빈 표지)과 겹공백·구두점 중복. */
const 자국없음 = (t: string) => {
  expect(t, "빈 괄호가 남았다").not.toMatch(/\([ \t]*\)|（[ \t]*）|\[[ \t]*\]/);
  expect((t.match(/\*\*/g) ?? []).length % 2, "짝 잃은 굵게 표식이 남았다").toBe(0);
  expect(t, "알맹이 없는 표지가 남았다").not.toMatch(/[(（\[][ \t]*(?:출처|원문|근거|자료)[ \t]*[:：]?[ \t]*[)）\]]/);
  expect(t, "겹공백이 남았다").not.toMatch(/\S[ \t]{2,}/);
  expect(t, "구두점이 겹쳤다").not.toMatch(/[,，][ \t]*[,，]/);
  // ★ K1(2026-09-05 라이브) — 인용을 떼고 **귀속 꼬리**만 남는 부류. 이 세 줄이 없어서
  //   「출처: "제목" by Brian Krebs, 2021-04-29.」이 「 by Brian Krebs, 2021-04-29.」로 나갔고
  //   그때 이 헬퍼는 초록이었다(자국을 세 꼴로만 봤다).
  expect(t, "귀속 꼬리(by 사람)가 남았다").not.toMatch(/[Bb]y[ \t]+[A-Z가-힣]/);
  expect(t, "귀속 날짜 꼬리가 남았다").not.toMatch(/(?:^|[)）\]】])[ \t]*[,，][ \t]*\(?\d{4}[\s년\-./]/m);
  expect(t, "줄표 귀속 꼬리가 남았다").not.toMatch(/^[ \t]*[—–][ \t]*[^,\n]{1,40}[,，][ \t]*\d{4}/m);
  // ★ L1(2026-09-05 실측) — 귀속 꼬리를 떼면서 **마침표가 겹쳤다**. 「…적용합니다..」·「…합니다。.」는
  //   사용자 눈에 오타로 보인다. 이 줄이 없어서 「…적용합니다..」가 나가고도 헬퍼는 초록이었다.
  expect(t, "마침표가 겹쳤다").not.toMatch(/[.。!?][ \t]*[.。]/);
};

describe("★ H1 자국 정리 — 배포 dist에서 재현된 세 꼴", () => {
  it("① 「(출처: \"지어낸 제목\")」이 「()」로 안 남는다", () => {
    const r = guardCitations('요약입니다. 아래 내용을 보세요 (출처: "존재하지 않는 사내 문서 제목입니다"). 끝.', 조각);
    expect(r.removed).toHaveLength(1);
    expect(r.text).not.toContain("출처");
    자국없음(r.text);
  });

  it("② 「**\"…\"**」가 「**」로 안 남는다", () => {
    const r = guardCitations(`설명을 적습니다. 이어서 적습니다. [1]에 따르면 **"${지어낸문장}"** 라고 되어 있습니다.`, []);
    expect(r.removed).toHaveLength(1);
    expect(r.text).not.toContain(지어낸문장);
    자국없음(r.text);
  });

  it("③ 한 줄에 둘이 겹친 실물 꼴 — 「발견·평가 (** (출처: …)」", () => {
    const r = guardCitations(`취약점 발견·평가 (**[1]에 따르면 "${지어낸문장}"** (출처: "없는 문서 제목입니다"))`, []);
    expect(r.removed.length).toBeGreaterThanOrEqual(2);
    자국없음(r.text);
  });

  it("★ 목록 알맹이가 다 사라지면 「- 」만 남기지 않는다(줄째 접는다)", () => {
    const r = guardCitations(`아래는 사례입니다.\n- 원문: "${지어낸문장}"\n계속 설명합니다.`, []);
    expect(r.text).not.toMatch(/^[ \t]*[-*·][ \t]*$/m);
    expect(r.text).toContain("계속 설명합니다.");
  });

  it("★ 자국이 없는 줄의 정상 괄호·굵게는 한 글자도 안 바꾼다", () => {
    const 답 = `인터넷 웜(Worm)은 **자동 전파**됩니다.\n원문: "${지어낸문장}"\n1) 첫째 항목 (참고) **굵게**`;
    const r = guardCitations(답, []);
    expect(r.text).toContain("인터넷 웜(Worm)은 **자동 전파**됩니다.");
    expect(r.text).toContain("1) 첫째 항목 (참고) **굵게**");
  });
});

describe("★ H2 짧은 인용(무공백 8~22자) — 라이브 실물 사고사례 2건이 그대로 나가던 자리", () => {
  it("잣대가 하나다 — 23자↑은 겹침, 8~22자는 글자 그대로, 8자 미만은 판정 없음", () => {
    expect(짧은대조하한).toBe(8);
    expect(원천에있나("기본 관리자 계정명은 널리", 조각[1]), "8~22자 그대로 옮긴 것을 못 찾았다").toBe(true);
    expect(원천에있나("기본 계정명은 절대로 못 바꾼다", 조각[1]), "없는 말을 있다고 했다").toBe(false);
    expect(원천에있나("MFA 필수", 조각[1]), "8자 미만은 판정하지 않는다").toBe(false);
  });

  // ★ 실물(2026-09-05 라이브 격리): 없는 사고사례 2건이 **출처·연월까지 붙어** 통과했고 계수는 0이었다.
  const 실물 = [
    '- **"서버 취약점 잠시 무시하다가 다시 발견"** (출처: "서버 취약점 관리 실패 사례", 2023년 4월)',
    '- **"패치 미적용으로 랜섬웨어 감염"** (출처: "국내 제조업체 침해사고 사례집", 2022년 11월)',
  ];
  it.each(실물)("출처 표지를 **표지째** 뗀다: %s", (줄) => {
    const r = guardCitations(`아래는 관련 사고 사례입니다.\n${줄}`, 조각);
    expect(r.removed.length, "지어낸 출처가 그대로 나갔다(계수도 0)").toBeGreaterThan(0);
    expect(r.text, "출처 표지가 남았다").not.toContain("출처");
    expect(r.text, "없는 출처의 연월만 살아남았다").not.toMatch(/2023년 4월|2022년 11월/);
    자국없음(r.text);
  });

  it("★★ 표지만 떼면 지어낸 사고사례가 **출처 없는 제품 단정**으로 남는다 — 앞 인용문도 함께 뗀다", () => {
    // 이 파일이 이미 겪은 함정과 같은 모양이다(「출처만 사라지고 주장은 제품 단정으로 읽혀 더 나빠졌다」).
    const r = guardCitations('아래는 관련 사고 사례입니다.\n' + 실물[0], 조각);
    expect(r.text, "지어낸 사고사례 문장이 그대로 남았다").not.toContain("잠시 무시하다가");
    expect(r.text).toContain("아래는 관련 사고 사례입니다.");
    expect(r.removed[0].reason, "사유에 함께 뗀 사실이 안 남았다").toContain("표지 앞 인용문");
  });

  it("★ 그러나 인용문이 **원천에 그대로 있으면** 살린다 — 제목이 파일명이라 조각에 없을 때", () => {
    // 제목(파일명)은 조각 본문에 없어 표지는 떼지만, 인용문은 조각 그대로이므로 남아야 한다.
    const r = guardCitations('정리하면 "설치 직후 변경해야 한다" (출처: "보안설정_지침_v3.md")입니다.', 조각);
    expect(r.text, "원천에 그대로 있는 인용문까지 뗐다").toContain("설치 직후 변경해야 한다");
    expect(r.text).not.toContain("보안설정_지침_v3.md");
  });

  it("★ 짧아도 **원천에 그대로 있으면** 안 뗀다(오탐 방지 — 이쪽이 더 무섭다)", () => {
    const r = guardCitations('설명합니다. 이어서 적습니다. [1]에 따르면 "설치 직후 변경해야 한다"', 조각);
    expect(r.removed, "조각 본문 그대로인 짧은 인용을 뗐다").toHaveLength(0);
  });

  it("★ 8자 미만은 여전히 판정하지 않는다 — 대조 못 할 것은 안 건드린다", () => {
    expect(guardCitations('다중 인증을 켜야 합니다. 계정 탈취를 줄입니다. [1]에 따르면 "MFA 필수"', 조각).removed).toHaveLength(0);
  });
});

describe("★ H4 맨 [n] — 주석은 「번호 범위만 본다」였는데 코드는 범위조차 안 봤다", () => {
  it("★ 조각이 2개인데 [1]~[8]이 그대로 나가던 자리 — 표지만 뗀다(문장은 남는다)", () => {
    const r = guardCitations("기본 계정명을 바꾸는 것이 좋습니다 [1] [5] [8]. 패치도 빨리 설치하세요.", 조각);
    expect(r.text, "범위 밖 번호가 남았다").not.toMatch(/\[5\]|\[8\]/);
    expect(r.text, "범위 안 번호까지 지웠다").toContain("[1]");
    expect(r.text, "문장을 지웠다").toContain("패치도 빨리 설치하세요.");
    expect(r.removed.map((x) => x.n)).toEqual([5, 8]);
  });

  it("★ 조각이 0건이면 맨 [n]은 전부 가리킬 곳이 없다", () => {
    const r = guardCitations("정리했습니다 [2]. 그리고 이어서 설명합니다.", []);
    expect(r.text).not.toContain("[2]");
    expect(r.text).toContain("정리했습니다. 그리고 이어서 설명합니다.");
  });

  it("★ 답이 **자기 번호 목록**을 붙였으면 손대지 않는다 — 코드가 매긴 번호다", () => {
    // 행동 대조(actioncheck)와 도구 경로(agentloop)가 실제로 내는 두 꼴.
    const 행동대조 = '【행동 대조】 × 금지\n\n사내 근거(원문 발췌 — 코드가 그대로 오림):\n  [1] 승인문답:abc — "본문"\n  [2] GIJO_지식.md — "본문"';
    expect(guardCitations(행동대조, []).removed, "코드가 오려 붙인 근거 목록을 건드렸다").toHaveLength(0);
    const 도구 = "조회 결과를 정리했습니다.\n[1] tool: list_assets — 자산 58건\n[2] tool: list_vulns — 취약점 12건";
    expect(guardCitations(도구, []).removed).toHaveLength(0);
  });

  it("★ 마크다운 링크·연도는 인용 번호가 아니다", () => {
    const 답 = "자세한 것은 [1](https://example.invalid/a) 문서를 보세요. 그리고 [2024] 판을 확인하세요.";
    expect(guardCitations(답, []).removed).toHaveLength(0);
    expect(guardCitations(답, []).text).toBe(답);
  });

  it("★ 코드블록 안의 번호는 안 건드린다", () => {
    const 답 = "설정은 아래와 같습니다.\n```\nlist[9] = 1\n```";
    expect(guardCitations(답, []).removed).toHaveLength(0);
  });

  it("★ chunks가 null이면(도구 답 합성) 맨 [n]도 판정하지 않는다", () => {
    const 답 = "정리했습니다 [7]. 이어서 설명합니다.";
    expect(guardCitations(답, null).text).toBe(답);
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
    // ⚠ **emit의 if**를 집어서 본다(2026-09-06) — 같은 글자가 앞의 `reply = 인용가드.text`
    //   줄에도 있어, 거기서부터 재면 주석이 늘 때마다 글자 예산이 넘쳐 감시가 헛돈다.
    //   경로가드까지 한 조건에 있는 줄이 **그 emit의 if**다.
    expect(llm).toMatch(/if \(인용가드\.removed\.length > 0 \|\| 인용가드\.보류\.length > 0[^)\n]*\|\| 경로가드\.통째메타\) \{[\s\S]{0,2000}kind: "cite"/);
    // ⚠ 2026-09-06 — 같은 신호에 **내부 경로 제거**(metaleak)도 함께 싣는다. 그래서 detail은
    //   변수 하나(`요약`)가 되었다. 감시하는 것은 여전히 「뗀 사유 요약이 detail로 나간다」이다.
    // ⚠ 3번째 인자(통째교체)까지 못 박는다(2026-09-06 검토관) — 빼면 「답 전체를 안내로 바꿨다」가
    //   실시간 한 줄에서 조용히 사라진다. 뗀 건수에서는 빠지되 **사실은 남아야** 한다.
    expect(llm, "뗀 사유 요약을 안 만든다")
      .toMatch(/뗀인용요약\(인용가드\.removed, 인용가드\.보류, 인용가드\.통째교체\)/);
    expect(llm, "감독 detail에 그 요약이 안 실린다").toMatch(/kind: "cite"[^\n]*detail: 요약/);
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
  // ★★ 2026-09-06 경합 — **반쪽 재료로는 재지 않는다.**
  //   야간 회귀(03:00 KST · claude-deploy)가 이 파일을 회차마다 다시 쓴다. 예전엔 10문항마다
  //   **제자리에서** 덮어써서, 그 창에 시험이 돌면 총 1건짜리 재료를 읽고 **거짓 빨강**이 났다
  //   (실측: 03:00:09 총=1 → 03:01:59 61 → 158). 생산자 쪽은 원자 교체로 고쳤고
  //   (tools/ops-sim.mjs — .partial에 쓰고 완주 뒤 rename), **읽는 쪽도 스스로 지킨다.**
  //   ⚠ 조용히 건너뛰지 않는다 — **사유를 찍는다.** 삼켜진 건너뜀은 없는 시험과 같다.
  //
  // ⚠⚠ 「mtime이 60초 이내면 건너뛴다」는 **일부러 안 넣었다**(설계안에서 한 번 걸렀다).
  //   ① wsl-test.sh가 이 파일을 사본으로 **cp**해 오므로 사본의 mtime은 늘 방금이다 —
  //      그 규칙을 넣으면 WSL에서 이 시험이 **영영 안 돈다**(이 저장소의 「헛도는 시험」 계보).
  //   ② 하네스를 돌리고 바로 시험을 돌리는 것이 정상 작업 순서인데, 그때마다 건너뛴다.
  //   대신 **완주본인가**를 본다 — 그리고 그 판정은 **생산자가 적어 준 메타**로 한다.
  //
  // ★ 2026-09-06 두 번째 손질(검토관 적발 둘) — 위 첫 판의 두 자리를 걷어냈다.
  //   ① `.partial이 더 새것` 검사를 **없앴다.** 생산자가 이미 원자 교체(rename)를 하므로
  //      읽는 쪽이 반쪽 파일을 볼 길이 없다 — 그 검사는 지키는 것이 없는데, 하네스가 중간에
  //      죽어 **고아 .partial**이 남으면(지우는 코드가 한 줄도 없다) 다음 완주 때까지
  //      이 시험이 **계속 건너뛰었다.** 거짓 빨강을 없애려다 시각에 따라 갈리는 건너뜀을 새로 만든 셈.
  //      (하네스가 도는 중이라도 ops-sim.json은 **지난 회차의 온전한 판**이라 읽어도 된다.)
  //   ② 「158건보다 적으면 반쪽」이라는 **손으로 적은 숫자**를 없앴다. 그 숫자는 적어 넣은
  //      **같은 커밋에서** 이미 낡았다(문항이 162로 늘었다) — 그러면 --limit 158~161 실행이
  //      완주본으로 통과한다. 잣대는 문항을 아는 쪽(하네스)이 적는다: `ops-sim.meta.json`.
  //   ⚠ 메타가 없으면(옛 기록·wsl 사본에 안 실림) **완주 여부를 못 가린다** — 그때는 하한선
  //     100건만 보고 돈다. 낡은 숫자를 새로 박아 넣으면 같은 결함이 되풀이된다.
  const 재료상태 = (): string => {
    if (!fs.existsSync(f)) return "재료 없음(하네스를 아직 안 돌렸다)";
    try {
      const n = (JSON.parse(fs.readFileSync(f, "utf8")) as unknown[]).length;
      const 메타파일 = path.join(path.dirname(f), "ops-sim.meta.json");
      if (fs.existsSync(메타파일)) {
        const m = JSON.parse(fs.readFileSync(메타파일, "utf8")) as { 총문항?: number; 기록?: number; 완주?: boolean };
        // 교체 순간에는 (새 메타 · 옛 기록)이 짝이 안 맞는다 — 그때는 재지 않는다.
        if (typeof m.기록 === "number" && m.기록 !== n) return `메타와 기록이 어긋난다(메타 ${m.기록} · 기록 ${n} — 교체 중)`;
        if (m.완주 !== true) return `부분 기록(${n}/${m.총문항 ?? "?"}건 — --limit 실행이다)`;
      } else if (n < 100) {
        return `부분 기록(${n}건 · 메타 없음 — 완주 여부를 못 가린다)`;
      }
    } catch { return "재료를 못 읽었다(쓰는 중이거나 깨졌다)"; }
    return "";
  };
  const 건너뛸사유 = 재료상태();
  if (건너뛸사유) console.log(`⏭ 실전 답 기록 시험을 건너뜁니다 — ${건너뛸사유}`);

  // ★★ 2026-09-07 — **무엇을 「건드림」으로 셀 것인가**를 여기 한 곳에 적는다.
  //   옛 판은 `g.removed[0]?.quote.slice(0,50) ?? "손질만"`이었는데, **번호 표지만 뗀 자리**는
  //   quote가 빈 문자열이라 `??`에 안 걸리고 빈 칸이 찍혔다. 읽는 사람은 그것을 「손질만」으로
  //   읽는다 — 실제로 2026-09-07 이 빨강을 처음 읽은 사람이 「제거가 아니라 손질만」이라고
  //   판단했다. **뗀 것을 안 뗐다고 말하는 실패 메시지**는 없느니만 못하다.
  const 건드린바 = (원문: string, g: ReturnType<typeof guardCitations>): string | null => {
    if (g.removed.length === 0 && g.text === 원문) return null;
    if (g.removed.length === 0) return "손질만 — 뗀 것 없이 글자가 바뀌었다";
    const r = g.removed[0];
    const 무엇 = r.quote ? `"${r.quote.slice(0, 50)}"` : `번호 표지 [${r.n ?? "?"}]`;
    const 더 = g.removed.length > 1 ? ` (외 ${g.removed.length - 1}건)` : "";
    return `${r.kind} ${무엇} — ${r.reason}${더}`;
  };

  // ★★ **가드가 옳게 뗀 실전 답** — 물음 글자와 사유를 적어 두고 지나간다.
  //   왜 명시 목록인가: 이 시험의 오라클은 「실전 답은 정상이다」라는 **가정**이다. 제품이
  //   실제로 인용 표기를 달기 시작하면(2026-09-07 실측: 172답 중 11답이 [n]·「원문:」을 단다)
  //   그 가정은 사례마다 깨질 수 있다. 그때 잣대를 조용히 넓히면 **오탐 감시가 통째로 꺼진다** —
  //   그래서 넓히는 대신 **사례를 이름으로 못박는다.** 목록에 없는 새 사례는 반드시 빨강으로 온다.
  //   ⚠ 여기 적을 수 있는 조건 셋: ① 가장 사나운 조건(chunks=0) 때문에 걸린 것이고
  //     ② 뗀 것이 그 조건에서 **대조 자체가 불가능한** 인용이며 ③ 사람이 답 전문을 읽고 판정했다.
  //   ⚠ 「오탐이라서 봐준다」는 여기 적지 않는다 — 그건 가드를 고칠 일이다(같은 날 ⑭ 「[1] 또는
  //     [2]」가 그랬고, citeguard.ts 나란한번호로 고쳤다).
  const 검증된제거: { 물음: string; 사유: string }[] = [
    {
      물음: "보안 교육 참여율 높이려면?",
      // 실측 2026-09-07: 답 끝에 「원문: "The authoring agencies recommend end-user organizations …"」.
      //   이 영문은 CISA 권고 원문이 맞고 저장소에도 있다(server/data/ladder/material/day1/cisa-aa/
      //   cisa-aa-01.md — 증류 **재료**다). 그런데 ① 그 재료는 RAG 저장소가 아니고(knowledge/에
      //   같은 영문이 0건) ② 물음(교육 참여율 올리기)과 아무 관계 없는 권고 머리말이다.
      //   chunks=0에서는 대조할 것이 아예 없으니 「블록없음」이 맞다 — 조각을 주면 안 뗀다(실측).
      사유: "chunks=0에서 대조 불가능한 영문 인용(CISA 권고 머리말) — 조각을 주면 안 뗀다",
    },
    {
      물음: "개인정보 교육 연 2회 맞지?",
      // 실측 2026-09-07: 「그러나 [1]에서 지적한 것처럼 …」 — 번호 표지만 뗀다(문장은 그대로).
      //   chunks=0이면 [1]이 가리킬 곳이 없으므로 설계대로다("번호가 틀린 것이지 문장이 거짓이라는
      //   증거는 없다"). 조각을 하나라도 주면 안 뗀다(실측) — 실행 시점에는 근거가 있었다.
      사유: "chunks=0이라 [1]이 가리킬 곳이 없다 — 번호 표지만 뗌(조각을 주면 안 뗀다)",
    },
  ];

  it.skipIf(!!건너뛸사유)("실전 답 전체에서 한 글자도 안 바꾼다", () => {
    const rows = JSON.parse(fs.readFileSync(f, "utf8")) as Record<string, unknown>[];
    const 건드림: string[] = [];
    const 봐준것 = new Set<string>();
    let 총 = 0;
    for (const r of rows) {
      const t = String(r.out ?? ""); if (!t) continue;
      총++;
      const q = String(r.q ?? "");
      const 무엇 = 건드린바(t, guardCitations(t, []));
      if (!무엇) continue;
      if (검증된제거.some((x) => x.물음 === q)) { 봐준것.add(q); continue; }
      건드림.push(`${q.slice(0, 30)} :: ${무엇}`);
    }
    expect(총, "실전 답 기록이 비었다").toBeGreaterThanOrEqual(100);
    expect(건드림, `실전 답을 건드렸다(오탐):\n${건드림.join("\n")}`).toHaveLength(0);
    // ⚠ **봐주기 목록이 낡으면 알린다** — 제품이 고쳐졌는데 예외가 남으면 그 예외가 다음 오탐을
    //   조용히 삼킨다(이 저장소의 「헛도는 시험」 계보). 재료가 그 물음을 안 담은 회차라면
    //   봐줄 일도 없으므로, **재료에 있는데 안 걸린** 것만 나무란다.
    const 물음들 = new Set(rows.map((r) => String(r.q ?? "")));
    const 낡은예외 = 검증된제거.filter((x) => 물음들.has(x.물음) && !봐준것.has(x.물음)).map((x) => x.물음);
    expect(낡은예외, `봐주기 목록이 낡았다(이제 안 걸린다 — 지워라):\n${낡은예외.join("\n")}`).toHaveLength(0);
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

  // ★★ J3 — 소스 감시는 「부르는 코드가 적혀 있다」까지만 증명한다. 여기서는 **제목이 실제로
  //    모델 프롬프트까지 가는지**를 스텁 fetch의 요청 본문에서 직접 본다. 그리고 그 제목을
  //    모델이 그대로 옮겨 적었을 때 가드가 **안 떼는지**까지 한 번에 잰다(주는 쪽 ↔ 재는 쪽).
  it("★★ 문서 제목이 프롬프트까지 실제로 간다 — 그리고 그 제목을 댄 인용은 안 뗀다", async () => {
    const 본문 = "기본 관리자 계정명은 널리 알려져 있어 공격자가 계정을 추측하기 쉬우므로 설치 직후 변경해야 한다.";
    const 제목 = "GIJO_AS_보안제품관리_지침.md";
    setRagProvider(async () => ({ chunks: [본문], titles: [제목], 약한근거만: false }));
    const m = 스텁모델(`계정명은 바꾸는 것이 좋습니다. (출처: "${제목}")`);
    const 답 = await chat({ agentId: "orchestrator", message: "기본 계정명을 왜 바꾸나요?", remember: true });

    const 보낸것 = String((m.mock.calls[0]?.[1] as { body?: string } | undefined)?.body ?? "");
    expect(보낸것, "제목이 프롬프트에 안 실렸다 — 「제목을 밝히라」고 시켜 놓고 재료를 안 준 셈이다")
      .toContain(`《${제목}》`);
    expect(답, "우리가 준 제목을 가드가 도로 뗐다(자충수)").toContain(제목);
  });

  // ★★ 2026-09-06 — **내부 ID가 제목 자리로 새던 자리.** 「승인문답:<로그 id>」는 우리가 가장 많이
  //    만드는 내부 ID인데 K2 그물이 `^[a-z]…`라 ASCII 접두만 봤다. 실물이 프롬프트에
  //    「[1] 《승인문답:dtmtl40khqg8uehk》 …」로 실려 나갔다.
  //    ⚠ 제목을 **손으로 적지 않는다** — 제품 함수(사람이읽는문서제목)에 실제 documentId를 넣어
  //      나온 값을 그대로 태운다. 손으로 ""를 적으면 배선이 아니라 내 짐작을 재게 된다.
  it("★★ 승인문답 내부 ID는 프롬프트에 안 실린다 — 조각 본문은 그대로 간다", async () => {
    const docId = "승인문답:dtmtl40khqg8uehk";
    const 본문 = "사내 보안서약서는 입사 시 1회 제출하며 부서장이 취합해 보안팀에 넘긴다.";
    setRagProvider(async () => ({ chunks: [본문], titles: [사람이읽는문서제목(docId)], 약한근거만: false }));
    const m = 스텁모델("보안서약서는 입사 시 제출합니다.");
    await chat({ agentId: "orchestrator", message: "보안서약서 언제 내나요?", remember: true });

    const 보낸것 = String((m.mock.calls[0]?.[1] as { body?: string } | undefined)?.body ?? "");
    expect(보낸것, "내부 ID가 제목 자리로 프롬프트에 실렸다").not.toContain("승인문답:");
    expect(보낸것, "빈 제목인데 《》 껍데기가 붙었다").not.toContain("《》");
    expect(보낸것, "제목을 지우면서 조각 본문까지 잃었다").toContain(본문);
  });

  it("★ 제목을 안 주는 제공자여도 돈다 — 옛 꼴 그대로(스텁·구 제공자 호환)", async () => {
    const 본문 = "보안 패치는 발표 후 가능한 한 빨리 설치할 것을 권장하며 영향도 검사가 필요하다.";
    setRagProvider(async () => ({ chunks: [본문], 약한근거만: false }));
    const m = 스텁모델(`[1]에 따르면 "${본문}"`);
    const 답 = await chat({ agentId: "orchestrator", message: "패치는 언제 하나요?", remember: true });
    const 보낸것 = String((m.mock.calls[0]?.[1] as { body?: string } | undefined)?.body ?? "");
    expect(보낸것, "제목이 없는데 《》 껍데기가 붙었다").not.toContain("《》");
    expect(답, "정상 인용을 뗐다").toContain("[1]에 따르면");
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

// ─────────────────────────────────────────────────────────────────────────────
// ★★ 2026-09-05 3차 수리(검토관 9건) — 재수리 커밋이 열어 둔 자리들.
//    ⚠ 이 절은 **돌연변이로 뚫렸던 자리**를 메우는 것이 목적이다. 2차 커밋이 약속한 규칙 여덟은
//      시험이 하나도 없어 한 줄씩 지워도 81개가 전부 초록이었다(검토관 실측). 규칙마다
//      「이걸 지우면 어디가 붉어지나」를 여기에 못 박는다.

describe("★★ H1-2 목록 표시 — 우리가 안 만든 괄호를 자국으로 오인하던 자리", () => {
  it("★ 「가) …」 한 줄이 답 전체일 때 「가」 한 글자로 안 나간다", () => {
    // 실측(검토관): 자국 ±3칸이 목록 표시의 「)」를 먹고, 남은 「가」가 글자라 통째 교체도 안 걸렸다.
    const r = guardCitations('가) **"패치 미적용으로 랜섬웨어 감염"** (출처: "국내 제조업체 침해사고 사례집", 2022년 11월)', 조각);
    expect(r.text, "한 글자짜리 답이 사용자에게 나갔다").not.toBe("가");
    expect(r.text).toBe(근거불일치안내);
  });

  it("★ 「1) …」 줄만 접히고 이웃 목록 줄은 그대로 산다", () => {
    const r = guardCitations(
      '아래는 사례입니다.\n1) **"서버 취약점 잠시 무시하다가 다시 발견"** (출처: "서버 취약점 관리 실패 사례", 2023년 4월)\n2) 계속',
      조각,
    );
    expect(r.text).toBe("아래는 사례입니다.\n2) 계속");
  });

  it("★ 뗀 자리 **뒤에** 붙은 목록 표시도 안 먹는다", () => {
    const r = guardCitations('원문: "이 문장은 어느 조각에도 없는 지어낸 원문입니다 정말로." 1) 첫째 항목', 조각);
    expect(r.text).toBe("1) 첫째 항목");
  });

  it("★ 그래도 **자국에서 먼** 짝 잃은 괄호는 안 건드린다(±3칸 창이 살아 있나)", () => {
    // ⚠ 돌연변이 감시: 창을 999로 넓히면 이 줄의 「:)」가 사라진다 — 그때 여기가 붉어져야 한다.
    const r = guardCitations('이모티콘 :) 을 씁니다. 원문: "이 문장은 어느 조각에도 없는 지어낸 원문입니다 정말로."', 조각);
    expect(r.text, "자국에서 먼 괄호까지 지웠다").toContain(":)");
  });
});

describe("★★ H2-2 출처 제목 — 제목이 짧으면 통째로 통과하던 자리", () => {
  it("★ 제목이 무공백 5자여도 사고사례 줄이 통째로 사라진다", () => {
    // 2차 커밋의 「사고사례 2건 닫힘」은 그 두 제목이 길었기 때문이었다(검토관 실측).
    const r = guardCitations('아래는 사례입니다.\n- **"서버 취약점 잠시 무시하다가 다시 발견"** (출처: "실패 사례집", 2023년 4월)', 조각);
    expect(r.removed.length, "짧은 제목이라 아무것도 안 뗐다").toBeGreaterThan(0);
    expect(r.text).not.toContain("잠시 무시하다가");
    expect(r.text).not.toContain("2023년 4월");
  });

  it("★ 제목을 못 확인한 것과 인용을 지어낸 것을 **따로 센다**", () => {
    // 조각에는 문서 제목이 안 실린다(memory.ts c.text) — 「미확인」과 「지어냄」은 다른 사실이다.
    const 표지만 = guardCitations('요약입니다. 아래 내용을 보세요 (출처: "존재하지 않는 사내 문서 제목입니다"). 끝.', 조각);
    expect(표지만.removed.map((x) => x.kind)).toEqual(["출처미확인"]);
    const 인용까지 = guardCitations('아래는 사례입니다.\n- **"서버 취약점 잠시 무시하다가 다시 발견"** (출처: "실패 사례집", 2023년 4월)', 조각);
    expect(인용까지.removed.map((x) => x.kind)).toEqual(["겹침없음"]);
  });

  it("★ 제목이 **원천 글에 그대로** 있으면 표지를 안 뗀다(온톨로지·📎첨부에서 옮긴 자리)", () => {
    const r = guardCitations('정리하면 다음과 같습니다 (출처: "보안설정_지침_v3.md").', 조각, ["보안설정_지침_v3.md 문서의 요약"]);
    expect(r.removed, "원천에 그대로 있는 제목을 뗐다").toHaveLength(0);
  });
});

describe("★★ H3-2 통째 교체 — 조각이 있는데 「자료가 없다」고 단정하던 자리", () => {
  it("★ 조각이 있으면 **다른 문장**으로 바꾼다(확인하지 않은 것을 단정하지 않는다)", () => {
    const r = guardCitations('[1]에 따르면 "메일 제목에 이모지를 넣으면 클릭률이 15% 오른다고 조사됐다"', 조각);
    expect(r.text).toBe(근거불일치안내);
    expect(r.text, "조각을 줬는데 「자료가 없다」고 말했다").not.toBe(자료없음안내);
  });

  it("★ 조각이 0건이면 종전 문장 그대로 — 그때는 「자료가 없다」가 사실이다", () => {
    expect(guardCitations('원문: "이 답은 통째로 인용 하나뿐이라 떼면 아무것도 안 남는다."', []).text).toBe(자료없음안내);
  });

  it("★ 바꾼 문장도 자료없음 배너와 「없습니다」를 겹치지 않는다", () => {
    expect(자료없음중복가드.test(근거불일치안내.slice(0, 60)), "배너가 겹쳐 붙는다").toBe(true);
  });
});

describe("★★ H4-2 맨 [n] — 참고문헌 목록이 답 전체 판정을 끄던 자리", () => {
  it("★ 끝에 참고문헌을 붙여도 본문의 범위 밖 번호는 뗀다(보류는 **그 줄에만**)", () => {
    const r = guardCitations("기본 계정명을 바꾸세요 [5] [8].\n\n참고 문헌\n[1] KISA 가이드 2024년판\n[2] 사내 보안지침", 조각);
    expect(r.removed.map((x) => x.n).sort(), "답 전체 판정이 꺼졌다").toEqual([5, 8]);
    expect(r.text, "코드가 매긴 목록 줄을 건드렸다").toContain("[1] KISA 가이드 2024년판");
  });

  it("★ 배열 자리·인라인 코드·조항 번호는 인용 번호가 아니다", () => {
    for (const 답 of ["로그 배열의 첫 항목 logs[0]을 확인하세요.", "설정에서 `rules[0]`을 보세요.", "규정 [12]항을 보세요."]) {
      const r = guardCitations(답, 조각);
      expect(r.text, 답).toBe(답);
      expect(r.removed, `${답} — 계수기까지 오염된다`).toHaveLength(0);
    }
  });

  it("★ 낱말에 **붙은** 대괄호 제외 — 뒤가 글자가 아닐 때도 산다(⑩ 규칙 단독 감시)", () => {
    // 「logs[0]을」은 뒤 글자 규칙에도 걸려 서로를 가린다 — 뒤에 공백을 두어 앞 규칙만 재게 한다.
    const 답 = "배열 항목 logs[3] 을 보세요.";
    expect(guardCitations(답, 조각).removed).toHaveLength(0);
  });

  it("★ 인라인 코드 보호 — 양옆이 백틱뿐일 때도 산다(⑫ 규칙 단독 감시)", () => {
    const 답 = "설정값은 `[3]` 입니다.";
    expect(guardCitations(답, 조각).removed).toHaveLength(0);
    expect(guardCitations(답, 조각).text).toBe(답);
  });

  it("★ 「[7] tool: …」 제외는 **줄머리가 아닌 자리**에서도 산다(⑦ 규칙 단독 감시)", () => {
    // ⚠ 이 입력은 자기목록_RE(줄머리)에 안 걸린다 — 두 제외 규칙이 서로를 가리지 않게 갈라 둔 것이다.
    const 답 = "아래 [7] tool: list_assets 를 보세요.";
    expect(guardCitations(답, 조각).removed).toHaveLength(0);
  });

  // ★★ 2026-09-07 — **번호를 나란히 늘어놓은 자리**는 인용이 아니라 「자리표를 예로 든 것」이다.
  //   실전 답(야간 회귀 172문항 · ⑭ 「AI가 뭘 근거로 답했는지 볼 수 있어?」)에서 이 자리가 부서졌다:
  //     원답 「…질문에 대한 답변이 [1] 또는 [2]에 해당하는 문서를 인용하고 있다면…」
  //     가드 「…질문에 대한 답변이 또는 [2]에 해당하는 문서를 인용하고 있다면…」
  //   왜 한쪽만 떨어졌나: [2]는 조사(「에」)가 바로 붙어 ⑩ 규칙(낱말에 붙은 대괄호)에 걸려 살아남고,
  //   [1]은 뒤가 공백이라 그 규칙을 안 탄다. **같은 나열의 형제가 서로 다른 판정을 받은 것**이다.
  //   ⚠ 「둘 다 뗀다」는 답이 아니다 — 「답변이 또는 에 해당하는」이 되어 더 부서진다.
  //     이 꼴은 인용 주장이 아니라 **인용 표기를 설명하는 안내 문장**이라 애초에 판정 대상이 아니다.
  it("★★ 「[1] 또는 [2]」처럼 나란한 번호는 안 뗀다 — 이웃만 살아남아 문장이 부서졌다", () => {
    const 답 = "예를 들어, 질문에 대한 답변이 [1] 또는 [2]에 해당하는 문서를 인용하고 있다면 확인할 수 있습니다.";
    const r = guardCitations(답, []);
    expect(r.text, "나란한 번호 한쪽만 떼어 문장을 부쉈다").toBe(답);
    expect(r.removed, "자리표를 예로 든 것을 인용 건수로 셌다").toHaveLength(0);
  });

  it("★ 나열 표시가 「또는」만은 아니다 — 쉼표·가운뎃점·「과」도 같은 자리다", () => {
    for (const 답 of [
      "번호는 [1], [2] 처럼 붙습니다.",
      "번호는 [1]·[2] 로 적습니다.",
      "근거 번호 [1] 과 [2] 를 보세요.",
      "표기는 [7] 또는 [8] 입니다.",
    ]) {
      const r = guardCitations(답, []);
      expect(r.text, 답).toBe(답);
      expect(r.removed, `${답} — 계수기까지 오염된다`).toHaveLength(0);
    }
  });

  it("★★ 나열이 아닌 **홑 번호**는 종전대로 뗀다 — 좁힘이 가드를 통째로 끄지 않는다", () => {
    const r = guardCitations("기본 계정명을 바꾸세요 [9].", []);
    expect(r.removed.map((x) => x.n), "홑 번호까지 살려 버렸다").toEqual([9]);
  });

  it("★★ 나열 뒤에 **주장이 붙으면** 그 자리는 주장_RE가 종전대로 본다", () => {
    // 「[1] 또는 [2]에 따르면 "…"」 — 뒤쪽은 도입 어구가 붙은 인용 주장이라 살려 두면 안 된다.
    const r = guardCitations('[1] 또는 [2]에 따르면 "우리 문서에 없는 지어낸 문장이 여기에 들어간다."', []);
    expect(r.removed.length, "나열 좁힘이 뒤따르는 인용 주장까지 껐다").toBeGreaterThan(0);
  });

  it("★ 마크다운 링크 제외도 **콜론 없는 주소**에서 산다(⑧ 규칙 단독 감시)", () => {
    // ⚠ 옛 시험 입력은 「https:」의 콜론 때문에 목록정의_RE에도 걸려 두 규칙이 서로를 가렸다.
    const 답 = "자세한 것은 [1](#자산목록) 문서를 보세요.";
    expect(guardCitations(답, []).removed).toHaveLength(0);
    expect(guardCitations(답, []).text).toBe(답);
  });
});

describe("★★ 인용 대조 — 생략 표기가 참인 인용을 떨구던 자리", () => {
  it("★ 「…」가 붙어도 원천에 있으면 안 뗀다(옛 판에 없던 새 오탐)", () => {
    expect(원천에있나("설치 직후 변경해야 한다…", 조각[1]), "말줄임표 한 글자에 무너졌다").toBe(true);
    expect(guardCitations('[1]에 따르면 "설치 직후 변경해야 한다…"', 조각).removed).toHaveLength(0);
  });

  it("★ 가운데를 생략해도 **양쪽 다** 원천에 있어야 산다", () => {
    expect(원천에있나("기본 관리자…설치 직후 변경해야", 조각[1])).toBe(true);
    expect(원천에있나("기본 관리자…절대 바꾸면 안 된다", 조각[1]), "없는 말을 있다고 했다").toBe(false);
  });
});

describe("★★ 자국 손질 규칙별 감시 — 한 줄씩 지워도 초록이던 자리", () => {
  it("★ ② 손질은 **한 바퀴로 안 끝난다**(겹친 껍데기가 두 겹일 때)", () => {
    const r = guardCitations(`발견·평가 ((**[1]에 따르면 "${지어낸문장}"**))`, []);
    expect(r.text, "두 겹 괄호 껍데기가 남았다").not.toMatch(/\([ \t]*\)/);
    expect(r.text, "빈 굵게가 남았다").not.toContain("**");
  });

  it("★ ⑤ 껍데기만 남은 쉼표 — 「(, 2023년 …)」로 안 남는다", () => {
    // 꼬리가 40자를 넘어 표지째 못 잡는 자리(그때 여는 괄호는 남긴다 — 남의 괄호를 안 연다).
    const 답 = '정리합니다 (출처: "지어낸제목입니다여기에", 2023년 4월에 발표된 아주 긴 꼬리를 여기에 넉넉히 붙여서 마흔 글자를 넘긴다)';
    const r = guardCitations(답, 조각);
    expect(r.removed.length).toBeGreaterThan(0);
    expect(r.text, "없는 출처의 쉼표 껍데기가 남았다").not.toContain("(,");
  });

  it("★ ⑥ 짝을 못 찾은 **여는** 괄호도 자국 옆이면 뗀다", () => {
    const r = guardCitations(`설명합니다 (원문: "${지어낸문장}"`, []);
    expect(r.text, "고아 여는 괄호가 남았다").not.toMatch(/\($/);
  });

  it("★ 붙어 있는 두 굵게의 경계(「**중요****주의**」)는 안 먹는다", () => {
    const r = guardCitations(`**중요****주의** 사항 [1]에 따르면 "${지어낸문장}"`, 조각);
    expect(r.text, "본문의 굵게 경계를 먹었다").toContain("**중요****주의**");
  });

  it("★ 표 줄의 정렬 공백은 뗀 줄이라도 안 바꾼다", () => {
    const r = guardCitations(`| 항목   | 값    |\n| 계정   | [1]에 따르면 "${지어낸문장}" |`, 조각);
    expect(r.text, "안 뗀 줄의 정렬이 어긋났다").toContain("| 항목   | 값    |");
    expect(r.text, "뗀 줄의 정렬 공백이 뭉개졌다").toContain("| 계정   |");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ★★ J1 — 마크다운 내성. **배포 dist에서 실제로 재현된 다섯 꼴**이 재료다(만든 예문이 아니다).
//    이 다섯은 전부 「뗌 0」이었다: 굵게(`**`)와 줄바꿈이 앞인용_RE·사이말_RE를 깨뜨렸다.
//    ⚠ 제품이 모델에게 마크다운을 시키므로 이건 드문 꼴이 아니라 **주류**다 —
//      가드가 막으려던 답의 가장 흔한 모양을 원리상 못 보고 있었다.
describe("★★ J1 마크다운 내성 — 배포 dist 재현 5꼴", () => {
  const 제목 = "서버 취약점 관리 실패 사례";
  const 다섯: [string, string][] = [
    ["**출처:** \"제목\"", `사고가 있었습니다.\n- **출처:** "${제목}"`],
    ["**출처**: \"제목\"", `사고가 있었습니다.\n- **출처**: "${제목}"`],
    ["**원문:** \"…\"", `요약합니다.\n**원문:** "${지어낸문장}"`],
    ["출처: **\"제목\"**", `사고가 있었습니다.\n출처: **"${제목}"**`],
    ["출처:⏎\"제목\"", `사고가 있었습니다.\n출처:\n"${제목}"`],
  ];

  it.each(다섯)("뗀다: %s", (_이름, 답) => {
    const r = guardCitations(답, []);
    expect(r.removed.length, "배포본에서 뗌 0이던 꼴을 여전히 못 뗀다").toBeGreaterThan(0);
    expect(r.text, "지어낸 제목·원문이 그대로 남았다").not.toMatch(/서버 취약점 관리 실패 사례|릴레이 기능을/);
  });

  it.each(다섯)("자국이 안 남는다 — 고아 굵게·빈 목록: %s", (_이름, 답) => {
    const r = guardCitations(답, []);
    expect(r.text, "고아 굵게(**)가 남았다").not.toMatch(/\*\*/);
    expect(r.text, "빈 목록 표시가 남았다").not.toMatch(/^\s*-\s*$/m);
  });

  it("★ 오탐 반대편 — **조각 그대로면** 굵게가 붙어 있어도 안 뗀다", () => {
    const r = guardCitations(`**[1]에 따르면** "${조각[0]}"`, 조각);
    expect(r.removed, "정상 인용을 마크다운 때문에 뗐다").toHaveLength(0);
    expect(r.text, "본문 굵게를 건드렸다").toContain("**[1]에 따르면**");
  });

  it("★ 낱말 사이의 밑줄은 **강조가 아니다** — 걷어내면 원천 대조가 거짓으로 실패한다", () => {
    const 조각들 = ["설정 파일에서 api_key 값을 그대로 두면 안 되며 배포 전에 반드시 교체해야 한다고 규정한다."];
    const r = guardCitations(`[1]에 따르면 "${조각들[0]}"`, 조각들);
    expect(r.removed, "api_key의 밑줄을 강조로 보고 원천 대조를 깨뜨렸다").toHaveLength(0);
  });

  it("★ 코드 구간 안의 굵게·따옴표는 판정본에서도 안 건드린다", () => {
    const 답 = '설정은 다음과 같습니다.\n```\n출처: **"foo"**\n```';
    expect(guardCitations(답, []).text).toBe(답);
  });

  it("★ 남의 굵게를 닫는 표식은 안 먹는다 — 「**중요**출처: \"…\"」", () => {
    const r = guardCitations(`**중요**출처: "${지어낸문장}"`, []);
    expect(r.removed.length, "지어낸 인용을 못 뗐다").toBeGreaterThan(0);
    expect(r.text, "앞 문장의 굵게 짝을 깨뜨렸다").toContain("**중요**");
  });

  it("★ 줄바꿈은 **한 줄까지만** 넘는다 — 세 줄 아래 따옴표를 삼키지 않는다", () => {
    const 답 = `출처:\n\n\n"${지어낸문장}"`;
    expect(guardCitations(답, []).text, "먼 줄의 따옴표까지 삼켰다").toContain(지어낸문장);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ★★ J2 — 따옴표 없는 **맨몸 출처 표지**. 배포 dist에서 조각 0건인데도 뗌 0이던 자리다.
//    지어낸 CSOOnline 기사가 보안 담당자에게 그대로 나갔다.
describe("★★ J2 맨몸 출처 표지 — 따옴표가 없다고 주장이 아닌 것이 아니다", () => {
  const 뗄것: [string, string][] = [
    ["(출처: 이름, 날짜)", "2021년 대규모 유출이 있었습니다. (출처: CSOOnline, 2021년 11월 25일)"],
    ["(출처: 기관)", "국내 침해 신고는 24시간 안에 해야 합니다. (출처: 한국인터넷진흥원)"],
    ["줄끝 출처: 이름", "정리하면 다음과 같습니다.\n출처: CSOOnline"],
    ["줄표 귀속", "대규모 유출 사고가 있었습니다.\n— CSOOnline, 2021년 11월 25일"],
  ];

  it.each(뗄것)("표지를 뗀다: %s", (_이름, 답) => {
    const r = guardCitations(답, []);
    expect(r.removed.length, "맨몸 표지를 못 뗐다").toBeGreaterThan(0);
    expect(r.removed.every((x) => x.kind === "출처미확인"), "사유가 출처미확인이 아니다").toBe(true);
    expect(r.text, "지어낸 출처 이름이 남았다").not.toMatch(/CSOOnline|한국인터넷진흥원/);
  });

  it("★★ **앞 문장은 살린다** — 표지만 뗀다(문장까지 떼면 답이 사라진다)", () => {
    const r = guardCitations("2021년 대규모 유출이 있었습니다. (출처: CSOOnline, 2021년 11월 25일)", []);
    expect(r.text, "표지를 떼면서 앞 문장까지 지웠다").toContain("2021년 대규모 유출이 있었습니다");
    expect(r.text, "날짜 껍데기가 남았다").not.toMatch(/2021년 11월 25일|\(\s*\)|\(,/);
  });

  it("★ 이름이 **원천에 있으면** 안 뗀다 — 우리가 준 제목을 가드가 지우면 자충수다", () => {
    const 원천 = ["한국인터넷진흥원이 발간한 침해사고 대응 안내서에 따르면 신고는 지체 없이 해야 한다."];
    const r = guardCitations("신고는 지체 없이 해야 합니다. (출처: 한국인터넷진흥원)", 원천);
    expect(r.removed, "원천에 있는 출처 이름을 뗐다").toHaveLength(0);
  });

  it("★★ **제품이 만든 문서 참조**는 판정에서 뺀다 — 실전 답 8건이 전부 이 꼴이었다", () => {
    const 실물 = [
      "가명정보는 추가 정보 없이는 특정 개인을 알아볼 수 없게 한 것입니다. (근거: GIJO_지식_가명정보_처리.md)",
      "통지·신고 의무는 다음과 같습니다. (근거: 개인정보_유출_통지_신고.md, 개인정보_접속기록_보관.md)",
      "조사 결과는 다음과 같습니다. (출처: internet-research-2026-07)",
      "정리하면 다음과 같습니다.\n근거: store:GIJO_AS_보안제품관리_지침.md#0f40a46117f4",
    ];
    for (const 답 of 실물) {
      expect(guardCitations(답, []).text, `제품이 붙인 근거 표시를 지웠다: ${답}`).toBe(답);
    }
  });

  it("★ 날짜·쪽수는 이름이 아니다 — 이름만 골라 낸다", () => {
    expect(출처이름들("CSOOnline, 2021년 11월 25일")).toEqual(["CSOOnline"]);
    expect(출처이름들("한국인터넷진흥원")).toEqual(["한국인터넷진흥원"]);
    expect(출처이름들("2023년 4월")).toEqual([]);
  });

  it("★ 줄표 꼴은 **날짜가 있을 때만** — 평범한 줄표 문장을 안 건드린다", () => {
    const 답 = "조치는 다음과 같습니다.\n— 자세한 내용은 담당자에게 문의하세요";
    expect(guardCitations(답, []).text).toBe(답);
  });

  it("★ 문장 한복판의 「자료:」는 안 건드린다 — 줄머리 표식만 본다", () => {
    const 답 = "이 화면에서 참고 자료: 목록을 눌러 보시면 됩니다";
    expect(guardCitations(답, []).text).toBe(답);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ★★ J3 — 「참고 자료」 블록에 **문서 제목**을 싣는다.
//    구조 결함이었다: 프롬프트는 「사례 제목과 출처를 함께 밝히라」고 시키는데 조각에는 제목이
//    실린 적이 없었다(memory.ts가 c.text만 담았다) → 모델의 제목은 **구조적으로 지어낸 것**.
describe("★★ J3 참고 자료 블록의 문서 제목", () => {
  const llmsrc = fs.readFileSync(path.join(__dirname, "../src/engine/llm.ts"), "utf8");
  const memsrc = fs.readFileSync(path.join(__dirname, "../src/engine/memory.ts"), "utf8");
  const sansrc = fs.readFileSync(path.join(__dirname, "../src/engine/ragsanitize.ts"), "utf8");

  it("제목을 주면 「[n] 《제목》 본문」으로 나간다", () => {
    expect(ragBlock(["가", "나"], ["지침.md", "사례집.md"]))
      .toBe(RAG_BLOCK_HEADER + "\n[1] 《지침.md》 가\n[2] 《사례집.md》 나");
  });

  it("★ 제목을 **안 주면 옛 꼴 그대로** — RAFT 빌더·창구 예시가 안 갈린다", () => {
    expect(ragBlock(["가", "나"])).toBe(RAG_BLOCK_HEADER + "\n[1] 가\n[2] 나");
    expect(ragBlock(["가"], [""])).toBe(RAG_BLOCK_HEADER + "\n[1] 가");
    expect(ragBlock(["가"], [undefined])).toBe(RAG_BLOCK_HEADER + "\n[1] 가");
  });

  it("★ 머리말은 한 글자도 안 바뀌었다 — 바꾸면 이미 구운 어댑터의 학습 꼴과 갈린다", () => {
    expect(RAG_BLOCK_HEADER.startsWith("참고 자료 — 사내 지식 베이스")).toBe(true);
  });

  it("★ 제목은 **사람이 읽는 제목**이다 — documentId를 그대로 싣지 않는다(K2)", () => {
    // ★ 왜 바뀌었나(2026-09-05 K2 라이브): documentId를 그대로 실었더니 내부 ID가 답에 나갔다
    //   (「(출처: 《incident-case:ic-c37e91a2db580f43》)」). 판정은 사람이읽는문서제목 한 곳이다.
    expect(memsrc, "queryMemoryGraded가 titles를 안 돌려준다")
      .toMatch(/titles:\s*쓸것\.map\(\(c\) => 사람이읽는문서제목\(c\.documentId\)\)/);
    expect(memsrc, "documentId를 제목으로 그대로 싣는 옛 줄이 살아 있다")
      .not.toMatch(/titles:\s*쓸것\.map\(\(c\) => c\.documentId/);
    expect(memsrc, "반환 타입에 titles가 없다").toContain("chunks: string[]; titles: string[]");
    // 종류별 판정(사례·개인 문서·ID 꼴)의 실동작은 test/doctitle.test.ts가 잰다 — 여기선 배선만.
    expect(memsrc, "사례/개인 문서 접두를 안 가른다").toContain('const 사례접두 = "incident-case:"');
    expect(memsrc, "사례/개인 문서 접두를 안 가른다").toContain('const 개인접두 = "personal:"');
  });

  it("★★ 살균이 조각을 **버릴 때 제목도 같이 버린다** — 안 그러면 한 칸씩 밀린다", () => {
    // 이 저장소가 이미 한 번 밟은 함정이다(handlers.ts 「한 조각씩 살균」 + ops147-regress 감시).
    // 그때 답은 「한 조각씩 부르기」였는데 그러면 감사 기록이 쪼개진다 → 이번엔 자리표를 받는다.
    expect(sansrc, "살균기가 keptIndexes를 안 돌려준다").toContain("keptIndexes");
    expect(llmsrc, "llm.ts가 제목을 자리표로 안 거른다").toMatch(/살균\.keptIndexes\.map\(\(i\) => String\(rawTitles/);
  });

  it("★ 살균이 버린 자리만큼 제목도 밀린다(자리표 산수 자체를 잰다)", () => {
    // 가운데 조각은 「내용이 거의 없는」 것이라 살균이 통째로 버린다.
    const raw = ["실제 내용이 충분히 들어 있는 첫 번째 조각입니다.", "짧음", "실제 내용이 충분히 들어 있는 세 번째 조각입니다."];
    const 제목 = ["첫.md", "버려질.md", "셋.md"];
    const s = sanitizeRagChunks(raw, { source: "test" });
    const 걸러진제목 = s.keptIndexes.map((i) => 제목[i]);
    expect(s.chunks.length, "재료가 바뀌었다 — 가운데가 안 버려졌다").toBe(2);
    expect(걸러진제목, "제목이 한 칸 밀렸다").toEqual(["첫.md", "셋.md"]);
  });

  it("★★ 제목이 **대조 원천**에 들어간다 — 우리가 준 제목을 가드가 떼면 자충수다", () => {
    expect(llmsrc, "titles가 추가원천에 안 들어간다").toMatch(/const 추가원천: string\[\] = titles\.filter\(Boolean\)/);
    // 잣대 자체도 잰다: 제목이 원천에 있으면 그 제목을 댄 표지는 안 뗀다.
    expect(guardCitations('신고 절차는 다음과 같습니다. (출처: "침해사고_대응_지침.md")', ["본문"], ["침해사고_대응_지침.md"]).removed)
      .toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ★★ J4 — 감독 화면 ✂. 「쌓이는데 그리는 화면이 없다」를 닫는다.
describe("★★ J4 감독 화면·실동작 스트림의 ✂", () => {
  const 화면 = (p: string) => fs.readFileSync(path.join(__dirname, "../../client/src/renderer/pages", p), "utf8");
  const sup = 화면("supervision.html");
  const agent = 화면("agent.html");

  it("감독 화면이 kind=cite를 **합산**한다 — 7·30일은 (날짜 × 팀원) 여러 줄로 온다", () => {
    expect(sup, "cite 합산이 없다").toMatch(/if \(d\.kind !== "cite"\) return;/);
    expect(sup, "합산이 아니라 대입이면 마지막 날만 남는다").toMatch(/뗀답 \+= d\.calls \|\| 0;/);
    expect(sup, "팀원별도 합산이어야 한다").toMatch(/인용별\[d\.agent\] = \(인용별\[d\.agent\] \|\| 0\) \+/);
    // ⚠ chat으로 거른 daily가 아니라 **원본 sup.daily**를 다시 훑어야 한다(거른 것을 다시 안 쓴다).
    expect(sup, "거른 daily에서 cite를 찾고 있다 — 늘 0이 된다").toMatch(/\(sup\.daily \|\| \[\]\)\.forEach\(function \(d\) \{\s*\n\s*if \(d\.kind !== "cite"\)/);
  });

  it("★ 「정상」 줄이 살아 있다 — ✂ 줄을 늘 넣으므로 lines.length로 재면 영영 안 뜬다", () => {
    expect(sup, "정상 판정이 여전히 lines.length다").not.toMatch(/if \(!lines\.length\) lines\.push\('<div class="sup-line"><span class="tag ok">/);
    expect(sup, "정상 판정이 무호출·오류만 보지 않는다").toMatch(/if \(!무호출\.length && !오류상위\.length\) lines\.push/);
  });

  it("★ 0일 때도 줄을 숨기지 않는다 — 「장애 ≠ 부재」", () => {
    expect(sup).toContain("0개 — 이 기간에 뗀 인용이 없습니다");
  });

  it("★★ 문구가 「건수」가 아니라 「답 개수」다 — 답 하나에 이벤트 하나라 건수라 쓰면 거짓", () => {
    expect(sup).toContain("답 \" + 뗀답 + \"개에서 근거 없는 인용을 뗐습니다");
    expect(sup, "표에 「건」이라 적었다 — 집계는 답의 수다").not.toMatch(/뗀답 \+ "건/);
  });

  it("tag cite 색이 있다(없으면 라벨이 배경 없이 뜬다)", () => {
    expect(sup).toMatch(/\.tag\.cite\{background:rgba\(139,124,240/);
  });

  it("★ 실동작 스트림 아이콘 ✂ — **사람이 보는 유일한 변화**", () => {
    expect(agent, "fmtLlm에 cite 아이콘이 없다").toMatch(/evt\.kind === "cite" \? "✂"/);
    // 입구 검사(🛡 guard)와 출구 검사(✂ cite)를 한 아이콘으로 묶지 않는다.
    expect(agent).toMatch(/evt\.kind === "guard" \? "🛡" : evt\.kind === "cite" \? "✂"/);
  });

  it("★ 죽은 함수 llmRowHtml — 라벨은 맞춰 두되 **호출 0**임을 주석이 말한다", () => {
    expect(agent, "라벨에 인용이 없다").toMatch(/f\.kind === "cite" \? "인용"/);
    expect(agent, "죽은 함수라는 표기가 없다 — 「스트림 라벨을 바꿨다」가 거짓이 된다")
      .toMatch(/호출부가 0곳인 죽은 함수/);
    // 「호출 0」이 지금도 참인지 **직접 센다**(주석이 낡으면 거짓말이 된다).
    expect(agent.split("llmRowHtml").length - 1, "llmRowHtml이 되살아났다 — 주석을 고쳐야 한다").toBe(1);
  });

  it("★ ⓘ 풀이는 화면이 아니라 screenguide에 있다(제품 원칙)", () => {
    const g = fs.readFileSync(path.join(__dirname, "../src/engine/screenguide.ts"), "utf8");
    expect(g, "supervision panels에 인용 제거 풀이가 없다").toContain('"인용 제거(✂)"');
    expect(g).toMatch(/답의 개수/);
    expect(sup, "화면에 긴 설명문을 적었다 — 풀이는 ⓘ가 연다").not.toMatch(/뗍니다\./);
  });

  it("★★ **화면에 적힌 글자로** 물어도 구역 안내가 열린다(별명표)", () => {
    // ★ 왜(2026-09-05 검토관): 구역 이름은 「인용 제거(✂)」인데 화면 글자는 「✂ 인용 제거」다.
    //   괄호 때문에 한 글자도 안 맞아, 담당자가 화면을 보고 물으면 안내가 아니라 RAG로 샜다.
    //   supervision.html에는 PANEL_ALIASES 칸이 **아예 없었다** — 그 표의 존재 이유가 이것인데도.
    const 자국 = "그 근거가 실제로 없으면"; // 인용 제거(✂) 구역 안내에만 있는 문장
    for (const q of ["✂ 인용 제거 뭐야?", "인용 제거가 뭐야?", "인용 검증 어떻게 봐?", "근거 없는 인용 뭐야?"]) {
      expect(formatScreenGuide("supervision.html", q), `화면 글자로 물었는데 구역 안내가 안 열렸다: ${q}`)
        .toContain(자국);
    }
  });

  it("별명은 **이름만** 잇는다 — 설명을 복사하지 않았다(같은 것을 두 곳에 적으면 어긋난다)", () => {
    const g = fs.readFileSync(path.join(__dirname, "../src/engine/screenguide.ts"), "utf8");
    const 표 = g.slice(g.indexOf('"supervision.html": {', g.indexOf("PANEL_ALIASES")));
    expect(표.slice(0, 표.indexOf("},")), "별명표에 설명문을 적었다").not.toMatch(/그 근거가 실제로 없으면/);
  });

  it("★ citeguard 주석의 「그리는 화면은 없다」가 정정됐다(약속-코드 일치)", () => {
    const c = fs.readFileSync(path.join(__dirname, "../src/engine/citeguard.ts"), "utf8");
    expect(c, "이제 그리는 화면이 있는데 주석은 없다고 말한다").not.toContain("지금 이 값을 **그리는 화면은 없다**");
    expect(c).toMatch(/이제 그리는 화면이 있다/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ★★ J5 — 클라우드 출구. 「출구 한 곳에 걸었다」가 **출구가 둘인 줄 몰라서** 반쪽이었다.
describe("★★ J5 클라우드 답도 가드를 지난다", () => {
  const cloud = fs.readFileSync(path.join(__dirname, "../src/engine/cloudllm.ts"), "utf8");

  it("askCloud가 r.text를 **그대로** 안 돌려준다", () => {
    // ⚠ 2026-09-05 검토관 2차로 **계약이 바뀌었다** — chunks=[]만으로는 「출처 표기 전면 삭제기」가
    //   된다(아래 ⑥ describe). 원천없는출구를 붙여 **번호 인용만** 보게 한다.
    expect(cloud, "가드를 안 지난다").toMatch(/const 인용가드 = guardCitations\(r\.text, \[\], undefined, \{ 원천없는출구: true \}\)/);
    expect(cloud, "가드를 부르고도 원문을 돌려주면 헛일이다").toMatch(/const answer = 인용가드\.text/);
  });

  it("★★ chunks는 **[]이지 null이 아니다** — 클라우드는 「근거 없음」이 확정이다", () => {
    // null은 「모른다」(RAG 미실행)라 판정 보류다. 이 경로는 사내 조각을 한 개도 안 싣는다.
    expect(cloud).not.toMatch(/guardCitations\(r\.text, null\)/);
    // 근거: 이 경로가 실을 수 있는 것은 질문과 CLOUD_SYSTEM_PROMPT뿐임을 소스로 못 박는다.
    expect(cloud, "클라우드 경로가 RAG 블록을 싣기 시작했다 — chunks=[]가 거짓이 된다")
      .not.toMatch(/ragBlock|RAG_BLOCK_HEADER/);
    expect(cloud).toMatch(/callProvider\(provider, apiKey \?\? "", model, CLOUD_SYSTEM_PROMPT, q\)/);
  });

  it("계수기를 남긴다 — 팀원 id를 사칭하지 않는다(agent=\"-\")", () => {
    expect(cloud).toMatch(/kind: "cite", phase: "done", agent: "-"/);
    expect(cloud).toMatch(/detail: 뗀인용요약\(인용가드\.removed, 인용가드\.보류, 인용가드\.통째교체\)/);
  });

  it("★ 잣대를 두 벌로 두지 않았다 — llm.ts와 **같은 함수**를 부른다", () => {
    // ⚠ 2026-09-06에 `사유별집계`가 같은 줄에 붙었다(✂ 사유 집계 — 세는 곳도 citeguard 하나다).
    //   그래서 이름표를 통째로 박지 않고 **앞 두 개가 그대로인지**만 본다.
    expect(cloud).toMatch(/import \{ guardCitations, 뗀인용요약[^}]*\} from "\.\/citeguard"/);
    expect(cloud, "사유도 같은 곳에서 세야 한다 — 클라우드만 따로 세면 갈라진다")
      .toMatch(/citeReasons: 사유별집계\(인용가드\.removed, 인용가드\.보류, 인용가드\.통째교체\)/);
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// ★★ 2026-09-05 검토관 **2차** — 「같은 좁힘을 한쪽에만 걸었다」 계열.
//
// 1차 수리(J1~J6)가 새로 만든 결함을 병렬 검토관이 8건 잡았고, 그 뿌리는 하나였다:
//   **답 쪽만 손보고 원천 쪽을 안 손봤다**(강조 표식) · **한 갈래에만 좁힘을 걸었다**(출처|원문·줄머리)
//   · **원천이 원리상 비는 출구를 「자료가 없다」로 읽었다**(클라우드).
// ⚠ 여기 시험은 **돌연변이로 검증했다** — 각 좁힘을 지운 사본에서 아래 시험이 실제로 붉어지는지
//   확인했다. 1차 때 「출처|원문」 좁힘은 지워도 시험이 전부 초록이었다(검토관 적발 5번).
describe("★★ 검토관 2차 — 원천 마크다운 · 좁힘 비대칭 · 클라우드 출구", () => {
  // ── ① 원천도 **같은 규칙으로** 강조를 걷는다 ────────────────────────────────────
  describe("① 조각이 마크다운이어도 그대로 옮긴 인용은 안 뗀다", () => {
    const 마크조각 = [
      "> GIJO AS는 조직 규모·역할에 맞춰 **세 가지 에디션**으로 제공합니다. 에디션은 「기계가 얼마나 큰가」가 아니라 **「무엇을 할 수 있는가」(기능)**로 나뉩니다.",
    ];
    it("긴 인용(23자↑ 겹침 갈래) — 조각을 글자 그대로 옮겼는데 뗐다", () => {
      const 답 = `[1]에 따르면 "GIJO AS는 조직 규모·역할에 맞춰 **세 가지 에디션**으로 제공합니다."`;
      expect(guardCitations(답, 마크조각).removed).toHaveLength(0);
    });
    it("짧은 인용(8~22자 verbatim 갈래) — 제품 코퍼스 실물", () => {
      const 조각들 = ["인증기준은 **세 영역**으로 되어 있다. 관리체계 수립·운영, 보호대책 요구사항, 개인정보 처리단계별 요구사항이다."];
      const 답 = `설명합니다. 이어서 적습니다. [1]에 따르면 "인증기준은 **세 영역**으로 되어 있다."`;
      expect(guardCitations(답, 조각들).removed).toHaveLength(0);
    });
    it("★ 돌려주는 답에는 굵게가 **그대로** 남는다 — 걷는 것은 대조본뿐이다", () => {
      const 답 = `[1]에 따르면 "GIJO AS는 조직 규모·역할에 맞춰 **세 가지 에디션**으로 제공합니다."`;
      expect(guardCitations(답, 마크조각).text).toBe(답);
    });
    it("강조걷은글 — 낱말 사이 밑줄·코드 구간은 안 건드린다(오탐이 미탐보다 무섭다)", () => {
      expect(강조걷은글("**굵게** 확인")).toBe("굵게 확인");
      expect(강조걷은글("api_key를 확인"), "낱말 사이 밑줄을 걷었다").toBe("api_key를 확인");
      expect(강조걷은글("\`a*b*c\` 확인"), "코드 구간을 걷었다").toBe("\`a*b*c\` 확인");
    });
    it("★★ 제품이 **실제로 싣는** 지식 코퍼스로 잰다 — 오탐 0", () => {
      // 왜 합성 예문이 아니라 코퍼스인가: 내가 고른 예문만 보면 「내 규칙이 내 예문을 맞힌다」밖에
      // 못 본다. 1차 수리의 오탐 9.5%는 **이 재료로 재서** 드러났다(합성 예문 ①a는 통과했다).
      //
      // ⚠ 재는 것은 **위험 모집단 전수**다 — 강조 표식(`*`·`_`)이 든 문장. 표본이 아니다.
      //   실측 2026-09-05: 강조 든 문장 1,249건이 수리 전 오탐 **322건을 하나도 빠짐없이** 담았다
      //   (전수 3,373건을 다 돌려도 오탐은 같은 322건). 강조가 없는 문장은 이 결함이 원리상 못 산다.
      //   그래서 전수보다 **1/3 값에 같은 민감도**다 — 느린 게이트는 안 도는 게이트가 된다.
      const 뿌리 = path.join(__dirname, "..", "..", "knowledge");
      const 파일들 = fs.readdirSync(뿌리).filter((f) => f.endsWith(".md"));
      expect(파일들.length, "지식 코퍼스가 사라졌다 — 이 시험이 헛통과한다").toBeGreaterThanOrEqual(10);
      const 오탐: string[] = [];
      let 총 = 0;
      for (const f of 파일들) {
        const 문단 = fs.readFileSync(path.join(뿌리, f), "utf8")
          .split(/\n{2,}/).map((s) => s.trim()).filter((s) => s.length > 40);
        for (let i = 0; i < 문단.length; i++) {
          const chunk = 문단.slice(i, i + 3).join("\n\n"); // 실제 CHUNK는 문단 하나보다 크다
          for (const 문장 of 문단[i].split(/(?<=[.。!?])\s+|\n/).map((x) => x.trim())) {
            if (문장.replace(/\s+/g, "").length < 대조하한 || !/[*_]/.test(문장)) continue;
            총++;
            if (guardCitations(`[1]에 따르면 "${문장}"`, [chunk]).removed.length > 0) {
              오탐.push(`${f}: ${문장.slice(0, 60)}`);
            }
          }
        }
      }
      expect(총, "강조 든 문장이 안 모였다 — 모집단이 비면 이 시험은 헛통과한다").toBeGreaterThan(500);
      expect(오탐.slice(0, 5), `조각을 그대로 옮긴 인용 ${오탐.length}/${총}건을 뗐다`).toEqual([]);
    }, 30_000);
  });

  // ── ② 줄끝 갈래의 「출처|원문」 좁힘 — 돌연변이 킬러 ────────────────────────────
  describe("② 줄머리 표지라도 낱말이 「출처|원문」일 때만 본다", () => {
    // ⚠ 이 세 짝이 좁힘을 지키는 자리다. 좁힘을 지우면 앞의 둘이 붉어진다(돌연변이로 확인).
    it("「관련 자료: 내부 스캔 결과」는 안 뗀다", () => {
      expect(guardCitations("정리했습니다.\n관련 자료: 내부 스캔 결과", []).removed).toHaveLength(0);
    });
    it("「근거: 담당자 확인 내용」도 안 뗀다", () => {
      expect(guardCitations("요약입니다.\n근거: 담당자 확인 내용", []).removed).toHaveLength(0);
    });
    it("「출처: 없는매체이름」은 뗀다 — 좁힘이 J2를 죽이지 않았다", () => {
      const r = guardCitations("정리했습니다.\n출처: 없는매체이름", []);
      expect(r.removed).toHaveLength(1);
      expect(r.removed[0].kind).toBe("출처미확인");
    });
  });

  // ── ③ 괄호 갈래에도 **같은** 좁힘 ───────────────────────────────────────────────
  describe("③ 맨몸 괄호 갈래도 줄끝 갈래와 같은 좁힘을 쓴다", () => {
    const 딴조각 = ["아무 관련 없는 조각 본문이 여기 들어 있습니다. 대조 길이를 채우려고 적습니다."];
    it("「(근거: 위 표)」는 안 뗀다 — 문서가 아니라 정당한 괄호 주석이다", () => {
      const 답 = "관리자 계정을 바꾸세요. (근거: 위 표)";
      expect(guardCitations(답, 딴조각).text).toBe(답);
    });
    it("「(자료: 내부 스캔 결과)」·「(문서: 담당자 확인)」도 안 뗀다", () => {
      for (const 답 of ["스캔을 다시 돌리세요. (자료: 내부 스캔 결과)", "확인했습니다. (문서: 담당자 확인)"]) {
        expect(guardCitations(답, 딴조각).text, 답).toBe(답);
      }
    });
    it("「(출처: CSOOnline, 2021년 11월 25일)」은 뗀다 — J2 표적은 그대로 산다", () => {
      const r = guardCitations("2021년 대규모 유출이 있었습니다. (출처: CSOOnline, 2021년 11월 25일)", []);
      expect(r.removed).toHaveLength(1);
      expect(r.text).toBe("2021년 대규모 유출이 있었습니다.");
    });
  });

  // ── ④ 사이말 줄바꿈 넘기도 **같은** 좁힘 ───────────────────────────────────────
  describe("④ 줄바꿈 넘기는 「줄머리 + 출처|원문」에만 준다", () => {
    const 한조각 = ["보안 조각 하나가 여기 들어 있습니다. 대조 길이를 채우려고 적어 둔 문장입니다."];
    it("「질문 문서:⏎\"…\"」에 답이 한 낱말로 줄지 않는다", () => {
      const 답 = '질문 문서:\n"이 설정을 어떻게 바꾸나요?"';
      expect(guardCitations(답, []).text, "답이 「\"질문\"」 한 낱말로 축소됐다").toBe(답);
    });
    it("「관련 자료:⏎\"…\"」·「**참고 문서:**⏎\"…\"」도 안 건드린다", () => {
      for (const 답 of ['정리하면 다음과 같습니다.\n\n관련 자료:\n"MFA 적용은 필수입니다"', '**참고 문서:**\n"보안 정책 수립 가이드입니다"']) {
        expect(guardCitations(답, 한조각).text, 답).toBe(답);
      }
    });
    it("「출처:⏎\"제목\"」은 뗀다 — J1이 노린 배포 dist 실물 꼴", () => {
      const r = guardCitations('정리했습니다.\n출처:\n"침해사고 대응 실패 사례집"', []);
      expect(r.removed.length, "J1 표적을 놓쳤다").toBeGreaterThan(0);
      expect(r.text).not.toContain("침해사고 대응 실패 사례집");
    });
  });

  // ── ⑤ 문서꼴 하이픈 — 하나로 판정을 끄지 않는다 ────────────────────────────────
  describe("⑤ 하이픈 하나로 맨몸 판정을 끄지 않는다", () => {
    it("「Krebs-on-Security」·「CSO Online, 2021-11-25」·「Bleeping Computer, 2023-04-11」은 뗀다", () => {
      for (const 이름 of ["Krebs-on-Security", "CSO Online, 2021-11-25", "Bleeping Computer, 2023-04-11"]) {
        const r = guardCitations(`사고가 있었습니다. (출처: ${이름})`, []);
        expect(r.removed.length, `지어낸 매체 표지를 놓쳤다: ${이름}`).toBe(1);
      }
    });
    it("★ 제품이 붙인 근거 표시는 그대로 둔다(문서 id·파일명·store:)", () => {
      for (const 답 of [
        "안내드립니다. (출처: internet-research-2026-07)",
        "안내드립니다. (근거: GIJO_지식_가명정보_처리.md)",
        "안내드립니다.\n근거: store:abc#0f40a",
      ]) {
        expect(guardCitations(답, []).text, `제품이 붙인 근거 표시를 지웠다: ${답}`).toBe(답);
      }
    });
    it("ISO 날짜는 **이름이 아니라 꼬리**로 걸러진다", () => {
      expect(출처이름들("CSO Online, 2021-11-25")).toEqual(["CSO Online"]);
      expect(출처이름들("한국인터넷진흥원, 2023.04.11")).toEqual(["한국인터넷진흥원"]);
    });
  });

  // ── ⑥ 클라우드 출구 — 대조 못 할 것은 안 건드린다 ──────────────────────────────
  describe("⑥ 원천없는출구 — 「확인 못 했다」를 「가짜다」로 바꿔 말하지 않는다", () => {
    const 클 = (a: string) => guardCitations(a, [], undefined, { 원천없는출구: true });
    it("외부 출처 표기를 **안 지운다** — 사용자가 일부러 고른 경로다", () => {
      const 답 = "랜섬웨어 피해는 2023년에 크게 늘었습니다.\n출처: Verizon DBIR 2023";
      expect(클(답).text).toBe(답);
      expect(guardCitations(답, []).removed, "사내 출구 판정까지 느슨해졌다").toHaveLength(1);
    });
    it("따옴표 인용도 안 건드린다 — 대조할 원천이 원리상 없다", () => {
      const 답 = '원문: "공격자는 초기 침투 후 평균 16일간 머문다고 보고되었습니다"';
      expect(클(답).text).toBe(답);
    });
    it("★ 번호 인용은 **뗀다** — [n]은 있지도 않은 근거 블록을 가리킨다(확정된 거짓)", () => {
      const r = 클('설명합니다. 이어서 적습니다. [1]에 따르면 "사내 서버는 패치가 밀려 있습니다"');
      expect(r.removed.length, "클라우드가 지어낸 사내 근거 참조를 놓쳤다").toBeGreaterThan(0);
      expect(r.text).not.toContain("[1]에 따르면");
    });
    it("★★ 통째 교체 문구가 「사내 자료가 없다」가 아니다(장애≠부재)", () => {
      const r = 클('[1]에 따르면 "이 답은 통째로 인용 하나뿐이라 떼면 아무것도 안 남는다."');
      expect(r.text).toBe(클라우드근거없음안내);
      expect(r.text, "사내 자료 부재를 단정했다").not.toBe(자료없음안내);
      expect(r.text).not.toContain("다른 에이전트에게");
    });
    it("클라우드 안내 문구는 FAIL_MARKS에 안 걸린다(정직한 답에 실패 딱지가 붙는다)", () => {
      const 점검 = fs.readFileSync(path.join(__dirname, "..", "..", "tools", "drawer-audit.mjs"), "utf8");
      const m = 점검.match(/const FAIL_MARKS = \[([\s\S]*?)\];/);
      expect(m, "FAIL_MARKS를 못 읽었다").toBeTruthy();
      const 표식 = [...(m?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((x) => x[1]);
      expect(표식.length).toBeGreaterThan(5);
      expect(표식.filter((t) => 클라우드근거없음안내.includes(t))).toEqual([]);
    });
    it("옵션을 안 주면 **옛 판정 그대로**다 — 사내 출구는 하나도 안 느슨해졌다", () => {
      const 답 = '원문: "이 답은 통째로 인용 하나뿐이라 떼면 아무것도 안 남는다."';
      expect(guardCitations(답, []).text).toBe(자료없음안내);
      expect(guardCitations(답, [], undefined, {}).text).toBe(자료없음안내);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ★★ K1 — 귀속 꼬리. 「누가·언제」만 남으면 **없는 기사의 기자 이름**이 답에 남는다.
//    재료는 배포 dist 재현 3꼴 그대로다(2026-09-05 라이브).
describe("★★ K1 귀속 꼬리 — 표지를 떼고 「by 사람, 날짜」가 남던 자리", () => {
  const 없는제목 = "존재하지 않는 사내 문서 제목입니다";

  it("① 「출처: \"제목\" by Brian Krebs, 2021-04-29.」 — 꼬리째 사라진다", () => {
    const r = guardCitations(`요약을 적습니다. 아래를 보세요. 출처: "${없는제목}" by Brian Krebs, 2021-04-29.`, 조각);
    expect(r.removed.length).toBeGreaterThanOrEqual(1);
    expect(r.text, "기자 이름이 남았다").not.toContain("Brian Krebs");
    expect(r.text, "날짜가 남았다").not.toContain("2021-04-29");
    expect(r.text).toContain("요약을 적습니다.");
    자국없음(r.text);
  });

  it("② 「(출처: 제목) by 사람, 날짜」 — 괄호 표지 뒤 꼬리도 같이", () => {
    const r = guardCitations(`설명입니다. 자세한 내용은 아래와 같습니다 (출처: CSOOnline) by 김철수, 2023년 4월 11일.`, 조각);
    expect(r.removed.length).toBeGreaterThanOrEqual(1);
    expect(r.text).not.toContain("김철수");
    expect(r.text).not.toContain("2023년 4월 11일");
    자국없음(r.text);
  });

  it("③ 「**출처:** \"제목\" by 사람」 — 굵게가 끼어도(J1 사본) 꼬리가 남지 않는다", () => {
    const r = guardCitations(`본문을 적습니다. 이어서 적습니다.\n**출처:** "${없는제목}" by Brian Krebs`, 조각);
    expect(r.removed.length).toBeGreaterThanOrEqual(1);
    expect(r.text).not.toContain("Brian Krebs");
    자국없음(r.text);
  });

  it("★ 오탐 반대편 — **원천에 그 이름이 있으면** 귀속을 안 뗀다", () => {
    // 제목이 원천에 있으니 표지 자체가 안 뗴지고, 꼬리도 그대로 남아야 한다.
    const r = guardCitations('신고 절차입니다. (출처: "침해사고_대응_지침.md") by 홍길동, 2024년 1월 2일', ["본문"], ["침해사고_대응_지침.md", "홍길동"]);
    expect(r.removed).toHaveLength(0);
    expect(r.text).toContain("홍길동");
  });

  it("★ 오탐 반대편 — 뗀 자리와 **무관한** 「by」는 안 건드린다", () => {
    const 답 = `보안은 by design 원칙으로 설계합니다. 아래 표를 보세요.`;
    expect(guardCitations(답, 조각).text).toBe(답);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ★★ K3 — 표지 변형 일곱. 콜론 하나만 표지가 아니다(배포 dist 뗌 0).
describe("★★ K3 표지 변형 — 「출처:」 말고도 표지다", () => {
  const 없는제목 = "존재하지 않는 사내 문서 제목입니다";
  const 뗐나 = (답: string, 원천?: string[]) => {
    const r = guardCitations(답, 조각, 원천);
    return { 건수: r.removed.length, text: r.text };
  };

  it("① 「출처 — \"제목\"」 (줄표 도입)", () => {
    const r = 뗐나(`요약입니다. 이어서 적습니다. 출처 — "${없는제목}"`);
    expect(r.건수).toBeGreaterThanOrEqual(1);
    expect(r.text).not.toContain(없는제목);
  });

  it("② 「### 출처⏎\"제목\"」 (머리말 줄이 표지)", () => {
    const r = 뗐나(`요약입니다. 이어서 적습니다.\n### 출처\n"${없는제목}"`);
    expect(r.건수).toBeGreaterThanOrEqual(1);
    expect(r.text).not.toContain(없는제목);
  });

  it("③ 「【출처】\"제목\"」 (자기 안에서 닫히는 괄호)", () => {
    const r = 뗐나(`요약입니다. 이어서 적습니다. 【출처】"${없는제목}"`);
    expect(r.건수).toBeGreaterThanOrEqual(1);
    expect(r.text).not.toContain(없는제목);
    expect(r.text, "여는 괄호만 남았다").not.toContain("【");
  });

  it("④ 「Source: \"제목\"」 (영문 표지)", () => {
    const r = 뗐나(`요약입니다. 이어서 적습니다. Source: "${없는제목}"`);
    expect(r.건수).toBeGreaterThanOrEqual(1);
    expect(r.text).not.toContain(없는제목);
  });

  it("⑤ 「(참고: 기관)」 — 이름이 바깥 기관·매체 꼴일 때만", () => {
    const r = 뗐나(`요약입니다. 이어서 적습니다 (참고: CSOOnline).`);
    expect(r.건수).toBeGreaterThanOrEqual(1);
    expect(r.text).not.toContain("CSOOnline");
  });

  it("⑥ 「[출처: 기관]」 — 대괄호 표지", () => {
    const r = 뗐나(`요약입니다. 이어서 적습니다 [출처: Bleeping Computer].`);
    expect(r.건수).toBeGreaterThanOrEqual(1);
    expect(r.text).not.toContain("Bleeping Computer");
    expect(r.text).not.toContain("[출처");
  });

  it("⑦ 줄표 귀속 + ISO 날짜 — 「— Krebs on Security, 2021-04-29」", () => {
    const r = 뗐나(`메일 릴레이는 제한해야 합니다.\n— Krebs on Security, 2021-04-29`);
    expect(r.건수).toBeGreaterThanOrEqual(1);
    expect(r.text).not.toContain("Krebs on Security");
    expect(r.text).toContain("메일 릴레이는 제한해야 합니다.");
  });

  // ── 오탐 반대편 — 넓힌 잣대가 정상 답을 지우지 않는가 ──────────────────
  it("★ 정당한 「(참고: …)」 주석은 안 뗀다 — 기관 이름이 아니다", () => {
    for (const 답 of [
      "취약점 목록입니다 (참고: 위 표).",
      "조치 순서를 적었습니다 (참고: 아래 그림).",
      "이 값은 확인이 필요합니다 (참고: 담당자 확인).",
      "결과를 정리했습니다 (참고 자료: 내부 스캔 결과).",
    ]) {
      expect(guardCitations(답, 조각).text, `정상 주석을 뗐다: ${답}`).toBe(답);
    }
  });

  it("★ 「### 출처」 아래에 **실제 문서명**이 오면 안 뗀다", () => {
    const 답 = `신고 절차를 정리했습니다.\n### 출처\n"침해사고_대응_지침.md"`;
    const r = guardCitations(답, ["본문 조각"], ["침해사고_대응_지침.md"]);
    expect(r.removed, "우리가 준 제목을 우리가 뗐다(자충수)").toHaveLength(0);
    expect(r.text).toContain("침해사고_대응_지침.md");
  });

  it("★ 줄표 문장·소문자 source는 여전히 안 건드린다", () => {
    for (const 답 of [
      "조치를 마쳤습니다.\n— 자세한 내용은 담당자에게 문의하세요",
      "설정 파일에 source: local 을 적습니다.",
    ]) {
      expect(guardCitations(답, 조각).text, `정상 문장을 건드렸다: ${답}`).toBe(답);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ★★ 2026-09-05 6차 수리 — **6차가 만든 오탐**을 되짚는 자리(검토관 적발 K3'·K1'·K1''·F7).
//    앞선 시험들은 「뗄 것을 뗐나」를 봤고, 이 묶음은 **「안 뗄 것을 지켰나」**를 본다.
//    반대편 표본을 한 갈래(한글 주석)로만 두었다가 라틴 낱말 갈래를 통째로 놓친 것이 그 결함의 뿌리다.

describe("★ K3' 「참고」 허용목록 — 라틴 낱말이 하나 끼었다고 기관이 아니다", () => {
  it("보안 제품에서 가장 흔한 정상 주석 7꼴을 **한 글자도** 안 건드린다", () => {
    // 실측(2026-09-05 A/B): 고치기 전 7/7이 지워졌다. 줄머리 꼴은 줄이 통째로,
    //   그 줄이 답의 전부면 근거불일치안내로 통째교체까지 갔다.
    for (const 답 of [
      "패치 우선순위를 정했습니다 (참고: Nessus 스캔 결과).",
      "권한 설정을 확인하세요 (참고: Active Directory 그룹 정책).",
      "로그를 모으세요 (참고: Windows 이벤트 뷰어).",
      "영향 범위를 보세요 (참고: CVE-2021-44228 영향).",
      "버킷 설정을 점검하세요 (참고: AWS S3 버킷 설정).",
      "방화벽 정책을 점검하세요.\n참고: Fortinet 콘솔에서 로그 보관 기간을 확인합니다.\n완료 후 보고하세요.",
      "참고: Windows Defender 설정을 확인하세요",
    ]) {
      const r = guardCitations(답, 조각);
      expect(r.text, `정상 주석을 뗐다: ${답}`).toBe(답);
      expect(r.removed, `안 뗐는데 「뗐다」고 셌다 — 감독 화면 ✂ 숫자가 거짓이 된다: ${답}`).toHaveLength(0);
    }
  });

  it("지어낸 **매체 이름**은 그대로 뗀다 — 넓힌 값어치를 잃지 않았다", () => {
    for (const 답 of [
      "클릭률이 15% 늘었습니다 (참고: CSOOnline).",
      "공격이 급증했습니다 (참고: Krebs on Security).",
      "사고가 늘었습니다 (참고: 보안뉴스).",
    ]) {
      const r = guardCitations(답, 조각);
      expect(r.text, `지어낸 매체를 안 뗐다: ${답}`).not.toBe(답);
      expect(r.removed[0]?.kind).toBe("출처미확인");
    }
  });

  it("기관이름인가() 판정표 — 매체 / 제품·규격을 가른다", () => {
    for (const n of ["CSOOnline", "CSO Online", "Krebs on Security", "Bleeping Computer",
                     "TechCrunch", "보안뉴스", "한국인터넷진흥원", "전자신문"]) {
      expect(기관이름인가(n), `기관·매체를 못 알아봤다: ${n}`).toBe(true);
    }
    for (const n of ["Nessus", "Fortinet", "Windows", "Nessus 스캔 결과", "AWS S3 버킷 설정",
                     "CVE-2021-44228 영향", "위 표", "담당자 확인", "내부 조사", "See the admin guide"]) {
      expect(기관이름인가(n), `제품·주석을 기관으로 봤다: ${n}`).toBe(false);
    }
  });
});

describe("★ K1' 귀속 꼬리 — 날짜만 있는 갈래는 **절 경계**를 요구한다", () => {
  const 원천: string[] = [];

  it("뒤 문장의 문법 성분인 날짜를 자르지 않는다(조사만 남은 깨진 절 금지)", () => {
    // 실측(2026-09-05, 고치기 전): 아래 넷이 각각 10·10·13·12자씩 잘려
    //   「에 개정되었습니다.」·「부터 적용됩니다.」·「 이후 적용됩니다.」·「 기준입니다.」가 남았다.
    for (const tail of [
      ", 2024년 3월에 개정되었습니다.",
      ", 2023년 4월부터 적용됩니다.",
      " (2024-03-01) 이후 적용됩니다.",
      ", 2024-01-01 기준입니다.",
    ]) {
      expect(귀속꼬리길이(tail, 원천), `문법 성분인 날짜를 잘랐다: ${tail}`).toBe(0);
    }
  });

  it("절을 끝맺는 날짜 귀속은 그대로 뗀다 — K1이 노린 값어치는 남는다", () => {
    expect(귀속꼬리길이(", 2021년 11월 25일.", 원천)).toBeGreaterThan(0);
    expect(귀속꼬리길이(" (2021-04-29).", 원천)).toBeGreaterThan(0);
    expect(귀속꼬리길이(" by Nobody Here, 2021-04-29.", 원천)).toBeGreaterThan(0);
    expect(귀속꼬리길이(" — Krebs on Security, 2021-04-29", 원천)).toBeGreaterThan(0);
  });

  it("★ K1'' **원천에 있는 참인 날짜**는 안 뗀다 — 약속이 코드 절반에만 있었다", () => {
    // 「원천에 그 이름이 있으면 안 뗀다」가 by 갈래에만 걸려 있었다(날짜 갈래엔 캡처가 없어 건너뛰어졌다).
    const 있는원천 = ["보도자료입니다. 발표일 2021-04-29 기사입니다.", "이 지침은 2021년 11월 25일 개정되었습니다."];
    expect(귀속꼬리길이(" (2021-04-29).", 있는원천), "원천에 그대로 있는 날짜를 지웠다").toBe(0);
    expect(귀속꼬리길이(", 2021년 11월 25일.", 있는원천), "원천에 그대로 있는 날짜를 지웠다").toBe(0);
    // 이름 갈래의 보호는 그대로다(회귀).
    expect(귀속꼬리길이(" by Brian Krebs, 2021-04-29.", ["Brian Krebs 기자가 썼습니다."])).toBe(0);
  });

  it("끝-끝 — 표지를 뗀 뒤에도 문장이 안 깨진다", () => {
    const r = guardCitations('요약입니다. 출처: "없는 제목입니다 길게" (2024-03-01) 이후 적용됩니다.', 조각);
    expect(r.text, "기준점만 지우고 단정을 남겼다").toContain("(2024-03-01) 이후 적용됩니다.");
    expect(r.text).not.toContain("없는 제목입니다");
  });
});

// ★ L1(2026-09-05 실측 — 배포 a6862633) — 귀속 꼬리를 떼면 **마침표가 겹쳤다.**
//   꼬리 쪽 마침표를 「우리가 안 만든 자국」이라며 무조건 남겼는데, 원문 문장이 이미 마침표로
//   끝나 있으면 그 마침표는 남길 것이 아니라 **덤**이다. 자국손질이 사이 공백까지 접어서
//   「. .」도 아닌 딱 붙은 「..」로 나갔다 — 사용자 눈에는 오타다.
//   ⚠ 짝으로 잰다: 앞이 문장부호면 안 남기고, **아니면 반드시 남긴다**(안 그러면 문장이 안 닫힌다).
describe("★ L1 귀속 꼬리 — 마침표를 언제 남기고 언제 먹나", () => {
  const 꼬리답 = (앞: string) => `${앞} 출처: "없는 제목입니다 아주 길게" by Brian Krebs, 2021-04-29.`;

  it("① 앞이 이미 마침표면 꼬리 마침표를 **안 남긴다**(「…합니다..」 금지)", () => {
    const r = guardCitations(꼬리답("AI 보안 정책을 적용합니다."), 조각);
    expect(r.text, "마침표가 겹쳤다").toBe("AI 보안 정책을 적용합니다.");
    자국없음(r.text);
  });

  it("② 앞이 문장부호가 아니면 꼬리 마침표를 **남겨 문장을 닫는다**(반대 짝)", () => {
    const r = guardCitations(꼬리답("AI 보안 정책을 적용합니다"), 조각);
    expect(r.text, "마침표까지 뺏어 문장이 안 끝났다").toBe("AI 보안 정책을 적용합니다.");
    자국없음(r.text);
  });

  it("③ 뒤에 문장이 더 있어도 들러붙지 않는다 — 공백은 안 먹는다", () => {
    const r = guardCitations(꼬리답("AI 보안 정책을 적용합니다.") + " 다음 문장입니다.", 조각);
    expect(r.text).toBe("AI 보안 정책을 적용합니다. 다음 문장입니다.");
    자국없음(r.text);
  });

  it("④ 단품 — 앞 글자에 따라 길이가 갈린다(회귀: 앞을 안 주면 옛 동작 그대로)", () => {
    const 꼬리 = " by Brian Krebs, 2021-04-29.";
    expect(귀속꼬리길이(꼬리, []), "앞을 모르면 마침표를 남긴다(옛 동작)").toBe(꼬리.length - 1);
    expect(귀속꼬리길이(꼬리, [], "적용합니다."), "앞이 마침표인데 덤을 안 먹었다").toBe(꼬리.length);
    expect(귀속꼬리길이(꼬리, [], "적용합니다. "), "앞의 공백을 안 걷었다").toBe(꼬리.length);
    expect(귀속꼬리길이(꼬리, [], "적용합니다"), "앞이 글자인데 마침표를 먹었다").toBe(꼬리.length - 1);
    // 가운뎃점은 앞이 마침표여도 안 먹는다 — 이 함수가 원래 지키던 「우리가 안 만든 자국」.
    expect(귀속꼬리길이(" by Brian Krebs, 2021-04-29 · 뒷말", [], "합니다."))
      .toBe(" by Brian Krebs, 2021-04-29".length);
  });
});

// ★ L3(2026-09-05) — 「[출처]: "제목"」 — 표식 낱말과 도입 어구 **사이에 `]`**가 낀 꼴.
//   마지막 갈래는 표식 바로 뒤에 도입 어구를 요구하고, K3 괄호 갈래는 「[출처: …]」처럼 낱말이
//   괄호 **안**에 있는 꼴이라 이건 어느 쪽에도 안 걸렸다(옛 판도 새 판도 뗌 0 — 회귀가 아니다).
describe("★ L3 대괄호로 싸인 표식 — 「[출처]: \"제목\"」", () => {
  it("표식이 대괄호에 싸여도 표지다 — 네 낱말·두 도입 어구", () => {
    for (const 답 of [
      '앞 문장입니다. [출처]: "없는 제목입니다 아주 길게"',
      '앞 문장입니다. [원문]: "없는 제목입니다 아주 길게"',
      '앞 문장입니다. [근거]: "없는 제목입니다 아주 길게"',
      '앞 문장입니다. [자료]: "없는 제목입니다 아주 길게"',
      '앞 문장입니다. [출처] — "없는 제목입니다 아주 길게"',
    ]) {
      const r = guardCitations(답, 조각);
      expect(r.removed.length, `대괄호 표지를 안 뗐다: ${답}`).toBe(1);
      expect(r.text, `표지·제목이 남았다: ${답}`).toBe("앞 문장입니다.");
      자국없음(r.text);
    }
  });

  // ⚠ 넓히는 변경은 **오탐 반대편을 먼저 잰다.** 아래 10꼴은 이 갈래를 넣기 전에 손상 0건을
  //   확인한 목록이다(실전 답 152개도 함께 쟀다 — 바뀐 답 0건). 「참고」는 표식 낱말이지만
  //   기관이름인가()가 「위 표」를 기관으로 안 봐서 안 뗀다.
  it("정당한 대괄호 머리표는 **한 글자도** 안 건드린다 — 오탐 반대편 10꼴", () => {
    for (const 답 of [
      "[비고]: 이 항목은 담당자가 직접 확인했습니다.",
      "[참고]: 위 표를 보세요.",
      "[주의]: 재시작이 필요합니다.",
      "[1]: 항목 이름",
      "[검토]: 2026-09-05 완료",
      "[상태]: 진행 중",
      "[참고]: 담당자 확인 후 진행",
      "[분류]: 취약점 관리",
      "[TODO]: 패치 적용",
      "[결과]: 통과",
    ]) {
      expect(guardCitations(답, 조각).text, `정당한 머리표를 건드렸다: ${답}`).toBe(답);
    }
  });

  it("도입 어구가 없으면 표지가 아니다 — 「[출처]」만으로는 안 뗀다", () => {
    // `]`를 도입 어구 표에 그냥 넣으면 「…자료] "…"」 같은 짝 없는 대괄호까지 표지가 된다.
    const 답 = '앞 문장입니다. [출처] 뒤 문장입니다. "없는 제목입니다 아주 길게"라고 적혀 있습니다.';
    expect(guardCitations(답, 조각).text).toContain("[출처] 뒤 문장입니다");
  });
});

describe("★ F7 표지 자체닫힘 — 안쪽 번호 대괄호의 `]`에 속지 않는다", () => {
  it("닫는 대괄호가 없는 「[출처 [1]: \"…\"」은 **앞 인용문을 안 건드린다**", () => {
    // 실측(고치기 전): `m[0].includes("]")`가 안쪽 `[1]`의 `]`에 걸려 자체닫힘=참이 됐고,
    //   표지꼴이 우연히 켜져 「표지 앞 인용문도 함께 뗌」까지 갔다.
    for (const 답 of [
      '앞 문장입니다 "지어낸 인용문입니다 길게 적습니다" [출처 [1]: "없는 제목입니다 길게"',
      '앞 문장입니다 "지어낸 인용문입니다 길게 적습니다" [자료 [2]: "없는 제목입니다 길게"',
    ]) {
      expect(guardCitations(답, 조각).text, `앞 인용문까지 지웠다: ${답}`).toContain("지어낸 인용문입니다 길게 적습니다");
    }
  });

  it("자기 안에서 진짜로 닫히는 표지(【출처】)는 그대로 판정한다 — 회귀", () => {
    const r = guardCitations('앞 문장입니다. 【출처】"없는 제목입니다 길게"', 조각);
    expect(r.text, "자체닫힘 표지를 못 뗐다").not.toContain("없는 제목입니다");
    expect(r.text, "여는 글자만 덩그러니 남았다").not.toMatch(/[【\[][ \t]*$/);
  });

  // ★ 여기 있던 「정직한 한계 — 「[출처]: "제목"」은 아직 안 본다」는 **L3에서 닫혔다**(2026-09-05).
  //   그 시험이 지키던 것은 「안 보던 갈래를 **오탐을 안 재고** 조용히 넓히지 마라」였다. 그 조건을
  //   먼저 갚았다 — 오탐 반대편 10꼴 + 실전 답 152개(chunks=[], 가장 센 설정)에서 **손상 0건**을
  //   확인한 뒤에 넓혔다(위 「★ L3 대괄호로 싸인 표식」 describe가 양쪽을 다 잰다).
  //   ⚠ 그러니 이 자리를 지울 때 함께 지워진 것은 「한계」지 「규율」이 아니다 — 다음에 갈래를
  //     넓힐 때도 **반대편을 먼저 재고** 그 숫자를 시험에 남긴다.
  it("★ 넓힌 갈래의 대가를 시험이 들고 있다 — 「[출처]:」는 뗀다 · 「[비고]:」는 안 뗀다", () => {
    expect(guardCitations('앞 문장입니다. [출처]: "없는 제목입니다 길게"', 조각).text).toBe("앞 문장입니다.");
    expect(guardCitations("[비고]: 이 항목은 담당자가 직접 확인했습니다.", 조각).text)
      .toBe("[비고]: 이 항목은 담당자가 직접 확인했습니다.");
  });
});

describe("★ 표식 낱말 아홉 — 주석이 유일한 기록이 되지 않게 못 박는다", () => {
  it("아홉 낱말이 전부 살아 있고, 관문(gates.mjs 여섯)과 **일부러** 갈라져 있다", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "src", "engine", "citeguard.ts"), "utf8");
    const m = /const 표식낱말 = "(.+?)";/.exec(src);
    expect(m, "표식낱말 상수를 못 찾았다(이름이 바뀌었나)").toBeTruthy();
    for (const 낱말 of ["원문", "인용", "출처", "근거", "자료", "문서", "참고", "Source", "Reference"]) {
      expect(m![1], `표식 낱말이 빠졌다: ${낱말}`).toContain(낱말);
    }
    // 관문은 여섯 — 넓히면 옛 회차 숫자와 못 견준다(그래서 갈라 둔다).
    expect(창작인용, "관문 쪽 계수기가 사라졌다").toBeTypeOf("function");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ★★ 부분 접지 — **넷은 문서에 있고 하나만 지어냈다** (2026-09-06 · 시안 mockups/dim-range)
//
// 2026-09-06까지 이 관문은 「전부 없을 때만」 배너를 붙였다. 백분율 다섯 중 넷이 조각에 그대로
// 있고 **하나만** 모델이 지어낸 답에는 경고가 아예 안 붙어 그 숫자가 진하게 나갔다.
// 이제 없는것이 하나라도 있으면 배너가 붙고, **어느 수치인지**를 표면형으로 함께 싣는다.
//
// ⚠ 표면형이 이 수리의 전부다. 값(「12.5」)만으로는 화면이 어느 글자를 옅게 할지 못 고르고,
//   결국 답 전체를 회색으로 칠하게 된다 — 문서에 그대로 적힌 참인 네 값까지.
describe("★★ 숫자 접지 — 부분 접지의 표면형(없는것표면)", () => {
  const 교육조각 = [
    "2026년 2분기 보안 교육 결과: 전사 이수율 82.3%. 부서별로는 개발 91.2%, 영업 78.4%, 관리 88.1%로 집계되었다.",
  ];
  const 부분답 = "2분기 보안 교육 이수율은 82.3%입니다. 부서별로는 91.2% · 78.4% · 88.1%이고, 전년 대비 12.5% 증가했습니다.";

  it("넷 있음 · 하나 없음 → 판정은 「있음」인데 없는것은 하나다", () => {
    const r = 숫자가원천에있나(부분답, 교육조각);
    expect(r.판정, "부분 접지를 「없음」이라 부르면 참인 넷까지 회색이 된다").toBe("있음");
    expect(r.수치).toEqual(["82.3", "91.2", "78.4", "88.1", "12.5"]);
    expect(r.없는것).toEqual(["12.5"]);
    expect(r.없는것표면, "표면형이 없으면 화면이 어느 글자인지 못 고른다").toEqual(["12.5%"]);
  });

  it("없는것 ↔ 없는것표면은 **자리·개수가 1:1**이다 — 어긋나면 엉뚱한 숫자가 옅어진다", () => {
    const r = 숫자가원천에있나("이수율 82.3%, 편차 36.4%, 증가 12.5%입니다.", 교육조각);
    expect(r.없는것).toEqual(["36.4", "12.5"]);
    expect(r.없는것표면).toEqual(["36.4%", "12.5%"]);
    expect(r.없는것표면.length).toBe(r.없는것.length);
    for (let i = 0; i < r.없는것.length; i++) {
      expect(r.없는것표면[i].replace(/[^0-9.]/g, ""), `${i}번째 짝이 어긋났다`).toBe(r.없는것[i]);
    }
  });

  it("전부 없으면 종전대로 「없음」 — 표면도 전부 실린다(꼬리는 안 붙는다 · noevidence.숫자무근거배너붙이기)", () => {
    const r = 숫자가원천에있나("이수율은 82.3%이고 12.5% 증가했습니다.", ["관련 없는 조각입니다."]);
    expect(r.판정).toBe("없음");
    expect(r.없는것표면).toEqual(["82.3%", "12.5%"]);
  });

  it("볼 수치가 없거나 조각이 null이면 표면도 빈 배열 — 없는 칸을 만들지 않는다", () => {
    expect(숫자가원천에있나("특이사항 없습니다.", 교육조각).없는것표면).toEqual([]);
    expect(숫자가원천에있나("이수율 82.3%", null).없는것표면).toEqual([]);
  });

  it("★ 표면은 **답에 적힌 그대로**다 — 값만으로는 「12.5%」와 「12.5건」을 못 가른다", () => {
    expect(실적수치자리("이수율은 12.5% 입니다.")).toEqual([{ 값: "12.5", 표면: "12.5%" }]);
    expect(실적수치자리("이수율은 12.5 % 입니다."), "기호 앞 공백은 표면에 든다").toEqual([{ 값: "12.5", 표면: "12.5 %" }]);
    expect(실적수치자리("증가 3,200 퍼센트")).toEqual([{ 값: "3200", 표면: "3,200 퍼센트" }]);
    // ⚠ **이 라운드가 안 고친 것**(실측으로 드러난 옛 성질 — 표면을 더하다 눈에 띄었다):
    //   「증가율 3,200 퍼센트」는 비율맨수_RE가 「율 3」도 함께 집어 값이 ["3200","3"]이 된다.
    //   지어낸 값 목록에 없는 「3」이 실릴 수 있다는 뜻이지만, 이 라운드의 약속은 「판정·수치·
    //   없는것 불변」이라 **여기서 안 고친다.** 고치려면 정규식을 건드려야 하고 그건 다른 묶음이다.
    expect(실적수치뽑기("증가율 3,200 퍼센트"), "옛 성질이 바뀌었으면 이 주석부터 다시 볼 것").toEqual(["3200", "3"]);
    // ⚠ 「…율/률 뒤의 맨수」 꼴은 m[0]에 앞말이 붙는다("완료율은 74"). 표면은 **수부터**여야
    //   ⓐ 배너 꼬리가 읽히고 ⓑ 화면 후보 조각("74")과 맞는다 — 시안의 「m[0]」와 다른 대목이다.
    expect(실적수치자리("조치 완료율은 74로 집계됩니다.")).toEqual([{ 값: "74", 표면: "74" }]);
  });

  it("★ 옛 이름은 값만 돌려준다 — 두 벌로 세지 않는다(dispatcher 수치있음·짝 시험이 이 꼴을 읽는다)", () => {
    const 답 = "이수율 82.3%, 증가 12.5%, 편차 36.4%입니다.";
    expect(실적수치뽑기(답)).toEqual(["82.3", "12.5", "36.4"]);
    expect(실적수치뽑기(답)).toEqual(실적수치자리(답).map((x) => x.값));
  });
});

describe("★★ 반올림해 옮긴 값 — 「82.3%」를 「약 82%」로 적은 답에 배너가 붙던 자리", () => {
  // 2026-09-06 검토관(상): 배너를 「전부 없을 때」에서 「하나라도 없을 때」로 넓히면서
  //   오탐의 반대편이 열렸다. 리포트·스캔 산출물은 소수 자리를 맞춰 적고(82.3%) 모델은
  //   반올림해 옮긴다(약 82%) — 값 동치만 보면 그 참인 값에 「모델 추정치」가 붙는다.
  //   같은 자리에서 learncandidates가 인용 +3점을 잃어 학습 후보에서도 빠졌다(연쇄).
  const 조각 = ["2026년 2분기 보안 교육 결과: 전사 이수율 82.3%. 부서별로는 개발 91.2%로 집계되었다."];

  it("소수 원천을 반올림해 옮긴 값은 「있음」이다 — 없는것이 비어야 한다", () => {
    const r = 숫자가원천에있나("이수율은 약 82%이고 개발부는 91.2%입니다.", 조각);
    expect(r.없는것, "반올림해 옮긴 참인 값에 「모델 추정치」가 붙는다").toEqual([]);
    expect(r.판정).toBe("있음");
  });

  it("소수 한 자리까지 줄여 적은 값도 「있음」 — 「82.34%」→「82.3%」", () => {
    expect(숫자가원천에있나("이수율은 82.3%입니다.", ["전사 이수율 82.34% 집계"]).판정).toBe("있음");
  });

  it("★ 값이 정말 다르면 그대로 「없음」 — 반올림 창을 넘는 짝은 안 잇는다", () => {
    // 이 셋이 「있음」이 되면 관문이 사실상 꺼진 것이다.
    expect(숫자가원천에있나("과징금은 3%입니다.", ["기준 요율 3.5% 적용"]).판정).toBe("없음");
    expect(숫자가원천에있나("이수율은 82%입니다.", ["전사 이수율 84.2% 집계"]).판정).toBe("없음");
    expect(숫자가원천에있나("이수율은 82.3%입니다.", ["전사 이수율 82% 집계"]), "정밀도를 **더한** 것은 지어낸 것이다").toHaveProperty("판정", "없음");
  });

  it("반올림은 **원천이 더 정밀할 때만** 연다 — 정수 원천은 창이 안 열린다", () => {
    expect(숫자가원천에있나("이수율은 82%입니다.", ["대상 81명 · 83건 처리"]).판정).toBe("없음");
  });
});
