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
  db.prepare("UPDATE law_config SET encryptedKey = NULL, enabled = 0, domain = NULL WHERE id = 1").run();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const jsonRes = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

describe("법령 조회 — 켜짐/꺼짐", () => {
  it("기본은 꺼져 있다 — 인터넷이 필요한 기능이라 켜려면 키를 넣어야 한다", () => {
    expect(law.getLawConfig()).toMatchObject({ enabled: false, hasKey: false, domain: "", updatedAt: null });
  });

  // 화면이 목록을 또 적으면 두 곳이 어긋난다 — 서버 한 벌을 내려준다.
  it("자주 걸리는 법 목록을 함께 준다(화면이 그대로 그린다)", () => {
    expect(law.getLawConfig().laws).toContain("개인정보 보호법");
    expect(law.getLawConfig().laws).toBe(law.IT_SECURITY_LAWS);
  });

  it("꺼진 상태로 조회하면 무엇을 해야 하는지 알려준다(조용히 실패 금지)", async () => {
    await expect(law.searchLaw("개인정보 보호법")).rejects.toThrow(/꺼져 있습니다|인증키/);
    expect(fetchMock).not.toHaveBeenCalled(); // 키 없이 외부로 나가지 않는다
  });

  it("키를 넣으면 켜지고, 빈 값을 넣으면 지워지고 꺼진다", () => {
    expect(law.setLawConfig("my-key", "www.example.kr")).toMatchObject({ enabled: true, hasKey: true });
    expect(law.setLawConfig("")).toMatchObject({ enabled: false, hasKey: false, domain: "" });
  });

  it("키 원문은 응답에 실리지 않는다(hasKey 불리언만)", () => {
    law.setLawConfig("secret-oc-value", "www.example.kr");
    expect(JSON.stringify(law.getLawConfig())).not.toContain("secret-oc-value");
  });

  // 신청 도메인 — 담당자가 신청현황 화면에서 본 것을 그대로 붙여넣어도 받아야 한다.
  it("도메인은 스킴·경로·포트를 떼고 호스트만 남긴다", () => {
    for (const 넣은값 of ["https://www.gijo.ai/", "http://WWW.GIJO.AI", "www.gijo.ai/list?a=1", " www.gijo.ai:443 "]) {
      expect(law.normalizeLawDomain(넣은값)).toBe("www.gijo.ai");
    }
  });

  it("도메인은 비밀이 아니라 그대로 돌려준다 — 뭘 넣었는지 화면에서 봐야 고친다", () => {
    expect(law.setLawConfig("k", "https://www.gijo.ai/").domain).toBe("www.gijo.ai");
  });
});

describe("법령 조회 — 법제처 인증(Referer)", () => {
  // ⚠ 실사고(2026-08-09): OC·승인 모두 정상인데 계속 거부됐다. 법제처는 OC만으로 인증하지 않고
  //   Referer가 활용신청서의 "도메인주소"와 맞는지까지 본다. 우리가 Referer를 안 보내고 있었다.
  it("신청 도메인을 Referer 헤더로 보낸다 — 없으면 법제처가 거부한다", async () => {
    law.setLawConfig("test", "www.gijo.ai");
    fetchMock.mockResolvedValue(jsonRes({ LawSearch: { law: [] } }));
    await law.searchLaw("개인정보 보호법");
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Referer).toBe("https://www.gijo.ai/");
  });

  it("도메인이 없으면 Referer를 지어내지 않는다(엉뚱한 값은 어차피 거부된다)", async () => {
    law.setLawConfig("test");
    fetchMock.mockResolvedValue(jsonRes({ LawSearch: { law: [] } }));
    await law.searchLaw("개인정보 보호법");
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Referer).toBeUndefined();
  });

  it("「사용자 정보 검증 실패」는 인증키(OC)를 짚어준다", async () => {
    law.setLawConfig("wrong-oc", "www.gijo.ai");
    fetchMock.mockResolvedValue(jsonRes({ result: "사용자 정보 검증에 실패하였습니다.", msg: "…IP주소 및 도메인주소를 등록해 주세요." }));
    await expect(law.searchLaw("개인정보 보호법")).rejects.toThrow(/인증키\(OC\)를 알아보지 못했습니다/);
  });

  it("「필수입력요소 검증 실패」는 URL이 아니라 신청 도메인을 짚어준다", async () => {
    law.setLawConfig("test", "www.wrong.kr");
    fetchMock.mockResolvedValue(jsonRes({ result: "필수입력요소 검증에 실패하였습니다.", msg: "필수 입력값이 존재하지 않습니다. 요청 URL을 확인해 주세요." }));
    const 오류 = law.searchLaw("개인정보 보호법");
    await expect(오류).rejects.toThrow(/신청 도메인\(www\.wrong\.kr\)이 맞지 않습니다/);
  });

  it("도메인이 비어 있을 때는 '도메인을 넣으라'고 안내한다", async () => {
    law.setLawConfig("test");
    fetchMock.mockResolvedValue(jsonRes({ result: "필수입력요소 검증에 실패하였습니다.", msg: "필수 입력값이 존재하지 않습니다." }));
    await expect(law.searchLaw("개인정보 보호법")).rejects.toThrow(/신청 도메인이 비어 있습니다/);
  });
});

describe("법령 조회 — 응답 가공", () => {
  beforeEach(() => law.setLawConfig("test", "www.gijo.ai"));

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

  // ⚠ 실사고(2026-08-09): 장 제목 칸도 **뒤따르는 조문의 번호를 갖고 있다**. 번호 유무로 거르면
  //   제29조를 물었을 때 "제4장 개인정보의 안전한 관리"가 함께 나온다. 법제처의 조문여부로 갈라야 한다.
  it("장 제목이 조문번호를 갖고 있어도 조문으로 세지 않는다(실데이터 꼴)", async () => {
    fetchMock.mockResolvedValue(
      jsonRes({
        법령: {
          조문: {
            조문단위: [
              { 조문번호: "29", 조문내용: "                        제4장 개인정보의 안전한 관리", 조문여부: "전문" },
              { 조문번호: "29", 조문제목: "안전조치의무", 조문내용: "제29조(안전조치의무) 개인정보처리자는…", 조문여부: "조문" },
            ],
          },
        },
      })
    );
    const arts = await law.getLawArticles("270351", "제29조");
    expect(arts).toHaveLength(1);
    expect(arts[0].title).toBe("안전조치의무");
    expect(arts[0].text).not.toContain("제4장");
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
