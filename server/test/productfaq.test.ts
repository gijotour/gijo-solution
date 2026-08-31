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
