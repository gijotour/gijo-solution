#!/usr/bin/env node
// QA 계층 [verify] — 조치 검증 · VEX 출력 · 자산 기본 담당자 (2026-07-26 신설)
//
// 왜 별도 계층인가: 이 기능들은 "판정이 맞는가"보다 **"판정을 어디에 쓰는가"**가 더 위험하다.
// 실제로 승인 테이블의 잘못된 키에 써서 유령 '완료'가 생기는 버그가 단위 테스트를 통과한 채
// 운영까지 갔다(2026-07-26). 그래서 운영 서버 자신을 점검 대상으로 세우고 실제 명령·실제 상태
// 전이까지 확인한다.
//
// 사용: QA_USER=... QA_PASS=... node tools/qa-verify.mjs
// 검증용 자산·대상·승인행은 끝나고 전부 회수한다(실데이터 오염 금지).

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const B = process.env.GIJO_SERVER_URL || "http://localhost:4000";
const USER = process.env.QA_USER || process.env.GIJO_ADMIN_USER;
const PASS = process.env.QA_PASS || process.env.GIJO_ADMIN_PASSWORD;
if (!USER || !PASS) { console.error("QA_USER/QA_PASS 필요"); process.exit(2); }

let fails = 0;
const ok = (n, c, d) => { if (!c) fails++; console.log(`  ${c ? "✓" : "✗"} ${n}${d ? " — " + String(d).slice(0, 150) : ""}`); };

const login = await (await fetch(`${B}/api/auth/login`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: USER, password: PASS, force: true }),
})).json();
if (!login.accessToken) { console.error("로그인 실패"); process.exit(2); }
const H = { Authorization: `Bearer ${login.accessToken}`, "Content-Type": "application/json" };

const LABEL = "QA검증시나리오";
const ASSET_ID = "qa-verify-local";
let targetId = null;

// findings 주입 — 주입 API가 없어(스캔 어댑터 경유만) DB에 직접 심는다.
// 운영 DB는 WSL에 있으므로 wsl 경유. 실패하면 그 시나리오만 건너뛴다(환경 의존).
function injectFindings() {
  const script = `
const D=require("better-sqlite3");const db=new D("data/gijo-as.sqlite");
const f=[
 {finding_type:"OpenSSH < 9.6 사용자 열거 (CVE-2024-6387)",severity:"high",evidence:"포트: tcp/22",source_tool:"QA",key:"qa-pass",state:"active"},
 {finding_type:"OpenSSH < 10.0 가상 취약점 (CVE-2099-00001)",severity:"medium",evidence:"포트: tcp/22",source_tool:"QA",key:"qa-fail",state:"active"},
 {finding_type:"권한 상승 가능성 있음",severity:"low",evidence:"동작 확인 필요",source_tool:"QA",key:"qa-manual",state:"active"}];
const r=db.prepare("UPDATE assets SET findings=?, lastScannedAt=? WHERE id=?").run(JSON.stringify(f),Date.now(),"${ASSET_ID}");
console.log(JSON.stringify({changed:r.changes,count:f.length}));`;
  const tmp = path.join(process.cwd(), ".tmp-reports", "_qa-inject.cjs");
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  fs.writeFileSync(tmp, script, "utf8");
  try {
    const out = execFileSync("wsl", ["-d", "Ubuntu-24.04", "--", "bash", "-lc",
      `cp '${tmp.replace(/\\/g, "/").replace(/^([A-Za-z]):/, (_m, d) => `/mnt/${d.toLowerCase()}`)}' /home/gijo/gijo-as/server/_qa.cjs && cd /home/gijo/gijo-as/server && node _qa.cjs; rm -f /home/gijo/gijo-as/server/_qa.cjs`],
      { encoding: "utf8" }).trim();
    return out.includes('"count":3');
  } catch { return false; } finally { try { fs.unlinkSync(tmp); } catch {} }
}

try {
  // ── 1. 조치 검증 (실제 명령·실제 판정) ────────────────────────────────
  console.log("\n[verify] 조치 검증 — 운영 서버 자신을 점검 대상으로");
  const t = (await (await fetch(`${B}/api/hardening/targets`, {
    method: "POST", headers: H,
    body: JSON.stringify({ label: LABEL, host: "local", port: 22, authMethod: "local", standard: "kisa" }),
  })).json()).target;
  targetId = t?.id;
  ok("점검 대상 등록(local)", Boolean(targetId), `${t?.label}`);

  const a = await (await fetch(`${B}/api/assets`, {
    method: "POST", headers: H,
    body: JSON.stringify({ id: ASSET_ID, name: `${LABEL} 서버`, path: "/tmp/qa-verify", assetType: "server", owner: "보안관제팀" }),
  })).json();
  ok("검증용 자산 등록", a.id === ASSET_ID);

  const can = await (await fetch(`${B}/api/verify/can/${ASSET_ID}`, { headers: H })).json();
  ok("검증 가능 판정(권한·대상 연결)", can.allowed && can.hasTarget, `${can.reason} / ${can.targetLabel}`);

  const injected = injectFindings();
  if (!injected) {
    console.log("  ― 취약점 주입 실패(WSL 미가용) — 판정 시나리오 건너뜀");
  } else {
    ok("취약점 3건 주입", true);
    const run = await (await fetch(`${B}/api/verify/run`, {
      method: "POST", headers: H, body: JSON.stringify({ assetId: ASSET_ID }),
    })).json();
    const find = (frag) => (run.results || []).find((r) => r.title.includes(frag));
    ok("검증 실행", Array.isArray(run.results), JSON.stringify(run.summary || run.error));
    ok("① 기준 이상 → 조치확인(PASS)", find("< 9.6")?.status === "PASS", find("< 9.6")?.evidence?.split("\n").pop());
    ok("① 근거에 실제 명령·출력", /ssh -V/.test(find("< 9.6")?.evidence || "") && /OpenSSH_/.test(find("< 9.6")?.evidence || ""));
    ok("② 기준 미달 → 미조치(FAIL)", find("< 10.0")?.status === "FAIL", find("< 10.0")?.evidence?.split("\n").pop());
    ok("③ 판단 불가 → 수동확인(NA)", find("권한 상승")?.status === "NA");
    ok("요약 집계", run.summary?.fixed === 1 && run.summary?.still === 1 && run.summary?.manual === 1, JSON.stringify(run.summary));

    // 상태 전이 — PASS는 '검증 대기'까지만(자동 완료 금지) + 유령 '완료' 없음
    const { reviews } = await (await fetch(`${B}/api/approvals`, { headers: H })).json();
    const mine = reviews.filter((r) => r.assetId === ASSET_ID);
    ok("PASS는 '검증 대기'까지만(자동 완료 금지)",
      mine.find((r) => r.finding.finding_type.includes("< 9.6"))?.status === "verifying");
    ok("유령 '완료' 없음(고아 행 0)", mine.length === 3 && !mine.some((r) => r.gone), `${mine.length}건`);
  }

  // ── 2. VEX 출력 ───────────────────────────────────────────────────────
  console.log("\n[verify] VEX 내보내기");
  const res = await fetch(`${B}/api/vex/export`, { headers: H });
  const doc = await res.json();
  ok("CycloneDX 1.5 VEX 형식", doc.bomFormat === "CycloneDX" && doc.specVersion === "1.5");
  ok("파일 다운로드 헤더", (res.headers.get("content-disposition") || "").includes("gijo-vex"));
  const states = [...new Set((doc.vulnerabilities || []).map((v) => v.analysis?.state))];
  ok("상태값이 VEX 표준 어휘", states.every((s) => ["under_investigation", "affected", "fixed", "not_affected"].includes(s)), states.join(","));
  const bad = (doc.vulnerabilities || []).filter((v) => v.analysis?.state === "not_affected" && !v.analysis?.justification);
  ok("근거 없는 not_affected 없음(가장 위험한 지점)", bad.length === 0, `${bad.length}건`);
  const sum = await (await fetch(`${B}/api/vex/summary`, { headers: H })).json();
  ok("VEX 요약 조회", typeof sum.total === "number", JSON.stringify(sum.byState));

  // ── 3. 자산 기본 담당자 ────────────────────────────────────────────────
  console.log("\n[verify] 자산 기본 담당자");
  const set1 = await (await fetch(`${B}/api/assets/${ASSET_ID}/default-assignee`, {
    method: "POST", headers: H, body: JSON.stringify({ assignee: "QA담당자" }),
  })).json();
  ok("기본 담당자 지정", set1.defaultAssignee === "QA담당자");
  const set2 = await (await fetch(`${B}/api/assets/${ASSET_ID}/default-assignee`, {
    method: "POST", headers: H, body: JSON.stringify({ assignee: "" }),
  })).json();
  ok("기본 담당자 해제", set2.defaultAssignee === null);
} catch (e) {
  fails++;
  console.log(`  ✗ 예외: ${(e && e.message) || e}`);
} finally {
  // ── 정리 — 검증용 데이터는 전부 회수한다 ────────────────────────────────
  await fetch(`${B}/api/assets/${ASSET_ID}`, { method: "DELETE", headers: H }).catch(() => {});
  const cur = (await (await fetch(`${B}/api/hardening/targets`, { headers: H })).json().catch(() => ({}))).targets || [];
  for (const x of cur.filter((y) => y.label === LABEL || y.id === targetId)) {
    await fetch(`${B}/api/hardening/targets/${x.id}`, { method: "DELETE", headers: H }).catch(() => {});
  }
  const assets = await (await fetch(`${B}/api/assets`, { headers: H })).json().catch(() => []);
  const tg = (await (await fetch(`${B}/api/hardening/targets`, { headers: H })).json().catch(() => ({}))).targets || [];
  ok("검증 데이터 회수(자산·대상)", !assets.some?.((x) => x.id === ASSET_ID) && !tg.some((x) => x.id === targetId));
}

console.log(fails ? `\n[verify] ✗ 실패 ${fails}건` : "\n[verify] ✓ 전부 통과");
process.exit(fails ? 1 : 0);
