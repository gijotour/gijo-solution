// terminalPolicy.ts — 터미널(CLI) 실행 정책. 담당자 PC에서 도는 셸이라 위험 명령은 항상 차단하고,
// 챗봇이 제안한 명령은 허용목록(allowlist) 안에 있어도 사람 승인을 거친다.
// main.ts(실행 게이트)와 렌더러(사전 표시)가 같은 판정을 쓰도록 단일 소스로 둔다.

// 항상 차단 — 수동/챗봇 무관. 시스템을 통째로 날리거나 되돌릴 수 없는 파괴적 패턴.
// (담당자가 admin이라도 오타 한 번에 복구 불가한 사고가 나는 걸 막는 안전망.)
const DANGER_PATTERNS: { re: RegExp; why: string }[] = [
  { re: /\brm\s+-rf?\s+\/(?:\s|$)/i, why: "루트 삭제(rm -rf /)" },
  { re: /Remove-Item[^\n]*-Recurse[^\n]*(?:[A-Z]:\\?(?:\s|$)|[\\/](?:\s|$))/i, why: "드라이브/루트 재귀 삭제" },
  { re: /\b(?:mkfs|format)\b[^\n]*\b[a-z]:?\b/i, why: "포맷" },
  { re: /\bformat\s+[a-z]:/i, why: "드라이브 포맷" },
  { re: /\bdel\s+\/[sq][^\n]*[\\/]/i, why: "재귀 강제 삭제(del /s)" },
  { re: /\bdiskpart\b/i, why: "디스크 파티션 조작(diskpart)" },
  { re: /\bcipher\s+\/w/i, why: "디스크 완전 소거(cipher /w)" },
  { re: /\b(?:shutdown|Restart-Computer|Stop-Computer)\b/i, why: "시스템 종료/재시작" },
  { re: /\bRemove-Item\b/i, why: "" }, // 오탈자 방지용 no-op(무시)
  { re: />\s*\/dev\/sd[a-z]/i, why: "디스크 직접 덮어쓰기" },
  { re: /:\(\)\s*\{\s*:\|:&\s*\}\s*;/i, why: "포크 폭탄" },
];

// 챗봇이 제안할 수 있는 명령의 허용목록(prefix/정규식). 목록 안이어도 실행은 사람 승인 후.
// 관리자가 확장 가능(향후 설정 화면). 기본값은 보안 점검에 흔한 조회·설치 계열.
const ALLOWLIST: RegExp[] = [
  /^nmap\b/i,
  /^ping\b/i,
  /^tracert\b/i, /^traceroute\b/i,
  /^nslookup\b/i, /^Resolve-DnsName\b/i,
  /^netstat\b/i,
  /^Get-[A-Za-z]+\b/i,        // PowerShell 조회 계열(Get-Service·Get-Process 등)
  /^Test-NetConnection\b/i,
  /^ipconfig\b/i, /^ifconfig\b/i, /^ip\s+a(ddr)?\b/i,
  /^winget\s+install\b/i,     // 승인 후 설치
  /^choco\s+install\b/i,
  /^pip\s+install\b/i,
  /^curl\b/i, /^Invoke-WebRequest\b/i,
  /^whoami\b/i, /^hostname\b/i,
  /^dir\b/i, /^ls\b/i, /^Get-ChildItem\b/i,
];

export function isDangerous(cmd: string): { blocked: boolean; reason: string } {
  const c = (cmd ?? "").trim();
  for (const d of DANGER_PATTERNS) {
    if (d.why && d.re.test(c)) return { blocked: true, reason: d.why };
  }
  return { blocked: false, reason: "" };
}

export function inAllowlist(cmd: string): boolean {
  const c = (cmd ?? "").trim();
  return ALLOWLIST.some((re) => re.test(c));
}

// 챗봇 제안 명령 판정: 위험이면 무조건 차단, 허용목록 안이면 승인 대상, 밖이면 승인 대상(사유 표시).
export function classifyChatbotCommand(cmd: string): { decision: "blocked" | "approval"; inList: boolean; reason: string } {
  const danger = isDangerous(cmd);
  if (danger.blocked) return { decision: "blocked", inList: false, reason: danger.reason };
  const inList = inAllowlist(cmd);
  return { decision: "approval", inList, reason: inList ? "허용목록 명령 — 승인 후 실행" : "허용목록 밖 — 승인 필요" };
}
