import { describe, it, expect } from "vitest";
import { playbookFor, remediationFor, applyKevUrgency, formatRemediation, 플레이북영토인가 } from "../src/engine/playbook";

describe("조치 플레이북", () => {
  it("RCE/Log4j를 RCE 플레이북으로 매칭", () => {
    expect(playbookFor("Apache Log4j2 Log4Shell RCE").id).toBe("rce");
    expect(playbookFor("역직렬화 취약점").id).toBe("rce");
  });
  it("OWASP LLM/프롬프트 인젝션을 AI 플레이북으로", () => {
    expect(playbookFor("LLM01 프롬프트 인젝션").id).toBe("llm-prompt-injection");
  });
  it("매칭 없으면 일반 플레이북", () => {
    expect(playbookFor("알 수 없는 항목").id).toBe("generic");
  });
  it("KEV면 SLA 절반으로 단축(최소 1일)", () => {
    expect(applyKevUrgency(7, false)).toBe(7);
    expect(applyKevUrgency(7, true)).toBe(4);
    expect(applyKevUrgency(1, true)).toBe(1);
  });
  it("remediationFor — 심각도별 기한과 단계 반환", () => {
    const r = remediationFor({ findingType: "SQL Injection", severity: "critical", kev: false });
    expect(r.playbookId).toBe("injection");
    expect(r.slaDays).toBe(5);
    expect(r.steps.length).toBeGreaterThan(2);
    expect(r.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it("formatRemediation — 사람이 읽을 텍스트에 단계·기한 포함", () => {
    const t = formatRemediation({ findingType: "Log4Shell RCE", severity: "critical", kev: true, assetName: "was-01" });
    expect(t).toContain("조치 플레이북");
    expect(t).toContain("was-01");
    expect(t).toContain("KEV");
  });
});

// ★ `rce`가 낱말 경계 없이 `force`를 물던 것 (2026-08-12 실측).
//   "brute force 로그인 시도가 계속 잡히는데 어떻게 대응해?"가 **RCE 취약점 플레이북**을 받았다.
//   보안 문서에 흔한 낱말들이라 조용히 엉뚱한 절차를 내주고 있었다.
describe("★ rce는 낱말일 때만 — force·source를 물지 않는다", () => {
  const 아닌것 = ["brute force 로그인 시도", "source code 검토", "resource 고갈", "enforcement 정책", "Salesforce 연동", "SourceTree 설치"];
  for (const 말 of 아닌것) {
    it(`RCE 아님: "${말}"`, () => expect(playbookFor(말).id).not.toBe("rce"));
  }
  const 맞는것 = ["Apache Log4j2 Log4Shell RCE", "RCE 취약점", "remote code execution", "역직렬화 취약점"];
  for (const 말 of 맞는것) {
    it(`RCE 맞음: "${말}"`, () => expect(playbookFor(말).id).toBe("rce"));
  }
});

// ★★ 「어떻게 대응해?」라고만 물으면 **무엇이든** 취약점 플레이북이 나오던 것 (2026-08-12).
//   win·max 양쪽에서 재현했다. 담당자가 받은 건 내용 없는 「일반 취약점 조치 30일 내」 표다.
//   배제 낱말을 더 넣는 대신 **답할 근거가 있을 때만 답한다**로 뒤집었다 —
//   담당자는 라벨이 아니라 증상으로 묻기 때문이다("445 급증"·"로그가 안 쌓이는데").
describe("★ 플레이북영토인가 — 모르는 주제엔 표를 내밀지 않는다", () => {
  const 비켜야 = [
    "직원이 퇴사하는데 어떻게 대응해?", // ← max 실측. 보안 질문조차 아니다
    "고객사에서 견적서를 요청했는데 어떻게 대응해?",
    "방화벽 로그가 안 쌓이는데 어떻게 대응해?",
    "내부 PC에서 인터넷으로 나가는 445 포트 접속이 급증했는데 어떻게 대응해?",
    "outbound 445 급증 초동 조치 절차가 뭐야?",
    "S3 버킷이 퍼블릭으로 열려 있어. 대응 방안 알려줘",
    "IPS 오탐이 너무 많아. 어떻게 대응하지?",
    "MFA를 어디부터 적용해야 하는지 조치 절차 알려줘",
  ];
  for (const 말 of 비켜야) {
    it(`비켜 준다: "${말.slice(0, 24)}…"`, () => expect(플레이북영토인가(말)).toBe(false));
  }

  // 반대쪽 — 여기서 비켜 주면 **기능을 죽인 것**이다.
  const 우리자리 = [
    "이 취약점 조치 방법 알려줘",
    "취약점 조치 절차가 어떻게 돼?",
    "medium 취약점은 며칠 안에 조치해야 해?",
    "KEV에 오른 취약점 대응 방안 알려줘",
    "조치 플레이북 보여줘",
    "Log4Shell 대응 방법 알려줘", // 특정 플레이북에 걸린다 — 줄 것이 실제로 있다
    "WAF에서 SQL 인젝션 탐지가 떴는데 조치 방법 알려줘",
  ];
  for (const 말 of 우리자리) {
    it(`우리 자리다: "${말.slice(0, 24)}…"`, () => expect(플레이북영토인가(말)).toBe(true));
  }
});
