// 국내 웹취약점 점검 결과보고서 파서 — 실제 보고서((주)안전대부 v1.0, PDF 추출 텍스트) 구조를
// 축약한 샘플로 검증한다. 이 파서가 없어서 PDF 보고서가 자산·취약점으로 등록되지 않았다(2026-07-25).
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/engine/llm", () => ({
  // 2026-08-29 화살 #14·#15 — llm이 RAG·수집 훅을 내보낸다. 목도 표면을 따라가야 한다
  // (안 주면 그 모듈을 import하는 파일이 통째로 죽는다 — verifyroutes 6개가 실증).
  setRagProvider: vi.fn(), hasRagProvider: vi.fn(() => false), onChatRecorded: vi.fn(), chatLogListenerCount: vi.fn(() => 0),
  chat: vi.fn(async () => "[mock]"),
  embed: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
}));

import { parseWebVulnReport, looksLikeWebVulnReport } from "../src/engine/webreport";

// 실제 보고서의 뼈대: 수행 대상 표 → 진단항목표(위험도 사전) → 상세 장 → 보안 대책 장(제외 대상).
const SAMPLE = `
(주) 안전대부 서비스
웹 취약점 진단 결과 보고서

1. 개요
1.2. 수행 대상
대상 명 IP
SafeKey 발급 웹 서버 (cert.aj-safe.co.kr) 211.241.238.1
안전대부 본인인증 웹 서버 (certify.aj-safe.co.kr) 211.241.238.1
[표 1] 수행 범위 및 대상

2.1. 웹 취약점 진단
보안 설정 오류
취약점 [IW-20] 디렉토리 인덱싱 위험도 하
웹 서버에 경로 탐색 기능이 설정되어 목록 조회가 가능할 경우 취약
정보 노출 취약점 [IW-25] 서버 정보 노출 위험도 하
서버 관련 중요 정보가 웹 페이지 상에 노출 시 취약
취약점 [IW-27] 임시/백업 파일 노출 위험도 하
웹 루트 하위에 test.html 등 불필요한 파일이 존재할 경우 취약
암호화 오류
취약점 [IW-32] 데이터 평문 전송 위험도 중
중요 정보 송·수신 구간에 SSL 암호화 통신이 적용되지 않을 경우 취약
취약점 [IW-18] Cross Site Request Forgery (CSRF) 위험도 상
사용자가 의도치 않은 상태에서 실행 가능 시 취약
[표 5] 웹 취약점 진단 항목

3.1.1. 총평
2 개의 대외 서비스에서 5 개의 취약점이 확인 되었음.
(주) 안전대부 대외 서비스 취약점 총 개수 : 5 개
[표 6] 진단 결과 요약

4. 취약점 진단 상세 내용
4.1. SafeKey 발급 웹 서버 (cert.aj-safe.co.kr)
4.1.1. [IW-20] 디렉토리 인덱싱
웹 루트 하위의 디렉토리 및 파일 목록 조회가 가능한 것을 확인하였음.
번호 디렉토리 인덱싱 경로
1 cert.aj-safe.co.kr/img/
2 cert.aj-safe.co.kr/icons/
4.1.2. [IW-25] 서버 정보 노출
HTTP 헤더 값을 통해 PHP 버전 정보가 노출되는 것을 확인하였음.
4.2. 안전대부 본인인증 웹 서버 (certify.aj-safe.co.kr)
4.2.1. [IW-20] 디렉토리 인덱싱
경로 탐색 기능이 설정되어 있음을 확인하였음.
4.2.2. [IW-27] 임시/백업 파일 노출
웹 루트 하위에 test 페이지가 존재함을 확인하였음.
4.2.3. [IW-32] 데이터 평문 전송
http 로 접근 시 https 로 자동 리다이렉트 되지 않음을 확인하였음.

5. 웹 취약점 보안 대책
5.1. [IW-20] 디렉토리 인덱싱
httpd.conf 에서 Options -Indexes 로 설정한다.
5.2. [IW-25] 서버 정보 노출 (PHP)
php.ini 에서 expose_php = Off 로 설정한다.
`;

describe("looksLikeWebVulnReport", () => {
  it("국내 웹취약점 진단 보고서를 인식한다", () => {
    expect(looksLikeWebVulnReport(SAMPLE)).toBe(true);
  });

  it("일반 문서는 인식하지 않는다(오탐 방지)", () => {
    expect(looksLikeWebVulnReport("사내 방화벽 운영 매뉴얼입니다. 정책 설정 방법을 안내합니다.")).toBe(false);
  });
});

describe("parseWebVulnReport", () => {
  const r = parseWebVulnReport(SAMPLE);

  it("수행 대상 표에서 자산 2개를 도메인·IP와 함께 뽑는다", () => {
    expect(r.assets).toHaveLength(2);
    expect(r.assets.map((a) => a.host).sort()).toEqual(["cert.aj-safe.co.kr", "certify.aj-safe.co.kr"]);
    expect(r.assets.every((a) => a.ip === "211.241.238.1")).toBe(true);
    expect(r.assets.find((a) => a.host === "cert.aj-safe.co.kr")?.name).toContain("SafeKey");
  });

  it("상세 장에서 취약점 5건을 서비스별로 정확히 귀속한다", () => {
    expect(r.vulns).toHaveLength(5);
    const byHost = r.vulns.reduce<Record<string, number>>((m, v) => ({ ...m, [v.host]: (m[v.host] ?? 0) + 1 }), {});
    expect(byHost["cert.aj-safe.co.kr"]).toBe(2);
    expect(byHost["certify.aj-safe.co.kr"]).toBe(3);
  });

  it("문서가 제공하는 진단항목표로 위험도를 매핑한다(상=high·중=medium·하=low)", () => {
    const plain = r.vulns.find((v) => v.name.includes("IW-32"));
    const index = r.vulns.find((v) => v.name.includes("IW-20"));
    expect(plain?.risk).toBe("medium"); // 위험도 중
    expect(index?.risk).toBe("low"); // 위험도 하
  });

  it("보안 대책 장(5.x)의 같은 [IW-NN] 헤딩은 발견 건으로 세지 않는다", () => {
    // 5.1·5.2가 세어졌다면 7건이 된다 — 조치 가이드는 취약점 발견이 아니다.
    expect(r.vulns).toHaveLength(5);
    expect(r.notes.some((n) => n.includes("조치 가이드"))).toBe(true);
  });

  it("문서 자체 합계와 추출 건수를 대조해 누락 없음을 알린다", () => {
    expect(r.declaredTotal).toBe(5);
    expect(r.notes.some((n) => n.includes("일치") && n.includes("누락 없음"))).toBe(true);
  });

  it("취약점 코드를 pluginId로 써 재점검 시 상태 추적이 되게 한다", () => {
    expect(r.vulns.map((v) => v.pluginId)).toContain("IW-32");
  });

  it("증적(설명)에 대상 서비스와 본문을 담는다", () => {
    const v = r.vulns.find((x) => x.name.includes("IW-25"));
    expect(v?.description).toContain("cert.aj-safe.co.kr");
    expect(v?.description).toContain("PHP");
  });

  it("파일명·설정파일(php.ini·httpd.conf)을 자산으로 오인하지 않는다", () => {
    expect(r.assets.some((a) => /\.(ini|conf|html?|jsp)$/i.test(a.host))).toBe(false);
  });

  it("취약점이 없는 일반 문서는 0건을 돌려준다(LLM 폴백으로 넘어갈 신호)", () => {
    const empty = parseWebVulnReport("웹 취약점 진단 절차 안내 문서입니다. 진단 방법을 설명합니다.");
    expect(empty.vulns).toHaveLength(0);
  });
});
