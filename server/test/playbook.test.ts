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

// ★★ 「어떻게 하나」와 「무엇에 근거하나」를 가른다 (2026-08-13, 계획서 전-1 시연 ③ 실측)
//
// ■ 무엇이 있었나 — 시연 대본의 문항이 깨져 있었다(운영 재현 2/2)
//     "KEV 등재 취약점 조치 기한 근거 지침이 뭐야?" → 0.1초에 「일반 취약점 조치·15일」 표
//     "KEV 조치 기한을 정한 지침 이름이 뭐야?"      → "CISA BOD 22-01" (1.6초, 정답)
//   문서도 지식도 있는데 **못 닿았다.** 갈림길은 「취약점」이라는 낱말 하나였다.
//   대본의 대사가 "지침 이름과 기한을 근거와 함께 — '아마 그럴걸요'가 없습니다"인데,
//   정작 그 대사를 읽는 순간 제품이 지침 대신 자기 SLA 표를 냈다.
//
// ■ 왜 낱말을 더 넣지 않았나 — 위 describe의 교훈 그대로다.
//   여기서 보는 것은 **주제가 아니라 묻는 방식**이다. 묻는 방식은 주제와 독립이라
//   새 표현이 늘어도 같은 자에 걸린다.
describe("★ 출처를 묻는 말에는 표를 내밀지 않는다 (2026-08-13)", () => {
  const 비켜야 = [
    "KEV 등재 취약점 조치 기한 근거 지침이 뭐야?",       // ← 시연 ③ 대본 문항 그대로
    "취약점 조치 기한 근거가 뭐야?",
    "이 취약점 조치 기준이 어디에 나와 있어?",
    "조치 기한을 정한 지침 이름이 뭐야?",
    "취약점 조치 규정 알려줘",
    // ⚠ 특정 플레이북(RCE)에 걸리는 말이어도 **출처를 물으면 비켜야** 한다.
    //   이 한 줄이 「맨 앞에서 가른다」를 못박는다 — 뒤에 두면 여기서 새다.
    "Log4Shell 조치 기한 근거 지침이 뭐야?",
  ];
  for (const 말 of 비켜야) {
    it(`비켜 준다: "${말.slice(0, 28)}…"`, () => expect(플레이북영토인가(말)).toBe(false));
  }

  // 반대쪽 — **기한을 묻는 말은 그대로 우리 자리다.** 여기서 비켜 주면 기능을 죽인 것이다.
  //   ⚠ 위 describe의 「우리자리」 목록과 겹쳐 두는 것이 일부러다: 이 수리가 그쪽을
  //     망가뜨리지 않았음을 이 파일 안에서 바로 보이게 한다.
  const 그대로우리자리 = [
    "medium 취약점은 며칠 안에 조치해야 해?",  // 기한을 묻지만 **출처**를 묻는 게 아니다
    "취약점 조치 절차가 어떻게 돼?",
    "이 취약점 조치 방법 알려줘",
    "KEV에 오른 취약점 대응 방안 알려줘",
    "Log4Shell 대응 방법 알려줘",
  ];
  for (const 말 of 그대로우리자리) {
    it(`그대로 우리 자리: "${말.slice(0, 28)}…"`, () => expect(플레이북영토인가(말)).toBe(true));
  }
});
