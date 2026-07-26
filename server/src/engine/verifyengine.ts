// engine/verifyengine.ts — 조치 검증(찾은 취약점이 정말 닫혔는지 확인)
//
// 왜 만드나(2026-07-26 설계 확정, GIJO_AS_조치검증_계획서.md):
// 담당자가 조치한 뒤 "진짜 고쳐졌는지" 확인할 수단이 없어 다음 정기 스캔까지 기다리거나
// 수동 확인에 의존했다. approvals 흐름(미검토→진행중→**검증**→완료)에서 '검증' 칸을 채울
// 도구가 없던 것이다. 이 파일이 그 칸을 채운다.
//
// ⚠ 이건 "취약점을 더 찾는" 스캐너가 아니다. **찾은 것을 닫는** 도구다.
//   명칭도 "조치 검증"으로 고정한다("스캐너"라 부르면 Nessus를 연상해 기대가 어긋난다).
//
// 【설계: 실행 엔진은 하나, 항목 생성기만 둘】
//   hardeningscan.ts의 수집 계층(RunFn·targetRunner·probeTarget)을 그대로 재사용한다.
//   두 기능은 접속(SSH 읽기전용)·명령 실행·판정 결과가 같고 **판정 기준만** 다르다.
//   따로 만들면 접속·인증·타임아웃·에러 처리를 두 벌 유지하게 된다.
//
//     HardeningTarget → targetRunner() → RunFn      (수집: 공유)
//                             ↓
//       ① CheckItem   정적 체크리스트(기존 U-47 등)
//       ② VerifyItem  취약점에서 동적 생성(여기)     (판정: 분기)
//
// 【정직 원칙 — manual은 1급 시민】
//   자동으로 판정할 수 없는 것은 억지로 결론 내지 않고 manual(사람 확인 필요)로 둔다.
//   버전 비교는 versioncmp.ts(순수 함수·테스트 고정)가 하고 LLM은 쓰지 않는다 —
//   판정이 비결정적이면 같은 자산을 두 번 검사할 때 답이 달라져 제품 신뢰가 무너진다.

import type { RunFn, ScanStatus } from "./hardeningscan";
import { isFixed, extractVersion, type VersionVerdict } from "./versioncmp";
import type { StandardFinding } from "./bridge";
import { findingKey } from "./approvals";

/** 검증 대상의 "기대 상태" — 무엇이 참이어야 조치 완료인가. */
export type ExpectedState =
  | { kind: "version"; product: string; fixedFrom: string } // 그 버전 이상이어야 함
  | { kind: "absent"; pattern: string }                     // 해당 서비스/포트가 없어야 함
  | { kind: "config"; path: string; expect: string }        // 설정값이 일치해야 함
  | { kind: "cert"; notAfter: string }                      // 인증서가 유효해야 함
  | { kind: "manual"; reason: string };                     // 자동 검증 불가(정직하게 표기)

/** 판정 결과 — hardeningscan의 ScanStatus와 같은 어휘를 쓴다(화면·리포트 공유). */
export interface VerifyResult {
  status: ScanStatus; // PASS=조치확인 · FAIL=아직 취약 · WARN=확인 필요 · NA=자동검증 불가
  evidence: string;   // 판정 근거(명령 출력 요약) — 화면에 그대로 보여준다
}

export interface VerifyItem {
  findingKey: string; // assets.findings[].key — approvals와 잇는 열쇠
  assetId: string;
  cve?: string;
  title: string;
  expected: ExpectedState;
  /** CheckItem.check와 동일 시그니처 — 같은 실행 엔진에 그대로 태울 수 있다. */
  probe: (run: RunFn) => Promise<VerifyResult>;
}

// ── finding 텍스트에서 기대 상태 뽑기 ────────────────────────────────────
// 스캐너 제목·근거는 사람이 읽는 문장이라 규칙으로 읽는다. 못 읽으면 manual이다(추측 금지).

/** "CVE-2021-44228" 같은 표기를 찾는다(여러 개면 첫 번째). */
export function extractCve(text: string): string | undefined {
  const m = String(text || "").match(/CVE-\d{4}-\d{4,7}/i);
  return m ? m[0].toUpperCase() : undefined;
}

// 제품명 사전 — 스캐너 제목에 나오는 표기 → 조회에 쓸 제품 키.
// 현장에서 만나는 대로 늘려가는 축적 자산이다(versioncmp의 정규식 표와 짝).
const PRODUCT_HINTS: { re: RegExp; product: string }[] = [
  { re: /log4j/i, product: "log4j" },
  { re: /openssh|\bssh\b/i, product: "openssh" },
  { re: /openssl/i, product: "openssl" },
  { re: /apache(?!\s*log4j)|httpd/i, product: "apache" },
  { re: /nginx/i, product: "nginx" },
  { re: /oracle/i, product: "oracle" },
  { re: /mysql|mariadb/i, product: "mysql" },
  { re: /postgres/i, product: "postgres" },
  { re: /fortios|fortigate/i, product: "fortios" },
  { re: /cisco|ios\b/i, product: "cisco" },
  { re: /netscaler|citrix/i, product: "netscaler" },
  { re: /ivanti|pulse/i, product: "ivanti" },
  { re: /java|jdk|jre/i, product: "java" },
  { re: /python/i, product: "python" },
];

function productOf(text: string): string | null {
  for (const h of PRODUCT_HINTS) if (h.re.test(text)) return h.product;
  return null;
}

/**
 * finding에서 기대 상태를 유도한다. 읽을 수 없으면 manual — 이 함수는 추측하지 않는다.
 *
 * 읽는 표기(실제 스캐너 문구 기준):
 *  · "Apache Log4j < 2.15.0 RCE"          → version(log4j, 2.15.0)
 *  · "(설치 2.11.0 → 2.12.2 필요)"          → version fixedFrom=2.12.2 (근거의 권고 버전 우선)
 *  · "... 인증서 만료 ..."                   → cert
 *  · "포트: tcp/23" + telnet 류             → absent
 */
export function deriveExpected(f: StandardFinding): ExpectedState {
  const title = String(f.finding_type || "");
  const ev = String(f.evidence || "");
  const all = `${title}\n${ev}`;

  // 인증서 — 만료는 버전과 무관한 별도 판정. 근거에 파일 경로가 있으면 그 인증서를 본다.
  // 경로가 없으면 빈 값으로 두고, probe가 "위치를 몰라 판정 못 함(NA)"으로 정직하게 답한다
  // — 경로를 추측해 엉뚱한 인증서를 검사하면 "괜찮다"는 오답이 나온다.
  if (/인증서|certificate/i.test(all) && /만료|expir/i.test(all)) {
    const p = ev.match(/(\/[\w./-]+\.(?:pem|crt|cer))/);
    return { kind: "cert", notAfter: p ? p[1] : "" };
  }

  // 설정값 — 스캐너가 **파일과 기대값을 명시했을 때만** 자동 판정한다.
  // "설정이 미흡하다" 정도로는 무엇이 옳은 값인지 알 수 없어 추측하면 오판이 된다.
  // 인식하는 표기: "파일: /etc/ssh/ssh_config" + "기대: PermitRootLogin no"
  const cfgPath = ev.match(/(?:파일|경로|file)\s*[:：]\s*(\/[\w./-]+)/i);
  const cfgWant = ev.match(/(?:기대|권장|설정값|expect)\s*[:：]\s*([^\n]+)/i);
  if (cfgPath && cfgWant) {
    return { kind: "config", path: cfgPath[1], expect: cfgWant[1].trim() };
  }

  const product = productOf(all);

  // ① 근거에 "→ X 필요"(권고 버전)가 있으면 그게 가장 정확하다
  const rec = ev.match(/→\s*([0-9][0-9.\-p]*)\s*(?:필요|이상)/);
  if (product && rec) return { kind: "version", product, fixedFrom: rec[1] };

  // ② 제목의 "< X" (그 아래 버전이 취약 = X부터 고쳐짐)
  const lt = title.match(/<\s*([0-9][0-9.\-p]*)/);
  if (product && lt) return { kind: "version", product, fixedFrom: lt[1] };

  // ③ 꺼져 있어야 하는 서비스(평문 프로토콜 등)
  if (/telnet|ftp(?!s)|rlogin|평문/i.test(all)) {
    const port = ev.match(/tcp\/(\d+)/i);
    return { kind: "absent", pattern: port ? `:${port[1]}` : "telnet" };
  }

  // 읽지 못했다 — 억지로 결론 내지 않는다
  return {
    kind: "manual",
    reason: product
      ? `${product}의 조치 기준 버전을 스캐너 문구에서 읽지 못했습니다 — 권고 버전을 확인해 주세요`
      : "제품과 조치 기준을 자동으로 알아낼 수 없는 유형입니다 — 담당자 확인이 필요합니다",
  };
}

// ── 조회 명령(전부 읽기 전용) ────────────────────────────────────────────
// 제품별 버전 조회. 여러 배포판을 고려해 대안 명령을 || 로 잇는다.
const VERSION_CMD: Record<string, string> = {
  openssh: "ssh -V 2>&1",
  openssl: "openssl version 2>&1",
  apache: "(apache2 -v || httpd -v) 2>&1",
  nginx: "nginx -v 2>&1",
  log4j: "find / -name 'log4j-core-*.jar' -maxdepth 6 2>/dev/null | head -5",
  java: "java -version 2>&1",
  python: "python3 --version 2>&1",
  mysql: "(mysql --version || mariadb --version) 2>&1",
  postgres: "psql --version 2>&1",
  oracle: "(sqlplus -v || echo no-sqlplus) 2>&1",
  fortios: "get system status",
  cisco: "show version",
  netscaler: "show ns version",
  ivanti: "show version",
};

function shortEvidence(cmd: string, out: string): string {
  const body = (out || "").trim().split("\n").slice(0, 3).join(" / ").slice(0, 240);
  return `$ ${cmd}\n${body || "(출력 없음)"}`;
}

/** 버전 판정 → 화면 어휘로. unknown은 NA(자동검증 불가)로 정직하게 떨어뜨린다. */
function statusOfVerdict(v: VersionVerdict): ScanStatus {
  return v === "fixed" ? "PASS" : v === "vulnerable" ? "FAIL" : "NA";
}

/** 기대 상태로부터 실제 점검 함수를 만든다(RunFn 주입 — 단위 테스트가 실 SSH 없이 가능). */
export function probeFor(expected: ExpectedState): (run: RunFn) => Promise<VerifyResult> {
  if (expected.kind === "version") {
    const cmd = VERSION_CMD[expected.product] ?? `${expected.product} --version 2>&1`;
    return async (run) => {
      const r = await run(cmd);
      const raw = `${r.out}\n${r.err}`;
      const cur = extractVersion(expected.product, raw);
      if (!cur) {
        return {
          status: "NA",
          evidence: `${shortEvidence(cmd, raw)}\n→ 버전을 읽지 못했습니다(자동 판정 불가). 수동 확인이 필요합니다.`,
        };
      }
      const verdict = isFixed(cur, expected.fixedFrom);
      const label =
        verdict === "fixed" ? `설치 ${cur} ≥ 조치기준 ${expected.fixedFrom} — 조치 확인`
          : verdict === "vulnerable" ? `설치 ${cur} < 조치기준 ${expected.fixedFrom} — 아직 취약`
            : `설치 ${cur} 과 조치기준 ${expected.fixedFrom} 을 비교할 수 없습니다(계열 상이 등) — 수동 확인 필요`;
      return { status: statusOfVerdict(verdict), evidence: `${shortEvidence(cmd, raw)}\n→ ${label}` };
    };
  }

  if (expected.kind === "absent") {
    const cmd = `(ss -lntu 2>/dev/null || netstat -lntu 2>/dev/null) | grep -i -- '${expected.pattern}' | head -5`;
    return async (run) => {
      const r = await run(cmd);
      const hit = (r.out || "").trim();
      return hit
        ? { status: "FAIL", evidence: `${shortEvidence(cmd, r.out)}\n→ 아직 열려 있습니다(${expected.pattern}).` }
        : { status: "PASS", evidence: `${shortEvidence(cmd, r.out)}\n→ 해당 서비스/포트가 보이지 않습니다 — 조치 확인.` };
    };
  }

  if (expected.kind === "config") {
    const cmd = `grep -E -- '${expected.expect}' '${expected.path}' 2>/dev/null | head -3`;
    return async (run) => {
      const r = await run(cmd);
      const hit = (r.out || "").trim();
      return hit
        ? { status: "PASS", evidence: `${shortEvidence(cmd, r.out)}\n→ 설정이 기대값과 일치합니다.` }
        : { status: "FAIL", evidence: `${shortEvidence(cmd, r.out)}\n→ 기대한 설정(${expected.expect})을 찾지 못했습니다.` };
    };
  }

  if (expected.kind === "cert") {
    // 근거에 인증서 경로가 있을 때만 검사한다. 없으면 실행하지 않고 NA —
    // 경로를 추측해 엉뚱한 인증서를 보면 "괜찮다"는 오답이 나온다(가장 나쁜 방향).
    if (!expected.notAfter) {
      return async () => ({
        status: "NA",
        evidence: "인증서 파일 경로를 알 수 없어 자동 판정하지 않았습니다 — 근거에 경로(예: /etc/ssl/certs/서버.pem)가 있으면 자동으로 확인합니다.",
      });
    }
    const cmd = `openssl x509 -enddate -noout -in '${expected.notAfter}' 2>&1`;
    return async (run) => {
      const r = await run(cmd);
      const m = `${r.out}${r.err}`.match(/notAfter=(.+)/);
      if (!m) {
        return { status: "NA", evidence: `${shortEvidence(cmd, r.out + r.err)}\n→ 인증서를 읽지 못해 자동 판정하지 못했습니다.` };
      }
      const until = new Date(m[1].trim());
      const days = Math.floor((until.getTime() - Date.now()) / 86_400_000);
      return days > 30
        ? { status: "PASS", evidence: `만료 ${until.toISOString().slice(0, 10)} (${days}일 남음) — 조치 확인` }
        : { status: "FAIL", evidence: `만료 ${until.toISOString().slice(0, 10)} (${days}일 남음) — 갱신 필요` };
    };
  }

  // manual — 실행하지 않고 사유를 그대로 돌려준다
  const reason = expected.reason;
  return async () => ({ status: "NA", evidence: `자동 검증 대상이 아닙니다 — ${reason}` });
}

/** 자산의 finding 목록에서 검증 항목을 만든다. 이미 조치된(fixed) 건은 대상에서 뺀다. */
export function buildVerifyItems(assetId: string, findings: StandardFinding[]): VerifyItem[] {
  return (findings || [])
    .filter((f) => f.state !== "fixed")
    .map((f) => {
      const expected = deriveExpected(f);
      return {
        // ⚠ approvals의 정식 키(sha1 해시)를 써야 한다. 스캐너가 준 f.key를 쓰면 승인 테이블의
        //   어느 행과도 안 맞아, 상태를 고아 행에 쓰게 된다. 그 고아 행은 "재스캔에서 사라진
        //   건"으로 오인돼 자동 완료(approved)로 뒤집히고, 목록에 유령 '완료'가 생긴다.
        //   (2026-07-26 로컬 시나리오 e2e에서 실제로 잡힌 버그 — 단위 테스트로는 못 잡았다.)
        findingKey: findingKey(assetId, f),
        assetId,
        cve: extractCve(`${f.finding_type}\n${f.evidence}`),
        title: f.finding_type,
        expected,
        probe: probeFor(expected),
      };
    });
}

export interface VerifyOutcome extends VerifyResult {
  findingKey: string;
  title: string;
  cve?: string;
  expectedKind: ExpectedState["kind"];
}

/** 항목들을 순서대로 실행한다(대상 한 대에 동시 접속을 늘리지 않는다 — 운영 장비 부담 회피). */
export async function runVerifyItems(items: VerifyItem[], run: RunFn): Promise<VerifyOutcome[]> {
  const out: VerifyOutcome[] = [];
  for (const it of items) {
    let r: VerifyResult;
    try {
      r = await it.probe(run);
    } catch (e) {
      // 접속·명령 실패를 "조치됨"으로 오해하면 안 된다 — 확인 실패는 NA다.
      r = { status: "NA", evidence: `점검 명령 실행 실패: ${(e as Error).message.slice(0, 160)}` };
    }
    out.push({ ...r, findingKey: it.findingKey, title: it.title, cve: it.cve, expectedKind: it.expected.kind });
  }
  return out;
}

/** 결과 요약 — 화면·리포트에서 쓰는 집계. */
export function summarize(results: VerifyOutcome[]): { total: number; fixed: number; still: number; manual: number } {
  return {
    total: results.length,
    fixed: results.filter((r) => r.status === "PASS").length,
    still: results.filter((r) => r.status === "FAIL").length,
    manual: results.filter((r) => r.status === "NA" || r.status === "WARN").length,
  };
}
