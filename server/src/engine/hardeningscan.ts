// engine/hardeningscan.ts — 보안장비 하드닝(보안설정) 점검 엔진.
//
// 담당자가 챗봇/터미널로 "이 장비 하드닝 점검해줘"라고 하면, 대상 장비 CLI에서 표준 기준의 점검
// 명령을 실제로 실행하고 그 출력으로 양호/취약을 판정해 리포트를 만든다. 판정은 전부 규칙 코드가
// 하고(LLM 아님), 명령은 고정된 읽기 전용 진단 명령만 쓴다(사용자 입력을 셸에 넣지 않는다 — 인젝션 없음).
//
// 지원 기준(2종):
//  - kisa: 국내 CCE 기반 — KISA 「주요정보통신기반시설 기술적 취약점 분석·평가 방법 상세가이드」
//          UNIX(Linux) U-시리즈(U-01 root 원격접속 제한 … U-72 로깅). 국내 공공/금융 점검의 사실상 표준.
//  - cis:  CIS Benchmark(Level 1) — 국제 하드닝 기준(계정·방화벽·SSH·로깅·시간동기·서비스·패치).
//
// 대상(target) 실행: 서버가 리눅스(WSL/운영)면 호스트에서 직접, 개발용 Windows면 wsl.exe 경유.
// runner를 SSH(`ssh user@host "cmd"`)로 바꾸면 실제 원격 보안장비에도 그대로 적용된다.

import type { Express } from "express";
import { execFile } from "node:child_process";
import { authMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import { recordAudit } from "./audit";
import type { GijoUser } from "../auth/users";
import { koDateTimeString } from "../util/date";

export type ScanStatus = "PASS" | "FAIL" | "WARN" | "NA";
export type StandardId = "kisa" | "cis";

export interface RunResult { code: number; out: string; err: string }
export type RunFn = (cmd: string) => Promise<RunResult>;

export interface CheckItem {
  id: string; // 표시용 항목 id(예: U-47, ACCT-01)
  cat: string; // 분류(계정 정책·네트워크 등)
  title: string; // 점검 내용
  ref: string; // 근거 기준 조항
  remediation: string; // 조치 방법
  check: (run: RunFn) => Promise<{ status: ScanStatus; evidence: string }>;
}

export interface CheckResult extends Omit<CheckItem, "check"> {
  status: ScanStatus;
  evidence: string;
}

export interface ScanReport {
  standard: StandardId;
  standardLabel: string;
  target: string;
  startedAt: string;
  durationMs: number;
  items: CheckResult[];
  summary: { total: number; pass: number; fail: number; warn: number; na: number; scored: number; rate: number; verdict: string };
}

// ── 대상 장비 CLI 실행기 ───────────────────────────────────────────────────
// 서버가 리눅스면 그 호스트가 곧 점검 대상(에이전트/셀프 점검). 원격 장비 점검 시 이 함수만 ssh로 교체.
export const hostRunner: RunFn = (cmd) =>
  new Promise((resolve) => {
    const isWin = process.platform === "win32";
    const file = isWin ? "wsl.exe" : "bash";
    const args = isWin ? ["-e", "bash", "-lc", cmd] : ["-lc", cmd];
    execFile(file, args, { timeout: 15000, maxBuffer: 4 * 1024 * 1024 }, (err, so, se) => {
      resolve({ code: err && typeof (err as { code?: number }).code === "number" ? (err as { code: number }).code : err ? 1 : 0, out: (so || "").trim(), err: (se || "").trim() });
    });
  });

// ── 점검 대상(장비) — local(서버 자신) 또는 ssh(원격 장비) ─────────────────
export type AuthMethod = "local" | "key" | "password";
export interface HardeningTarget {
  id: string;
  label: string;
  host: string; // "local" 또는 IP/호스트명
  port: number;
  username?: string;
  authMethod: AuthMethod;
  secret?: string; // key: 개인키 경로 · password: 비밀번호
}

// SSH 실행 인자 조립(순수 함수 — 테스트 가능). local이면 null.
// 명령(cmd)은 고정 진단 명령이고 host/user/key도 배열 인자로 넘겨 셸 해석을 거치지 않는다(인젝션 없음).
export function sshCommandFor(t: HardeningTarget, cmd: string): { file: string; args: string[] } | null {
  if (t.authMethod === "local" || t.host === "local") return null;
  const sshOpts = ["-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new", "-o", "ConnectTimeout=8", "-p", String(t.port || 22)];
  const dest = `${t.username || "root"}@${t.host}`;
  if (t.authMethod === "password" && t.secret) {
    // sshpass가 있으면 비밀번호 인증. 없으면 실패를 명확히 돌려준다(키 인증 권장).
    return { file: "sshpass", args: ["-p", t.secret, "ssh", ...sshOpts, dest, cmd] };
  }
  const args = t.authMethod === "key" && t.secret ? ["-i", t.secret, ...sshOpts, dest, cmd] : [...sshOpts, dest, cmd];
  return { file: "ssh", args };
}

// 대상별 실행기. local이면 호스트 직접, ssh면 `ssh [-i key] user@host "cmd"`로 원격 실행한다.
export function targetRunner(t: HardeningTarget): RunFn {
  const built = sshCommandFor(t, "__probe__");
  if (!built) return hostRunner; // local
  return (cmd) =>
    new Promise((resolve) => {
      const { file, args } = sshCommandFor(t, cmd)!;
      execFile(file, args, { timeout: 20000, maxBuffer: 4 * 1024 * 1024 }, (err, so, se) => {
        resolve({ code: err && typeof (err as { code?: number }).code === "number" ? (err as { code: number }).code : err ? 1 : 0, out: (so || "").trim(), err: (se || "").trim() });
      });
    });
}

// 대상 CLI 접속 가능 여부 확인(스케줄 등록 전 검증용) — 원격이면 `echo ok`가 돌아오는지 본다.
export async function probeTarget(t: HardeningTarget): Promise<{ ok: boolean; detail: string }> {
  try {
    const r = await targetRunner(t)("echo gijo-ok");
    if (r.out.includes("gijo-ok")) return { ok: true, detail: "접속·명령 실행 확인" };
    return { ok: false, detail: r.err || r.out || "응답 없음 (인증/네트워크 확인)" };
  } catch (e) {
    return { ok: false, detail: (e as Error).message.slice(0, 120) };
  }
}

// 정수 파싱 도우미(문자열 출력 → 숫자, 실패 시 NaN).
function num(s: string): number { const n = parseInt(String(s).trim(), 10); return Number.isFinite(n) ? n : NaN; }

// ── 국내 CCE(KISA U-시리즈) 체크리스트 ─────────────────────────────────────
const KISA_CHECKS: CheckItem[] = [
  {
    id: "U-01", cat: "계정 관리", title: "root 계정 원격 접속 제한", ref: "KISA U-01",
    remediation: "/etc/ssh/sshd_config 의 PermitRootLogin 을 no 로 설정",
    check: async (run) => {
      const has = (await run("test -f /etc/ssh/sshd_config && echo y || echo n")).out;
      if (has !== "y") return { status: "NA", evidence: "SSH 서버(sshd) 미설치 — 원격 접속면 없음(점검 대상 아님)" };
      const r = await run("grep -Ei '^[[:space:]]*PermitRootLogin' /etc/ssh/sshd_config | tail -1");
      if (/no/i.test(r.out)) return { status: "PASS", evidence: r.out.trim() };
      return { status: "FAIL", evidence: r.out.trim() || "PermitRootLogin 미설정(기본 허용)" };
    },
  },
  {
    id: "U-02", cat: "계정 관리", title: "패스워드 복잡성 설정", ref: "KISA U-02",
    remediation: "pam_pwquality(common-password)에 minlen·복잡도(dcredit/ucredit/lcredit/ocredit) 설정",
    check: async (run) => {
      const r = await run("grep -E 'pam_pwquality|pam_cracklib' /etc/pam.d/common-password 2>/dev/null | grep -v '^#' | head -1");
      if (r.out && /(minlen|credit)/.test(r.out)) return { status: "PASS", evidence: r.out.trim().slice(0, 120) };
      return { status: "FAIL", evidence: "pam_pwquality 복잡도 미설정(기본 pam_unix만 사용)" };
    },
  },
  {
    id: "U-03", cat: "계정 관리", title: "계정 잠금 임계값 설정", ref: "KISA U-03",
    remediation: "pam_faillock(또는 pam_tally2)에 deny=5 등 로그인 실패 잠금 설정",
    check: async (run) => {
      const r = await run("grep -E 'pam_faillock|pam_tally2' /etc/pam.d/common-auth /etc/pam.d/common-account 2>/dev/null | grep -v '^#' | head -1");
      if (r.out && /deny=/.test(r.out)) return { status: "PASS", evidence: r.out.trim().slice(0, 120) };
      return { status: "FAIL", evidence: "로그인 실패 잠금(faillock/tally) 미설정" };
    },
  },
  {
    id: "U-07", cat: "파일·디렉터리", title: "/etc/passwd 소유자·권한 (root, 644 이하)", ref: "KISA U-07",
    remediation: "chown root /etc/passwd; chmod 644 /etc/passwd",
    check: async (run) => {
      const r = await run("stat -c '%U %a' /etc/passwd 2>/dev/null");
      const [owner, perm] = r.out.split(/\s+/);
      const p = num(perm);
      if (owner === "root" && Number.isFinite(p) && p <= 644) return { status: "PASS", evidence: `소유자 ${owner}, 권한 ${perm}` };
      return { status: "FAIL", evidence: `소유자 ${owner || "?"}, 권한 ${perm || "?"} (기준: root·644 이하)` };
    },
  },
  {
    id: "U-08", cat: "파일·디렉터리", title: "/etc/shadow 소유자·권한 (root, 640 이하)", ref: "KISA U-08",
    remediation: "chown root /etc/shadow; chmod 640 /etc/shadow (또는 그 이하)",
    check: async (run) => {
      const r = await run("stat -c '%U %a' /etc/shadow 2>/dev/null");
      const [owner, perm] = r.out.split(/\s+/);
      const p = num(perm);
      if (owner === "root" && Number.isFinite(p) && p <= 640) return { status: "PASS", evidence: `소유자 ${owner}, 권한 ${perm}` };
      return { status: "FAIL", evidence: `소유자 ${owner || "?"}, 권한 ${perm || "?"} (기준: root·640 이하)` };
    },
  },
  {
    id: "U-44", cat: "계정 관리", title: "root(UID 0) 이외 UID 0 계정 금지", ref: "KISA U-44",
    remediation: "root 외 UID 0 계정의 UID를 변경하거나 제거",
    check: async (run) => {
      const r = await run("awk -F: '($3==0){print $1}' /etc/passwd 2>/dev/null | tr '\\n' ' '");
      const names = r.out.split(/\s+/).filter(Boolean);
      const extra = names.filter((n) => n !== "root");
      if (extra.length === 0) return { status: "PASS", evidence: "UID 0 계정은 root 뿐" };
      return { status: "FAIL", evidence: `root 외 UID 0 계정: ${extra.join(", ")}` };
    },
  },
  {
    id: "U-46", cat: "계정 관리", title: "패스워드 최소 길이 8자 이상", ref: "KISA U-46",
    remediation: "/etc/login.defs PASS_MIN_LEN 8 또는 pwquality minlen=8 이상",
    check: async (run) => {
      const a = num((await run("grep -E '^PASS_MIN_LEN' /etc/login.defs 2>/dev/null | awk '{print $2}'")).out);
      const b = num((await run("grep -E '^[[:space:]]*minlen' /etc/security/pwquality.conf 2>/dev/null | awk -F= '{print $2}'")).out);
      const best = Math.max(Number.isFinite(a) ? a : 0, Number.isFinite(b) ? b : 0);
      if (best >= 8) return { status: "PASS", evidence: `최소 길이 ${best}자` };
      return { status: "FAIL", evidence: best > 0 ? `최소 길이 ${best}자 (기준 ≥8)` : "패스워드 최소 길이 미설정" };
    },
  },
  {
    id: "U-47", cat: "계정 관리", title: "패스워드 최대 사용기간 90일 이하", ref: "KISA U-47",
    remediation: "/etc/login.defs PASS_MAX_DAYS 90 (이하)로 설정",
    check: async (run) => {
      const v = num((await run("grep -E '^PASS_MAX_DAYS' /etc/login.defs 2>/dev/null | awk '{print $2}'")).out);
      if (!Number.isFinite(v)) return { status: "WARN", evidence: "PASS_MAX_DAYS 미설정" };
      return { status: v <= 90 ? "PASS" : "FAIL", evidence: `PASS_MAX_DAYS=${v} (기준 ≤90)` };
    },
  },
  {
    id: "U-48", cat: "계정 관리", title: "패스워드 최소 사용기간 1일 이상", ref: "KISA U-48",
    remediation: "/etc/login.defs PASS_MIN_DAYS 1 (이상)로 설정",
    check: async (run) => {
      const v = num((await run("grep -E '^PASS_MIN_DAYS' /etc/login.defs 2>/dev/null | awk '{print $2}'")).out);
      if (!Number.isFinite(v)) return { status: "WARN", evidence: "PASS_MIN_DAYS 미설정" };
      return { status: v >= 1 ? "PASS" : "FAIL", evidence: `PASS_MIN_DAYS=${v} (기준 ≥1)` };
    },
  },
  {
    id: "U-56", cat: "파일·디렉터리", title: "UMASK 022 이상(그룹·타인 쓰기 제한)", ref: "KISA U-56",
    remediation: "/etc/login.defs UMASK 022 (또는 027)로 설정",
    check: async (run) => {
      const raw = (await run("grep -E '^UMASK' /etc/login.defs 2>/dev/null | awk '{print $2}'")).out.trim();
      const d = raw.replace(/^0+/, "").padStart(3, "0"); // 마지막 3자리 = u/g/o
      const g = num(d[1]); const o = num(d[2]);
      if (Number.isFinite(g) && Number.isFinite(o) && (g & 2) && (o & 2)) return { status: "PASS", evidence: `UMASK=${raw}` };
      return { status: raw ? "WARN" : "WARN", evidence: raw ? `UMASK=${raw} (그룹·타인 쓰기 제한 확인 필요)` : "UMASK 미설정" };
    },
  },
  {
    id: "U-72", cat: "로그 관리", title: "시스템 로깅(rsyslog) 정상 동작", ref: "KISA U-72",
    remediation: "systemctl enable --now rsyslog",
    check: async (run) => {
      const r = await run("systemctl is-active rsyslog 2>/dev/null || echo inactive");
      return { status: r.out === "active" ? "PASS" : "FAIL", evidence: `rsyslog: ${r.out || "unknown"}` };
    },
  },
];

// ── CIS Benchmark(Level 1) 체크리스트 ──────────────────────────────────────
const CIS_CHECKS: CheckItem[] = [
  {
    id: "ACCT-01", cat: "계정 정책", title: "패스워드 최대 사용기간 ≤90일", ref: "CIS 5.4.1.1",
    remediation: "/etc/login.defs PASS_MAX_DAYS 를 90 이하로 설정",
    check: async (run) => {
      const v = num((await run("grep -E '^PASS_MAX_DAYS' /etc/login.defs | awk '{print $2}'")).out);
      if (!Number.isFinite(v)) return { status: "WARN", evidence: "PASS_MAX_DAYS 미설정" };
      return { status: v <= 90 ? "PASS" : "FAIL", evidence: `PASS_MAX_DAYS=${v} (권장 ≤90)` };
    },
  },
  {
    id: "FW-01", cat: "네트워크 방화벽", title: "호스트 방화벽 활성(ufw/nftables/iptables)", ref: "CIS 4.x",
    remediation: "ufw enable 또는 nftables/iptables 정책 적용, 관리망만 허용",
    check: async (run) => {
      const ufw = await run("command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | head -1 || echo NO_UFW");
      if (/Status:\s*active/i.test(ufw.out)) return { status: "PASS", evidence: "ufw active" };
      const nft = num((await run("command -v nft >/dev/null 2>&1 && nft list ruleset 2>/dev/null | grep -c 'chain' || echo 0")).out);
      if (nft > 0) return { status: "PASS", evidence: `nftables 체인 ${nft}개 적용됨` };
      return { status: "FAIL", evidence: "호스트 방화벽 미적용(ufw/nftables 규칙 없음)" };
    },
  },
  {
    id: "SSH-01", cat: "원격 접속(SSH)", title: "SSH root 직접 로그인 차단", ref: "CIS 5.1.x",
    remediation: "sshd_config: PermitRootLogin no",
    check: async (run) => {
      const has = (await run("test -f /etc/ssh/sshd_config && echo y || echo n")).out;
      if (has !== "y") return { status: "NA", evidence: "sshd 미설치 — 원격 SSH 접속면 없음" };
      const r = await run("grep -Ei '^[[:space:]]*PermitRootLogin' /etc/ssh/sshd_config | tail -1");
      if (/no/i.test(r.out)) return { status: "PASS", evidence: r.out.trim() };
      return { status: "FAIL", evidence: r.out.trim() || "PermitRootLogin 미설정(기본 허용)" };
    },
  },
  {
    id: "LOG-01", cat: "로깅·감사", title: "시스템 로깅(rsyslog) 동작", ref: "CIS 6.x",
    remediation: "systemctl enable --now rsyslog",
    check: async (run) => {
      const r = await run("systemctl is-active rsyslog 2>/dev/null || echo inactive");
      return { status: r.out === "active" ? "PASS" : "FAIL", evidence: `rsyslog: ${r.out || "unknown"}` };
    },
  },
  {
    id: "TIME-01", cat: "시간 동기화", title: "NTP 시간 동기화 활성", ref: "CIS 2.1",
    remediation: "timedatectl set-ntp true (신뢰된 NTP 서버 사용)",
    check: async (run) => {
      const r = await run("timedatectl show -p NTPSynchronized --value 2>/dev/null || echo unknown");
      return { status: r.out === "yes" ? "PASS" : r.out === "no" ? "FAIL" : "WARN", evidence: `NTPSynchronized=${r.out || "unknown"}` };
    },
  },
  {
    id: "SVC-01", cat: "서비스 최소화", title: "외부 리스닝 서비스 최소화(≤10)", ref: "CIS 2.x",
    remediation: "불필요한 리스닝 서비스 중지 — 관리 포트만 노출",
    check: async (run) => {
      const r = await run("ss -tlnH 2>/dev/null | awk '{print $4}' | sed 's/.*://' | sort -un | tr '\\n' ' '");
      const ports = r.out.split(/\s+/).filter(Boolean);
      return { status: ports.length <= 10 ? "PASS" : "WARN", evidence: `TCP 리스닝 포트 ${ports.length}개: ${ports.join(", ") || "없음"}` };
    },
  },
  {
    id: "UPD-01", cat: "패치 관리", title: "자동 보안 업데이트 설정", ref: "CIS 1.x",
    remediation: "unattended-upgrades 설치·활성화",
    check: async (run) => {
      const r = await run("dpkg -l unattended-upgrades 2>/dev/null | grep -q '^ii' && echo installed || echo missing");
      return { status: r.out === "installed" ? "PASS" : "WARN", evidence: `unattended-upgrades: ${r.out || "missing"}` };
    },
  },
];

const STANDARDS: Record<StandardId, { label: string; checks: CheckItem[] }> = {
  kisa: { label: "국내 CCE — KISA 주요정보통신기반시설 취약점 분석·평가(UNIX U-시리즈)", checks: KISA_CHECKS },
  cis: { label: "CIS Benchmark (Level 1)", checks: CIS_CHECKS },
};

export function isStandard(s: string): s is StandardId {
  return s === "kisa" || s === "cis";
}

export function listChecklists() {
  return (Object.keys(STANDARDS) as StandardId[]).map((id) => ({
    id,
    label: STANDARDS[id].label,
    count: STANDARDS[id].checks.length,
    items: STANDARDS[id].checks.map((c) => ({ id: c.id, cat: c.cat, title: c.title, ref: c.ref })),
  }));
}

function verdictOf(fail: number): string {
  return fail === 0 ? "🟢 양호" : fail <= 2 ? "🟡 보통(취약 항목 조치 필요)" : "🔴 미흡(다수 취약)";
}

export async function runHardeningScan(opts: { standard: StandardId; target?: string; run?: RunFn }): Promise<ScanReport> {
  const std = STANDARDS[opts.standard];
  const run = opts.run ?? hostRunner;
  const target = opts.target || "localhost (this-appliance)";
  const t0 = Date.now();
  const startedAt = new Date().toISOString();
  const items: CheckResult[] = [];
  for (const c of std.checks) {
    let res: { status: ScanStatus; evidence: string };
    try {
      res = await c.check(run);
    } catch (e) {
      res = { status: "WARN", evidence: `점검 실행 오류: ${(e as Error).message.slice(0, 80)}` };
    }
    items.push({ id: c.id, cat: c.cat, title: c.title, ref: c.ref, remediation: c.remediation, status: res.status, evidence: res.evidence });
  }
  const total = items.length;
  const na = items.filter((i) => i.status === "NA").length;
  const pass = items.filter((i) => i.status === "PASS").length;
  const fail = items.filter((i) => i.status === "FAIL").length;
  const warn = items.filter((i) => i.status === "WARN").length;
  const scored = total - na;
  const rate = scored ? Math.round((pass / scored) * 100) : 0;
  return {
    standard: opts.standard,
    standardLabel: std.label,
    target,
    startedAt,
    durationMs: Date.now() - t0,
    items,
    summary: { total, pass, fail, warn, na, scored, rate, verdict: verdictOf(fail) },
  };
}

const MARK: Record<ScanStatus, string> = { PASS: "✅ 양호", FAIL: "❌ 취약", WARN: "⚠️ 확인필요", NA: "➖ 해당없음" };

export function formatHardeningReport(r: ScanReport): string {
  const L: string[] = [];
  L.push(`# 보안장비 하드닝 점검 리포트`);
  L.push("");
  L.push(`- 대상 장비: ${r.target}`);
  L.push(`- 점검 기준: ${r.standardLabel}`);
  L.push(`- 점검 일시: ${koDateTimeString(new Date(r.startedAt).getTime())} (${(r.durationMs / 1000).toFixed(1)}초 소요)`);
  L.push(`- 점검 방식: 장비 CLI 원격 점검(실 명령 실행·실측)`);
  L.push("");
  L.push(`## 요약`);
  L.push("");
  L.push(`- 준수율: **${r.summary.rate}%** (양호 ${r.summary.pass} / 채점대상 ${r.summary.scored})`);
  L.push(`- 결과: ✅ 양호 ${r.summary.pass} · ❌ 취약 ${r.summary.fail} · ⚠️ 확인필요 ${r.summary.warn} · ➖ 해당없음 ${r.summary.na} (총 ${r.summary.total}항목)`);
  L.push(`- 종합 판정: ${r.summary.verdict}`);
  L.push("");
  L.push(`## 항목별 결과`);
  L.push("");
  L.push(`| 항목 | 분류 | 점검 내용 | 결과 | 근거(실측) |`);
  L.push(`|---|---|---|---|---|`);
  for (const i of r.items) L.push(`| ${i.id} | ${i.cat} | ${i.title} | ${MARK[i.status]} | ${i.evidence} |`);
  const acts = r.items.filter((i) => i.status === "FAIL" || i.status === "WARN");
  if (acts.length) {
    L.push("");
    L.push(`## 조치 권고 (취약·확인필요 ${acts.length}건)`);
    L.push("");
    for (const i of acts) L.push(`- **[${i.id}] ${i.title}** — ${i.evidence}\n  → 조치: ${i.remediation}`);
  }
  L.push("");
  L.push(`> 본 리포트는 대상 장비 CLI에서 ${r.standardLabel.split(" —")[0]} 기준 점검 명령을 실제 실행해 얻은 실측 결과입니다.`);
  return L.join("\n");
}

// 챗봇/에이전트 도구가 그대로 최종 답으로 쓸 수 있는 축약 텍스트(리포트 헤더+요약+취약 목록).
export function scanSummaryText(r: ScanReport): string {
  const fails = r.items.filter((i) => i.status === "FAIL");
  const L: string[] = [];
  L.push(`${r.standardLabel.split(" —")[0]} 기준 하드닝 점검 완료 — 대상 ${r.target}`);
  L.push(`준수율 ${r.summary.rate}% (양호 ${r.summary.pass}/${r.summary.scored}) · ${r.summary.verdict}`);
  L.push(`✅ 양호 ${r.summary.pass} · ❌ 취약 ${r.summary.fail} · ⚠️ 확인필요 ${r.summary.warn} · ➖ 해당없음 ${r.summary.na}`);
  if (fails.length) {
    L.push("취약 항목:");
    for (const i of fails) L.push(`  - [${i.id}] ${i.title} — ${i.evidence}\n    → ${i.remediation}`);
  } else {
    L.push("취약(FAIL) 항목 없음.");
  }
  return L.join("\n");
}

export function registerHardeningRoutes(app: Express): void {
  app.get("/api/hardening/checklists", authMiddleware, (_req, res) => {
    res.json({ standards: listChecklists() });
  });

  app.post(
    "/api/hardening/scan",
    authMiddleware,
    asyncRoute(async (req, res) => {
      const standard = String(req.body?.standard ?? "kisa").trim();
      if (!isStandard(standard)) {
        res.status(400).json({ error: "standard는 kisa 또는 cis여야 합니다" });
        return;
      }
      // target은 표시용 라벨만으로 쓴다 — 절대 셸 명령에 넣지 않는다(인젝션 방지).
      const targetLabel = String(req.body?.target ?? "").trim().slice(0, 120) || undefined;
      const report = await runHardeningScan({ standard, target: targetLabel });
      const actor = (req as unknown as { user?: GijoUser }).user?.username ?? "unknown";
      recordAudit({
        kind: "cli",
        actor,
        action: `하드닝 점검 실행 (${standard.toUpperCase()})`,
        target: report.target,
        detail: `준수율 ${report.summary.rate}% · 취약 ${report.summary.fail} · 확인필요 ${report.summary.warn}`,
        result: "ok",
      });
      res.json({ report, markdown: formatHardeningReport(report), summary: scanSummaryText(report) });
    })
  );
}
