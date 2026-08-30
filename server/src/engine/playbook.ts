// engine/playbook.ts — 조치 플레이북. 취약점/탐지 유형별로 "무엇을·누가·며칠 안에·어떤 단계로"
// 조치할지 표준 절차를 제공한다. 경쟁 제품이 remediation recommendation을 셀링포인트로 내세우는데,
// GIJO는 이걸 결정적 규칙(LLM 무관)으로 제공해 MTTR을 실제로 줄인다.
//
// 정직성: 플레이북은 일반 모범사례 절차다. 자산·환경별 세부는 담당자가 판단해야 하며, 실행 단계에
// 쓰기 작업이 있으면 기존 결재판(승인 후 실행) 계약을 그대로 따른다.

import type { Express } from "express";
import { authMiddleware } from "../auth/auth";

export type Severity = "critical" | "high" | "medium" | "low";

export interface Playbook {
  id: string;
  title: string;
  match: RegExp; // finding_type/제목에 매칭
  slaDays: Record<Severity, number>; // 심각도별 조치 기한(일)
  owner: string; // 권장 담당 역할
  steps: string[]; // 조치 단계(순서)
  verify: string; // 완료 검증 방법
}

// KEV(실제 악용)면 SLA를 절반으로 당긴다 — CISA 권고(연방 14~21일)와 같은 정신.
export function applyKevUrgency(days: number, kev: boolean): number {
  return kev ? Math.max(1, Math.ceil(days / 2)) : days;
}

// 유형별 플레이북. 위에서부터 첫 매칭을 채택하므로 구체적인 것을 앞에 둔다.
const PLAYBOOKS: Playbook[] = [
  {
    id: "rce",
    title: "원격 코드 실행(RCE) 취약점",
    // ⚠ `rce`에 **낱말 경계**가 없어 `force`를 물고 있었다(2026-08-12 실측).
    //   "brute force 로그인 시도가 계속 잡히는데 어떻게 대응해?"가 **RCE 취약점 플레이북**을
    //   받았다. force·source·resource·enforcement·workforce·Salesforce·SourceTree가 전부 걸린다.
    //   보안 문서에 흔한 낱말들이라 조용히 엉뚱한 절차를 내주고 있었다.
    match: /\brce\b|remote code|원격 코드|log4shell|log4j|deserial|역직렬화/i,
    slaDays: { critical: 3, high: 7, medium: 30, low: 90 },
    owner: "보안담당자(+시스템 담당)",
    steps: [
      "영향 자산·버전 확인(자산 허브에서 해당 컴포넌트 검색)",
      "인터넷 노출 여부 확인 — 노출됐다면 임시 접근차단(WAF 규칙·방화벽)부터",
      "벤더 패치/업그레이드 경로 확인(릴리즈노트의 Resolved Issues)",
      "변경 전 설정·데이터 백업 → 유지보수 시간대에 패치 적용",
      "패치 불가 시 완화책 적용(취약 기능 비활성화·격리)",
    ],
    verify: "재스캔으로 해당 CVE 미검출 확인 + 서비스 정상 동작 확인",
  },
  {
    id: "injection",
    title: "인젝션(SQL·명령·XSS)",
    match: /injection|sql|xss|command inject|명령 삽입|크로스사이트/i,
    slaDays: { critical: 5, high: 10, medium: 30, low: 90 },
    owner: "개발/애플리케이션 담당",
    steps: [
      "취약 파라미터·입력점 특정",
      "입력 검증·파라미터 바인딩(prepared statement)·출력 인코딩 적용",
      "WAF 규칙으로 즉시 완화(근본 수정 전 임시)",
      "코드 수정 배포 후 회귀 테스트",
    ],
    verify: "동일 페이로드 재시도로 차단 확인 + 정상 입력 동작 확인",
  },
  {
    id: "llm-prompt-injection",
    title: "LLM 프롬프트 인젝션 / AI 위험(OWASP LLM)",
    match: /prompt inject|프롬프트 인젝션|llm0?1|owasp llm|jailbreak|탈옥|가드레일/i,
    slaDays: { critical: 5, high: 14, medium: 30, low: 90 },
    owner: "AI/보안담당자",
    steps: [
      "해당 AI 자산의 입력 경로 확인(AI-BOM의 프롬프트·에이전트 도구 영역)",
      "런타임 가드레일 활성화·강화(AI 공격 시험·차단 화면에서 페이로드 재점검)",
      "시스템 프롬프트 격리·출력 필터 적용",
      "권한 최소화 — 에이전트가 접근하는 도구·데이터 범위 축소",
    ],
    verify: "레드팀 카나리 페이로드 재실행으로 차단율 확인",
  },
  {
    id: "misconfig",
    title: "보안 설정 미흡(CCE·하드닝)",
    match: /config|설정|hardening|하드닝|cce|기본 비밀번호|default password|weak|약한/i,
    slaDays: { critical: 7, high: 14, medium: 30, low: 90 },
    owner: "시스템/인프라 담당",
    steps: [
      "④ 검증 → 보안설정 점검(하드닝)에서 해당 항목 재확인",
      "기준(KISA U-시리즈·CIS)에 맞게 설정 변경",
      "변경 영향 검토 후 적용(서비스 중단 여부 확인)",
      "정기점검 스케줄에 등록해 재발 감시",
    ],
    verify: "하드닝 재점검으로 PASS 확인",
  },
  {
    id: "outdated",
    title: "지원 종료·구버전(EoL/패치 누락)",
    match: /outdated|eol|end of life|구버전|지원 종료|미패치|unpatched|버전/i,
    slaDays: { critical: 7, high: 21, medium: 45, low: 90 },
    owner: "시스템 담당",
    steps: [
      "현재 버전·지원 종료 일정 확인(보안제품 등록부의 EoS 필드)",
      "업그레이드 경로·호환성 확인",
      "백업 후 단계적 업그레이드(HA면 Standby부터)",
      "EoL 제품은 교체 계획 수립",
    ],
    verify: "버전 확인 + 재스캔",
  },
];

const DEFAULT_PLAYBOOK: Playbook = {
  id: "generic",
  title: "일반 취약점 조치",
  match: /.*/,
  slaDays: { critical: 7, high: 15, medium: 30, low: 90 },
  owner: "보안담당자",
  steps: [
    "영향 자산·범위 확인",
    "벤더 권고·패치 확인",
    "우선순위(KEV→EPSS→CVSS)에 따라 조치 일정 배정",
    "조치 후 재스캔으로 검증",
  ],
  verify: "재스캔으로 미검출 확인",
};

export function playbookFor(findingType: string): Playbook {
  const t = findingType ?? "";
  return PLAYBOOKS.find((p) => p.match.test(t)) ?? DEFAULT_PLAYBOOK;
}

/**
 * 이 말이 **조치 플레이북이 답할 자리**인가 (2026-08-12 신설).
 *
 * ■ 왜 필요한가 — 「어떻게 대응해?」라고만 물으면 **무엇이든** 취약점 플레이북이 나왔다.
 *   실측(win·max 양쪽에서 재현):
 *     "직원이 퇴사하는데 어떻게 대응해?"           → 🛠 일반 취약점 조치, 30일 내
 *     "고객사에서 견적서를 요청했는데 어떻게 대응해?" → 같은 표
 *     "내부 PC 445 급증 어떻게 대응해?"            → 같은 표 (정작 문서에 초동 절차가 있다)
 *   담당자가 받은 것은 **내용이 없는 표**다. 지식 저장소에 답이 있어도 거기까지 못 간다.
 *
 * ■ 왜 배제 낱말을 더 넣지 않았나
 *   이 분기에는 이미 배제가 세 겹(장애·침해사고·실행지시) 있다. 사고가 날 때마다 덧댄 것이다.
 *   그런데 **담당자는 라벨이 아니라 증상으로 묻는다** — "445 급증"·"로그가 안 쌓이는데"는
 *   어느 목록에도 없다. 목록을 늘리는 한 다음 표현이 또 샌다.
 *   그래서 방향을 뒤집는다: **「무엇을 뺄까」가 아니라 「답할 근거가 있을 때만 답한다」.**
 *
 * ■ 판정 — 둘 중 하나면 우리 자리다.
 *   ① 특정 플레이북(RCE·인젝션·설정미흡 등)에 걸린다 → 줄 것이 실제로 있다.
 *   ② 질문이 **취약점 자체**를 말한다("이 취약점 조치 방법", "조치 플레이북 보여줘").
 *      이때는 「일반」 표가 정답이다 — 담당자가 일반 절차를 물은 것이다.
 *   둘 다 아니면 **비켜 준다.** 모르는 주제에 표를 내미느니 지식 조회로 보내는 편이 낫다.
 *
 * ■ ★ 2026-08-13 — 「어떻게 하나」와 「무엇에 근거하나」는 다른 물음이다 (시연 ③ 실측)
 *   시연 대본(전-1)의 문항이 깨져 있었다. 재현 2/2:
 *     "KEV 등재 취약점 조치 기한 **근거 지침이 뭐야?**" → 0.1초에 「일반 취약점 조치·15일」 표
 *   그런데 말만 바꾸면 정확히 답한다:
 *     "KEV 조치 기한을 정한 **지침 이름이 뭐야?**"      → "CISA BOD 22-01" (1.6초)
 *   문서(kev_bod_22-01_조치기한.md)도 지식도 있다 — **못 아는 게 아니라 못 닿는 것**이었다.
 *   갈림길은 「취약점」이라는 낱말 하나였다(위 ②가 무조건 통과시킨다).
 *
 *   ⚠ 배제 낱말을 **네 번째로 덧대지 않는다** — 위 「■ 왜 배제 낱말을 더 넣지 않았나」 그대로다.
 *     여기서 보는 것은 주제가 아니라 **묻는 방식**이다:
 *       「어떻게·절차·며칠 안에」 → 플레이북이 답할 물음
 *       「근거·지침·기준이 **뭐냐/어디냐/이름이 뭐냐**」 → 출처를 묻는 물음. 우리 자리가 아니다.
 *     묻는 방식은 주제와 독립이라, 새 표현이 늘어도 같은 자에 걸린다.
 *   ⚠ **맨 앞에서 가른다.** 뒤에 두면 특정 플레이북에 걸린 질문(①)이 먼저 true를 내
 *     "Log4Shell 조치 기한 근거 지침이 뭐야?"가 그대로 표로 샌다.
 *   ⚠ 기한을 **묻는** 말은 건드리지 않는다 — "medium 취약점은 며칠 안에 조치해야 해?"는
 *     이 시험이 이미 「우리 자리」로 못 박아 둔 물음이다(playbook.test.ts).
 */
//   ★ 2026-08-13 QA 회귀: 「**어떤** 지침에 근거하고 며칠이야?」가 새는 것을 잡았다 —
//     의문사가 명사 **앞**에 오는 꼴(어떤 X)은 뒤-의문사 자로는 못 잰다. 갈래를 하나 더 둔다.
//     「어떤 취약점부터 조치해?」는 명사 목록에 취약점이 없어 안 걸린다(기한 물음 보존).
const 출처를묻는말 = /(근거|지침|규정|기준|표준|출처|법령|조항)[^.\n]{0,10}(뭐|무엇|어디|이름|명칭|알려)|어떤\s*(근거|지침|규정|기준|표준|법령|조항)/;

export function 플레이북영토인가(text: string): boolean {
  const t = String(text ?? "");
  if (출처를묻는말.test(t)) return false; // ★ 맨 앞 — 아래 ①보다 먼저 갈라야 한다
  if (playbookFor(t).id !== "generic") return true;
  return /(취약점|취약\s*점|vulnerabilit|플레이북|playbook)/i.test(t);
}

// 특정 finding에 대한 완결 조치 안내 — 플레이북 + KEV 반영 SLA + 권장 기한(오늘로부터).
export function remediationFor(input: { findingType: string; severity?: Severity; kev?: boolean; assetName?: string }): {
  playbookId: string;
  title: string;
  owner: string;
  severity: Severity;
  slaDays: number;
  dueDate: string;
  steps: string[];
  verify: string;
} {
  const pb = playbookFor(input.findingType);
  const sev = input.severity ?? "medium";
  const slaDays = applyKevUrgency(pb.slaDays[sev], !!input.kev);
  const due = new Date(Date.now() + slaDays * 86400_000);
  return {
    playbookId: pb.id,
    title: pb.title,
    owner: pb.owner,
    severity: sev,
    slaDays,
    dueDate: due.toISOString().slice(0, 10),
    steps: pb.steps,
    verify: pb.verify,
  };
}

export function listPlaybooks(): Playbook[] {
  return [...PLAYBOOKS, DEFAULT_PLAYBOOK];
}

export function registerPlaybookRoutes(app: Express): void {
  // 전체 플레이북 목록(참고용).
  app.get("/api/playbooks", authMiddleware, (_req, res) => {
    res.json(listPlaybooks().map((p) => ({ id: p.id, title: p.title, owner: p.owner, slaDays: p.slaDays, steps: p.steps, verify: p.verify })));
  });
  // 특정 취약점에 맞는 조치 플레이북 — 화면·챗봇의 "이 취약점 조치 방법" 응답에 쓴다.
  app.post("/api/playbooks/remediation", authMiddleware, (req, res) => {
    const findingType = String(req.body?.findingType ?? req.body?.title ?? "");
    if (!findingType.trim()) {
      res.status(400).json({ error: "findingType(취약점 유형·제목)을 입력하세요" });
      return;
    }
    const sev = ["critical", "high", "medium", "low"].includes(req.body?.severity) ? req.body.severity : "medium";
    res.json(remediationFor({ findingType, severity: sev, kev: !!req.body?.kev, assetName: req.body?.assetName }));
  });
}

// 챗봇/리포트가 그대로 쓸 텍스트.
export function formatRemediation(input: { findingType: string; severity?: Severity; kev?: boolean; assetName?: string }): string {
  const r = remediationFor(input);
  const L: string[] = [];
  L.push(`🛠 조치 플레이북 — ${r.title}${input.assetName ? ` (${input.assetName})` : ""}`);
  L.push(`권장 담당: ${r.owner} · 조치 기한: ${r.dueDate} (${r.severity}${input.kev ? "·KEV 실제악용→기한 단축" : ""}, ${r.slaDays}일 내)`);
  L.push("조치 단계:");
  r.steps.forEach((s, i) => L.push(`  ${i + 1}. ${s}`));
  L.push(`완료 검증: ${r.verify}`);
  return L.join("\n");
}
