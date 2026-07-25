import { describe, it, expect } from "vitest";
import {
  webReportTriples,
  manualTriples,
  maintenanceReportTriples,
  syncDocTriples,
  removeDocTriples,
  docSource,
} from "../src/engine/docgraph";
import { listTriples, expandOntology } from "../src/engine/ontology";

const SAMPLE = {
  assets: [
    { host: "certify.example.co.kr", name: "본인인증 웹 서버", ip: "10.0.0.11" },
    { host: "10.0.0.12", name: "10.0.0.12" }, // 이름 없는 자산 — 서비스명 트리플 생략
  ],
  vulns: [
    { host: "certify.example.co.kr", name: "데이터 평문 전송", risk: "medium", cve: "", description: "", pluginId: "IW-32", port: "", protocol: "" },
    { host: "10.0.0.12", name: "디렉터리 목록 노출", risk: "low", cve: "", description: "", pluginId: "IW-25", port: "", protocol: "" },
  ],
};

describe("docgraph — 트리플 생성 규칙(지어내지 않는다)", () => {
  it("웹취약점 보고서: 보고서→자산, 자산→취약점, 취약점→위험도", () => {
    const t = webReportTriples("보고서.pdf", SAMPLE);
    const s = t.map((x) => `${x.subject}|${x.predicate}|${x.object}`);
    expect(s).toContain("보고서.pdf|점검 보고서|certify.example.co.kr");
    expect(s).toContain("certify.example.co.kr|서비스명|본인인증 웹 서버");
    expect(s).toContain("certify.example.co.kr|발견 취약점|[IW-32] 데이터 평문 전송");
    expect(s).toContain("[IW-32] 데이터 평문 전송|위험도|medium");
    // 이름=호스트인 자산은 서비스명 트리플을 만들지 않는다(자기 자신 관계는 잡음)
    expect(s.filter((x) => x.includes("10.0.0.12|서비스명"))).toHaveLength(0);
    // 전 트리플의 source가 문서로 귀속된다(멱등 삭제의 열쇠)
    expect(t.every((x) => x.source === docSource("보고서.pdf"))).toBe(true);
  });

  it("대형 입력도 문서당 상한(60)을 넘지 않는다 — 온톨로지 잡음 방지", () => {
    const big = {
      assets: Array.from({ length: 50 }, (_, i) => ({ host: `h${i}.example.com`, name: `서버${i}` })),
      vulns: Array.from({ length: 100 }, (_, i) => ({ host: `h${i % 50}.example.com`, name: `취약점${i}`, risk: "low", cve: "", description: "", pluginId: `X-${i}`, port: "", protocol: "" })),
    };
    expect(webReportTriples("big.pdf", big).length).toBeLessThanOrEqual(60);
  });

  it("제품 매뉴얼: 종류(제품/로그)에 따라 술어가 갈린다", () => {
    expect(manualTriples("fw.pdf", "FW-2000", "manual")[0].predicate).toBe("제품 매뉴얼");
    expect(manualTriples("fw-log.pdf", "FW-2000", "logManual")[0].predicate).toBe("로그 매뉴얼");
  });

  it("유지보수 점검서: (제품)-[점검 리포트]->(파일)", () => {
    const [t] = maintenanceReportTriples("점검서.pdf", "IPS-9000");
    expect(t).toMatchObject({ subject: "IPS-9000", predicate: "점검 리포트", object: "점검서.pdf" });
  });
});

describe("docgraph — 멱등 동기화·삭제 (실 DB in-memory)", () => {
  it("재동기화해도 트리플이 중복 누적되지 않는다", () => {
    const triples = webReportTriples("멱등.pdf", SAMPLE);
    syncDocTriples("멱등.pdf", triples);
    syncDocTriples("멱등.pdf", triples); // 재업로드 시뮬레이션
    const mine = listTriples().filter((t) => t.source === docSource("멱등.pdf"));
    expect(mine.length).toBe(triples.length); // 2배가 아니라 1배
  });

  it("문서 삭제 시 그 문서의 트리플만 지워진다(고아 방지)", () => {
    syncDocTriples("지울문서.pdf", manualTriples("지울문서.pdf", "UTM-1", "manual"));
    syncDocTriples("남길문서.pdf", manualTriples("남길문서.pdf", "UTM-2", "manual"));
    expect(removeDocTriples("지울문서.pdf")).toBe(1);
    const left = listTriples().filter((t) => t.source?.startsWith("doc:"));
    expect(left.some((t) => t.object === "남길문서.pdf")).toBe(true);
    expect(left.some((t) => t.object === "지울문서.pdf")).toBe(false);
  });

  it("멀티홉: 자산 호스트로 물으면 2홉(보고서·취약점·위험도)까지 관계가 걸린다", () => {
    syncDocTriples("홉테스트.pdf", webReportTriples("홉테스트.pdf", SAMPLE));
    const triples = expandOntology("certify.example.co.kr 관련 문서와 취약점 알려줘");
    const rendered = triples.map((t) => `${t.subject}|${t.predicate}|${t.object}`).join("\n");
    expect(rendered).toContain("홉테스트.pdf|점검 보고서|certify.example.co.kr"); // 1홉: 문서
    expect(rendered).toContain("발견 취약점"); // 1홉: 취약점
    expect(rendered).toContain("위험도"); // 2홉: 취약점→위험도
  });
});

describe("docgraph — 코드 이중 표기 방지(운영 실측 버그)", () => {
  it("name에 코드가 이미 붙어 있으면 그대로 쓴다", () => {
    const t = webReportTriples("d.pdf", {
      assets: [],
      vulns: [{ host: "h", name: "[IW-20] 디렉토리 인덱싱", risk: "low", cve: "", description: "", pluginId: "IW-20", port: "", protocol: "" }],
    });
    const label = t.find((x) => x.predicate === "발견 취약점")!.object;
    expect(label).toBe("[IW-20] 디렉토리 인덱싱");
  });
});
