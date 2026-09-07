// 인입 품질 관문 — **읽을 수 없는 문서를 조용히 받아들이지 않는다.**
//
// 실사고(2026-08-08): 저장소 조각의 73%가 PDF 압축 바이트였다. 숫자로는 "지식 5,631조각"이라
// 건강해 보였고, 아무도 내용을 열어 보지 않아 오래 몰랐다. 넣는 순간 막았어야 할 일이다.
//
// 판정 방식: 위생 필터가 걸러 내기 **전과 후**를 비교한다. 원문 길이로 기대한 조각 수의
// 20%도 안 남았다면 그 문서는 글자가 아니다 — 성공한 척하지 말고 오류로 알린다.
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// ⚠ 이 시험은 「정상 문서는 그대로 들어간다」에서 **진짜로 LanceDB에 쓴다.** 경로를 안 걸면
//   memory.ts의 기본값(cwd/data/memory.lancedb)이라 **개발 기계의 진짜 지식 베이스**에 시험
//   문서가 쌓인다(2026-09-04 실측: 시험 하나만 돌려도 사본에 server/data/memory.lancedb가 생겼다.
//   D:\Connect AI\server\data\memory.lancedb는 실재하는 개발 데이터다).
//   testisolation.test.ts의 표가 막으려는 바로 그 계열 — 표에도 함께 적었다.
// ⚠ 경로는 memory.ts가 **모듈 로드 시점에** 읽는다. 그래서 아래 memory import는 정적 import가
//   아니라 `await import`다 — 정적 import는 이 줄들보다 **먼저** 돌아 env를 못 본다.
// ⚠ 이름에 pid·시각을 넣는다 — 강제 종료로 남은 찌꺼기가 「누가 언제 만든 것인지」 말해 준다.
const tmpDb = fs.mkdtempSync(path.join(os.tmpdir(), `gijo-lancedb-ingestquality-${process.pid}-${Date.now()}-`));
process.env.GIJO_MEMORY_DB_PATH = tmpDb;

// ⚠ 2026-08-28(화살 #12): embed가 잎 모듈 engine/embedding.ts로 내려갔다 — memory는 그쪽을
//   문다. llm만 목하면 **진짜 embed가 돌아** 임베딩 서버(8081)를 찾다 실패한다(실측).
vi.mock("../src/engine/embedding", () => ({ embed: vi.fn(async (t: string[]) => t.map(() => [0.1, 0.2, 0.3])) }));
vi.mock("../src/engine/llm", () => ({
  // 2026-08-29 화살 #14·#15 — llm이 RAG·수집 훅을 내보낸다. 목도 표면을 따라가야 한다
  // (안 주면 그 모듈을 import하는 파일이 통째로 죽는다 — verifyroutes 6개가 실증).
  setRagProvider: vi.fn(), hasRagProvider: vi.fn(() => false), onChatRecorded: vi.fn(), chatLogListenerCount: vi.fn(() => 0), chat: vi.fn(async () => "기타"), embed: vi.fn(async () => [new Array(1024).fill(0.01)]) }));

const { ingestText } = await import("../src/engine/memory");

describe("읽을 수 없는 문서는 인입에서 막는다", () => {
  beforeEach(() => vi.clearAllMocks());
  afterAll(() => fs.rmSync(tmpDb, { recursive: true, force: true })); // 남기지 않는다 — /tmp에 매 실행마다 쌓이면 그것도 사고다

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

// ★ 2026-09-07 — 낱말 구분자가 제어문자인 PDF가 「읽지 못했습니다」로 거절되던 자리.
//   추출은 성공했는데 판정기가 제어문자만 보고 통째로 바이너리라 했다. 실물 PDF로 끝까지 태운다.
describe("낱말 구분자가 제어문자인 PDF도 반입된다 (2026-09-07 실사고)", () => {
  it("추출 → 인입이 400 없이 통과하고 조각이 남는다", async () => {
    const { extractDocumentText } = await import("../src/engine/dataset");
    const b64 = fs.readFileSync(path.join(__dirname, "fixtures", "ctrl-sep.pdf")).toString("base64");
    const 글 = await extractDocumentText("ctrl-sep.pdf", b64);
    const r = await ingestText("제어문자구분자.pdf", 글);
    expect(r.chunks, "조각이 0이면 예전 결함 그대로다").toBeGreaterThan(0);
  });

  // ★ 반증 — 이 수리가 **게이트를 열어 버리지 않았는가**. 위 표본은 손으로 적으면 제어 바이트가
  //   빠져 시험이 헛돈다(실제로 한 번 그렇게 틀렸다). 그래서 **진짜 PDF 파일의 바이트**를
  //   글자인 척 그대로 넣는다 — 2026-08-08에 저장소 73%를 채웠던 바로 그 꼴이다.
  it("추출을 안 거친 **날것 PDF 바이트**는 여전히 막는다 — 이 수리가 게이트를 열지 않았다", async () => {
    const 날것 = fs.readFileSync(path.join(__dirname, "fixtures", "has-text.pdf")).toString("utf8");
    expect(날것.length, "표본이 너무 짧으면 품질 가드가 원리상 안 돈다").toBeGreaterThan(2400);
    await expect(ingestText("여전히깨진문서.pdf", 날것)).rejects.toThrow(/읽지 못했습니다/);
  });
});
