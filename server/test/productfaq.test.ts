// 제품 지식 즉답 카드 — [2026-08-08 · 야간 150상황의 마지막 불편 3건에서]
//
// 계약: ① 실측에서 30초 걸리던 세 물음이 즉시 잡힌다 ② 판별은 좁다 — 같은 낱말의 조회·쓰기·
//   개념 물음은 안 삼킨다(겹침 0 원칙) ③ 카드 답에는 「이어서」 갈 곳이나 확인 자리가 있다.
import { describe, it, expect } from "vitest";
import { faqAnswerFor, FAQ_CARDS } from "../src/engine/productfaq";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("지식 카드 — 실측 3문이 잡힌다", () => {
  it("★ CEF 헤더 구조(야간 32.7초)", () => {
    expect(faqAnswerFor("CEF 로그 헤더 구조 알려줘")?.id).toBe("cef-header");
    expect(faqAnswerFor("CEF 헤더 형식이 뭐야?")?.id).toBe("cef-header");
  });
  it("★ 학습 내용 확인(야간 30초대)", () => {
    expect(faqAnswerFor("AI가 뭘 학습했는지 볼 수 있어?")?.id).toBe("what-ai-learned");
  });
  it("★ 지어냄 식별(야간 30.8초)", () => {
    expect(faqAnswerFor("AI가 답을 지어내면 어떻게 알아?")?.id).toBe("how-to-spot-hallucination");
  });
  it("★ 제품 상태·성숙도(2026-08-21 코퍼스 QA — GA 공식출시 환각 차단)", () => {
    // GA·성숙도·파일럿은 우리 제품 전용 낱말이라 단독 발동, 「정식 출시」류는 제품 앵커가 있을 때만
    for (const q of ["GIJO AS의 GA 판정 상태나 향후 계획이 어떻게 돼?", "제품 성숙도 어때?", "이 제품 정식 출시 됐어?", "파일럿 대상이 누구야?"]) {
      expect(faqAnswerFor(q)?.id, q).toBe("product-status");
    }
    // ★ 2026-08-22 라이브 검증 잔여 — GA 현재형·순접 어형이 「됐나?」만으로 새던 것을 넣는다
    for (const q of ["언제 GA 돼?", "GA 나왔어?", "GA 언제 나와?", "이거 GA 됐나요?"]) {
      expect(faqAnswerFor(q)?.id, q).toBe("product-status");
    }
    // ★ 검토관 [중]2·[낮]3: 제3자 SW 질문·GA 부분문자열은 영업카드가 선점하면 안 된다
    for (const q of ["Log4j 정식 버전이 뭐야?", "Struts 출시 일정 나왔어?", "VGA 상태 확인", "MEGA 상태 어때"]) {
      expect(faqAnswerFor(q), q + " 는 제품상태 아님").toBeNull();
    }
    // 답이 「영업 문의」로 유도하고, 거짓 GA 주장이 없어야 한다
    const a = faqAnswerFor("GIJO AS GA 상태?")!.answer;
    expect(/영업|도입 담당/.test(a), "영업 유도").toBe(true);
    expect(/GA\s*상태에?\s*(있|이며)|공식\s*출시된/.test(a), "거짓 GA 주장 없어야").toBe(false);
  });
});

describe("좁은 판별 — 딴 물음은 안 삼킨다", () => {
  it("★★ 데이터 조회·쓰기·무관 질문은 통과시킨다", () => {
    expect(faqAnswerFor("CEF 로그 최근 것 보여줘")).toBeNull();      // 데이터 조회
    expect(faqAnswerFor("지금 학습 시작해줘")).toBeNull();            // 쓰기
    expect(faqAnswerFor("오늘 뭐부터 볼까?")).toBeNull();             // 무관
    expect(faqAnswerFor("미조치 취약점 알려줘")).toBeNull();          // 데이터 조회
    expect(faqAnswerFor("GIJO AS가 뭘 해?")).toBeNull();             // 기능(제품소개 몫) — 제품상태 아님
    expect(faqAnswerFor("에디션 뭐가 있어?")).toBeNull();             // 에디션 안내 몫
    expect(faqAnswerFor("GAP 분석 어떻게 해?")).toBeNull();          // GA 오발 방지
  });
});

describe("답의 됨됨이", () => {
  it("모든 카드에 다음 갈 곳 또는 확인 자리가 있다 — 숫자만 주고 끝내지 않는 원칙의 지식판", () => {
    for (const c of FAQ_CARDS) {
      expect(c.answer.length, c.id).toBeGreaterThan(120);
      expect(/화면|대화창|지적|▸|\"/.test(c.answer), c.id + "에 갈 곳이 없다").toBe(true);
    }
  });
});

// ── 타사 SBOM 검수 범위 (2026-08-22 게시 전 검토관 [높음]) ──────────────────────
//
// ■ 이 카드의 내력 — 두 번 다 「제품이 자기에 대해 거짓을 말한 것」이다
//   2026-08-22: 없는 기능을 **있다고** 했다. 「타사 SBOM 검수할 수 있어?」에 모델이 KISA
//     공급망 가이드라인(일반론)을 근거로 「가능하다」고 답했다 — 제품 능력에 대한 문장이
//     아니었는데 사용자는 능력을 물었으니 거짓 안내가 됐다. 그래서 카드로 못 박았다.
//   2026-08-31: **그 반대가 됐다.** 기능이 실제로 생겼는데(sbomimport→licenserisk→sbomreview)
//     카드가 안 따라와 **되는 기능을 안 된다고** 했다. 게다가 이 시험이 「아직 안 됩니다」를
//     **강제**하고 있어서, 시험이 거짓을 지키는 자물쇠 노릇을 했다.
//   → 교훈: **기능 카드는 기능과 같은 커밋에서 움직여야 한다.** 이 시험은 이제 문구가 아니라
//     「카드가 기능과 같은 말을 하는가」를 본다(아래 마지막 검사가 그 잣대다).
describe("타사 SBOM 검수 — 되는 것을 안 된다고 하지 않는다", () => {
  it("★★ 남의 SBOM을 받아 본다는 **능력 질문**은 카드가 받는다", () => {
    for (const q of [
      "우리 제품이 타사 SBOM을 검수할 수 있어?",
      "협력사 SBOM 올려서 점검할 수 있나요?",
      "납품 업체 부품표 분석 돼?",
      "다른 회사 SBOM 파일 읽을 수 있어?",
      "SBOM 올려서 검수해줘",
    ]) {
      const r = faqAnswerFor(q);
      expect(r?.id, q).toBe("sbom-license-scope");
      expect(r?.answer, "「됩니다」로 시작해야 한다 — 실제로 되는 기능이다").toContain("**됩니다**");
      expect(r?.answer, "없다고 말하면 안 된다").not.toContain("아직 안 됩니다");
    }
  });

  it("★★ **조회 물음은 카드가 안 삼킨다** — 그건 도구가 실제 이력으로 답할 몫이다", () => {
    // 옛 판은 이것까지 삼켜서, 검수를 **실제로 끝낸** 담당자가 결과를 물어도
    // 자기 대장 대신 「아직 안 됩니다」를 받았다(강제 규칙 sbom_review_status가 영영 안 돔).
    for (const q of [
      "타사 SBOM 검수 결과 보여줘",
      "외부 업체 SBOM 검수 결과 알려줘",
      "협력사 SBOM 점검 현황 알려줘",
      "타사 SBOM 검수한 것 목록 줘",
    ]) {
      expect(faqAnswerFor(q), q + " — 카드가 조회를 가로챘다").toBeNull();
    }
  });

  it("★ 한계는 그대로 말한다 — 「된다」만 하고 끝내지 않는다", () => {
    const a = faqAnswerFor("타사 SBOM 검수 돼?")?.answer ?? "";
    expect(a, "중첩 부품을 안 편다는 한계를 밝혀야 한다").toContain("중첩");
    expect(a, "법률 자문이 아니라는 경계를 밝혀야 한다").toContain("법률 자문");
    expect(a, "우리 제품 자기 점검도 실제로 되니 함께 알려야 한다").toContain("빌드가 멈춥니다");
  });

  it("★ 좁게 — 개념 질문·우리 것 생성은 안 삼킨다", () => {
    expect(faqAnswerFor("SBOM이 뭐야?")).toBeNull();                  // 개념 — 지식 문서 몫
    expect(faqAnswerFor("이 자산 SBOM 만들어줘")).toBeNull();          // 실제로 되는 기능(도구 몫)
    expect(faqAnswerFor("AI-BOM 상태 보여줘")).toBeNull();            // 조회 도구 몫
    expect(faqAnswerFor("AGPL 부품 넣으면 무슨 의무가 생겨?")).toBeNull(); // 지식 몫
  });

  it("★★ 카드가 기능과 **같은 말**을 한다 — 엔진이 사라지면 이 시험이 깨진다", () => {
    // 문구를 외우는 대신 **기능의 존재**를 잣대로 삼는다. 2026-08-31에 겪은 어긋남
    // (기능은 있는데 카드는 없다고 말함)이 다시 나면 여기서 걸린다.
    const 검수엔진 = readFileSync(join(__dirname, "..", "src", "engine", "sbomreview.ts"), "utf8");
    expect(검수엔진, "검수 이력 조회가 사라졌다 — 그러면 카드의 「됩니다」가 거짓이 된다")
      .toContain("export function 검수목록");
    expect(검수엔진, "검수 실행이 사라졌다").toContain("export function sbom검수");
    const 카드 = faqAnswerFor("타사 SBOM 검수할 수 있어?")?.answer ?? "";
    expect(카드, "엔진이 있는데 카드가 없다고 말한다").toContain("**됩니다**");
  });
});

// ── OCR 범위 (2026-08-22 신설) ────────────────────────────────────────────────
// 용어사전에 항목을 넣었는데도 라이브에서 「확인할 수 없습니다」로 답했다 —
// 랭킹이 그 조각을 안 집었다. 이번에 게시하는 기능이라 못 박는다.
describe("OCR — 되는 기능을 안 된다고 하지 않는다", () => {
  it("★ 사진·스캔 문서를 읽느냐는 물음은 카드가 받는다", () => {
    for (const q of [
      "OCR이 뭐야?",
      "사진으로 찍은 문서도 읽을 수 있어?",
      "스캔한 문서 올릴 수 있나요?",
      "이미지에서 글자 추출 가능해?",
      "OCR 기능 언제 돼?",
    ]) {
      expect(faqAnswerFor(q)?.id, q).toBe("ocr-scope");
    }
  });

  it("★ 한계도 함께 말한다 — 「됩니다」만 하고 끝내지 않는다", () => {
    const a = faqAnswerFor("사진 문서 읽을 수 있어?")?.answer ?? "";
    expect(a, "Windows 전용 동봉이라는 사실을 말해야 한다").toContain("Windows");
    expect(a, "30쪽 상한을 말해야 한다").toContain("30쪽");
    expect(a, "못 읽으면 거절한다는 것을 말해야 한다").toContain("거절");
  });

  it("★ 좁게 — 취약점 스캔은 안 삼킨다(이 저장소에서 「스캔」은 두 뜻이다)", () => {
    expect(faqAnswerFor("취약점 스캔 결과 보여줘")).toBeNull();
    expect(faqAnswerFor("스캔 돌려줘")).toBeNull();
    expect(faqAnswerFor("스캔 일정 알려줘")).toBeNull();
  });
});

// ── GPL/AGPL 경계 (2026-08-22) ────────────────────────────────────────────────
// 지식 문서에 정확히 적혀 있는데도 모델이 **근거 절을 뒤집어** 말했다(실측):
// 「네트워크 서비스로 제공하는 경우는 **배포로 보기 때문에** 의무가 적용되지 않습니다」
// — 결론은 맞고 이유가 정반대다. 라이선스는 법무가 보는 칸이라 결정적으로 못 박는다.
describe("GPL과 AGPL의 경계 — 흔들리면 안 되는 한 문장", () => {
  it("★ 차이를 묻는 말은 카드가 받는다", () => {
    for (const q of [
      "GPL이랑 AGPL 차이가 뭐야?",
      "AGPL과 GPL 구분해줘",
      "GPL 차이점 알려줘",
      "사내에서만 쓰면 AGPL도 괜찮아?",
      "네트워크 서비스면 GPL 공개 의무가 있어?",
    ]) {
      expect(faqAnswerFor(q)?.id, q).toBe("gpl-agpl-diff");
    }
  });

  it("★★ 근거 절이 **정방향**이다 — 「배포로 보지 않습니다」", () => {
    const a = faqAnswerFor("GPL이랑 AGPL 차이가 뭐야?")?.answer ?? "";
    expect(a, "GPL은 네트워크 서비스를 배포로 안 본다").toContain("배포로 보지 않습니다");
    expect(a, "AGPL은 §13이 그 구멍을 막는다").toContain("§13");
    expect(a, "우리 제품에 왜 중요한지 말한다").toContain("네트워크로");
    expect(a, "법률 자문이 아니라고 밝힌다").toContain("법률 자문이 아닙니다");
  });

  it("★ 좁게 — 개념·적용 질문은 지식 문서 몫으로 넘긴다", () => {
    expect(faqAnswerFor("GPL이 뭐야?")).toBeNull();
    expect(faqAnswerFor("AGPL 부품을 넣으면 무슨 의무가 생겨?")).toBeNull();
    expect(faqAnswerFor("MPL은 어디까지 공개해?")).toBeNull();
  });
});


// ── 「쓸수록 똑똑해진다」 (2026-09-07 사장님 지시로 신설) ──────────────────────
//
// ■ 왜 카드인가 — 이 말은 우리가 가장 많이 하는 약속인데 **제품이 못 답했다.**
//   정본(GIJO_AS_제품소개.md §3-③ · INTENT.md 같은 절)에만 있고, 모델이 답하면
//   「학습해서 좋아집니다」류로 얼버무린다 — 그건 거짓에 가깝다. 모델 가중치는
//   2026-09 4회전 시험에서 전부 불채택이라 **지금 안 바뀐다.** 똑똑해지는 것은
//   사내 기억(문서·승인 문답)과 잣대(지적→회귀 문항)다.
//
// ■ 이 시험이 지키는 것 셋
//   ⓐ 판별이 좁다 — 원리를 묻는 말만 받고, 쓰기·화면·기존 카드 몫은 안 삼킨다.
//   ⓑ **정본과 같은 말을 한다** — 카드·제품소개·INTENT 세 곳에 핵심 구절이 전부 있다.
//      셋 중 하나만 고치면 빨강이 난다. 「같은 것을 여러 곳에 적으면 어긋난다」를 기계로 막는다.
//   ⓒ 반증 — 카드를 빼면 ⓐ가 실제로 무너지는지 본다(이 시험이 헛돌지 않는다는 증거).
describe("쓸수록 똑똑해진다 — 제품이 자기 약속을 설명한다", () => {
  const 긍정 = [
    "쓸수록 똑똑해져?",
    "이 제품 쓰면 뭐가 좋아져?",
    "AI가 어떻게 학습해?",
    "쓰면 쓸수록 나아진다는 게 무슨 말이야?",
    "사용할수록 똑똑해지나요?",
    "어떻게 똑똑해지는 거야?",
  ];

  it("ⓐ 원리를 묻는 말은 이 카드가 받는다", () => {
    for (const q of 긍정) expect(faqAnswerFor(q)?.id, q).toBe("smarter-with-use");
  });

  it("★★ ⓐ 좁게 — 쓰기·화면 열기·기존 카드 몫은 안 삼킨다", () => {
    // 「학습」이라는 낱말 하나로 가로채면 이 저장소가 반복해 겪은 **낱말 가로채기**가 된다.
    expect(faqAnswerFor("학습 시작해줘"), "쓰기").toBeNull();
    expect(faqAnswerFor("어댑터 채택해줘"), "쓰기").toBeNull();
    expect(faqAnswerFor("학습 루프 화면 열어줘"), "화면 열기").toBeNull();
    expect(faqAnswerFor("학습 루프가 뭐야"), "개념 — 지식 문서 몫").toBeNull();
    expect(faqAnswerFor("모델 학습 돌려줘"), "쓰기").toBeNull();
    // 이건 **다른 카드**로 가야 한다 — null이 아니라 what-ai-learned다
    expect(faqAnswerFor("AI가 뭘 학습했는지 볼 수 있어?")?.id, "기존 카드 몫").toBe("what-ai-learned");
  });

  it("★★ ⓑ 정본과 같은 말을 한다 — 카드·제품소개 §3-③·INTENT.md 세 곳", () => {
    const 뿌리 = join(__dirname, "..", "..");
    const 소개 = readFileSync(join(뿌리, "GIJO_AS_제품소개.md"), "utf8");
    const 의도 = readFileSync(join(뿌리, "INTENT.md"), "utf8");

    // 절만 도려낸다 — 문서 어딘가에 같은 낱말이 있다고 통과시키면 감시가 헛돈다.
    const 절 = (본문: string, 머리: RegExp, 끝: RegExp) => {
      const i = 본문.search(머리);
      expect(i, `절을 못 찾았다: ${머리}`).toBeGreaterThanOrEqual(0);
      const 뒤 = 본문.slice(i + 10);
      const j = 뒤.search(끝);
      return j >= 0 ? 뒤.slice(0, j) : 뒤;
    };
    const 소개절 = 절(소개, /^### ③ 쓸수록 똑똑해진다/m, /^(---|## )/m);
    const 의도절 = 절(의도, /^## 쓸수록 똑똑해진다/m, /^## /m);
    const 카드 = faqAnswerFor("쓸수록 똑똑해져?")!.answer;

    // 다섯 갈래와 경계를 가리키는 **핵심 구절**. 하나라도 한 곳에서 사라지면 빨강.
    const 핵심 = ["모델이 아니라", "자리", "이 답 이상해요", "회귀 검사 문항", "게이트", "불채택"];
    const 빠진것: string[] = [];
    for (const [이름, 본문] of [["카드", 카드], ["제품소개 §3-③", 소개절], ["INTENT.md", 의도절]] as const) {
      for (const k of 핵심) if (!본문.includes(k)) 빠진것.push(`${이름}에 「${k}」 없음`);
    }
    expect(빠진것, "세 곳이 어긋났다 — 한 곳만 고치면 제품과 문서가 딴말을 한다:\n  " + 빠진것.join("\n  ")).toEqual([]);

    // 절이 헛도는 도려내기가 아닌지 — 너무 짧으면 위 검사가 우연히 통과한다
    expect(소개절.length, "제품소개 절이 너무 짧다 — 도려내기가 깨졌다").toBeGreaterThan(400);
    expect(의도절.length, "INTENT 절이 너무 짧다 — 도려내기가 깨졌다").toBeGreaterThan(200);
  });

  it("★ ⓑ 안 똑똑해지는 것과 담당자가 할 일을 함께 말한다 — 「된다」만 하고 끝내지 않는다", () => {
    const a = faqAnswerFor("쓸수록 똑똑해져?")!.answer;
    expect(a, "모델 일반 지식·말투는 안 바뀐다는 경계").toContain("일반 지식과 말투는 바뀌지 않습니다");
    expect(a, "담당자가 할 일 셋").toContain("담당자가 할 일 셋");
    expect(a, "확인하는 곳으로 이어져야 한다").toContain("▸ 이어서");
    expect(a.split("\n").length, "12줄 안쪽 — 길면 대화창에서 안 읽힌다").toBeLessThanOrEqual(12);
  });

  it("★★ ⓒ 반증 — 이 카드를 빼면 ⓐ가 무너진다(감시가 헛돌지 않는다는 증거)", () => {
    // 다른 카드가 이미 이 물음들을 받고 있었다면 위 ⓐ는 카드 없이도 초록일 수 있다.
    // 실제로 카드를 걷어내고 같은 물음을 돌려서, 이 카드가 **일하고 있음**을 증명한다.
    const 카드빼고 = FAQ_CARDS.filter((c) => c.id !== "smarter-with-use");
    expect(카드빼고.length, "카드가 실제로 등록돼 있어야 한다").toBe(FAQ_CARDS.length - 1);
    const 남은답 = (q: string) => 카드빼고.find((c) => c.re.test(q))?.id ?? null;
    for (const q of 긍정) {
      expect(남은답(q), `${q} — 카드를 빼도 답이 나온다면 이 카드는 일하지 않는 것이다`).toBeNull();
    }
  });
});
