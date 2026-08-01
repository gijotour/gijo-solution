// 제품 1차 목표 — **3소스를 담당자가 실제로 넣을 수 있는가.**
//
// ★ 2026-08-01 설계목적 점검에서 드러난 것: 엔진(analysishub)은 세 소스를 다 정규화하고
//   상관분석까지 하는데, **뒤 두 소스는 넣을 길이 없었다.** 드롭존을 없애면서 화면 호출처가
//   전부 사라졌고 preload의 analysisIngest는 부르는 곳이 0이 됐다. 시연은 됐다 — DB에 데모
//   데이터가 이미 있었기 때문이다. 파일럿 고객은 자기 로그를 못 넣는 상태였다.
//
//   기능이 있는데 **입구가 없는** 결함은 단위시험도 QA도 안 잡는다(둘 다 기능만 본다).
//   그래서 여기서는 **입구부터 이벤트까지**를 한 줄로 본다.
import { describe, it, expect, beforeEach } from "vitest";
import { autoRouteUpload, type UploadType } from "../src/engine/autoupload";
import { listAnalysisEvents, ingestAnalysisFile } from "../src/engine/analysishub";

const b64 = (s: string) => Buffer.from(s, "utf-8").toString("base64");

// ⚠ 파서는 **같은 출처에서 10회 이상**일 때만 이벤트를 만든다(잡음 방지 임계값).
//   시험 자료를 현실에 맞춘다 — 6줄짜리 가짜로 시험하면 0건이 나오고, 그걸 제품 결함으로
//   오해하게 된다(2026-08-01에 실제로 한 번 헛짚었다).
const 로그원본 = Array.from({ length: 12 }, (_, i) =>
  `Aug  1 10:0${i % 6}:0${i % 6} fw01 sshd[${1200 + i}]: Failed password for invalid user admin from 203.0.113.9 port ${51000 + i} ssh2`
).join("\n");

describe("★ 3소스 인입 — 담당자가 넣을 길이 있는가", () => {
  it("★ 업로드 유형 3소스가 **실제로 라우팅된다**", async () => {
    // ⚠ 예전엔 `expect(typeof t).toBe("string")`이었다 — 문자열 리터럴이 문자열인지 보는
    //   것이라 **제품을 전혀 검증하지 않았다**(2026-08-01 검토 지적). 유형을 지정해 올려
    //   각각 제 갈 길로 가는지 본다. 라우트의 허용 목록이 유형과 어긋나면 여기서 걸린다.
    const 갈곳: [UploadType, string][] = [
      ["securitylog", "analysis"],
      ["opsreport", "analysis"],
      ["guideline", "memory"],
    ];
    for (const [t, 기대] of 갈곳) {
      const r = await autoRouteUpload(`유형시험-${t}.txt`, b64("구분,건수\n차단,3\n"), t);
      expect(r.routedTo, `${t} 유형이 ${r.routedTo}로 갔다`).toBe(기대);
    }
  });

  it("보안 로그 원본을 올리면 **분석 이벤트가 생긴다**", async () => {
    const 전 = listAnalysisEvents().length;
    const r = await autoRouteUpload("secure.log", b64(로그원본));
    expect(r.routedTo, `로그가 ${r.routedTo}로 갔다 — 통합 분석에 안 들어간다`).toBe("analysis");
    expect(r.analysis?.kind).toBe("log");
    expect(r.analysis?.created, "이벤트가 하나도 안 생겼다").toBeGreaterThan(0);
    expect(listAnalysisEvents().length, "목록에 반영이 안 됐다").toBeGreaterThan(전);
  });

  it("확장자가 없어도 로그 서명이 반복되면 원본으로 본다", async () => {
    const r = await autoRouteUpload("2026-08-01-수집분", b64(로그원본));
    expect(r.routedTo).toBe("analysis");
  });

  it("★ 로그 **매뉴얼**은 분석으로 끌고 오지 않는다", async () => {
    // 「로그 읽는 법」 설명서가 분석 이벤트로 둔갑하면, 담당자가 올린 매뉴얼이 관제 목록을 더럽힌다.
    // 서명이 한두 줄 예시로 들어간 문서를 끌고 오지 않는지 본다.
    const 매뉴얼 = [
      "# ASA 로그 매뉴얼",
      "이 장비의 로그는 다음과 같이 읽습니다.",
      "예) Aug 1 10:00:01 fw01 sshd[1234]: Failed password ... 는 인증 실패를 뜻합니다.",
      "자세한 코드표는 부록을 보세요.",
    ].join("\n");
    const r = await autoRouteUpload("ASA_로그_매뉴얼.md", b64(매뉴얼));
    expect(r.routedTo, "매뉴얼이 통합 분석으로 샜다").not.toBe("analysis");
  });

  it("운영 리포트를 지정해 올리면 분석으로 간다", async () => {
    const 리포트 = "구분,건수\n차단,152\n탐지,37\n허용,9821\n";
    const r = await autoRouteUpload("주간_차단_리포트.csv", b64(리포트), "opsreport");
    expect(r.routedTo).toBe("analysis");
    expect(r.analysis?.kind).toBe("report");
  });

  it("★ 0건이어도 **왜 0건인지** 말한다 (조용히 끝내지 않는다)", async () => {
    // "올렸는데 아무 일도 없다"가 이 저장소의 단골 불만이다.
    const r = await autoRouteUpload("빈로그.log", b64("아무 의미 없는 줄\n또 한 줄\n"), "securitylog");
    expect(r.routedTo).toBe("analysis");
    expect(r.analysis?.created).toBe(0);
    expect(r.reason, "0건인 이유를 안 알려 준다").toMatch(/걸린 항목이 없|없어/);
  });

  it("취약점 리포트 경로는 그대로다 (되살리면서 안 깨뜨렸는지)", async () => {
    const csv = "Host,Plugin ID,Name,Risk\n10.0.0.1,19506,Nessus Scan Information,None\n10.0.0.1,12345,Test Vuln,High\n";
    const r = await autoRouteUpload("scan_report.csv", b64(csv));
    expect(r.routedTo, "취약점 경로가 로그 감지에 뺏겼다").toBe("vulnscan");
  });
});

describe("★ 인입 한 덩어리는 길이 하나다", () => {
  beforeEach(() => { /* 이벤트는 누적돼도 되는 시험이라 초기화하지 않는다 */ });

  it("라우트와 대화창 첨부가 같은 함수를 쓴다", () => {
    // 길이 둘이면 반드시 어긋난다(이 저장소 반복 사례). ingestAnalysisFile이 단일 출처다.
    const r = ingestAnalysisFile("직접.log", 로그원본);
    expect(r.kind).toBe("log");
    expect(r.created).toBeGreaterThan(0);
  });
});
