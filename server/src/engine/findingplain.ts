// engine/findingplain.ts — 취약점 이름 옆에 붙는 **한글 한 줄**.
//
// ★ 왜 (2026-08-04 파트너 지적 · 계획서 전-7)
//   지적: "조치 관련 사항 및 설명에 일부 영문이 보이는데 한글로 전환이 이미 된 것이겠죠?"
//   실측: 취약점 4,833건 중 **4,661건(96%)에 한글이 하나도 없다.** 스캐너가 준 원문 그대로다.
//
// ■ 이름 자체는 번역하지 않는다 — 우리 판단
//   `Apache Log4j < 2.15.0 RCE (CVE-2021-44228)`을 우리말로 바꾸면 담당자가 그 이름으로
//   검색할 수도, 벤더 공지와 대조할 수도 없다. **원문은 열쇠다.** 그래서 원문은 그대로 두고
//   **무엇이 위험한지 한 줄**을 옆에 붙인다.
//
// ■ 왜 이름별 번역표가 아니라 낱말 규칙인가
//   실측: 한글 없는 이름 4,661건이 **2,185가지**로 흩어져 있고 상위 25개를 다 덮어도 18%다.
//   이름표를 만들면 수백 줄을 적어도 대부분이 안 덮인다. 반면 이름들은 **같은 낱말**을 쓴다
//   (SSL·Certificate·Detection·Privilege Escalation…). 종류를 알아보는 규칙이 훨씬 멀리 간다.
//
// ■ 규칙이지 AI가 아니다
//   4,833건에 LLM을 태우면 느리고, 매번 달라지고, 몇 줄을 흘린다. 이 파일은 전부 규칙이다.
//
// ⚠ **모르면 모른다고 한다.** 안 걸리면 빈 값을 주고, 화면은 원문만 보여 준다.
//   그럴듯한 한 줄을 지어내면 담당자가 그 문장을 믿고 판단한다.

/** 한 줄 풀이의 종류 — 화면이 색·표식을 다르게 줄 수 있게 갈라 둔다. */
export type 풀이종류 = "조사정보" | "설정" | "암호화" | "인증" | "권한" | "실행" | "노출" | "구식";

export interface 한줄풀이 {
  종류: 풀이종류;
  /** 담당자가 읽는 한 줄. "무엇이 위험한가"를 먼저, 필요하면 "무엇을 하면 되나"를 뒤에. */
  말: string;
}

/**
 * 위에서부터 첫 규칙이 이긴다 — **구체적인 것을 앞에** 둔다.
 * 각 줄의 뒤 주석은 그 규칙이 실제로 어떤 이름을 덮는지다(운영 실측에서 뽑았다).
 */
const 규칙: { re: RegExp; 종류: 풀이종류; 말: string }[] = [
  // ── 실행·권한 (가장 위험한 것부터) ──────────────────────────────────────
  { re: /\b(rce|remote code execution|arbitrary code)\b|원격\s*코드/i, 종류: "실행",
    말: "공격자가 이 장비에서 **원하는 명령을 실행**할 수 있습니다. 가장 급합니다." },
  { re: /privilege escalation|elevation of privilege|권한\s*상승/i, 종류: "권한",
    말: "일반 권한으로 들어온 공격자가 **관리자 권한을 얻을 수 있습니다.**" },
  { re: /\b(sql injection|command injection|injection)\b/i, 종류: "실행",
    말: "입력값에 명령을 섞어 넣어 **서버를 조종**할 수 있습니다." },
  { re: /buffer overflow|memory corruption|use.after.free/i, 종류: "실행",
    말: "메모리를 망가뜨려 **임의 코드 실행**으로 이어질 수 있는 결함입니다." },
  { re: /denial of service|\bdos\b|서비스\s*거부/i, 종류: "실행",
    말: "공격자가 이 서비스를 **멈추게** 할 수 있습니다." },
  { re: /authentication bypass|unauthenticated|인증\s*우회/i, 종류: "인증",
    말: "**로그인하지 않고도** 접근할 수 있는 길이 있습니다." },

  // ── 인증·계정 ──────────────────────────────────────────────────────────
  { re: /default (password|credential)|기본\s*(암호|비밀번호)/i, 종류: "인증",
    말: "**공장 초기 비밀번호**가 그대로입니다 — 공개된 값이라 누구나 압니다." },
  { re: /(weak|null) (password|credential|session)/i, 종류: "인증",
    말: "비밀번호·세션이 **약하게** 설정돼 있습니다." },
  { re: /user enumeration|사용자\s*열거/i, 종류: "인증",
    말: "**어떤 계정이 있는지** 밖에서 알아낼 수 있습니다 — 공격의 첫 단계입니다." },

  // ── 암호화·인증서 ──────────────────────────────────────────────────────
  { re: /certificate.*(expired|expir)|만료/i, 종류: "암호화",
    말: "인증서가 **만료**됐습니다. 접속하는 쪽에 경고가 뜨고, 가로채기를 알아채기 어려워집니다." },
  { re: /self.signed certificate|자체\s*서명/i, 종류: "암호화",
    말: "**스스로 발급한 인증서**입니다 — 진짜 서버인지 확인할 방법이 없어 가로채기에 약합니다." },
  { re: /certificate cannot be trusted|untrusted certificate/i, 종류: "암호화",
    말: "**믿을 수 없는 인증서**입니다. 발급 경로를 확인할 수 없습니다." },
  // ⚠ `sha1`로만 쓰면 「SHA-1」을 놓친다(실측: SSH SHA-1 HMAC 14건). 하이픈·공백을 허용한다.
  { re: /\b(ssl|tls)\b.*(weak|insecure|deprecated|obsolete|sslv2|sslv3|tls ?1\.0|tls ?1\.1)|weak cipher|\brc4\b|3des|\bmd5\b|sha[-\s]?1\b|cbc mode/i,
    종류: "암호화", 말: "**낡은 암호 방식**을 아직 받아 줍니다 — 요즘 기준으로는 깨질 수 있습니다." },
  { re: /post.quantum|harvest now/i, 종류: "암호화",
    말: "지금은 안전하지만 **양자컴퓨터 시대에 대비**한 권고 항목입니다. 급하지 않습니다." },
  { re: /\b(ssl|tls)\b/i, 종류: "암호화",
    말: "암호 통신(SSL/TLS) 설정에 관한 항목입니다." },

  // ── 노출 ───────────────────────────────────────────────────────────────
  { re: /directory (listing|indexing)|디렉토리\s*인덱싱/i, 종류: "노출",
    말: "웹 폴더 안 **파일 목록이 그대로 보입니다** — 감춰야 할 파일이 드러납니다." },
  // ⚠ `information disclosure`로만 쓰면 「ICMP Timestamp … Date Disclosure」를 놓친다(실측 20건).
  //   disclosure·leak 낱말 자체를 본다.
  { re: /\b(disclosure|leak(age|ed)?)\b|정보\s*(유출|노출)/i, 종류: "노출",
    말: "**내부 정보가 밖으로 새어** 나갑니다 — 공격자가 다음 수를 정하는 데 씁니다." },
  { re: /clear.?text|plain.?text|평문/i, 종류: "노출",
    말: "**암호화하지 않고** 주고받습니다 — 중간에서 그대로 읽힙니다." },

  // ── 설정·패치 ──────────────────────────────────────────────────────────
  { re: /\b(cpu|patch|update|hotfix|kb\d+|security update|missing patch)\b|미적용/i, 종류: "구식",
    말: "**보안 패치가 빠져** 있습니다. 벤더가 이미 고쳐 둔 문제입니다." },
  { re: /end of (life|support)|unsupported version|지원\s*종료/i, 종류: "구식",
    말: "**제조사 지원이 끝난** 버전입니다 — 앞으로 취약점이 나와도 고칠 패치가 없습니다." },
  // ⚠ 실측에서 많이 남은 것들을 낱말로 담았다 — SMB Signing not required(14) · SELinux Status
  //   Check(13) · Password Authentication Accepted(19) 같은 **설정 상태** 항목이다.
  { re: /misconfigur|insecure configuration|hardening|설정\s*미흡|not (required|enabled|configured|set)|\b(disabled|enabled|accepted|permitted|allowed)\b|selinux|signing|policy check/i,
    종류: "설정",
    말: "**설정이 권고 기준과 다릅니다.** 기능 문제는 아니지만 공격 면이 넓어집니다." },

  // ── 조사·탐지 (취약점이 아니다) ────────────────────────────────────────
  // ⚠ 마지막에 둔다. 위 규칙에 안 걸린 것 중 "무엇이 있는지 알아낸" 항목이다.
  //   실측(2026-08-04): 이런 항목이 **1,423건(29%)**이고 거의 전부 Nessus 심각도 0(None)이다.
  //   담당자가 4,833건을 보고 겁먹는 큰 이유다 — 그래서 **이건 취약점이 아니라고 말해 준다.**
  // ⚠ `\bfingerprint\b`는 「Fingerprint**s**」를 놓친다(실측 42건). 복수형·파생형을 허용한다.
  //   scanner·report·status·hostname 같은 조사 낱말도 실측에서 뽑아 넣었다.
  { re: /\b(detect(ed|ion)?s?|identif(y|ied|ication)|information|info|enumerat(e|ed|ion)|fingerprints?|banner|inventory|traceroute|supported|versions?|scanner|portscanner|report|status|hostname|installed|discovery|netstat|bios|mounted|uptime|startup|available)\b|\bcpe\b|mac address|device type|scan information/i,
    종류: "조사정보",
    말: "**취약점이 아니라 조사 결과**입니다 — 스캐너가 「무엇이 깔려 있는지」 알아낸 것입니다. 조치 대상이 아닙니다." },
];

/**
 * 취약점 이름에서 한 줄 풀이를 찾는다. **못 찾으면 null**(지어내지 않는다).
 *
 * ⚠ 이름에 이미 한글이 넉넉히 있으면 굳이 덧붙이지 않는다 — 같은 말이 두 번 나온다.
 */
export function 한줄풀이찾기(findingType: string): 한줄풀이 | null {
  const 이름 = String(findingType ?? "").trim();
  if (!이름) return null;
  const 한글수 = (이름.match(/[가-힣]/g) || []).length;
  if (한글수 >= 6) return null; // 이미 우리말로 설명돼 있다
  for (const r of 규칙) {
    if (!r.re.test(이름)) continue;
    // ★ **CVE가 붙은 것에 "조치 대상이 아니다"라고 말하지 않는다.**
    //   실측(2026-08-04): `RPC portmapper Service Detection (CVE-1999-0632)`처럼 이름이
    //   조사(Detection)인데 CVE가 달린 항목이 있다. 스캐너가 정보로 분류했더라도,
    //   담당자가 **"조치 대상이 아닙니다"를 보고 넘기는 쪽**이 훨씬 위험하다.
    //   틀릴 거면 **더 보게 만드는 쪽으로** 틀린다.
    if (r.종류 === "조사정보" && /\bCVE-\d{4}-\d+/i.test(이름)) {
      return { 종류: "조사정보", 말: "스캐너가 **조사 성격**으로 분류했지만 **CVE가 달려 있습니다** — 넘기기 전에 한 번 확인해 주세요." };
    }
    return { 종류: r.종류, 말: r.말 };
  }
  return null;
}

/** 목록 한 줄에 붙일 글 — 없으면 빈 문자열(원문만 보인다). */
export function 한줄풀이글(findingType: string): string {
  const p = 한줄풀이찾기(findingType);
  return p ? ` — ${p.말}` : "";
}

/** 이 항목이 **조사 정보**인가(취약점이 아니다). 화면·집계가 갈라 볼 때 쓴다. */
export function 조사정보인가(findingType: string): boolean {
  return 한줄풀이찾기(findingType)?.종류 === "조사정보";
}

/**
 * 「취약점 N건」 아래에 붙는 **정직 줄**.
 *
 * ★ 왜(2026-08-04): 2026-08-04 이전에 반입한 스캔 결과는 Nessus 심각도 0(None/정보)을
 *   `low`로 저장했다. 파서는 고쳤지만 **이미 저장된 값은 바뀌지 않는다** — 원본 파일 없이는
 *   되돌릴 수 없기 때문이다(이름으로 되돌리면 진짜 취약점이 조용히 사라질 수 있어 안 한다).
 *   그래서 숫자를 고치는 대신 **얼마나 섞였는지 추정해 밝힌다.** 감추는 것보다 낫다.
 *
 * ⚠ **추정이라고 반드시 말한다.** 이름 규칙으로 센 값이라 정확하지 않다.
 */
export function 섞임고지(이름들: string[]): string {
  const 조사 = 이름들.filter((n) => 조사정보인가(n)).length;
  if (조사 === 0) return "";
  return (
    `⚠ 이 숫자에 **조사 정보가 약 ${조사}건 섞여 있습니다**(추정) — 취약점이 아니라 스캐너가 ` +
    `「무엇이 깔려 있는지」 알아낸 것입니다. 2026-08-04 이전에 올린 결과라 그렇습니다. ` +
    `같은 파일을 다시 올리면 갈라서 셉니다.`
  );
}

/** 덮는 범위 — **얼마나 덮는지 밝힌다.** 안 밝히면 "다 설명된다"로 읽힌다. */
export function 덮는범위(이름들: string[]): { 전체: number; 덮음: number; 비율: number; 종류별: Record<string, number> } {
  const 종류별: Record<string, number> = {};
  let 덮음 = 0;
  for (const n of 이름들) {
    const p = 한줄풀이찾기(n);
    if (!p) continue;
    덮음++;
    종류별[p.종류] = (종류별[p.종류] ?? 0) + 1;
  }
  return { 전체: 이름들.length, 덮음, 비율: 이름들.length ? Math.round((덮음 / 이름들.length) * 100) : 0, 종류별 };
}
