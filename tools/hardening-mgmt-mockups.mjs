// tools/hardening-mgmt-mockups.mjs — 원격 SSH 정기점검 "관리 화면" 시안 3종(자체완결 HTML).
// 대상(장비) 등록 · 정기점검 스케줄 · 이력/추세를 어떻게 배치할지 3가지 레이아웃으로 비교한다.
import * as fs from "node:fs";
import * as path from "node:path";
const OUT = path.resolve("D:/Connect AI/mockups/device-hardening/mgmt-variants");
fs.mkdirSync(OUT, { recursive: true });

// 운영 느낌 샘플 데이터
const TARGETS = [
  { id: "tgt-01", label: "경계 방화벽 (FW-01)", host: "10.10.1.5", port: 22, user: "admin", auth: "key", std: "KISA", rate: 78, fail: 3, trend: [65, 72, 78], next: "내일 02:00", every: "24시간", enabled: true },
  { id: "tgt-02", label: "웹서버 (WEB-02)", host: "10.10.1.20", port: 22, user: "secadmin", auth: "key", std: "CIS", rate: 67, fail: 2, trend: [71, 69, 67], next: "오늘 20:00", every: "12시간", enabled: true, worsening: true },
  { id: "tgt-03", label: "운영 리눅스 (self/local)", host: "local", port: 22, user: "-", auth: "local", std: "KISA", rate: 50, fail: 5, trend: [50, 50, 50], next: "내일 03:00", every: "24시간", enabled: true },
  { id: "tgt-04", label: "DB서버 (DB-03)", host: "10.10.1.30", port: 2222, user: "dba", auth: "password", std: "KISA", rate: null, fail: null, trend: [], next: "미설정", every: "-", enabled: false },
];
const HISTORY = [
  { at: "07-20 09:11", label: "웹서버 (WEB-02)", std: "CIS", rate: 67, fail: 2, src: "scheduled" },
  { at: "07-20 03:00", label: "경계 방화벽 (FW-01)", std: "KISA", rate: 78, fail: 3, src: "scheduled" },
  { at: "07-20 03:00", label: "운영 리눅스 (self/local)", std: "KISA", rate: 50, fail: 5, src: "scheduled" },
  { at: "07-19 20:00", label: "웹서버 (WEB-02)", std: "CIS", rate: 69, fail: 2, src: "scheduled" },
  { at: "07-19 15:22", label: "경계 방화벽 (FW-01)", std: "KISA", rate: 72, fail: 4, src: "manual" },
];
const esc = (s) => String(s == null ? "" : s).replace(/</g, "&lt;");
const rc = (r) => (r == null ? "#8b93ab" : r >= 80 ? "#1eb980" : r >= 60 ? "#f0a020" : "#e2483d");
const authBadge = (a) => ({ key: "🔑 SSH 키", password: "🔒 비밀번호", local: "🖥 로컬" }[a] || a);

function spark(vals, w = 84, h = 24, color = "#5fa1ff") {
  if (!vals.length) return `<span style="color:var(--muted-2);font-size:10px">이력 없음</span>`;
  const min = Math.min(...vals, 0), max = Math.max(...vals, 100);
  const pts = vals.map((v, i) => `${(i / Math.max(1, vals.length - 1)) * w},${h - ((v - min) / (max - min || 1)) * h}`).join(" ");
  return `<svg width="${w}" height="${h}" style="vertical-align:middle"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2"/>${vals.map((v, i) => `<circle cx="${(i / Math.max(1, vals.length - 1)) * w}" cy="${h - ((v - min) / (max - min || 1)) * h}" r="2" fill="${color}"/>`).join("")}</svg>`;
}

const HEAD = `<meta charset="utf-8"><style>
:root{--bg:#0a0e1a;--panel:#121a2e;--panel-2:#0e1526;--border:rgba(255,255,255,.08);--border-strong:rgba(255,255,255,.16);--blue:#3b82f6;--blue-light:#5fa1ff;--text:#e7eaf3;--muted:#8b93ab;--muted-2:#5f6785;--red:#e2483d;--amber:#f0a020;--teal:#1eb980;--purple:#8b7cf0;}
*{box-sizing:border-box;margin:0;padding:0;font-family:"Pretendard","Malgun Gothic","Segoe UI",sans-serif;}
body{background:var(--bg);color:var(--text);padding:22px;width:1000px;}
h2{font-size:19px;color:#fff;margin-bottom:3px;}
.sub{font-size:12px;color:var(--muted);margin-bottom:16px;}
.sec{font-size:13px;font-weight:800;color:#fff;margin:18px 0 9px;display:flex;align-items:center;gap:8px;}
.sec .n{color:var(--muted-2);font-weight:600;font-size:11px;}
.btn{background:var(--blue);color:#fff;border:0;border-radius:7px;padding:7px 13px;font-size:12px;font-weight:800;cursor:pointer;}
.btn.ghost{background:transparent;border:1px solid var(--border-strong);color:var(--muted);}
.btn.sm{padding:4px 9px;font-size:11px;}
.card{background:var(--panel-2);border:1px solid var(--border);border-radius:11px;padding:14px 16px;}
table{width:100%;border-collapse:collapse;font-size:12px;}
th{text-align:left;color:var(--muted-2);font-size:10.5px;font-weight:700;padding:6px 9px;border-bottom:1px solid var(--border);}
td{padding:8px 9px;border-bottom:1px solid var(--border);vertical-align:middle;}
.chip{font-size:10px;font-weight:800;padding:2px 8px;border-radius:5px;}
.chip.std{background:rgba(59,130,246,.15);color:#5fa1ff;}
.chip.on{background:rgba(30,185,128,.15);color:#1eb980;}
.chip.off{background:rgba(139,147,171,.15);color:#8b93ab;}
.chip.warn{background:rgba(226,72,61,.15);color:#e2483d;}
.rate{font-weight:800;}
.dot{width:8px;height:8px;border-radius:50%;display:inline-block;}
.toggle{width:34px;height:19px;border-radius:11px;position:relative;display:inline-block;}
.toggle .k{width:15px;height:15px;border-radius:50%;background:#fff;position:absolute;top:2px;transition:.2s;}
.form{background:var(--panel);border:1px dashed var(--border-strong);border-radius:10px;padding:13px 15px;margin-top:8px;display:grid;grid-template-columns:repeat(4,1fr);gap:9px;}
.form label{font-size:10.5px;color:var(--muted-2);font-weight:700;display:block;margin-bottom:3px;}
.form input,.form select{width:100%;background:var(--panel-2);border:1px solid var(--border-strong);border-radius:6px;padding:6px 8px;color:var(--text);font-size:11.5px;}
.kpi{display:flex;gap:12px;margin-bottom:6px;}
.kpi .k{flex:1;background:var(--panel-2);border:1px solid var(--border);border-radius:11px;padding:12px 15px;}
.kpi .kv{font-size:23px;font-weight:800;}
.kpi .kl{font-size:11px;color:var(--muted);margin-top:2px;}
.tcard{background:var(--panel-2);border:1px solid var(--border);border-radius:11px;padding:13px 15px;}
.tcard.warn{border-color:rgba(226,72,61,.4);}
</style>`;

const toggle = (on) => `<span class="toggle" style="background:${on ? "var(--teal)" : "var(--muted-2)"}"><span class="k" style="${on ? "right:2px" : "left:2px"}"></span></span>`;

// ── 시안 A: 세로 스택 (대상 → 스케줄 → 이력) ──────────────────────────────────
function variantA() {
  const targetRows = TARGETS.map((t) => `<tr>
    <td><b style="color:#fff">${esc(t.label)}</b></td>
    <td style="color:var(--muted);font-family:Consolas,monospace">${t.host}${t.host !== "local" ? ":" + t.port : ""}</td>
    <td>${authBadge(t.auth)}${t.user !== "-" ? ` · ${esc(t.user)}` : ""}</td>
    <td><span class="rate" style="color:${rc(t.rate)}">${t.rate == null ? "—" : t.rate + "%"}</span></td>
    <td><button class="btn sm">점검</button> <button class="btn sm ghost">삭제</button></td></tr>`).join("");
  const schedRows = TARGETS.filter((t) => t.every !== "-").map((t) => `<tr>
    <td><b style="color:#fff">${esc(t.label)}</b></td>
    <td><span class="chip std">${t.std}</span></td>
    <td>${t.every}마다</td>
    <td style="color:var(--muted)">${t.next}</td>
    <td><span class="rate" style="color:${rc(t.rate)}">${t.rate == null ? "—" : t.rate + "%"}</span> ${t.worsening ? '<span class="chip warn">▼ 악화</span>' : ""}</td>
    <td>${toggle(t.enabled)}</td></tr>`).join("");
  const histRows = HISTORY.map((h) => `<tr><td style="color:var(--muted);font-family:Consolas,monospace">${h.at}</td><td>${esc(h.label)}</td><td><span class="chip std">${h.std}</span></td><td><span class="rate" style="color:${rc(h.rate)}">${h.rate}%</span></td><td style="color:#e2483d">취약 ${h.fail}</td><td><span class="chip ${h.src === "scheduled" ? "on" : "off"}">${h.src === "scheduled" ? "정기" : "수동"}</span></td></tr>`).join("");
  return `<!doctype html><html><head>${HEAD}</head><body>
  <h2>🛡 원격 정기점검 관리</h2><div class="sub">보안장비에 SSH로 접속해 하드닝(보안설정)을 주기적으로 자동 점검합니다.</div>
  <div class="sec">🖥 점검 대상 <span class="n">${TARGETS.length}대</span><span style="margin-left:auto"><button class="btn sm">+ 대상 등록</button></span></div>
  <div class="card"><table><thead><tr><th>장비</th><th>주소</th><th>인증</th><th>최근 준수율</th><th>작업</th></tr></thead><tbody>${targetRows}</tbody></table>
  <div class="form"><div><label>장비 이름</label><input placeholder="경계 방화벽 (FW-01)"></div><div><label>호스트/IP</label><input placeholder="10.10.1.5"></div><div><label>포트</label><input value="22"></div><div><label>계정</label><input placeholder="admin"></div>
  <div><label>인증 방식</label><select><option>SSH 키</option><option>비밀번호</option><option>로컬</option></select></div><div style="grid-column:span 2"><label>키 경로 / 비밀번호</label><input placeholder="/keys/id_ed25519"></div><div style="align-self:end"><button class="btn" style="width:100%">등록 + 접속확인</button></div></div></div>
  <div class="sec">⏱ 정기점검 스케줄 <span class="n">활성 3</span><span style="margin-left:auto"><button class="btn sm">+ 스케줄 추가</button></span></div>
  <div class="card"><table><thead><tr><th>대상</th><th>기준</th><th>주기</th><th>다음 점검</th><th>최근 결과</th><th>활성</th></tr></thead><tbody>${schedRows}</tbody></table></div>
  <div class="sec">📜 최근 점검 이력</div>
  <div class="card"><table><thead><tr><th>시각</th><th>대상</th><th>기준</th><th>준수율</th><th>취약</th><th>실행</th></tr></thead><tbody>${histRows}</tbody></table></div>
  </body></html>`;
}

// ── 시안 B: 마스터-디테일 2열 (좌 대상목록 / 우 상세) ─────────────────────────
function variantB() {
  const sel = TARGETS[0];
  const list = TARGETS.map((t, i) => `<div style="display:flex;align-items:center;gap:9px;padding:11px 12px;border-radius:9px;margin-bottom:5px;cursor:pointer;${i === 0 ? "background:rgba(59,130,246,.12);box-shadow:inset 3px 0 0 var(--blue)" : "border:1px solid var(--border)"}">
    <span class="dot" style="background:${t.enabled ? rc(t.rate) : "#5f6785"}"></span>
    <div style="flex:1"><div style="font-weight:700;font-size:12.5px;color:#fff">${esc(t.label)}</div><div style="font-size:10.5px;color:var(--muted);font-family:Consolas,monospace">${t.host}${t.host !== "local" ? ":" + t.port : ""}</div></div>
    <span class="rate" style="color:${rc(t.rate)};font-size:13px">${t.rate == null ? "—" : t.rate + "%"}</span></div>`).join("");
  const hist = HISTORY.filter((h) => h.label === sel.label).concat(HISTORY.filter(h=>h.label===sel.label)).slice(0,4);
  const histLines = [{ at: "07-20 03:00", rate: 78, fail: 3 }, { at: "07-19 15:22", rate: 72, fail: 4 }, { at: "07-18 03:00", rate: 65, fail: 6 }]
    .map((h) => `<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--border);font-size:12px"><span style="color:var(--muted);font-family:Consolas,monospace">${h.at}</span><span><span class="rate" style="color:${rc(h.rate)}">${h.rate}%</span> <span style="color:#e2483d;font-size:11px">취약 ${h.fail}</span></span></div>`).join("");
  return `<!doctype html><html><head>${HEAD}</head><body>
  <h2>🛡 원격 정기점검 관리</h2><div class="sub">왼쪽에서 장비를 고르면 오른쪽에 스케줄·추세·이력이 나옵니다.</div>
  <div style="display:grid;grid-template-columns:320px 1fr;gap:16px">
    <div><div class="sec">🖥 점검 대상 <span class="n">${TARGETS.length}</span></div><div class="card" style="padding:9px">${list}<button class="btn ghost sm" style="width:100%;margin-top:6px">+ 대상 등록</button></div></div>
    <div><div class="sec">${esc(sel.label)} <span class="chip std" style="margin-left:4px">${sel.std}</span></div>
      <div class="card">
        <div style="display:flex;gap:20px;align-items:center;margin-bottom:14px;padding-bottom:14px;border-bottom:1px solid var(--border)">
          <div><div style="font-size:34px;font-weight:800;color:${rc(sel.rate)}">${sel.rate}%</div><div style="font-size:11px;color:var(--muted)">현재 준수율 · 취약 ${sel.fail}건</div></div>
          <div style="flex:1"><div style="font-size:11px;color:var(--muted-2);font-weight:700;margin-bottom:4px">준수율 추세</div>${spark(sel.trend, 200, 42, "#1eb980")}<div style="font-size:10.5px;color:#1eb980;margin-top:3px">▲ 65% → 78% (개선 중)</div></div>
        </div>
        <div style="display:flex;gap:20px;font-size:12px;flex-wrap:wrap">
          <div><div style="color:var(--muted-2);font-size:10.5px">접속</div><div style="font-family:Consolas,monospace">${sel.host}:${sel.port} · ${sel.user}</div></div>
          <div><div style="color:var(--muted-2);font-size:10.5px">인증</div><div>${authBadge(sel.auth)}</div></div>
          <div><div style="color:var(--muted-2);font-size:10.5px">주기</div><div>${sel.every}마다 ${toggle(sel.enabled)}</div></div>
          <div><div style="color:var(--muted-2);font-size:10.5px">다음 점검</div><div>${sel.next}</div></div>
          <div style="align-self:center;margin-left:auto"><button class="btn sm">지금 점검</button></div>
        </div>
      </div>
      <div class="sec" style="font-size:12px">📜 점검 이력</div><div class="card">${histLines}</div>
    </div>
  </div></body></html>`;
}

// ── 시안 C: 대시보드 카드형 (KPI + 대상 카드 그리드) ─────────────────────────
function variantC() {
  const avg = Math.round(TARGETS.filter((t) => t.rate != null).reduce((s, t) => s + t.rate, 0) / TARGETS.filter((t) => t.rate != null).length);
  const cards = TARGETS.map((t) => `<div class="tcard ${t.worsening ? "warn" : ""}">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><span class="dot" style="background:${t.enabled ? rc(t.rate) : "#5f6785"}"></span><b style="color:#fff;font-size:13px;flex:1">${esc(t.label)}</b><span class="chip std">${t.std}</span></div>
    <div style="display:flex;align-items:flex-end;gap:10px;margin-bottom:8px"><div style="font-size:28px;font-weight:800;color:${rc(t.rate)}">${t.rate == null ? "—" : t.rate + "%"}</div><div style="flex:1;text-align:right">${spark(t.trend)}</div></div>
    <div style="display:flex;justify-content:space-between;font-size:10.5px;color:var(--muted);border-top:1px solid var(--border);padding-top:7px">
      <span>${t.host === "local" ? "🖥 로컬" : t.host + ":" + t.port}</span>
      <span>${t.every !== "-" ? "⏱ " + t.every + " · " + t.next : "미설정"}</span></div>
    ${t.worsening ? '<div style="margin-top:6px;font-size:10.5px;color:#e2483d;font-weight:700">▼ 지난 점검 대비 악화 — 확인 필요</div>' : ""}
    <div style="margin-top:8px;display:flex;gap:6px">${toggle(t.enabled)}<span style="font-size:10.5px;color:var(--muted);align-self:center">정기점검 ${t.enabled ? "켜짐" : "꺼짐"}</span><button class="btn sm" style="margin-left:auto">점검</button></div>
  </div>`).join("");
  return `<!doctype html><html><head>${HEAD}</head><body>
  <h2>🛡 원격 정기점검 관제</h2><div class="sub">등록된 보안장비의 하드닝 준수율·추세·다음 점검을 한 화면에서 관제합니다.</div>
  <div class="kpi">
    <div class="k"><div class="kv" style="color:#fff">${TARGETS.length}</div><div class="kl">등록 장비</div></div>
    <div class="k"><div class="kv" style="color:#1eb980">${TARGETS.filter((t) => t.enabled).length}</div><div class="kl">활성 스케줄</div></div>
    <div class="k"><div class="kv" style="color:${rc(avg)}">${avg}%</div><div class="kl">평균 준수율</div></div>
    <div class="k" style="border-color:rgba(226,72,61,.4)"><div class="kv" style="color:#e2483d">1</div><div class="kl">악화 경고</div></div>
  </div>
  <div class="sec">🖥 장비별 현황 <span style="margin-left:auto"><button class="btn sm">+ 대상 등록</button></span></div>
  <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px">${cards}</div>
  </body></html>`;
}

fs.writeFileSync(path.join(OUT, "mgmtA-stack.html"), variantA());
fs.writeFileSync(path.join(OUT, "mgmtB-master-detail.html"), variantB());
fs.writeFileSync(path.join(OUT, "mgmtC-dashboard.html"), variantC());
console.log("생성:", OUT);
