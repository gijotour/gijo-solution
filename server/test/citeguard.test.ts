// citeguard — **지어낸 인용을 코드가 뗀다**의 짝 시험 (2026-09-05).
//
// 왜 이 시험이 있나: 이 가드는 사람에게 나가는 답을 **지운다**. 지나치면 정상 인용을 잃고,
//   모자라면 없는 출처가 결재판까지 간다. 그래서 ① 순수 함수 사례표 ② 관문(gates.mjs)과의
//   잣대 대조 ③ 배선 소스 감시 ④ **실물 재료**(사다리 표본)로 오탐·적발을 직접 잰다.
//   ④가 핵심이다 — 만든 사람이 고른 예문만 보면 「내 규칙이 내 예문을 맞힌다」밖에 못 본다.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { guardCitations, 근거겹침, 원문꼬리표, 제품인용꼬리표, 뗀인용요약 } from "../src/engine/citeguard";
import {
  원문꼬리표 as 관문원문꼬리표, 제품인용꼬리표 as 관문제품인용꼬리표, 창작인용,
} from "../../tools/team-bench/gates.mjs";

const 조각 = [
  "보안 패치 설치 후 시스템 재시작이 필요한 경우가 존재하며 설치에 따른 영향도 검사가 필요함. 패치는 발표 후 가능한 한 빨리 설치할 것을 권장함.",
  "기본 관리자 계정명은 널리 알려져 있어 공격자가 계정을 추측하기 쉬우므로 설치 직후 변경해야 한다.",
];

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

describe("② 번호가 범위 밖이면 뗀다", () => {
  it("조각 2개인데 [5]를 가리켰다 — 담당자가 찾아볼 수 없는 번호다", () => {
    const 답 = '패치는 빨리 설치해야 합니다. [5]에 따르면 "보안 패치 설치 후 시스템 재시작이 필요한 경우가 존재하며 설치에 따른 영향도 검사가 필요함."';
    const r = guardCitations(답, 조각);
    expect(r.removed[0].kind).toBe("범위밖");
    expect(r.removed[0].n).toBe(5);
  });

  it("[0]도 범위 밖 — 번호는 1부터다(ragBlock 규약)", () => {
    const 답 = '설명입니다. 그리고 또 설명을 이어서 적습니다. [0]에 따르면 "기본 관리자 계정명은 널리 알려져 있어 공격자가 계정을 추측하기 쉽다"';
    expect(guardCitations(답, 조각).removed[0].kind).toBe("범위밖");
  });
});

describe("③④ 겹침이 없으면 뗀다 — 자기 말을 원문이라 우긴 것도", () => {
  it("어느 조각과도 20자 안 겹치는 인용", () => {
    const 답 = '릴레이 기능은 제한해야 합니다. 외부에서 악용될 수 있기 때문입니다. [1]에 따르면 "릴레이 기능을 제한하지 않으면 외부 악성 사용자가 내부 네트워크를 통해 메일을 전달할 수 있습니다."';
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

  it("번호만 틀린 정상 인용은 살린다 — [2]라 적었지만 실제로 [1] 본문이다", () => {
    const 답 = '패치 설치는 재시작을 부를 수 있습니다. [2]에 따르면 "보안 패치 설치 후 시스템 재시작이 필요한 경우가 존재하며 설치에 따른 영향도 검사가 필요함."';
    expect(guardCitations(답, 조각).removed).toHaveLength(0);
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

  it("20자 미만 따옴표는 겹침으로 판정하지 않는다 — 창이 20자라 대조 불가", () => {
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

  it("★ 빈 답 방지 — 다 떼서 **글자가 하나도** 안 남으면 원답을 그대로 둔다(뗀 것으로 세지도 않는다)", () => {
    const 답 = '원문: "이 답은 통째로 인용 하나뿐이라 떼면 아무것도 안 남는다."';
    const r = guardCitations(답, []);
    expect(r.removed).toHaveLength(0);
    expect(r.text).toBe(답);
  });

  it("★ 짧아도 진짜 답이 남으면 뗀다 — 길이 문턱을 두면 지어낸 출처가 함께 통과한다", () => {
    // 문턱을 「20자 미만이면 되돌린다」로 뒀다가 이 사례에서 없는 출처가 그대로 나갔다.
    const r = guardCitations('패치는 빨리 설치해야 합니다. [5]에 따르면 "보안 패치 설치 후 시스템 재시작이 필요한 경우가 존재하며 설치에 따른 영향도 검사가 필요함."', 조각);
    expect(r.removed).toHaveLength(1);
    expect(r.text).toBe("패치는 빨리 설치해야 합니다.");
  });

  it("빈 답·공백은 그대로", () => {
    expect(guardCitations("", []).text).toBe("");
    expect(guardCitations("   ", []).removed).toHaveLength(0);
  });
});

describe("★ 잣대 단일 출처 — 관문(gates.mjs)과 갈리면 여기서 터진다", () => {
  it("꼬리표 정규식 두 개가 관문의 것과 **글자 그대로** 같다", () => {
    expect(원문꼬리표.source).toBe(관문원문꼬리표.source);
    expect(제품인용꼬리표.source).toBe(관문제품인용꼬리표.source);
  });

  it("★ 관문이 창작이라 부르는 것은 제품 가드도 반드시 뗀다(제품이 더 넓게 잡는다)", () => {
    // 관문 ⑨는 「모델이 지어냈나」를 재고, 가드는 「제품이 그것을 내보내나」를 막는다.
    // 가드가 더 좁으면 관문만 빨개지고 제품은 그대로 내보낸다 — 그 갈림을 여기서 못박는다.
    const 행들 = [
      { question: "기본 계정명을 왜 바꾸나", text: '기본 계정명은 바꿔야 합니다. 널리 알려져 있기 때문입니다. 원문: "기본 관리자 계정명을 그대로 두면 공격자가 쉽게 예측할 수 있는 패턴을 가지고 있습니다."' },
      { question: "패치 설치 시 주의점", text: '백업을 먼저 하십시오. 그리고 검증 절차를 거치십시오. [1]에 따르면 "패치 설치 전에 백업을 수행하여 데이터 손실을 대비해야 합니다."' },
    ];
    for (const 행 of 행들) {
      expect(창작인용(행).length, "관문이 창작으로 안 봤다 — 예문이 낡았다").toBeGreaterThan(0);
      expect(guardCitations(행.text, []).removed.length, `가드가 못 뗐다: ${행.text.slice(0, 30)}`).toBeGreaterThan(0);
    }
  });

  it("근거겹침은 옮겨온 뒤에도 같은 답을 낸다(공백 무시·20자 창)", () => {
    expect(근거겹침("악용이 확인된 취약점은 심각도와 무관하게 최우선으로 조치", "악용이 확인된 취약점은 심각도와 무관하게 최우선으로 조치한다")).toBeTruthy();
    expect(근거겹침("전혀 다른 내용의 문장입니다", 조각[0])).toBeNull();
    expect(근거겹침("짧다", 조각[0]), "20자 미만은 판정 불가(null)").toBeNull();
  });
});

describe("★ 배선 감시 — 출구 한 곳에서 실제로 불린다", () => {
  const llm = fs.readFileSync(path.join(__dirname, "../src/engine/llm.ts"), "utf8");

  it("chat()이 RAG 조각을 출구까지 나른다", () => {
    expect(llm, "ragContextFor가 chunks를 안 돌려준다").toMatch(/자료없음: chunks\.length === 0, chunks \}/);
    expect(llm, "제공자 없음·검색 실패를 chunks:null로 안 가른다").toMatch(/자료없음: false, chunks: null \}/);
  });

  it("가드가 **복창 방어선 뒤 · 배너 앞**에서 불린다(설계관이 정한 자리)", () => {
    expect(llm, "guardCitations 호출이 없다").toContain("guardCitations(reply, ragResult?.chunks ?? null)");
    const 가드 = llm.indexOf("guardCitations(reply");
    const 복창 = llm.indexOf("복창 지속 — 답변 대체");
    const 배너 = llm.indexOf("if (ragResult?.자료없음 && reply");
    expect(복창, "복창 최종 방어선을 못 찾았다").toBeGreaterThan(0);
    expect(배너, "자료없음 배너를 못 찾았다").toBeGreaterThan(0);
    expect(가드, "가드가 복창 방어선보다 앞이다 — 재생성 답이 가드를 안 지난다").toBeGreaterThan(복창);
    expect(가드, "가드가 배너 뒤다 — 코드가 붙인 배너 글자가 자기인용 판정을 오염시킨다").toBeLessThan(배너);
  });

  it("계수기 — 뗐을 때만 llm:event(kind=cite)를 남긴다", () => {
    expect(llm).toMatch(/인용가드\.removed\.length > 0[\s\S]{0,600}kind: "cite"/);
    expect(llm, "감독 detail에 뗀 사유 요약이 안 실린다").toMatch(/detail: 뗀인용요약\(인용가드\.removed\)/);
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
// ★★ 실물 재료 — 사다리 표본으로 **직접 잰다**(만든 사람이 고른 예문은 증거가 약하다).
//    grounded = 조각을 실제로 준 자리(정상 인용이 있다) → 오탐이 0이어야 한다.
//    bare·persona = 조각을 안 준 자리(창작만 가능) → 꼬리표가 있으면 떼야 한다.
const 재료뿌리 = path.join(__dirname, "..", "..", "tools", "team-bench", "results-ladder");
const 표본 = (p: string): Record<string, unknown>[] => {
  const f = path.join(재료뿌리, p);
  return fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, "utf8")) as Record<string, unknown>[]) : [];
};

describe("★★ 실물 재료 실측 (tools/team-bench/results-ladder)", () => {
  it("재료를 실제로 읽었다(감시가 헛돌지 않는지)", () => {
    expect(표본("day2/r4-v4/ep2/samples-grounded.json").length).toBeGreaterThanOrEqual(10);
  });

  it("★ 오탐 0 — grounded 표본의 정상 인용을 하나도 안 뗀다", () => {
    const 사례: string[] = [];
    let 총 = 0;
    for (const p of [
      "day2/r4-v4/ep2/samples-grounded.json", "day2/r4-v4/ep1/samples-grounded.json",
      "day2/r3-v3/ep2/samples-grounded.json", "baseline/samples-grounded.json",
    ]) {
      for (const s of 표본(p)) {
        총++;
        const r = guardCitations(String(s.text ?? ""), [String(s.chunk ?? "")].filter(Boolean));
        for (const x of r.removed) 사례.push(`${p}#${s.i} ${x.kind}: ${x.quote.slice(0, 40)}`);
      }
    }
    expect(총, "표본을 못 읽었다").toBeGreaterThanOrEqual(24);
    expect(사례, `정상 인용을 뗐다(오탐):\n${사례.join("\n")}`).toHaveLength(0);
  });

  it("★ 적발 — 근거 0건 자리의 인용 꼬리표를 전부 뗀다", () => {
    const 놓친: string[] = [];
    let 대상 = 0;
    const 훑기 = (d: string, out: string[] = []): string[] => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const q = path.join(d, e.name);
        if (e.isDirectory()) 훑기(q, out);
        else if (/^samples-(bare|persona)\.json$/.test(e.name)) out.push(q);
      }
      return out;
    };
    for (const f of 훑기(재료뿌리)) {
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
});
