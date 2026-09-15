// engine/vulnalias.ts — 「Log4Shell 있어?」·「CVE-2021-44228 있어?」에서 **등록 취약점을 찾을 조건**을 뽑는 한 곳(2026-09-15 고객 QA 예행 ⑬).
//
// 왜 따로 두나: finding_status는 write:false라 registry의 autoFill이 **안 돈다**(autoFill은 buildApproval 안에서만 돈다 —
//   agentloop.ts:3120 verify_finding 주석이 같은 사실을 적어 뒀다). 그래서 FORCED [95]가 고른 뒤 agentloop이 여기서 조건을
//   채운다. 별칭 표를 agentloop·registry 두 곳에 두면 어긋나므로 이 파일 하나가 원천이다.
// 별칭은 등록 취약점의 유형·근거 글에 **실제로 들어 있는 낱말**로 바꾼다(Log4Shell → log4j). 못 알아본 이름은 그대로 돌려준다.
export const 취약점별칭: Record<string, string> = {
  log4shell: "log4j", log4j: "log4j", heartbleed: "heartbleed", shellshock: "bash", bluekeep: "rdp", eternalblue: "smb",
  printnightmare: "print spooler", zerologon: "netlogon", spring4shell: "spring", proxylogon: "exchange", proxyshell: "exchange",
  "citrix bleed": "citrix", citrixbleed: "citrix", regresshion: "openssh", "dirty pipe": "kernel", follina: "msdt", "looney tunables": "glibc",
};
const 이름꼴 = /(log4shell|log4j|heartbleed|shellshock|bluekeep|eternalblue|printnightmare|zerologon|spring4shell|proxylogon|proxyshell|citrix\s*bleed|regresshion|dirty\s*pipe|follina|looney\s*tunables)/i;

/** 지시문에서 CVE 번호(그대로, 대문자) 또는 유명 취약점 별칭을 조건으로 뽑는다. 없으면 빈 문자열. */
export function 취약점이름조건(instruction: string): string {
  const 글 = String(instruction ?? "");
  const cve = /CVE-\d{4}-\d{4,7}/i.exec(글);
  if (cve) return cve[0].toUpperCase();
  const 이름 = 이름꼴.exec(글);
  if (!이름) return "";
  const k = 이름[1].toLowerCase().replace(/\s+/g, " ");
  return 취약점별칭[k] ?? k;
}
