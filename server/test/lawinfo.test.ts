// 법령 조회(법제처 국가법령정보 공개 API) — 켜짐/꺼짐 계약과 응답 가공을 검증한다.
// 외부 호출은 스텁으로 막는다: 테스트가 인터넷에 의존하면 망 없는 곳에서 깨지고,
// 법제처 사정으로 우리 CI가 빨개진다. 실제 호출은 별도로 실측했다(2026-07-26).
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

vi.mock("../src/engine/llm", () => ({
  chat: vi.fn(async () => "[mock]"),
  embed: vi.fn(async (t: string[]) => t.map(() => [0.1])),
  registerLlmRoutes: vi.fn(),
}));

const { db } = await import("../src/db");
const law = await import("../src/engine/lawinfo");

const fetchMock = vi.fn();
beforeEach(() => {
  db.prepare("UPDATE law_config SET encryptedKey = NULL, enabled = 0 WHERE id = 1").run();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const jsonRes = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

describe("법령 조회 — 켜짐/꺼짐", () => {
  it("기본은 꺼져 있다 — 인터넷이 필요한 기능이라 켜려면 키를 넣어야 한다", () => {
    expect(law.getLawConfig()).toEqual({ enabled: false, hasKey: false, updatedAt: null });
  });

  it("꺼진 상태로 조회하면 무엇을 해야 하는지 알려준다(조용히 실패 금지)", async () => {
    await expect(law.searchLaw("개인정보 보호법")).rejects.toThrow(/꺼져 있습니다|인증키/);
    expect(fetchMock).not.toHaveBeenCalled(); // 키 없이 외부로 나가지 않는다
  });

  it("키를 넣으면 켜지고, 빈 값을 넣으면 지워지고 꺼진다", () => {
    expect(law.setLawKey("my-key")).toMatchObject({ enabled: true, hasKey: true });
    expect(law.setLawKey("")).toMatchObject({ enabled: false, hasKey: false });
  });

  it("키 원문은 응답에 실리지 않는다(hasKey 불리언만)", () => {
    law.setLawKey("secret-oc-value");
    expect(JSON.stringify(law.getLawConfig())).not.toContain("secret-oc-value");
  });
});

describe("법령 조회 — 응답 가공", () => {
  beforeEach(() => law.setLawKey("test"));

  it("법령 검색 결과를 제목·시행일·소관부처와 공개 링크로 정리한다", async () => {
    fetchMock.mockResolvedValue(
      jsonRes({
        LawSearch: {
          law: [{ 법령명한글: "개인정보 보호법", 법령일련번호: "270351", 소관부처명: "개인정보보호위원회", 시행일자: "20251002", 제개정구분명: "일부개정" }],
        },
      })
    );
    const [hit] = await law.searchLaw("개인정보 보호법");
    expect(hit.title).toBe("개인정보 보호법");
    expect(hit.meta).toContain("시행 2025-10-02"); // 20251002 → 읽기 쉬운 날짜
    expect(hit.meta).toContain("개인정보보호위원회");
    expect(hit.link).toContain("law.go.kr");
  });

  it("원문 링크에 우리 인증키가 실리지 않는다", async () => {
    fetchMock.mockResolvedValue(
      jsonRes({
        LawSearch: {
          law: [{ 법령명한글: "개인정보 보호법", 법령일련번호: "270351", 법령상세링크: "/DRF/lawService.do?OC=test&target=law&MST=270351" }],
        },
      })
    );
    const [hit] = await law.searchLaw("개인정보 보호법");
    expect(hit.link).not.toContain("OC=");
  });

  it("판례·고시는 각자 맞는 필드로 읽는다", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonRes({ PrecSearch: { prec: [{ 사건명: "개인정보 유출 사건", 판례일련번호: "237875", 법원명: "대법원", 사건번호: "2022두68923", 선고일자: "20231012" }] } })
    );
    const [prec] = await law.searchLaw("개인정보 유출", "prec");
    expect(prec.title).toBe("개인정보 유출 사건");
    expect(prec.meta).toContain("대법원");

    fetchMock.mockResolvedValueOnce(
      jsonRes({ AdmRulSearch: { admrul: [{ 행정규칙명: "개인정보의 안전성 확보조치 기준", 행정규칙일련번호: "2100000281400", 소관부처명: "개인정보보호위원회", 행정규칙종류: "고시", 시행일자: "20260701" }] } })
    );
    const [rule] = await law.searchLaw("안전성 확보조치", "admrul");
    expect(rule.title).toContain("안전성 확보조치");
    expect(rule.meta).toContain("고시");
  });

  it("답변에는 법률 자문이 아니라는 문구가 항상 붙는다", async () => {
    fetchMock.mockResolvedValue(jsonRes({ LawSearch: { law: [{ 법령명한글: "개인정보 보호법", 법령일련번호: "1" }] } }));
    expect(await law.lawAnswer("개인정보 보호법")).toContain("법률 자문이 아닙니다");
  });

  it("0건이면 '없다'고 단정하지 않고 다시 물어보게 안내한다", async () => {
    fetchMock.mockResolvedValue(jsonRes({ LawSearch: {} }));
    const out = await law.lawAnswer("존재하지않는법률XYZ");
    expect(out).toContain("찾지 못했습니다");
    expect(out).toContain("없다는 뜻이 아니라");
    expect(out).not.toMatch(/존재하지 않습니다/);
  });

  it("본문 조문에서 편·장 제목 칸은 걸러낸다", async () => {
    fetchMock.mockResolvedValue(
      jsonRes({
        법령: {
          조문: {
            조문단위: [
              { 조문번호: "", 조문내용: "제4장 개인정보의 안전한 관리" }, // 장 제목 — 조문이 아니다
              { 조문번호: "29", 조문제목: "안전조치의무", 조문내용: "제29조(안전조치의무) 개인정보처리자는…" },
            ],
          },
        },
      })
    );
    const arts = await law.getLawArticles("270351");
    expect(arts).toHaveLength(1);
    expect(arts[0].no).toBe("29");
  });

  it("조문 번호를 지정하면 그 조문만 준다", async () => {
    fetchMock.mockResolvedValue(
      jsonRes({
        법령: {
          조문: {
            조문단위: [
              { 조문번호: "28", 조문내용: "제28조…" },
              { 조문번호: "29", 조문내용: "제29조(안전조치의무)…" },
            ],
          },
        },
      })
    );
    const arts = await law.getLawArticles("270351", "제29조");
    expect(arts).toHaveLength(1);
    expect(arts[0].no).toBe("29");
  });
});
