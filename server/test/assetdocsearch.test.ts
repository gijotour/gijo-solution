// 자산은 찾았는데 그 자산의 취약점이 DB에 없을 때, **그 자산을 다룬 사내 문서**를 붙이는가.
//
// 왜 이 시험이 있나(실사고 2026-07-28 → 원인 규명 2026-08-02):
//   "안전대부 웹서버 취약점 알려줘"에 "finding 없음 · 스캔 실패 1건"이라고 답했다.
//   같은 서버의 웹 취약점 진단 보고서가 지식에 31조각으로 들어 있었고 거기엔 5건이 적혀 있었다.
//   담당자가 이 답으로 "취약점 없음"이라고 보고하면 그것이 사고다.
//   원인은 **같은 질문에 잣대가 둘**이었던 것 — 자산은 낱말 하나만 걸려도 찾는데(이름에
//   "웹 서버"가 있다) 문서는 질문 문자열이 제목에 들어 있어야 찾았다(제목은 "웹취약점").
//
// ⚠ 여기서 지키는 것은 **확인된 것만 싣는가**다. 아무 발췌나 자산 취약점으로 보여 주면
//   없느니만 못하다 — 그래서 조각이 그 자산(호스트명·고유 낱말)을 실제로 가리키는지 본다.
import { describe, it, expect, vi, beforeEach } from "vitest";

// ⚠ 조각에 **문서 이름을 달아 다닌다**(2026-08-04). 이름이 없으면 우리 제품 설계 문서가
//   남의 자산 점검 보고서로 둔갑해도 알아챌 수 없다 — 실제로 그런 사고가 났다.
const 조각들 = vi.hoisted(() => ({ list: [] as { text: string; documentId: string }[] }));
const 자산들 = vi.hoisted(() => ({ list: [] as unknown[] }));

vi.mock("../src/engine/memory", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  queryMemory: vi.fn(async () => 조각들.list.map((c) => c.text)),
  queryMemoryScored: vi.fn(async () => 조각들.list.map((c) => ({ text: c.text, documentId: c.documentId, distance: 0.3 }))),
  documentsForAsset: vi.fn(() => []),
  listVisibleDocuments: vi.fn(async () => []),
}));
vi.mock("../src/engine/assets", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  listAssets: vi.fn(() => 자산들.list),
}));

const { findAgentTool } = await import("../src/engine/agenttools");

const 자산 = (findings: unknown[] = []) => ({
  id: "vuln:certify.aj-safe.co.kr",
  name: "안전대부 본인인증 웹 서버 (certify.aj-safe.co.kr)",
  assetType: "infra-host",
  components: [],
  findings,
});

async function 찾기(q: string): Promise<string> {
  const tool = findAgentTool("search");
  if (!tool) throw new Error("search 도구가 없다 — 이름이 바뀌었으면 이 시험도 고쳐야 한다");
  return await tool.run({ query: q });
}

describe("자산을 다룬 문서에서 취약점 발췌", () => {
  beforeEach(() => {
    조각들.list = [];
    자산들.list = [];
  });

  it("DB에 취약점이 없어도 그 자산을 다룬 보고서 대목을 싣는다", async () => {
    // 스캔은 실패했고(취약점 아님) 보고서에만 적혀 있는 상황 — 실제 운영 데이터와 같다.
    자산들.list = [자산([{ finding_type: "scan_error", severity: "low", evidence: "Command failed" }])];
    조각들.list = [
      {
        text: "안전대부 본인인증 웹 서버 (certify.aj-safe.co.kr) 디렉토리 인덱싱 · 임시/백업 파일 노출 · 데이터 평문 전송",
        documentId: "(주)안전대부 서비스 웹취약점 점검 결과 보고서_v1.0.pdf",
      },
    ];
    const out = await 찾기("안전대부 웹서버");
    // ★ **어느 문서인지 밝힌다**(2026-08-04). 예전엔 "사내 점검 보고서"라고 단정했는데,
    //   그러면 담당자가 근거를 확인할 길이 없고 엉뚱한 문서가 걸려도 알아채지 못한다.
    expect(out).toContain("(주)안전대부 서비스 웹취약점 점검 결과 보고서_v1.0.pdf");
    expect(out, "단정 문구는 더 이상 쓰지 않는다").not.toContain("사내 점검 보고서");
    expect(out).toContain("디렉토리 인덱싱");
    expect(out).toContain("평문 전송");
  });

  it("★★ 우리 제품 문서는 어느 자산의 점검 보고서도 아니다 (2026-08-04 147상황 실사고)", async () => {
    // 자산 이름 "GIJO AS 서버(로컬)"에서 고유 낱말을 뽑으면 "GIJO" 하나가 남는다.
    // 우리 사내 문서는 전부 `GIJO_AS_…`라 **설계 문서 전부가 이 자산의 점검 보고서로 걸렸다.**
    // 「SSH 취약점 찾아줘」 답이 2,561자가 됐고 그중 1,800자가 우리 제품 소개였다.
    자산들.list = [
      {
        id: "vuln:local",
        name: "GIJO AS 서버(로컬)",
        assetType: "server",
        components: [],
        findings: [{ finding_type: "scan_error", severity: "low", evidence: "x" }],
      },
    ];
    조각들.list = [
      { text: "# GIJO AS 취약점 관리 지침 — Tenable 사용자 가이드의 방법론을 요약·채택한 것", documentId: "GIJO_AS_취약점관리_지침.md" },
      { text: "### 6.1 시스템 구성 — GIJO AS 서버는 Node.js/Express로 상태를 단독 소유한다", documentId: "GIJO_AS_소개.md" },
    ];
    const out = await 찾기("GIJO AS 서버");
    expect(out, "우리 지침 문서가 자산 점검 결과로 실리면 안 된다").not.toContain("취약점 관리 지침");
    expect(out, "제품 소개가 자산 점검 결과로 실리면 안 된다").not.toContain("시스템 구성");
    expect(out.length, "2,561자 사고의 재발 — 답이 이렇게 길어질 이유가 없다").toBeLessThan(1200);
  });

  it("그 자산을 가리키지 않는 조각은 싣지 않는다", async () => {
    // ⚠ 벡터 검색은 **엉뚱한 문서도 가까우면 돌려준다.** 확인 없이 실으면 남의 취약점을
    //   이 자산 것으로 보여 주게 된다 — 없느니만 못한 답이다.
    자산들.list = [자산([{ finding_type: "scan_error", severity: "low", evidence: "x" }])];
    조각들.list = [{ text: "전혀 다른 회사 다른 서버의 점검 결과입니다. SQL 인젝션이 발견되었습니다.", documentId: "남의회사_점검결과.pdf" }];
    const out = await 찾기("안전대부 웹서버");
    expect(out).not.toContain("SQL 인젝션");
    expect(out).not.toContain("남의회사_점검결과.pdf");
  });

  it("넓은 질문(자산이 여럿 걸림)에는 붙이지 않는다", async () => {
    // ⚠ "자산 목록 보여줘"에 앞의 두 자산만 보고서를 붙이면 **하필 그 둘만 자세한** 이상한
    //   답이 된다. 지금 운영 데이터는 자산 대부분이 스캔 실패뿐이라 이 가지를 안 막으면
    //   거의 항상 탄다.
    const 여럿 = [1, 2, 3, 4].map((n) => ({
      ...자산([{ finding_type: "scan_error", severity: "low", evidence: "x" }]),
      id: `vuln:h${n}.aj-safe.co.kr`,
      name: `안전대부 서버 ${n} (h${n}.aj-safe.co.kr)`,
    }));
    자산들.list = 여럿;
    조각들.list = [{ text: "안전대부 h1.aj-safe.co.kr 디렉토리 인덱싱", documentId: "안전대부_점검.pdf" }];
    const out = await 찾기("안전대부");
    expect(out).not.toContain("안전대부_점검.pdf");
    expect(out).not.toContain("디렉토리 인덱싱");
  });

  it("DB에 진짜 취약점이 있으면 문서를 뒤지지 않는다", async () => {
    // 있는 것을 두고 문서를 또 뒤지면 같은 취약점이 두 번 나와 건수가 어긋난다.
    자산들.list = [자산([{ finding_type: "CVE-2025-1234", severity: "critical", evidence: "인증 우회" }])];
    조각들.list = [{ text: "안전대부 certify.aj-safe.co.kr 디렉토리 인덱싱", documentId: "안전대부_점검.pdf" }];
    const out = await 찾기("안전대부 웹서버");
    expect(out).toContain("CVE-2025-1234");
    expect(out).not.toContain("안전대부_점검.pdf");
  });
});
