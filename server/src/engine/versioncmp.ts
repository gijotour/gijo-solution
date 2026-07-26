// engine/versioncmp.ts — 버전 비교(조치 검증의 판정 근거)
//
// 왜 LLM이 아니라 코드인가(2026-07-26 설계 결정):
//  · "3.0.10"과 "3.0.9"를 문자열로 비교하면 틀린다(사전순으로는 3.0.10 < 3.0.9).
//  · FortiOS 7.2.5 / Cisco IOS 15.2(4)M / Oracle 19.3.0.0.0 — 형식이 제각각이다.
//  · 무엇보다 판정이 비결정적이면 같은 자산을 두 번 검사할 때 결과가 달라진다. 조치 검증에서
//    그건 제품 신뢰의 붕괴다. 그래서 순수 함수 + 단위 테스트로 고정한다.
//
// 왜 semver 라이브러리를 안 쓰나: semver는 "1.2.3-rc1" 규격만 다룬다. 15.2(4)M·19.3.0.0.0·
// 9.6p1 같은 장비/유닉스 관행 표기를 못 읽는다. 직접 구현이 맞다.
//
// ⚠ 이 파일의 제1원칙: **모르면 모른다고 답한다.**
//    비교할 수 없는 조합(트레인이 다른 Cisco IOS 등)은 억지로 판정하지 않고 "unknown"을 준다.
//    호출자(조치 검증)는 unknown을 manual(사람 확인 필요)로 떨어뜨린다. 억지 판정보다 정직한
//    판단불가가 신뢰를 만든다.

/** 판정 결과 — fixed=조치됨(취약 버전 아님) · vulnerable=아직 취약 · unknown=비교 불가(사람 확인) */
export type VersionVerdict = "fixed" | "vulnerable" | "unknown";

/**
 * 버전 문자열에서 숫자 마디만 순서대로 뽑는다.
 *  "7.2.5"        → [7, 2, 5]
 *  "15.2(4)M"     → [15, 2, 4]      (트레인 문자 M은 trainOf가 따로 본다)
 *  "19.3.0.0.0"   → [19, 3, 0, 0, 0]
 *  "9.6p1"        → [9, 6, 1]
 *  "v2.4.52-p1"   → [2, 4, 52, 1]
 * 숫자가 하나도 없으면 빈 배열(= 비교 불가 신호).
 */
export function parseVersion(raw: string): number[] {
  if (!raw) return [];
  const m = String(raw).match(/\d+/g);
  return m ? m.map((n) => Number(n)) : [];
}

/**
 * Cisco IOS의 "트레인"(15.2(4)M의 M, 15.2(4)S의 S)처럼 계열을 나누는 문자.
 * 계열이 다르면 숫자가 커도 최신이라 할 수 없다 — 비교 자체를 포기해야 하는 신호다.
 * 숫자 뒤에 붙은 대문자 한두 글자만 트레인으로 본다(9.6p1의 소문자 p는 패치 표기라 제외).
 */
export function trainOf(raw: string): string | null {
  const m = String(raw || "").match(/\)([A-Z]{1,2})\d*$|(?:^|\d)([A-Z]{1,2})$/);
  return m ? (m[1] || m[2] || null) : null;
}

/** 두 버전 비교 — a<b=-1 · a==b=0 · a>b=1. 자릿수가 다르면 짧은 쪽을 0으로 채운다(7.2 == 7.2.0). */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const x = parseVersion(a);
  const y = parseVersion(b);
  const len = Math.max(x.length, y.length);
  for (let i = 0; i < len; i++) {
    const av = x[i] ?? 0;
    const bv = y[i] ?? 0;
    if (av < bv) return -1;
    if (av > bv) return 1;
  }
  return 0;
}

/**
 * 조치 판정 — 현재 버전이 "이 버전부터 고쳐짐(fixedFrom)"에 도달했는가.
 * 도달(같거나 높음)했으면 fixed, 아니면 vulnerable.
 *
 * unknown을 주는 경우(억지 판정 금지):
 *  · 둘 중 하나에서 숫자를 못 뽑았을 때(파싱 실패)
 *  · Cisco IOS 트레인이 서로 다를 때(15.2(4)M vs 15.2(4)S — 계열이 달라 대소 비교가 무의미)
 */
export function isFixed(current: string, fixedFrom: string): VersionVerdict {
  const cur = parseVersion(current);
  const fix = parseVersion(fixedFrom);
  if (!cur.length || !fix.length) return "unknown";

  const ct = trainOf(current);
  const ft = trainOf(fixedFrom);
  if (ct && ft && ct !== ft) return "unknown";

  return compareVersions(current, fixedFrom) >= 0 ? "fixed" : "vulnerable";
}

/**
 * 제품별 버전 추출 정규식 표 — 명령 출력에서 버전만 골라낸다.
 * 이 표는 제품을 만날 때마다 늘려가는 **축적 자산**이다(현장에서 한 줄씩 붙는다).
 * 키는 소문자로 비교하며, 제품명에 키가 포함되면 그 규칙을 쓴다.
 */
const PRODUCT_PATTERNS: { key: string; re: RegExp }[] = [
  // 네트워크·보안 장비
  { key: "fortios", re: /v?(\d+\.\d+\.\d+)/i },                       // "FortiOS v7.2.5 build1517"
  { key: "fortigate", re: /v?(\d+\.\d+\.\d+)/i },
  { key: "cisco", re: /Version\s+(\d+\.\d+\([^)]+\)[A-Z]{0,2}\d*)/i }, // "IOS Software, Version 15.2(4)M7"
  { key: "ios", re: /Version\s+(\d+\.\d+\([^)]+\)[A-Z]{0,2}\d*)/i },
  { key: "netscaler", re: /NS(\d+\.\d+):?\s*Build\s*([\d.]+)/i },      // 아래 특수 처리
  { key: "ivanti", re: /(\d+\.\d+R\d+(?:\.\d+)?)/i },                  // "22.4R2.2"
  { key: "sonicwall", re: /(\d+\.\d+\.\d+\.\d+-\d+n?)/i },
  // 서버 소프트웨어
  { key: "openssh", re: /OpenSSH[_ ](\d+\.\d+(?:p\d+)?)/i },           // "OpenSSH_9.6p1"
  { key: "openssl", re: /OpenSSL\s+(\d+\.\d+\.\d+[a-z]?)/i },
  { key: "apache", re: /Apache\/(\d+\.\d+\.\d+)/i },                   // "Apache/2.4.52 (Ubuntu)"
  { key: "httpd", re: /Apache\/(\d+\.\d+\.\d+)/i },
  { key: "nginx", re: /nginx\/(\d+\.\d+\.\d+)/i },
  { key: "oracle", re: /(\d+\.\d+\.\d+\.\d+\.\d+)/ },                  // "19.3.0.0.0"
  { key: "mysql", re: /(\d+\.\d+\.\d+)/ },
  { key: "postgres", re: /PostgreSQL\s+(\d+\.\d+)/i },
  { key: "log4j", re: /(\d+\.\d+\.\d+)/ },
  { key: "java", re: /version\s+"?(\d+(?:\.\d+){0,3})/i },
  { key: "python", re: /Python\s+(\d+\.\d+\.\d+)/i },
];

/** 아무 제품 규칙도 못 찾았을 때 쓰는 마지막 시도 — 첫 번째 점 있는 숫자 뭉치. */
const GENERIC_RE = /(\d+\.\d+(?:\.\d+)*)/;

/**
 * 명령 출력에서 제품 버전을 뽑는다. 못 뽑으면 null — 호출자는 manual로 떨어뜨린다.
 * (억지로 아무 숫자나 집으면 오판정이 된다. 이 함수의 null은 실패가 아니라 정직한 답이다.)
 */
export function extractVersion(product: string, cmdOutput: string): string | null {
  if (!cmdOutput) return null;
  const p = String(product || "").toLowerCase();

  // NetScaler는 "NS13.1: Build 37.38" 처럼 두 조각이라 합쳐야 의미가 있다.
  if (p.includes("netscaler") || p.includes("citrix")) {
    const m = cmdOutput.match(/NS(\d+\.\d+):?\s*Build\s*([\d.]+)/i);
    if (m) return `${m[1]}.${m[2].replace(/\.$/, "")}`;
    return null;
  }

  for (const { key, re } of PRODUCT_PATTERNS) {
    if (!p.includes(key)) continue;
    const m = cmdOutput.match(re);
    if (m && m[1]) return m[1];
  }
  const g = cmdOutput.match(GENERIC_RE);
  return g ? g[1] : null;
}
