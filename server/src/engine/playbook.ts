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
    match: /rce|remote code|원격 코드|log4shell|log4j|deserial|역직렬화/i,
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
      "점검 콘솔(원격 정기점검)에서 해당 항목 재확인",
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
