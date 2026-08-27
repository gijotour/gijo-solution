// 인입 품질 관문 — **읽을 수 없는 문서를 조용히 받아들이지 않는다.**
//
// 실사고(2026-08-08): 저장소 조각의 73%가 PDF 압축 바이트였다. 숫자로는 "지식 5,631조각"이라
// 건강해 보였고, 아무도 내용을 열어 보지 않아 오래 몰랐다. 넣는 순간 막았어야 할 일이다.
//
// 판정 방식: 위생 필터가 걸러 내기 **전과 후**를 비교한다. 원문 길이로 기대한 조각 수의
// 20%도 안 남았다면 그 문서는 글자가 아니다 — 성공한 척하지 말고 오류로 알린다.
import { describe, it, expect, vi, beforeEach } from "vitest";

// ⚠ 2026-08-28(화살 #12): embed가 잎 모듈 engine/embedding.ts로 내려갔다 — memory는 그쪽을
//   문다. llm만 목하면 **진짜 embed가 돌아** 임베딩 서버(8081)를 찾다 실패한다(실측).
vi.mock("../src/engine/embedding", () => ({ embed: vi.fn(async (t: string[]) => t.map(() => [0.1, 0.2, 0.3])) }));
vi.mock("../src/engine/llm", () => ({ chat: vi.fn(async () => "기타"), embed: vi.fn(async () => [new Array(1024).fill(0.01)]) }));

import { ingestText } from "../src/engine/memory";

describe("읽을 수 없는 문서는 인입에서 막는다", () => {
  beforeEach(() => vi.clearAllMocks());

  it("PDF 압축 바이트를 넣으면 오류로 알린다 — 조용히 0조각이 아니라", async () => {
    // ⚠ 표본은 **실제 저장돼 있던 조각 그대로**여야 한다. 처음엔 제어문자를 빼고 적었는데
    //   그러면 진짜 데이터와 다른 것을 시험하게 된다(그 표본은 통과해 버렸다).
    //   운영에서 읽어낸 조각에는 ·· 같은 제어 바이트가 흩뿌려져 있다.
    const 쓰레기 =
      "\bzb~'}2rWjvzgh}-ft}-¢irfޮM>O\n-g*')ޞys#?]y}xƮ-m5C^z{bt^u(Wl杪x(67z%\fymƫxǝƥwnjQ'z2EZTj{)Z*')ڝȚ''WzJ֭xjQƭ̉Jey7HH1J{'r+]p]s".repeat(20);
    await expect(ingestText("깨진문서.pdf", 쓰레기)).rejects.toThrow(/읽지 못했습니다/);
  });

  it("오류 문구가 담당자에게 무엇을 하라고 말해 준다", async () => {
    const 쓰레기 = "zb~'}2rWjvzgh}-ft}-¢irfޮM>Oys#?]y}xƮ-m5C^z{bt^u(Wl".repeat(30);
    await expect(ingestText("깨진문서2.pdf", 쓰레기)).rejects.toThrow(/텍스트 추출/);
  });

  it("정상 문서는 그대로 들어간다(오탐 방지)", async () => {
    const 정상 = [
      "SSL/TLS 인증서 유효기간이 47일로 단축되면서 수작업 갱신은 한계에 부딪혔습니다.",
      "WizCLM은 Agent, Agentless, API 세 가지 방식으로 장비별 인증서를 검색합니다.",
      "Keyfactor Command는 어떤 CA와도 연동되며 인증서 발급·갱신·폐기를 자동화합니다.",
      "인증서 만료 알림은 D-4부터 단계적으로 발송되고, 작업 결과도 함께 통보됩니다.",
    ].join("\n\n").repeat(5);
    const r = await ingestText("정상문서.md", 정상);
    expect(r.chunks).toBeGreaterThan(0);
  });

  it("아주 짧은 문서는 판정하지 않는다 — 한 줄짜리 메모도 지식이다", async () => {
    const r = await ingestText("짧은메모.txt", "방화벽 FW-01 담당자는 보안운영팀입니다.");
    expect(r.chunks).toBeGreaterThanOrEqual(0); // 막히지만 않으면 된다
  });
});
