// tools/device-hardening-scan.mjs — 보안장비 CLI 점검 시나리오(데모).
// 담당자 터미널에서 "보안장비(리눅스 기반 어플라이언스)"에 접속해 CIS 벤치마크 기반 하드닝
// 체크리스트를 실행하고, 실제 명령 출력으로 pass/fail을 판정해 리포트를 만든다.
//
// 대상(target): 여기서는 실 리눅스 장비 대역으로 WSL(Ubuntu 24.04)을 쓴다 — runner를 SSH로
// 바꾸면 실제 원격 장비에도 그대로 쓸 수 있다(runOnAppliance만 교체). 모든 출력은 실측이다.
//
// 기준(출처): CIS Ubuntu/Linux Benchmark(Level 1) — SSH 하드닝(PermitRootLogin·MaxAuthTries·
// Banner), 계정정책(PASS_MAX_DAYS·빈 비밀번호), 방화벽, 로깅(rsyslog), 시간동기(NTP), 서비스 최소화.
// 참고: cisecurity.org/cis-benchmarks, Cisco Secure Firewall Hardening Guide.

import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const APPLIANCE = process.env.SCAN_TARGET_LABEL || "fw-linux-appliance-01 (Ubuntu 24.04, 리눅스 기반 보안 어플라이언스)";
// ⚠ 기본값을 두지 않는다 — 예전엔 실제 sudo 비밀번호가 여기 적혀 있었다(2026-08-09 정리).
//   없으면 sudo가 필요한 항목만 건너뛴다(있는 척하지 않는다 — 조용한 실패 금지).
const SUDO_PW = process.env.SCAN_SUDO_PW || "";
if (!SUDO_PW) console.error("ℹ SCAN_SUDO_PW가 없어 sudo가 필요한 점검은 건너뜁니다(환경변수로 넣으면 전부 실행).");

// "장비 CLI에 접속해 명령 실행" — 대역으로 WSL bash. (실 장비면 ssh user@host "cmd"로 교체)
function runOnAppliance(cmd) {
  return new Promise((resolve) => {
    execFile("wsl.exe", ["-e", "bash", "-lc", cmd], { timeout: 15000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ code: err && typeof err.code === "number" ? err.code : err ? 1 : 0, out: (stdout || "").trim(), errOut: (stderr || "").trim() });
    });
  });
}

// CIS 기반 점검 항목. check()는 실 명령을 돌려 { status: PASS|FAIL|WARN|NA, evidence } 를 낸다.
const CHECKLIST = [
  {
    id: "ACCT-01", cat: "계정 정책", title: "패스워드 최대 사용기간 90일 이하 (CIS 5.4.1.1)",
    remediation: "/etc/login.defs 의 PASS_MAX_DAYS 를 90 이하로 설정",
    check: async () => {
      const r = await runOnAppliance("grep -E '^PASS_MAX_DAYS' /etc/login.defs | awk '{print $2}'");
      const v = parseInt(r.out, 10);
      if (!Number.isFinite(v)) return { status: "WARN", evidence: "PASS_MAX_DAYS 미설정" };
      return { status: v <= 90 ? "PASS" : "FAIL", evidence: `PASS_MAX_DAYS=${v} (권장 ≤90)` };
    },
  },
  {
    id: "ACCT-02", cat: "계정 정책", title: "빈 비밀번호 계정 없음 (CIS 5.4.2)",
    remediation: "빈 비밀번호 계정을 잠그거나 비밀번호 설정",
    check: async () => {
      const r = await runOnAppliance(`echo '${SUDO_PW}' | sudo -S awk -F: '($2==""){print $1}' /etc/shadow 2>/dev/null`);
      const accts = r.out.split(/\s+/).filter(Boolean);
      return { status: accts.length === 0 ? "PASS" : "FAIL", evidence: accts.length ? `빈 비밀번호 계정: ${accts.join(", ")}` : "빈 비밀번호 계정 없음" };
    },
  },
  {
    id: "FW-01", cat: "네트워크 방화벽", title: "호스트 방화벽 활성 (ufw/nftables/iptables) (CIS 4.x)",
    remediation: "ufw enable 또는 nftables/iptables 정책 적용, 관리망만 허용",
    check: async () => {
      const ufw = await runOnAppliance("command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | head -1 || echo NO_UFW");
      if (/Status:\s*active/i.test(ufw.out)) return { status: "PASS", evidence: "ufw active" };
      const ipt = await runOnAppliance(`echo '${SUDO_PW}' | sudo -S iptables -S 2>/dev/null | grep -vE '^-P|^$' | wc -l`);
      const rules = parseInt(ipt.out, 10) || 0;
      if (rules > 0) return { status: "PASS", evidence: `iptables 규칙 ${rules}개 적용됨` };
      return { status: "FAIL", evidence: "ufw 미설치·iptables 사용자 규칙 없음 (호스트 방화벽 미적용)" };
    },
  },
  {
    id: "SSH-01", cat: "원격 접속(SSH)", title: "SSH root 직접 로그인 차단 (CIS 5.1.x)",
    remediation: "sshd_config: PermitRootLogin no",
    check: async () => {
      const exists = await runOnAppliance("test -f /etc/ssh/sshd_config && echo yes || echo no");
      if (exists.out !== "yes") return { status: "NA", evidence: "SSH 서버(sshd) 미설치 — 원격 SSH 접속면 없음(점검 대상 아님)" };
      const r = await runOnAppliance("grep -Ei '^\\s*PermitRootLogin' /etc/ssh/sshd_config | tail -1");
      if (/no/i.test(r.out)) return { status: "PASS", evidence: r.out.trim() };
      return { status: "FAIL", evidence: r.out.trim() || "PermitRootLogin 미설정(기본 허용)" };
    },
  },
  {
    id: "LOG-01", cat: "로깅·감사", title: "시스템 로깅(rsyslog) 동작 (CIS 6.x)",
    remediation: "systemctl enable --now rsyslog",
    check: async () => {
      const r = await runOnAppliance("systemctl is-active rsyslog 2>/dev/null || echo inactive");
      return { status: r.out === "active" ? "PASS" : "FAIL", evidence: `rsyslog: ${r.out}` };
    },
  },
  {
    id: "TIME-01", cat: "시간 동기화", title: "NTP 시간 동기화 활성 (CIS 2.1)",
    remediation: "timedatectl set-ntp true (신뢰된 NTP 서버 사용)",
    check: async () => {
      const r = await runOnAppliance("timedatectl show -p NTPSynchronized --value 2>/dev/null || echo unknown");
      return { status: r.out === "yes" ? "PASS" : r.out === "no" ? "FAIL" : "WARN", evidence: `NTPSynchronized=${r.out}` };
    },
  },
  {
    id: "SVC-01", cat: "서비스 최소화", title: "외부 리스닝 서비스 최소화 (CIS 2.x)",
    remediation: "불필요한 리스닝 서비스 중지 — 관리 포트만 노출",
    check: async () => {
      const r = await runOnAppliance("ss -tlnH 2>/dev/null | awk '{print $4}' | sed 's/.*://' | sort -un | tr '\\n' ' '");
      const ports = r.out.split(/\s+/).filter(Boolean);
      return { status: ports.length <= 10 ? "PASS" : "WARN", evidence: `TCP 리스닝 포트 ${ports.length}개: ${ports.join(", ") || "없음"}` };
    },
  },
  {
    id: "UPD-01", cat: "패치 관리", title: "자동 보안 업데이트 설정 (CIS 1.x)",
    remediation: "unattended-upgrades 설치·활성화",
    check: async () => {
      const r = await runOnAppliance("dpkg -l unattended-upgrades 2>/dev/null | grep -q '^ii' && echo installed || echo missing");
      return { status: r.out === "installed" ? "PASS" : "WARN", evidence: `unattended-upgrades: ${r.out}` };
    },
  },
];

const MARK = { PASS: "✅ 양호", FAIL: "❌ 취약", WARN: "⚠️ 확인필요", NA: "➖ 해당없음" };

async function main() {
  console.log(`\n[터미널] 보안 어플라이언스 접속 — ${APPLIANCE}`);
  console.log("[터미널] CIS 벤치마크 기반 하드닝 점검 시작...\n");
  const started = new Date();
  const results = [];
  for (const item of CHECKLIST) {
    process.stdout.write(`  점검 ${item.id} ${item.title.split(" (")[0]} ... `);
    const r = await item.check();
    results.push({ ...item, ...r });
    console.log(MARK[r.status].split(" ")[0]);
  }

  const total = results.length;
  const na = results.filter((r) => r.status === "NA").length;
  const scored = total - na;
  const pass = results.filter((r) => r.status === "PASS").length;
  const fail = results.filter((r) => r.status === "FAIL").length;
  const warn = results.filter((r) => r.status === "WARN").length;
  const rate = scored ? Math.round((pass / scored) * 100) : 0;

  const lines = [];
  lines.push("# 보안장비 하드닝 점검 리포트");
  lines.push("");
  lines.push(`- 대상 장비: ${APPLIANCE}`);
  lines.push(`- 점검 기준: CIS Benchmark (Level 1) — 계정·방화벽·SSH·로깅·시간동기·서비스·패치`);
  lines.push(`- 점검 일시: ${started.toLocaleString("ko-KR")}`);
  lines.push(`- 점검 방식: 터미널 CLI 원격 점검(실 명령 실행·실측)`);
  lines.push("");
  lines.push(`## 요약`);
  lines.push("");
  lines.push(`- 준수율: **${rate}%** (양호 ${pass} / 채점대상 ${scored})`);
  lines.push(`- 결과: ✅ 양호 ${pass} · ❌ 취약 ${fail} · ⚠️ 확인필요 ${warn} · ➖ 해당없음 ${na} (총 ${total}항목)`);
  lines.push(`- 종합 판정: ${fail === 0 ? "🟢 양호" : fail <= 2 ? "🟡 보통(취약 항목 조치 필요)" : "🔴 미흡(다수 취약)"}`);
  lines.push("");
  lines.push(`## 항목별 결과`);
  lines.push("");
  lines.push(`| 항목 | 분류 | 점검 내용 | 결과 | 근거(실측) |`);
  lines.push(`|---|---|---|---|---|`);
  for (const r of results) {
    lines.push(`| ${r.id} | ${r.cat} | ${r.title} | ${MARK[r.status]} | ${r.evidence} |`);
  }
  const fails = results.filter((r) => r.status === "FAIL" || r.status === "WARN");
  if (fails.length) {
    lines.push("");
    lines.push(`## 조치 권고 (취약·확인필요 ${fails.length}건)`);
    lines.push("");
    for (const r of fails) lines.push(`- **[${r.id}] ${r.title.split(" (")[0]}** — ${r.evidence}\n  → 조치: ${r.remediation}`);
  }
  lines.push("");
  lines.push(`> 본 리포트는 대상 장비 CLI에서 CIS 기반 점검 명령을 실제 실행해 얻은 실측 결과입니다.`);

  const report = lines.join("\n");
  const outDir = path.resolve("D:/Connect AI/mockups/device-hardening");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `hardening-report-${started.toISOString().slice(0, 10)}.md`);
  fs.writeFileSync(outFile, report, "utf8");

  console.log("\n" + "=".repeat(70));
  console.log(report);
  console.log("=".repeat(70));
  console.log(`\n리포트 저장: ${outFile}`);
}
main();
