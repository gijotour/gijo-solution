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
import { recordWork } from "./worklog";
import { execFile } from "node:child_process";
import { authMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import { recordAudit } from "./audit";
import type { GijoUser } from "../auth/users";
import { koDateTimeString } from "../util/date";
// ⚠ SSH는 fetch가 아니라 execFile이라 봉인 관문(installAirgapGuard)을 원리상 안 지난다 —
//   smtp·siem·redteam처럼 **연결 직전에 직접** 검사한다. 판정기는 airgap 한 곳만 쓴다.
import { assertEgressAllowed } from "./airgap";
// 금융권 담당자의 말(전자금융기반시설 취약점 평가기준)로도 결과가 읽히게 하는 대응표.
// ⚠ 세는 것도 문장도 **그쪽 한 곳**이다 — 여기서 따로 세면 리포트와 축약 답이 다른 수를 말한다.
import { fsiCoverageLine, fsiSectionLines, fsiAttentionLine } from "./hardeningfsi";

export type ScanStatus = "PASS" | "FAIL" | "WARN" | "NA";
export type StandardId = "kisa" | "cis" | "kisa_pc" | "kisa_net";
// 표준별 대상 셸: linux(bash) · windows(cmd, PC 점검) · network(장비 CLI, show 명령)
export type ShellKind = "linux" | "windows" | "network";

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
  /** **어디서 돌았나** — 라벨(target)이 아니라 실제로 명령을 실행한 곳이다.
   *  "self" = 이 서버 자신 · "remote" = 등록 장비에 붙어서.
   *  ⚠ 이 칸이 생기기 전에는 표기가 target을 보고 「원격 점검」이라 **단정**했다 —
   *    라벨만 받고 러너는 로컬인 경로에서 **점검하지 않은 장비를 점검했다고** 적었다
   *    (2026-09-01). 증적으로 저장되는 글이라 거짓이 굳는다. */
  ranOn: "self" | "remote";
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

// Windows PC 점검용 로컬 러너 — 이 프로세스가 Windows에서 돌 때(개발기·담당자 PC 동봉 모드)만
// cmd.exe로 직접 실행한다. chcp 65001로 코드페이지를 UTF-8로 바꿔 한국어 Windows의 net/reg
// 출력이 CP949로 깨지는 문제를 차단한다. 리눅스 서버에서는 로컬 실행 불가 — SSH 원격 대상
// (Windows OpenSSH 서버의 기본 셸이 cmd.exe라 같은 명령이 그대로 동작)을 등록해야 한다.
export const winHostRunner: RunFn = (cmd) =>
  new Promise((resolve) => {
    if (process.platform !== "win32") {
      resolve({ code: 1, out: "", err: "서버가 리눅스 — Windows PC는 SSH 원격 대상으로 등록해 점검하세요" });
      return;
    }
    execFile("cmd.exe", ["/d", "/s", "/c", `chcp 65001>nul & ${cmd}`], { timeout: 20000, maxBuffer: 4 * 1024 * 1024, windowsVerbatimArguments: true }, (err, so, se) => {
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
  standard?: StandardId; // 이 대상의 기본 점검 기준(장비 유형) — 수동 점검 시 사용
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
  // ⚠⚠ **에어갭 봉인을 여기서 건다**(2026-08-18 조사에서 발견 — 빠져 있었다).
  //   SSH는 `execFile`이라 `installAirgapGuard()`의 fetch 관문을 **원리상 안 지난다.**
  //   같은 처지인 SMTP·SIEM·레드팀은 연결 직전에 `assertEgressAllowed`를 부르고 통로 카탈로그
  //   (`airgap.ts EGRESS_POINTS`)에도 실려 있는데 **SSH만 둘 다 빠져 있었다.**
  //   ⇒ 폐쇄망 고객에게 내는 **봉인 증명서에 이 통로가 안 실렸다** — 거짓 증명이 된다.
  //
  // ⚠ 러너를 **만들 때 한 번** 막는다(명령마다가 아니라). 명령마다 던지면 점검 항목 30개가
  //   제각기 실패해 「무엇이 문제인지」가 흩어진다. 여기서 던지면 점검이 **시작조차 안 하고**
  //   한 줄로 이유가 나온다 — redteam.ts:483과 같은 자세("호출을 시작조차 하지 않는다").
  assertEgressAllowed(t.host, "hardening-ssh");
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
  // ── 이하 4항목: CCE 파이프라인 명세(제어시스템 C-계열)에서 미커버로 판정돼 추가(2026-07-21).
  {
    id: "U-19", cat: "서비스 관리", title: "finger 서비스 비활성화", ref: "KISA U-19 / 제어 C-08",
    remediation: "finger 데몬 제거·비활성화 (포트 79 차단)",
    check: async (run) => {
      const r = await run("ss -tlnH 2>/dev/null | awk '{print $4}' | grep -E ':79$' | head -1");
      if (r.out) return { status: "FAIL", evidence: `finger 포트(79) 리스닝: ${r.out}` };
      return { status: "PASS", evidence: "finger 서비스(포트 79) 미가동" };
    },
  },
  {
    id: "U-21", cat: "서비스 관리", title: "r 계열 서비스(rsh·rlogin·rexec) 비활성화", ref: "KISA U-21 / 제어 C-08·C-11",
    remediation: "rsh/rlogin/rexec 서비스 제거 (포트 512·513·514 차단), SSH로 대체",
    check: async (run) => {
      const r = await run("ss -tlnH 2>/dev/null | awk '{print $4}' | grep -E ':(512|513|514)$' | tr '\\n' ' '");
      if (r.out.trim()) return { status: "FAIL", evidence: `r 계열 포트 리스닝: ${r.out.trim()}` };
      return { status: "PASS", evidence: "r 계열 서비스(512·513·514) 미가동" };
    },
  },
  {
    id: "U-54", cat: "계정 관리", title: "세션 타임아웃(TMOUT) 600초 이하", ref: "KISA U-54 / 제어 C-14",
    remediation: "/etc/profile 에 TMOUT=600 (이하) 및 export TMOUT 설정",
    check: async (run) => {
      const r = await run("grep -hE '^[[:space:]]*(export[[:space:]]+)?TMOUT=' /etc/profile /etc/profile.d/*.sh /etc/bash.bashrc 2>/dev/null | tail -1");
      const m = r.out.match(/TMOUT=([0-9]+)/);
      if (!m) return { status: "FAIL", evidence: "TMOUT 미설정 — 방치 세션이 만료되지 않음" };
      const v = num(m[1]);
      if (v > 0 && v <= 600) return { status: "PASS", evidence: `TMOUT=${v}초 (기준 ≤600)` };
      return { status: "FAIL", evidence: `TMOUT=${m[1]} (기준: 1~600초)` };
    },
  },
  {
    id: "U-61", cat: "서비스 관리", title: "취약 원격 프로토콜(FTP·telnet) 비활성화", ref: "KISA U-61 / 제어 C-08·C-11",
    remediation: "vsftpd/proftpd·telnetd 중지, SFTP/SSH로 대체 (포트 21·23 차단)",
    check: async (run) => {
      const r = await run("ss -tlnH 2>/dev/null | awk '{print $4}' | grep -E ':(21|23)$' | tr '\\n' ' '");
      if (r.out.trim()) return { status: "FAIL", evidence: `평문 프로토콜 포트 리스닝: ${r.out.trim()} (FTP=21·telnet=23)` };
      return { status: "PASS", evidence: "FTP(21)·telnet(23) 미가동" };
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

// ── 국내 CCE(KISA PC 점검) 체크리스트 — 임직원 Windows PC ─────────────────
// 명령은 전부 Windows cmd 호환 한 줄(원격 Windows OpenSSH 기본 셸=cmd.exe에서도 동일 동작).
// net accounts 출력은 한국어/영어 Windows 둘 다 파싱한다(chcp 65001로 UTF-8 보장).
function accountsLine(out: string, keyRe: RegExp): string | null {
  const line = out.split(/\r?\n/).find((l) => keyRe.test(l));
  return line ? line.trim() : null;
}
function trailingNum(line: string | null): number {
  if (!line) return NaN;
  const m = line.match(/(\d+)\s*$/);
  return m ? num(m[1]) : NaN;
}
const KISA_PC_CHECKS: CheckItem[] = [
  {
    id: "PC-01", cat: "계정·비밀번호", title: "비밀번호 최대 사용기간 90일 이하", ref: "KISA PC-01",
    remediation: "net accounts /maxpwage:90 또는 로컬 보안 정책에서 최대 암호 사용 기간 설정",
    check: async (run) => {
      const r = await run("net accounts");
      const line = accountsLine(r.out, /최대 암호 사용|Maximum password age/i);
      if (!line) return { status: "WARN", evidence: "net accounts 출력에서 최대 사용기간 항목을 찾지 못함" };
      if (/제한 없음|Unlimited/i.test(line)) return { status: "FAIL", evidence: "최대 사용기간 무제한 (기준 ≤90일)" };
      const v = trailingNum(line);
      if (!Number.isFinite(v)) return { status: "WARN", evidence: line.slice(0, 100) };
      return { status: v <= 90 ? "PASS" : "FAIL", evidence: `최대 암호 사용기간 ${v}일 (기준 ≤90)` };
    },
  },
  {
    id: "PC-02a", cat: "계정·비밀번호", title: "비밀번호 최소 길이 8자 이상", ref: "KISA PC-02",
    remediation: "net accounts /minpwlen:8 또는 로컬 보안 정책에서 최소 암호 길이 설정",
    check: async (run) => {
      const r = await run("net accounts");
      const line = accountsLine(r.out, /최소 암호 길이|Minimum password length/i);
      const v = trailingNum(line);
      if (!Number.isFinite(v)) return { status: "WARN", evidence: line?.slice(0, 100) || "net accounts 출력 파싱 실패" };
      return { status: v >= 8 ? "PASS" : "FAIL", evidence: `최소 암호 길이 ${v}자 (기준 ≥8)` };
    },
  },
  {
    id: "PC-02b", cat: "계정·비밀번호", title: "계정 잠금 임계값 설정(무차별 대입 방어)", ref: "KISA PC-02",
    remediation: "net accounts /lockoutthreshold:5 또는 로컬 보안 정책에서 계정 잠금 임계값 설정",
    check: async (run) => {
      const r = await run("net accounts");
      const line = accountsLine(r.out, /잠금 임계값|Lockout threshold/i);
      if (!line) return { status: "WARN", evidence: "net accounts 출력에서 잠금 임계값 항목을 찾지 못함" };
      if (/사용 안|Never/i.test(line)) return { status: "FAIL", evidence: "계정 잠금 임계값 미설정 (무차별 대입 무방비)" };
      const v = trailingNum(line);
      if (!Number.isFinite(v)) return { status: "WARN", evidence: line.slice(0, 100) };
      return { status: v > 0 && v <= 10 ? "PASS" : "WARN", evidence: `잠금 임계값 ${v}회 (권장 ≤10)` };
    },
  },
  {
    id: "PC-03", cat: "계정·비밀번호", title: "복구 콘솔 자동 로그온 금지", ref: "KISA PC-03",
    remediation: "레지스트리 RecoveryConsole SecurityLevel=0 (자동 관리자 로그온 금지)",
    check: async (run) => {
      const r = await run('reg query "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Setup\\RecoveryConsole" /v SecurityLevel');
      if (r.code !== 0 || !r.out) return { status: "PASS", evidence: "복구 콘솔 정책 키 없음 — 현대 Windows 기본(자동 로그온 기능 자체 없음)" };
      const m = r.out.match(/SecurityLevel\s+REG_DWORD\s+0x([0-9a-f]+)/i);
      if (!m) return { status: "WARN", evidence: r.out.slice(0, 100) };
      return { status: parseInt(m[1], 16) === 0 ? "PASS" : "FAIL", evidence: `SecurityLevel=0x${m[1]} (0=자동 로그온 금지)` };
    },
  },
  {
    id: "PC-04", cat: "네트워크·공유", title: "기본 공유 폴더(C$·ADMIN$) 제거", ref: "KISA PC-04",
    remediation: "net share C$ /delete 등 관리 공유 제거 + AutoShareWks=0 레지스트리 설정",
    check: async (run) => {
      const r = await run("net share");
      // 공유 이름은 각 행의 첫 토큰 — 로케일에 따라 들여쓰기가 달라 앞 공백을 허용한다.
      const names = r.out.split(/\r?\n/).map((l) => (l.match(/^\s*([A-Za-z0-9$_-]+\$)(?:\s|$)/) || [])[1]).filter(Boolean) as string[];
      const admin = names.filter((n) => /^[A-Z]\$$/i.test(n) || /^ADMIN\$$/i.test(n));
      const ipc = names.some((n) => /^IPC\$$/i.test(n));
      if (admin.length) return { status: "FAIL", evidence: `기본 관리 공유 활성: ${admin.join(", ")}` };
      if (ipc) return { status: "WARN", evidence: "IPC$ 공유만 활성 (완전 제거는 도메인 환경에 따라 판단)" };
      return { status: "PASS", evidence: "기본 공유 폴더 없음" };
    },
  },
  {
    id: "PC-05", cat: "서비스 관리", title: "불필요 서비스(Remote Registry) 비활성화", ref: "KISA PC-05",
    remediation: "sc config RemoteRegistry start=disabled & sc stop RemoteRegistry",
    check: async (run) => {
      const r = await run("sc query RemoteRegistry");
      if (/RUNNING/.test(r.out)) return { status: "FAIL", evidence: "RemoteRegistry 서비스 실행 중 (원격 레지스트리 접근 허용)" };
      if (/STOPPED/.test(r.out)) return { status: "PASS", evidence: "RemoteRegistry 중지됨" };
      if (r.code !== 0) return { status: "PASS", evidence: "RemoteRegistry 서비스 미설치" };
      return { status: "WARN", evidence: r.out.slice(0, 100) };
    },
  },
  {
    id: "PC-06", cat: "소프트웨어", title: "비인가 상용 메신저 설치 확인", ref: "KISA PC-06",
    remediation: "사내 허가되지 않은 메신저 제거 (허용 목록은 조직 정책에 따름)",
    check: async (run) => {
      const q = (root: string) => `reg query "${root}\\Microsoft\\Windows\\CurrentVersion\\Uninstall" /s /v DisplayName 2>nul`;
      const r = await run(`(${q("HKLM\\SOFTWARE")} & ${q("HKLM\\SOFTWARE\\WOW6432Node")} & ${q("HKCU\\SOFTWARE")}) | findstr /i "kakao telegram discord nateon wechat whatsapp"`);
      // 매칭 행은 두 종류: DisplayName 값 행(영문명) 또는 키 경로 행(한글 DisplayName인 경우
      // 실측: 카카오톡은 DisplayName이 한글이라 경로 \KakaoTalk 로만 걸린다). 둘 다에서 이름 추출.
      const found = [...new Set(
        r.out.split(/\r?\n/).map((l) => {
          const t = l.trim();
          if (!t) return "";
          if (/REG_SZ/.test(t)) return t.replace(/^DisplayName\s+REG_SZ\s+/i, "").trim();
          if (/^HK/i.test(t)) return t.split("\\").pop() || "";
          return "";
        }).filter(Boolean)
      )];
      if (found.length) return { status: "WARN", evidence: `상용 메신저 발견: ${found.slice(0, 5).join(", ")} — 사내 허가 여부 확인 필요` };
      return { status: "PASS", evidence: "알려진 상용 메신저 미설치" };
    },
  },
  {
    id: "PC-07", cat: "파일 시스템", title: "고정 드라이브 NTFS 포맷 사용", ref: "KISA PC-07",
    remediation: "FAT32/exFAT 고정 드라이브를 NTFS로 변환 (convert <드라이브>: /fs:ntfs)",
    check: async (run) => {
      const r = await run("powershell -NoProfile -Command \"Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object { $_.DeviceID + ' ' + $_.FileSystem }\"");
      const drives = r.out.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^[A-Z]:/.test(l));
      if (!drives.length) return { status: "WARN", evidence: "고정 드라이브 조회 실패" };
      const bad = drives.filter((d) => !/NTFS|ReFS/i.test(d));
      if (bad.length) return { status: "FAIL", evidence: `NTFS 아님: ${bad.join(", ")}` };
      return { status: "PASS", evidence: drives.join(", ") };
    },
  },
];

// ── 국내 CCE(KISA 네트워크 장비 N-시리즈) 체크리스트 — Cisco IOS 계열 ──────
// SSH로 장비에 접속해 show running-config 를 읽어 판정한다(전부 읽기 전용).
// 기본값 판정 근거: proxy-arp·domain-lookup은 IOS 기본 활성(미설정=취약), identd·mask-reply는
// 기본 비활성(명시 활성만 취약), pad는 IOS 버전에 따라 기본값이 달라 미설정은 확인필요로 둔다.
function netFail(r: RunResult): { status: ScanStatus; evidence: string } | null {
  if (r.code !== 0 && !r.out) return { status: "WARN", evidence: `장비 CLI 응답 없음 — SSH 연결·권한 확인 (${(r.err || "").slice(0, 80)})` };
  return null;
}
const KISA_NET_CHECKS: CheckItem[] = [
  {
    id: "N-33", cat: "기능 관리", title: "Proxy ARP 차단", ref: "KISA N-33 / 명세 N-33",
    remediation: "인터페이스 설정에 no ip proxy-arp 적용",
    check: async (run) => {
      const r = await run("show running-config | include proxy-arp");
      const bad = netFail(r); if (bad) return bad;
      if (/^\s*ip proxy-arp/m.test(r.out)) return { status: "FAIL", evidence: "ip proxy-arp 활성 설정 존재" };
      if (/no ip proxy-arp/.test(r.out)) return { status: "PASS", evidence: "no ip proxy-arp 적용됨" };
      return { status: "WARN", evidence: "proxy-arp 설정 표기 없음 — Cisco 기본값은 활성(인터페이스별 확인 필요)" };
    },
  },
  {
    id: "N-34", cat: "기능 관리", title: "ICMP unreachable·redirect 차단", ref: "KISA N-34 / 명세 N-34",
    remediation: "인터페이스 설정에 no ip unreachables·no ip redirects 적용",
    check: async (run) => {
      const r = await run("show running-config | include unreachables|redirects");
      const bad = netFail(r); if (bad) return bad;
      const unre = /no ip unreachables/.test(r.out);
      const redi = /no ip redirects/.test(r.out);
      if (unre && redi) return { status: "PASS", evidence: "no ip unreachables·no ip redirects 적용됨" };
      if (unre || redi) return { status: "WARN", evidence: `일부만 적용: unreachables=${unre ? "차단" : "미차단"}, redirects=${redi ? "차단" : "미차단"}` };
      return { status: "WARN", evidence: "ICMP 차단 설정 표기 없음 — 기본값 활성(확인 필요)" };
    },
  },
  {
    id: "N-35", cat: "기능 관리", title: "identd(TCP 113) 서비스 차단", ref: "KISA N-35 / 명세 N-35",
    remediation: "no ip identd 적용 (기본 비활성 — 활성 설정 제거)",
    check: async (run) => {
      const r = await run("show running-config | include identd");
      const bad = netFail(r); if (bad) return bad;
      if (/^\s*ip identd/m.test(r.out)) return { status: "FAIL", evidence: "ip identd 활성 설정 존재" };
      return { status: "PASS", evidence: "identd 비활성 (기본값)" };
    },
  },
  {
    id: "N-36", cat: "기능 관리", title: "Domain lookup 차단", ref: "KISA N-36 / 명세 N-36",
    remediation: "no ip domain-lookup (또는 no ip domain lookup) 적용",
    check: async (run) => {
      const r = await run("show running-config | include domain");
      const bad = netFail(r); if (bad) return bad;
      if (/no ip domain[- ]lookup/.test(r.out)) return { status: "PASS", evidence: "no ip domain-lookup 적용됨" };
      return { status: "FAIL", evidence: "domain lookup 차단 미설정 — Cisco 기본값 활성(명시 차단 필요)" };
    },
  },
  {
    id: "N-37", cat: "기능 관리", title: "PAD(X.25) 서비스 차단", ref: "KISA N-37 / 명세 N-37",
    remediation: "no service pad 적용",
    check: async (run) => {
      const r = await run("show running-config | include pad");
      const bad = netFail(r); if (bad) return bad;
      if (/no service pad/.test(r.out)) return { status: "PASS", evidence: "no service pad 적용됨" };
      if (/^\s*service pad/m.test(r.out)) return { status: "FAIL", evidence: "service pad 활성 설정 존재" };
      return { status: "WARN", evidence: "pad 설정 표기 없음 — IOS 버전에 따라 기본값 상이(확인 필요)" };
    },
  },
  {
    id: "N-38", cat: "기능 관리", title: "ICMP mask-reply 차단", ref: "KISA N-38 / 명세 N-38",
    remediation: "no ip mask-reply 적용 (기본 비활성 — 활성 설정 제거)",
    check: async (run) => {
      const r = await run("show running-config | include mask-reply");
      const bad = netFail(r); if (bad) return bad;
      if (/^\s*ip mask-reply/m.test(r.out)) return { status: "FAIL", evidence: "ip mask-reply 활성 설정 존재" };
      return { status: "PASS", evidence: "mask-reply 비활성 (기본값)" };
    },
  },
];

const STANDARDS: Record<StandardId, { label: string; shell: ShellKind; checks: CheckItem[] }> = {
  kisa: { label: "국내 CCE — KISA 주요정보통신기반시설 취약점 분석·평가(UNIX U-시리즈)", shell: "linux", checks: KISA_CHECKS },
  cis: { label: "CIS Benchmark (Level 1)", shell: "linux", checks: CIS_CHECKS },
  kisa_pc: { label: "국내 CCE — KISA 임직원 PC 점검(Windows PC-시리즈)", shell: "windows", checks: KISA_PC_CHECKS },
  kisa_net: { label: "국내 CCE — KISA 네트워크 장비 점검(N-시리즈·Cisco IOS)", shell: "network", checks: KISA_NET_CHECKS },
};

export function isStandard(s: string): s is StandardId {
  return s === "kisa" || s === "cis" || s === "kisa_pc" || s === "kisa_net";
}

// 표준에 맞는 로컬 기본 러너 — PC 점검은 Windows cmd, 그 외(linux·network)는 bash.
// network를 로컬로 돌리면 show 명령이 실패해 전 항목 WARN이 된다(원격 SSH 대상 필요) — 의도된 동작.
export function defaultRunnerFor(standard: StandardId): RunFn {
  return STANDARDS[standard].shell === "windows" ? winHostRunner : hostRunner;
}

/**
 * 이 대상을 **정말 원격으로** 점검하는가 — 러너 선택과 리포트 문구가 **같은 답**을 쓰게 하는 원천.
 *
 * ⚠ 왜 함수로 뺐나(2026-09-01 검토관 [상]): 리포트가 「러너를 받았는가」로 원격을 판정했는데,
 *   authMethod="local" 대상도 runnerFor가 **로컬 러너를 돌려주어** opts.run이 채워진다.
 *   그래서 접속조차 안 한 점검이 「장비 CLI 원격 점검(등록 장비에 붙어 실 명령 실행·실측)」으로
 *   기록됐다 — 하루 전 커밋이 없애려던 바로 그 거짓이 반쪽만 지워져 있었다.
 */
export function 원격점검인가(t: HardeningTarget): boolean {
  return !(t.authMethod === "local" || t.host === "local");
}

// 대상×표준에 맞는 러너 — 원격(ssh)이면 SSH, 로컬이면 표준별 기본 러너.
export function runnerFor(t: HardeningTarget, standard: StandardId): RunFn {
  return 원격점검인가(t) ? targetRunner(t) : defaultRunnerFor(standard);
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

/**
 * 감사 기록·작업 원장에 적을 **대상 이름** — 리포트 본문과 **같은 사실**을 말하게 하는 원천.
 *
 * ⚠ 왜 함수인가(2026-09-01 완결성 비평 [상]): 리포트 본문만 「이 서버 자신을 점검」으로 고치고
 *   **감사 기록은 여전히 사람이 적은 장비 이름을 그대로** 남겼다. 증적은 리포트보다 오래 남고
 *   감사 때 그것부터 본다 — 본문과 증적이 다른 말을 하면 증적 쪽이 이긴다.
 *   붙지도 않은 장비를 「대상」으로 적어 두는 것은 이 제품에서 가장 나쁜 종류의 기록이다.
 */
export function 감사대상글(r: Pick<ScanReport, "target" | "ranOn">): string {
  return r.ranOn === "remote" ? r.target : `이 서버 자신(적힌 이름표: ${r.target})`;
}

/** 「이 서버 자신」 하드닝 점검이 꺼져 있나 — 고객 QA 인스턴스(4100) 격리 전제(2026-09-10 예행 ㉔).
 *  기본은 **켜짐**(false) — 라이트는 자기 PC 점검이 제품 자체다(lite-tools.json·hardening-fsi.test.ts
 *  가 전제로 붙들고 있다). env 한 줄로만 끈다 — 코드 기본값을 안 건드리면 기존 고객·라이트는
 *  그대로 돈다. */
export function 자기점검꺼짐(): boolean {
  return process.env.GIJO_NO_SELF_SCAN === "1";
}

/** ⓒ 격리가 던지는 안내 — ㉑(0-대상 안내)과 같은 말을 재사용한다(FAIL_MARKS 회피 관례). */
export const 자기점검차단안내 = "이 설치본에서는 이 서버 자신 점검을 하지 않습니다. 점검할 장비를 검증 화면에서 「+ 대상 등록」으로 등록해 주세요.";

/** 이 **등록 대상**이 자기점검 격리에 막히는가 — 2026-09-11 검토관 적발(막다른 길).
 *  앞 판은 격리를 대화 도구·POST /api/hardening/scan 두 창구에만 걸었다. 그런데 차단 안내가
 *  사람을 「+ 대상 등록」으로 보내는데, 등록 화면에는 「로컬(서버 자신)」 선택지가 그대로 있고
 *  그 대상을 만들면 ① 수동 점검이 500으로 떨어지고 ② 정기점검이 매 주기 lastResult='fail'을
 *  쌓아 「✕ 점검 실패」로 보였다 — **관리자가 끈 것인데 제품이 고장 난 것처럼** 보인다.
 *  ⇒ 등록·수동 실행·스케줄 세 곳이 **이 판정 하나**를 본다(새 판정기를 만들지 않는다).
 *  ⚠ 「로컬인가」를 여기서 다시 적지 않는다 — 원격점검인가()가 authMethod와 host를 **둘 다** 본다
 *    (authMethod는 key인데 host가 "local"인 대상이 실제로 만들어질 수 있다). 등록 창구는 아직
 *    id가 없는 값을 넘기므로 두 칸만 받는다. */
export function 자기점검막힌대상인가(t: Pick<HardeningTarget, "authMethod" | "host">): boolean {
  return 자기점검꺼짐() && !원격점검인가(t as HardeningTarget);
}

/** 대상 등록 단계에서 로컬(서버 자신)을 막을 때 쓰는 안내 — 위 차단 안내와 뜻이 같되 자리가 다르다. */
export const 로컬대상차단안내 = "이 설치본에서는 이 서버 자신을 점검 대상으로 등록할 수 없습니다. 점검할 장비를 내부망(사설·VPN 대역) IP로 등록해 주세요.";

export async function runHardeningScan(opts: { standard: StandardId; target?: string; run?: RunFn; ranOn?: "self" | "remote"; skipWorkLog?: boolean }): Promise<ScanReport> {
  const std = STANDARDS[opts.standard];
  // ⚠⚠ **「러너를 받았는가」로는 못 가린다**(2026-09-01 검토관 [상]이 잡은 반쪽 수정).
  //   runnerFor는 authMethod="local" 대상에도 **로컬 러너**를 돌려주므로 opts.run이 채워진다.
  //   그러면 접속도 안 한 점검이 「원격 점검」으로 기록됐다.
  //   → 아는 쪽(부르는 곳)이 말한다. **안 말하면 self다** — 모호할 때 「장비에 붙어 실측했다」고
  //     말하는 것이 이 리포트에서 가장 나쁜 거짓이라, 모르면 **덜 주장하는 쪽**으로 떨어뜨린다.
  const ranOn: "self" | "remote" = opts.ranOn ?? "self";
  // ⚠ ranOn을 정한 **바로 뒤**에서 막는다 — self로 확정된 뒤라 remote(등록 대상)는 그대로 돈다.
  if (ranOn === "self" && 자기점검꺼짐()) throw new Error(자기점검차단안내);
  const run = opts.run ?? defaultRunnerFor(opts.standard);
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
  // 자동화 작업 원장(중-2) — 손으로 하면 항목마다 명령을 치고 결과를 표로 옮겨야 하는 일이다.
  // 챗봇 경로는 agentloop이 이미 원장에 남긴다(TOOL_WORK_KIND) — 여기서 또 남기면 1회 점검이
  // 2건으로 잡혀 절감 시간이 2배가 된다(검토 지적 2026-07-29). 그래서 도구 경로는 skipWorkLog로 끈다.
  // 스케줄러·화면 실행은 agentloop을 안 타므로 여기서 남겨야 한다.
  if (!opts.skipWorkLog) recordWork({ kind: "hardening_scanned", detail: `${opts.standard}/${ranOn === "remote" ? target : `self(${target})`}`, source: "schedule" });
  return {
    standard: opts.standard,
    standardLabel: std.label,
    target,
    ranOn,
    startedAt,
    durationMs: Date.now() - t0,
    items,
    summary: { total, pass, fail, warn, na, scored, rate, verdict: verdictOf(fail) },
  };
}

const MARK: Record<ScanStatus, string> = { PASS: "✓ 양호", FAIL: "✗ 취약", WARN: "⚠ 확인필요", NA: "— 해당없음" };

export function formatHardeningReport(r: ScanReport): string {
  const L: string[] = [];
  L.push(`# 보안장비 하드닝 점검 리포트`);
  L.push("");
  // ⚠ **자기 자신을 점검했으면 그렇게 적는다**(2026-09-01). 옛 판은 사람이 적은 라벨을
  //   「대상 장비」라 부르고 원격 점검이라 단정했다 — 준수율 증적으로 쓰이는 글이라
  //   점검하지 않은 장비를 점검했다고 보고하게 된다.
  L.push(
    r.ranOn === "remote"
      ? `- 대상 장비: ${r.target}`
      : `- 점검한 곳: **이 서버 자신**${r.target && !/localhost|this-appliance/.test(r.target) ? ` (적어 주신 「${r.target}」은 **점검하지 않았습니다** — 이름표로만 남습니다)` : ""}`,
  );
  L.push(`- 점검 기준: ${r.standardLabel}`);
  L.push(`- 점검 일시: ${koDateTimeString(new Date(r.startedAt).getTime())} (${(r.durationMs / 1000).toFixed(1)}초 소요)`);
  L.push(
    r.ranOn === "remote"
      ? `- 점검 방식: 장비 CLI **원격 점검**(등록 장비에 붙어 실 명령 실행·실측)`
      : `- 점검 방식: **이 서버에서 실행**(실 명령 실행·실측). 다른 장비를 점검하려면 그 장비를 **등록**해야 합니다 — 등록 전에는 이 서버만 점검합니다.`,
  );
  L.push("");
  L.push(`## 요약`);
  L.push("");
  L.push(`- 준수율: **${r.summary.rate}%** (양호 ${r.summary.pass} / 채점대상 ${r.summary.scored})`);
  L.push(`- 결과: ✓ 양호 ${r.summary.pass} · ✗ 취약 ${r.summary.fail} · ⚠ 확인필요 ${r.summary.warn} · — 해당없음 ${r.summary.na} (총 ${r.summary.total}항목)`);
  L.push(`- 종합 판정: ${r.summary.verdict}`);
  L.push(`- ${fsiCoverageLine(r)}`);
  L.push("");
  L.push(`## 항목별 결과`);
  L.push("");
  L.push(`| 항목 | 분류 | 점검 내용 | 결과 | 근거(실측) |`);
  L.push(`|---|---|---|---|---|`);
  for (const i of r.items) L.push(`| ${i.id} | ${i.cat} | ${i.title} | ${MARK[i.status]} | ${i.evidence} |`);
  // 금융 평가기준의 **부문·항목 이름**으로 같은 결과를 한 번 더 적는다.
  // ⚠ 계수 한 줄만 내던 판(2026-09-08 검토관 적발)에는 화면 안내가 「부문·항목으로 읽는 자리」라
  //   말하는데 출력에 부문도 항목 이름도 없었다 — 표가 자료 파일 안에서만 살아 있었다.
  L.push("");
  L.push(...fsiSectionLines(r));
  const acts = r.items.filter((i) => i.status === "FAIL" || i.status === "WARN");
  if (acts.length) {
    L.push("");
    L.push(`## 조치 권고 (취약·확인필요 ${acts.length}건)`);
    L.push("");
    for (const i of acts) L.push(`- **[${i.id}] ${i.title}** — ${i.evidence}\n  → 조치: ${i.remediation}`);
  }
  L.push("");
  L.push(`> 본 리포트는 ${r.ranOn === "remote" ? "대상 장비 CLI에서" : "**이 서버에서**"} ${r.standardLabel.split(" —")[0]} 기준 점검 명령을 실제 실행해 얻은 실측 결과입니다.`);
  return L.join("\n");
}

// 챗봇/에이전트 도구가 그대로 최종 답으로 쓸 수 있는 축약 텍스트(리포트 헤더+요약+취약 목록).
export function scanSummaryText(r: ScanReport): string {
  const fails = r.items.filter((i) => i.status === "FAIL");
  const L: string[] = [];
  L.push(
    `${r.standardLabel.split(" —")[0]} 기준 하드닝 점검 완료 — ` +
      (r.ranOn === "remote" ? `대상 ${r.target}` : "점검한 곳 **이 서버 자신**"),
  );
  L.push(`준수율 ${r.summary.rate}% (양호 ${r.summary.pass}/${r.summary.scored}) · ${r.summary.verdict}`);
  L.push(`✓ 양호 ${r.summary.pass} · ✗ 취약 ${r.summary.fail} · ⚠ 확인필요 ${r.summary.warn} · — 해당없음 ${r.summary.na}`);
  L.push(fsiCoverageLine(r));
  // 계수 뒤에 **이름**을 부른다 — 손이 가야 할 평가기준 항목을 부문과 함께.
  // (이 축약 답은 라이트 단독 모드에서 재요약 없이 그대로 최종 답이 된다.)
  const attn = fsiAttentionLine(r);
  if (attn) L.push(attn);
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
        res.status(400).json({ error: "standard는 kisa·cis·kisa_pc·kisa_net 중 하나여야 합니다" });
        return;
      }
      // ⚠ 이 창구도 **항상 self**다(등록 대상 점검은 hardeningtargets 라우트가 맡는다).
      //   고객 QA 인스턴스(4100) 격리(2026-09-10 예행 ㉔).
      if (자기점검꺼짐()) {
        res.status(409).json({ error: 자기점검차단안내 });
        return;
      }
      // target은 표시용 라벨만으로 쓴다 — 절대 셸 명령에 넣지 않는다(인젝션 방지).
      const targetLabel = String(req.body?.target ?? "").trim().slice(0, 120) || undefined;
      const report = await runHardeningScan({ standard, target: targetLabel });
      const actor = (req as unknown as { user?: GijoUser }).user?.displayName ?? "(알 수 없음)";
      recordAudit({
        kind: "cli",
        actor,
        action: `하드닝 점검 실행 (${standard.toUpperCase()})`,
        target: 감사대상글(report),
        detail: `준수율 ${report.summary.rate}% · 취약 ${report.summary.fail} · 확인필요 ${report.summary.warn}`,
        result: "ok",
      });
      res.json({ report, markdown: formatHardeningReport(report), summary: scanSummaryText(report) });
    })
  );
}
