import { describe, it, expect, vi, afterEach } from "vitest";
import { hasPromptLeak, stripScaffoldEcho, dropEchoSentences } from "../src/engine/llm";

// 실측(2026-07-19)에서 나온 실제 복창 사례
const LEAKED =
  "당신은 GIJO AS에서 보안 자산 관리 플랫폼에 특화된 AI입니다. 응답 규칙(위에서부터 엄격히 지킬 것): " +
  "- 첫 문장 규칙 — 인사말·서두·예고 없이 곧바로 본론(핵심 내용)으로 시작합니다.";
const NORMAL =
  "취약점 조치 우선순위는 CVSS 심각도와 EPSS, 실제 악용 여부를 함께 봅니다. 자산 중요도와 " +
  "외부 노출 경로도 반영해 순서를 정합니다.";

// 실측(2026-07-20 운영 :4000): RAG 주입 블록의 머리말이 답변 끝에 그대로 실려 나왔다
// (max_tokens에 걸려 "관련 규칙: 우선순"에서 잘린 채). 감지 후 재생성으로는 못 막았다 —
// 재생성한 답도 같은 머리말을 붙였고, 더 나쁘면 원본을 유지하는 구조라 누출이 그대로 나갔다.
// 그래서 결정적 절단으로 처리한다.
describe("자료 주입 머리말 에코 제거", () => {
  it("머리말만 있는 줄부터 끝까지 잘라낸다", () => {
    const out = stripScaffoldEcho("조치 우선순위는 KEV를 먼저 봅니다.\n\n참고 자료 — 사내 지식 베이스\n관련 규칙: 우선순");
    expect(out).toBe("조치 우선순위는 KEV를 먼저 봅니다.");
  });

  it("온톨로지 머리말도 잘라낸다", () => {
    expect(stripScaffoldEcho("답변 본문입니다.\n\n관련 규칙·관계")).toBe("답변 본문입니다.");
  });

  it("본문 속 정상 인용은 살린다 — 프롬프트가 출처를 밝히라고 지시한다", () => {
    const cite = "참고 자료 — 사내 지식 베이스의 운영 매뉴얼에 따르면 패치는 7일 내 적용해야 합니다.";
    expect(stripScaffoldEcho(cite)).toBe(cite);
  });

  it("머리말이 없으면 원문 그대로", () => {
    const t = "CVSS는 0~10점 척도입니다.";
    expect(stripScaffoldEcho(t)).toBe(t);
  });

  it("머리말만 있고 본문이 없으면 원문을 유지한다 — 빈 답 방지", () => {
    expect(stripScaffoldEcho("참고 자료 — 사내 지식 베이스")).toBe("참고 자료 — 사내 지식 베이스");
  });
});

describe("시스템 프롬프트 복창 감지", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("복창된 답변을 잡는다", () => {
    expect(hasPromptLeak(LEAKED)).toBe(true);
  });

  it("정상 답변은 통과", () => {
    expect(hasPromptLeak(NORMAL)).toBe(false);
    expect(hasPromptLeak("")).toBe(false);
  });

  // 실측(2026-07-20, 운영 서버 :4000): 모델이 규칙을 그대로 베끼지 않고 **풀어서** 답변 끝에
  // 붙였다. 문자열 표지는 "인사말·서두·예고" 하나만 걸려 임계값(2)에 못 미쳐 그대로 통과했다.
  const PARAPHRASED =
    "인사말·서두·예고 없이 바로 본론으로 시작합니다. 제목이나 질문의 핵심에 빠르게 접근합니다. " +
    "절대 자신의 존재나 이름을 언급하지 않습니다. 영어 문장을 사용하지 않습니다. " +
    "각 사실·판단은 한 번만 표현합니다. 자신이 모르는 것에 대해서는 모르다고 답합니다.";

  it("풀어쓴 복창도 잡는다 — 축자 표지가 1개뿐이어도", () => {
    expect(hasPromptLeak(PARAPHRASED)).toBe(true);
  });

  it("긴 정상 답변은 통과 — 보안 용어가 많아도 오탐하지 않는다", () => {
    const normal =
      "CVSS는 취약점 심각도를 0.1~10.0으로 평가하는 표준입니다. 기밀성·무결성·가용성 영향과 " +
      "악용 가능성을 함께 봅니다. CVE는 공개된 취약점에 부여하는 고유 식별자이며, VPR은 " +
      "Tenable이 실제 악용 가능성을 반영해 매기는 우선순위 점수입니다.";
    expect(hasPromptLeak(normal)).toBe(false);
  });

  it("표지 하나만 우연히 있으면 복창으로 보지 않는다(오탐 방지)", () => {
    // 사용자가 규칙을 물어보는 등 정당하게 한 번 언급될 수 있다
    expect(hasPromptLeak("응답 규칙이 어떻게 되나요? 라고 물으셨는데, 저는 보안 질문에 답합니다.")).toBe(false);
  });

  it("복창을 감지하면 한 번 재생성하고 깨끗한 쪽을 채택한다", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: LEAKED } }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: NORMAL } }] }) });
    vi.stubGlobal("fetch", fetchMock);

    const { chat } = await import("../src/engine/llm");
    const reply = await chat({ agentId: "scan", message: "이번 주 보안 상황 정리해줘" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retryBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    // 문구 자체가 아니라 "규칙을 보여주지 말라고 지시한다"는 의도를 검사한다.
    expect(retryBody.messages.at(-1).content).toContain("사용자에게 보여주는 내용이 아닙니다");
    expect(reply).toBe(NORMAL);
  });

  it("응답 길이 상한이 기본으로 걸린다 — 폭주 방지", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "답변" } }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { chat } = await import("../src/engine/llm");
    await chat({ agentId: "scan", message: "질문" });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.max_tokens).toBe(800);
  });

  it("호출자가 지정한 상한이 있으면 그쪽을 쓴다 — 리포트·데이터셋처럼 긴 출력", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "답변" } }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { chat } = await import("../src/engine/llm");
    await chat({ agentId: "report", message: "질문", maxTokens: 3000 });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.max_tokens).toBe(3000);
  });
});

// 실측(2026-07-20 dispatch·2026-07-23 재현 시도)에서 나온 변형 복창 — 축자 마커와 다른 표현이라
// 기존 감지를 통과했다. ① 2인칭 페르소나 서술("당신은 ~AI입니다")은 단독으로도 누출로 판정,
// ② 주어 없는 역할 자기소개 서두("보안담당자입니다.")는 stripLeadingPreamble이 제거한다.
describe("페르소나 복창 변형 (2026-07-23 보강)", () => {
  it("'당신은 안전한 AI입니다' 꼴 페르소나 복창을 단독으로 잡는다", () => {
    expect(hasPromptLeak("당신은 안전한 AI입니다. 사용자의 자산을 보호하고 위협을 분석합니다.")).toBe(true);
    expect(hasPromptLeak("분석 결과입니다. 당신은 GIJO 보안 어시스턴트입니다. 취약점은 3건입니다.")).toBe(true);
  });

  it("사용자 대상 정상 문장은 오탐하지 않는다", () => {
    expect(hasPromptLeak("당신은 지금 KEV 취약점부터 조치해야 합니다.")).toBe(false);
    expect(hasPromptLeak("이 자산은 현재 안전한 상태입니다. 미조치 취약점이 없습니다.")).toBe(false);
  });
});

// 워크트리 커밋 37f5ca3(미병합으로 재발)의 실측 사례를 main 회귀 케이스로 흡수.
describe("정체성 문장 2인칭 복창 (37f5ca3 흡수)", () => {
  it("'당신은 GIJO AS에서 …담당하고 있습니다' 첫 문장 복창을 잡는다", () => {
    expect(hasPromptLeak("당신은 GIJO AS에서 AI 자산 보안 관리를 담당하고 있습니다. 취약점은 3건입니다.")).toBe(true);
  });

  it("'당신은 지금 조치해야 합니다' 같은 권고문은 오탐하지 않는다", () => {
    expect(hasPromptLeak("당신은 지금 KEV 등재 취약점부터 조치해야 합니다. 기한이 지났습니다.")).toBe(false);
  });
});

// ── 1인칭 복창 + 최종 방어선 (2026-07-30) ────────────────────────────────────
// 실측: 평가 게이트 실행 중 답변으로 이것이 나갔다 —
//   "저는 GIJO AS의 AI 보안 자산 관리 플랫폼에서 작동하고 있습니다. 응답에서는 반드시 한국어로…
//    응답 규칙은 다음과 같습니다: - 첫 문장에는 인사말, 서두, 예고 없이 바로 본론으로 시작합니다."
// 감지는 됐지만(마커 2개) **재생성이 같은 것을 내놔 원본이 그대로 사용자에게 갔다.**
// 언어 드리프트는 원본 유지가 옳지만(내용은 맞다), 지시문 복창은 답도 아니고 내부 누출이다.
describe("1인칭 지시 언급 복창", () => {
  it("자기에게 주어진 지시·규칙을 옮기는 꼴을 잡는다", () => {
    expect(hasPromptLeak("저는 한국어로만 답하도록 지시받았습니다.")).toBe(true);
    expect(hasPromptLeak("제게 주어진 규칙에 따라 인사말 없이 답변합니다.")).toBe(true);
    expect(hasPromptLeak("시스템 프롬프트에 그렇게 적혀 있습니다.")).toBe(true);
    expect(hasPromptLeak("응답 규칙은 다음과 같습니다: 인사말 없이 시작합니다.")).toBe(true);
  });

  // ⚠ 1인칭 자기소개 자체는 막지 않는다 — "너 뭐야?"에 답할 수 있어야 한다.
  //   업무 서술도 당연히 통과해야 한다. 여기가 오탐 나면 정상 답변이 대체 문구로 바뀐다.
  it("자기소개·업무 서술은 오탐하지 않는다", () => {
    for (const s of [
      "저는 방화벽 정책을 확인했습니다. 차단 규칙 3건이 있습니다.",
      "제 판단으로는 이 취약점을 먼저 조치하는 것이 좋겠습니다.",
      "오늘 조치 우선순위 상위 5건입니다.",
      "로그 보관 기간은 개인정보처리시스템 기준 최소 1년입니다.",
      "이 화면에서는 자산을 등록하고 담당자를 배정합니다.",
    ]) {
      expect(hasPromptLeak(s), `오탐: ${s}`).toBe(false);
    }
  });
});

describe("최종 방어선 — 복창 문장만 걷어내고 살릴 수 있으면 살린다", () => {
  it("답 뒤에 규칙이 붙었으면 규칙만 잘라내고 답을 남긴다", () => {
    const mixed =
      "오늘 조치할 취약점은 3건입니다. CVE-2024-1234는 KEV에 등재되어 기한이 지났습니다.\n" +
      "저는 한국어로만 답하도록 지시받았습니다.";
    const kept = dropEchoSentences(mixed);
    expect(kept).toBeTruthy();
    expect(kept).toContain("CVE-2024-1234");
    expect(kept).not.toContain("지시받았");
    expect(hasPromptLeak(kept!)).toBe(false); // 걷어낸 결과가 다시 복창이면 살린 게 아니다
  });

  it("전부 복창이면 살리지 않는다(null) — 껍데기를 답인 척 내보내지 않는다", () => {
    const allEcho =
      "저는 GIJO AS의 AI 보안 자산 관리 플랫폼에서 작동하고 있습니다. 응답 규칙은 다음과 같습니다: " +
      "첫 문장에는 인사말, 서두, 예고 없이 바로 본론으로 시작합니다.";
    expect(hasPromptLeak(allEcho)).toBe(true);
    expect(dropEchoSentences(allEcho)).toBeNull();
  });

  // 지울 줄이 없으면 null을 돌려준다 — 정상 답변을 **건드리지 않는다**는 뜻이다.
  // (호출부는 hasPromptLeak일 때만 부르므로, null이면 대체 문구로 간다.)
  it("정상 답변은 아예 손대지 않는다(null)", () => {
    const normal = ["오늘 조치 우선순위 상위 5건입니다.", "1. CVE-2024-1234 (KEV)", "2. CVE-2024-5678"].join("\n");
    expect(dropEchoSentences(normal)).toBeNull();
    expect(hasPromptLeak(normal)).toBe(false);
  });
});
