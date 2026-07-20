// tools/hardening-report-mockups.mjs — 하드닝 리포트 카드 "그룹핑" 시안 3종을 자체완결 HTML로 생성.
// 실 검증 데이터(KISA 11항목)를 그대로 써서 3가지 그룹핑 방식을 비교한다.
import * as fs from "node:fs";
import * as path from "node:path";

const OUT = path.resolve("D:/Connect AI/mockups/device-hardening/variants");
fs.mkdirSync(OUT, { recursive: true });

const ITEMS = [
  { id: "U-01", cat: "계정 관리", title: "root 계정 원격 접속 제한", status: "NA", ev: "SSH 서버(sshd) 미설치 — 원격 접속면 없음" },
  { id: "U-02", cat: "계정 관리", title: "패스워드 복잡성 설정", status: "FAIL", ev: "pam_pwquality 복잡도 미설정", rem: "common-password에 minlen·복잡도 설정" },
  { id: "U-03", cat: "계정 관리", title: "계정 잠금 임계값 설정", status: "FAIL", ev: "로그인 실패 잠금(faillock) 미설정", rem: "deny=5 등 실패 잠금 설정" },
  { id: "U-07", cat: "파일·디렉터리", title: "/etc/passwd 소유자·권한", status: "PASS", ev: "소유자 root, 권한 644" },
  { id: "U-08", cat: "파일·디렉터리", title: "/etc/shadow 소유자·권한", status: "PASS", ev: "소유자 root, 권한 640" },
  { id: "U-44", cat: "계정 관리", title: "UID 0 계정 root뿐", status: "PASS", ev: "UID 0 계정은 root 뿐" },
  { id: "U-46", cat: "계정 관리", title: "패스워드 최소 길이 8자 이상", status: "FAIL", ev: "패스워드 최소 길이 미설정", rem: "PASS_MIN_LEN 8 이상" },
  { id: "U-47", cat: "계정 관리", title: "패스워드 최대 사용기간 90일 이하", status: "FAIL", ev: "PASS_MAX_DAYS=99999", rem: "PASS_MAX_DAYS 90 이하로 설정" },
  { id: "U-48", cat: "계정 관리", title: "패스워드 최소 사용기간 1일 이상", status: "FAIL", ev: "PASS_MIN_DAYS=0", rem: "PASS_MIN_DAYS 1 이상" },
  { id: "U-56", cat: "파일·디렉터리", title: "UMASK 022 이상", status: "PASS", ev: "UMASK=022" },
  { id: "U-72", cat: "로그 관리", title: "시스템 로깅(rsyslog)", status: "PASS", ev: "rsyslog: active" },
];

const MARK = { PASS: "✅ 양호", FAIL: "❌ 취약", WARN: "⚠️ 확인필요", NA: "➖ 해당없음" };
const COLOR = { PASS: "#1eb980", FAIL: "#e2483d", WARN: "#f0a020", NA: "#8b93ab" };
const esc = (s) => String(s == null ? "" : s).replace(/</g, "&lt;");

const HEAD = `<meta charset="utf-8"><style>
:root{--bg:#0a0e1a;--panel:#121a2e;--panel-2:#0e1526;--border:rgba(255,255,255,.08);--border-strong:rgba(255,255,255,.16);--blue:#3b82f6;--blue-light:#5fa1ff;--text:#e7eaf3;--muted:#8b93ab;--muted-2:#5f6785;--red:#e2483d;--amber:#f0a020;--teal:#1eb980;}
*{box-sizing:border-box;margin:0;padding:0;font-family:"Pretendard","Malgun Gothic","Segoe UI",sans-serif;}
body{background:var(--bg);color:var(--text);padding:22px;width:760px;}
.report{background:var(--panel-2);border:1px solid var(--border-strong);border-radius:12px;padding:16px 18px;}
h4{font-size:15px;color:#fff;margin-bottom:3px;}
.meta{font-size:11px;color:var(--muted);margin-bottom:12px;line-height:1.5;}
.sumline{display:flex;gap:14px;align-items:baseline;margin-bottom:14px;flex-wrap:wrap;padding-bottom:12px;border-bottom:1px solid var(--border);}
.score{font-size:26px;font-weight:800;}
.verdict{font-weight:800;}
.tot{color:var(--muted);font-size:12px;}
table{width:100%;border-collapse:collapse;font-size:11.5px;}
td,th{text-align:left;padding:6px 8px;vertical-align:top;}
.st{white-space:nowrap;font-weight:700;}
.ev{color:var(--muted);font-size:11px;}
.badge{font-size:9.5px;font-weight:800;padding:1px 7px;border-radius:5px;}
</style>`;

function counts(items) {
  const c = { PASS: 0, FAIL: 0, WARN: 0, NA: 0 };
  items.forEach((i) => c[i.status]++);
  const scored = items.length - c.NA;
  const rate = scored ? Math.round((c.PASS / scored) * 100) : 0;
  return { ...c, scored, rate };
}
const ALL = counts(ITEMS);
const verdict = ALL.FAIL === 0 ? ["🟢 양호", "#1eb980"] : ALL.FAIL <= 2 ? ["🟡 보통", "#f0a020"] : ["🔴 미흡(다수 취약)", "#e2483d"];

function header() {
  return `<h4>🛡 보안장비 하드닝 점검 리포트</h4>
  <div class="meta">대상: 운영 리눅스 장비 (WSL Ubuntu) · 기준: 국내 CCE — KISA 주요정보통신기반시설 취약점 분석·평가(U-시리즈)<br>점검 방식: 장비 CLI 실 명령 실행·실측 · 0.2초 소요</div>
  <div class="sumline"><span class="score" style="color:${verdict[1]}">${ALL.rate}%</span>
  <span class="verdict" style="color:${verdict[1]}">${verdict[0]}</span>
  <span class="tot">✅ ${ALL.PASS} · ❌ ${ALL.FAIL} · ⚠️ ${ALL.WARN} · ➖ ${ALL.NA} (총 ${ITEMS.length})</span></div>`;
}
const row = (i) => `<tr><td style="width:52px;color:var(--muted-2);font-weight:700">${i.id}</td><td>${esc(i.title)}</td><td class="st" style="color:${COLOR[i.status]};width:88px">${MARK[i.status]}</td><td class="ev">${esc(i.ev)}</td></tr>`;

// ── 시안 A: 분류(카테고리)별 섹션 그룹 — 각 그룹 헤더에 소계 배지 ──────────────
function variantA() {
  const cats = [...new Set(ITEMS.map((i) => i.cat))];
  const groups = cats.map((cat) => {
    const items = ITEMS.filter((i) => i.cat === cat);
    const c = counts(items);
    const bar = c.FAIL > 0 ? "#e2483d" : c.WARN > 0 ? "#f0a020" : "#1eb980";
    const sub = `<span class="badge" style="background:rgba(30,185,128,.15);color:#1eb980">양호 ${c.PASS}</span>${c.FAIL ? `<span class="badge" style="background:rgba(226,72,61,.15);color:#e2483d">취약 ${c.FAIL}</span>` : ""}${c.NA ? `<span class="badge" style="background:rgba(139,147,171,.15);color:#8b93ab">해당없음 ${c.NA}</span>` : ""}`;
    return `<div style="margin-top:14px;border-left:3px solid ${bar};padding-left:12px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px"><span style="font-size:13px;font-weight:800;color:#fff">${cat}</span><span style="color:var(--muted-2);font-size:11px">${items.length}항목</span><span style="margin-left:auto;display:flex;gap:5px">${sub}</span></div>
      <table><tbody>${items.map(row).join("")}</tbody></table></div>`;
  });
  return `<!doctype html><html><head>${HEAD}</head><body><div class="report">${header()}
  <div style="font-size:11px;color:var(--muted-2);font-weight:700;margin-bottom:2px">분류별 점검 결과</div>${groups.join("")}</div></body></html>`;
}

// ── 시안 B: 상태별 우선순위 그룹 — 조치 필요(취약)를 맨 위 강조, 양호/해당없음은 접힌 요약 ─
function variantB() {
  const fails = ITEMS.filter((i) => i.status === "FAIL");
  const warns = ITEMS.filter((i) => i.status === "WARN");
  const pass = ITEMS.filter((i) => i.status === "PASS");
  const na = ITEMS.filter((i) => i.status === "NA");
  const actRow = (i) => `<div style="display:flex;gap:10px;padding:9px 11px;border:1px solid rgba(226,72,61,.3);background:rgba(226,72,61,.06);border-radius:8px;margin-bottom:7px">
    <span style="color:var(--muted-2);font-weight:800;font-size:11px;width:44px">${i.id}</span>
    <div style="flex:1"><div style="font-weight:700;font-size:12.5px;color:#fff">${esc(i.title)}</div>
    <div class="ev" style="margin-top:2px">${esc(i.ev)}</div>
    <div style="color:#8fd6a8;font-size:11px;margin-top:3px">→ ${esc(i.rem || "")}</div></div>
    <span class="st" style="color:${COLOR[i.status]}">${MARK[i.status]}</span></div>`;
  return `<!doctype html><html><head>${HEAD}</head><body><div class="report">${header()}
  <div style="font-size:12.5px;font-weight:800;color:#e2483d;margin-bottom:8px">🚨 조치 필요 (${fails.length + warns.length}건)</div>
  ${[...fails, ...warns].map(actRow).join("")}
  <div style="margin-top:14px;display:flex;gap:10px;flex-wrap:wrap">
    <div style="flex:1;min-width:220px;border:1px solid var(--border);border-radius:8px;padding:10px 12px">
      <div style="font-size:11.5px;font-weight:800;color:#1eb980;margin-bottom:6px">✅ 양호 ${pass.length}건 (기준 충족)</div>
      <div style="font-size:11px;color:var(--muted);line-height:1.7">${pass.map((i) => i.id + " " + i.title).join("<br>")}</div></div>
    <div style="flex:1;min-width:220px;border:1px solid var(--border);border-radius:8px;padding:10px 12px">
      <div style="font-size:11.5px;font-weight:800;color:#8b93ab;margin-bottom:6px">➖ 해당없음 ${na.length}건</div>
      <div style="font-size:11px;color:var(--muted);line-height:1.7">${na.map((i) => i.id + " " + i.title + " — " + i.ev).join("<br>")}</div></div>
  </div></div></body></html>`;
}

// ── 시안 C: 분류별 준수율 요약 바 + 분류 카드 그리드 ─────────────────────────
function variantC() {
  const cats = [...new Set(ITEMS.map((i) => i.cat))].map((cat) => ({ cat, items: ITEMS.filter((i) => i.cat === cat), c: counts(ITEMS.filter((i) => i.cat === cat)) }));
  const bars = cats.map(({ cat, c, items }) => {
    const col = c.FAIL > 0 ? "#e2483d" : "#1eb980";
    return `<div style="margin-bottom:9px"><div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px"><span style="color:#fff;font-weight:700">${cat}</span><span style="color:var(--muted)">${c.rate}% (양호 ${c.PASS}/${c.scored})</span></div>
    <div style="height:7px;background:rgba(255,255,255,.06);border-radius:4px;overflow:hidden"><div style="height:100%;width:${c.rate}%;background:${col}"></div></div></div>`;
  });
  const cards = cats.map(({ cat, items }) => {
    const chip = (i) => `<div style="display:flex;align-items:center;gap:7px;padding:5px 0;border-bottom:1px solid var(--border)"><span style="width:9px;height:9px;border-radius:50%;background:${COLOR[i.status]};flex:0 0 auto"></span><span style="font-size:11px;color:var(--muted-2);font-weight:700;width:42px">${i.id}</span><span style="font-size:11.5px;flex:1">${esc(i.title)}</span><span style="font-size:10.5px;color:${COLOR[i.status]};font-weight:700">${MARK[i.status].split(" ")[1]}</span></div>`;
    return `<div style="border:1px solid var(--border);border-radius:10px;padding:11px 13px"><div style="font-size:12.5px;font-weight:800;color:#fff;margin-bottom:6px">${cat} <span style="color:var(--muted-2);font-weight:600;font-size:11px">${items.length}</span></div>${items.map(chip).join("")}</div>`;
  });
  return `<!doctype html><html><head>${HEAD}</head><body><div class="report">${header()}
  <div style="font-size:11px;color:var(--muted-2);font-weight:700;margin-bottom:8px">분류별 준수율</div>${bars.join("")}
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px">${cards.join("")}</div></div></body></html>`;
}

fs.writeFileSync(path.join(OUT, "variantA-category.html"), variantA());
fs.writeFileSync(path.join(OUT, "variantB-status.html"), variantB());
fs.writeFileSync(path.join(OUT, "variantC-dashboard.html"), variantC());
console.log("생성:", OUT);
console.log(" - variantA-category.html (분류별 섹션 그룹)");
console.log(" - variantB-status.html (상태별 우선순위 그룹)");
console.log(" - variantC-dashboard.html (분류별 준수율 바 + 카드)");
