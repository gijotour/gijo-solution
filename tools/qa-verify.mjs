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
// 서버 폴더 — 주입 스크립트를 여기서 돌린다(dist/db.js·data/ 가 이 기준). mac처럼 서버가
// 저장소 밖에 있으면 GIJO_SERVER_DIR로 알려준다.
const SERVER_DIR = process.env.GIJO_SERVER_DIR || path.resolve(process.cwd(), "server");
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
//
// ⚠ 드라이버를 직접 열지 않고 **제품 자신의 db 모듈**을 빌려 쓴다(2026-08-09).
//   DB 암호화 이후 일반 better-sqlite3로 열면 "file is not a database"로 죽는다 —
//   잠긴 걸 못 읽는 건데 형식이 틀렸다는 말이 나와 원인을 엉뚱한 데서 찾게 된다.
//   dist/db.js는 봉인 해제까지 끝내고 열어 주므로 열쇠를 여기서 다룰 필요가 없다.
// ⚠ 실패하면 **건너뛰지 않고 실패로 센다.** 예전에는 조용히 넘어가서, Mac에서 이 판정
//   시나리오가 통째로 안 도는데도 QA가 초록불이었다(2026-08-09 Mac 세션 발견).
function injectFindings() {
  const script = `
const {db}=require("./dist/db.js");
const f=[
 {finding_type:"OpenSSH < 9.6 사용자 열거 (CVE-2024-6387)",severity:"high",evidence:"포트: tcp/22",source_tool:"QA",key:"qa-pass",state:"active"},
 {finding_type:"OpenSSH < 10.0 가상 취약점 (CVE-2099-00001)",severity:"medium",evidence:"포트: tcp/22",source_tool:"QA",key:"qa-fail",state:"active"},
 {finding_type:"권한 상승 가능성 있음",severity:"low",evidence:"동작 확인 필요",source_tool:"QA",key:"qa-manual",state:"active"}];
const r=db.prepare("UPDATE assets SET findings=?, lastScannedAt=? WHERE id=?").run(JSON.stringify(f),Date.now(),"${ASSET_ID}");
console.log(JSON.stringify({changed:r.changes,count:f.length}));`;
  // 서버가 어디 있느냐로 갈린다 — Windows는 운영이 WSL 안, mac은 서버가 이 기계에 있다.
  //   mac에서 wsl을 부르면 당연히 없어서 실패하는데, 예전 코드는 그걸 "환경 의존"이라며
  //   건너뛰었다. mac 담당이 판정 시나리오를 통째로 잃고도 몰랐던 이유다.
  // 스크립트는 **서버 폴더 안**에서 돌려야 한다 — ./dist/db.js 상대경로와 data/ 위치가
  // 거기 기준이다.
  const 로컬서버 = process.platform !== "win32";
  const localScript = path.join(SERVER_DIR, "_qa-inject.cjs");
  const tmp = path.join(process.cwd(), ".tmp-reports", "_qa-inject.cjs");
  try {
    let out;
    if (로컬서버) {
      fs.writeFileSync(localScript, script, "utf8");
      out = execFileSync(process.execPath, ["_qa-inject.cjs"], { cwd: SERVER_DIR, encoding: "utf8" });
    } else {
      fs.mkdirSync(path.dirname(tmp), { recursive: true });
      fs.writeFileSync(tmp, script, "utf8");
      const wslPath = tmp.replace(/\\/g, "/").replace(/^([A-Za-z]):/, (_m, d) => `/mnt/${d.toLowerCase()}`);
      out = execFileSync("wsl", ["-d", "Ubuntu-24.04", "--", "bash", "-lc",
        `cp '${wslPath}' /home/gijo/gijo-as/server/_qa.cjs && cd /home/gijo/gijo-as/server && node _qa.cjs; rm -f /home/gijo/gijo-as/server/_qa.cjs`],
        { encoding: "utf8" });
    }
    return { ok: String(out).includes('"count":3'), detail: String(out).trim().slice(-200) };
  } catch (e) {
    const msg = e?.stderr || e?.message || "실행 실패";
    return { ok: false, detail: String(msg).trim().slice(-200) };
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
    try { fs.unlinkSync(localScript); } catch {}
  }
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

  // ⚠ 주입이 실패하면 **실패로 센다.** 아래 판정 6종이 이 주입에 얹혀 있어서, 조용히
  //   건너뛰면 QA가 초록불인데 정작 조치 검증은 한 번도 안 돈 상태가 된다.
  const injected = injectFindings();
  ok("취약점 3건 주입", injected.ok, injected.detail);
  if (injected.ok) {
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
  // ⚠ 조회가 실패하면 빈 배열이 되어 "아무것도 안 남았다"가 **거짓으로 통과**한다(2026-08-09).
  //   회수됐다는 판정은 **실제로 목록을 받아 봤을 때만** 의미가 있다. 못 받았으면 못 받았다고 한다.
  let assets = null, tg = null;
  try { assets = await (await fetch(`${B}/api/assets`, { headers: H })).json(); } catch { /* null로 남긴다 */ }
  try { tg = (await (await fetch(`${B}/api/hardening/targets`, { headers: H })).json())?.targets ?? null; } catch { /* null로 남긴다 */ }
  if (!Array.isArray(assets) || !Array.isArray(tg)) {
    ok("검증 데이터 회수(자산·대상)", false, "목록을 못 받아 회수를 확인하지 못했다 — 남았는지 알 수 없다");
  } else {
    ok("검증 데이터 회수(자산·대상)", !assets.some((x) => x.id === ASSET_ID) && !tg.some((x) => x.id === targetId));
  }
}

console.log(fails ? `\n[verify] ✗ 실패 ${fails}건` : "\n[verify] ✓ 전부 통과");
process.exit(fails ? 1 : 0);
