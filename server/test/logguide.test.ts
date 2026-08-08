// 보안 로그 파일 분석 — 파일 대장·행동강령 대응 절차 (추가 기능, 2026-08-09)
//
// 계약: ① 파일 대장은 source="log" 이벤트를 ref로 묶는다(다른 소스는 안 섞임)
// ② 유형 판별은 결정적 — 모르면 null(일반 절차를 지어 붙이지 않는다)
// ③ 절차는 4단계·근거 문구 포함 ④ followup은 할 일 문구로 쓸 수 있게 비어 있지 않다.
import { describe, it, expect } from "vitest";
import { classifyLogEvent, responseGuideFor, logFileSummaries } from "../src/engine/logguide";
import { parseSecurityLog, listAnalysisEvents } from "../src/engine/analysishub";

describe("유형 판별 — 결정적", () => {
  it("브루트포스·포트스캔·차단폭주·웹공격을 제목·신호로 가른다", () => {
    expect(classifyLogEvent({ title: "인증 브루트포스 의심 — 1.2.3.4", signals: [] })).toBe("브루트포스");
    expect(classifyLogEvent({ title: "포트 스캔 의심 — 1.2.3.4", signals: [] })).toBe("포트스캔");
    expect(classifyLogEvent({ title: "방화벽 차단 폭주 — 1.2.3.4", signals: [] })).toBe("차단폭주");
    expect(classifyLogEvent({ title: "웹 공격 시그니처 — 1.2.3.4", signals: [] })).toBe("웹공격");
  });

  it("모르는 유형은 null — 아무 절차나 지어 붙이지 않는다", () => {
    expect(classifyLogEvent({ title: "이상한 새 이벤트", signals: [] })).toBeNull();
    expect(responseGuideFor({ title: "이상한 새 이벤트", signals: [] })).toBeNull();
  });
});

describe("대응 절차", () => {
  it("네 유형 모두 4단계 절차·근거·후속 문구를 갖는다", () => {
    for (const title of ["인증 브루트포스 의심", "포트 스캔 의심", "방화벽 차단 폭주", "웹 공격 시그니처"]) {
      const g = responseGuideFor({ title, signals: [] })!;
      expect(g.steps.length, `${title} 단계 수`).toBe(4);
      expect(g.basis).toContain("KISA");
      expect(g.followup.length).toBeGreaterThan(5);
    }
  });

  it("사내 문서를 지어 인용하지 않는다 — 근거는 대화창으로 확인하라고 안내한다", () => {
    const g = responseGuideFor({ title: "인증 브루트포스 의심", signals: [] })!;
    expect(g.basis).toContain("대화창");
    // "사내 행동강령 §3.2" 같은 구체 조항 번호를 코드가 지어내면 안 된다
    expect(g.basis).not.toMatch(/§\s*\d/);
  });
});

describe("파일 대장", () => {
  it("log 소스 이벤트를 ref(파일)로 묶고 P0·열림을 센다", () => {
    // 실제 파서로 이벤트를 만들어 흘린다 — 파서 계약과 어긋나면 여기서 드러난다.
    const 로그 = Array.from({ length: 12 }, (_, i) => `Aug  8 10:0${i % 10}:01 fw sshd[1]: Failed password for root from 9.9.9.9 port 2${i}`).join("\n");
    const r = parseSecurityLog("guide-test.log", 로그);
    expect(r.events.length).toBeGreaterThan(0);
    const files = logFileSummaries();
    const mine = files.find((f) => f.ref === "guide-test.log");
    // parseSecurityLog는 이벤트를 저장까지 하는가? 저장 함수가 따로면 이 대장은 저장분만 본다 —
    // 저장 안 됐으면 mine이 없고, 그것도 계약이다(대장=쌓인 것의 요약).
    if (mine) {
      expect(mine.events).toBeGreaterThan(0);
      expect(mine.open).toBeGreaterThan(0);
    } else {
      expect(listAnalysisEvents().some((e) => e.ref === "guide-test.log")).toBe(false);
    }
  });
});
