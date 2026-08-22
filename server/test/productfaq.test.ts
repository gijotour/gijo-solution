// 제품 지식 즉답 카드 — [2026-08-08 · 야간 150상황의 마지막 불편 3건에서]
//
// 계약: ① 실측에서 30초 걸리던 세 물음이 즉시 잡힌다 ② 판별은 좁다 — 같은 낱말의 조회·쓰기·
//   개념 물음은 안 삼킨다(겹침 0 원칙) ③ 카드 답에는 「이어서」 갈 곳이나 확인 자리가 있다.
import { describe, it, expect } from "vitest";
import { faqAnswerFor, FAQ_CARDS } from "../src/engine/productfaq";

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
// ■ 왜 생겼나 — 라이브에서 제품이 **없는 기능을 있다고 말했다**
//   「우리 제품이 타사 SBOM을 검수할 수 있어?」에 모델이 「**SBOM 검수는 가능하며**…」라고 답했다.
//   근거로 붙은 것은 KISA 공급망 가이드라인의 **일반론**이었고 우리 제품 능력에 대한 문장이 아니었다
//   — 그런데 사용자는 제품 능력을 물었으니 그대로 거짓 안내가 된다.
//   지식 문서에 범위를 적어 넣어도 랭킹이 그 조각을 안 집으면 소용없어서, 제품 상태 카드처럼 못 박았다.
describe("타사 SBOM 검수 — 없는 기능을 있다고 하지 않는다", () => {
  it("★★ 남의 SBOM을 받아 본다는 물음은 카드가 받는다", () => {
    for (const q of [
      "우리 제품이 타사 SBOM을 검수할 수 있어?",
      "협력사 SBOM 올려서 점검할 수 있나요?",
      "납품 업체 부품표 분석 돼?",
      "다른 회사 SBOM 파일 읽을 수 있어?",
      "SBOM 올려서 검수해줘",
    ]) {
      const r = faqAnswerFor(q);
      expect(r?.id, q).toBe("sbom-license-scope");
      expect(r?.answer, "「아직 안 됩니다」로 시작해야 한다").toContain("아직 안 됩니다");
    }
  });

  it("★ 되는 것은 함께 말한다 — 「안 된다」만 하고 끝내지 않는다", () => {
    const a = faqAnswerFor("타사 SBOM 검수 돼?")?.answer ?? "";
    expect(a, "우리 제품 자기 점검은 실제로 되니 그것을 알려야 한다").toContain("빌드가 멈춥니다");
    expect(a, "자산 SBOM 내보내기도 실제로 된다").toContain("내보내기");
  });

  it("★ 좁게 — 개념 질문·우리 것 생성은 안 삼킨다", () => {
    expect(faqAnswerFor("SBOM이 뭐야?")).toBeNull();                  // 개념 — 지식 문서 몫
    expect(faqAnswerFor("이 자산 SBOM 만들어줘")).toBeNull();          // 실제로 되는 기능(도구 몫)
    expect(faqAnswerFor("AI-BOM 상태 보여줘")).toBeNull();            // 조회 도구 몫
    expect(faqAnswerFor("AGPL 부품 넣으면 무슨 의무가 생겨?")).toBeNull(); // 지식 몫
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
