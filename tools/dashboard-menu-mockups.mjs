// tools/dashboard-menu-mockups.mjs — 대시보드 "담당자 메뉴 영역" 시안 3종.
// 통합 개념: A(역할 자동 큐레이션) + B(담당자가 원하는 메뉴 직접 담기) + C(업무 주기별 배치).
// 세 시안은 같은 개념을 다른 레이아웃으로 보여준다.
import * as fs from "node:fs";
import * as path from "node:path";
const OUT = path.resolve("D:/Connect AI/mockups/dashboard-menu");
fs.mkdirSync(OUT, { recursive: true });

// 보안담당자 역할 기본 큐레이션(업무 주기별). page=이동 대상.
const DAILY = [
  ["보안 분석", "📊", "analysis.html"], ["취약점", "🔎", "vulnscan.html"], ["조치·승인", "✅", "approvals.html"], ["위협 인텔", "🎯", "threat.html"],
];
const WEEKLY = [
  ["자산 목록", "📦", "inventory.html"], ["보안제품", "🧰", "products.html"], ["원격 정기점검", "🛰️", "hardening.html"], ["작업 기록", "📜", "audit.html"], ["터미널", "💻", "terminal.html"],
];
const MONTHLY = [
  ["리포트", "📄", "report.html"], ["컴플라이언스", "📋", "compliance.html"], ["정기 점검", "🔧", "maintenance.html"], ["레드팀·가드레일", "🚨", "redteam.html"],
];
// "메뉴 담기" 후보 — 담당자가 추가로 담을 수 있는 나머지(관리자·고급 포함).
const CATALOG = [
  ["보안 KPI", "📈"], ["작업 세션", "🗂️"], ["AI-BOM", "🤖"], ["에이전트 AI", "🤝"], ["LLM 합성", "⚗️"],
  ["기억·학습(RAG)", "🧠"], ["온톨로지", "🕸️"], ["학습 루프", "🔁"], ["로그", "📃"], ["설정", "⚙️"],
];
const esc = (s) => String(s == null ? "" : s).replace(/</g, "&lt;");

const HEAD = `<meta charset="utf-8"><style>
:root{--bg:#0a0e1a;--panel:#121a2e;--panel-2:#0e1526;--border:rgba(255,255,255,.08);--border-strong:rgba(255,255,255,.16);--blue:#3b82f6;--blue-light:#5fa1ff;--text:#e7eaf3;--muted:#8b93ab;--muted-2:#5f6785;--teal:#1eb980;--amber:#f0a020;}
*{box-sizing:border-box;margin:0;padding:0;font-family:"Pretendard","Malgun Gothic","Segoe UI",sans-serif;}
body{background:#070b14;color:var(--text);padding:20px;width:940px;}
.wrap{background:var(--panel);border:1px solid var(--border);border-radius:14px;padding:16px 18px;}
.top{display:flex;align-items:center;gap:10px;margin-bottom:4px;}
.h{font-size:15px;font-weight:800;color:#fff;}
.role{font-size:10.5px;font-weight:800;padding:2px 9px;border-radius:20px;background:rgba(59,130,246,.15);color:var(--blue-light);}
.sub{font-size:11.5px;color:var(--muted);margin-bottom:14px;}
.editbtn{margin-left:auto;background:transparent;border:1px solid var(--border-strong);color:var(--muted);border-radius:7px;padding:5px 12px;font-size:11.5px;font-weight:700;cursor:pointer;}
.editbtn.on{border-color:var(--blue);color:var(--blue-light);}
.seclabel{font-size:11px;font-weight:800;color:var(--muted-2);letter-spacing:.3px;margin:14px 2px 8px;display:flex;align-items:center;gap:7px;}
.seclabel .cnt{color:var(--muted-2);font-weight:600;}
.grid{display:grid;grid-template-columns:repeat(5,1fr);gap:9px;}
.tile{background:var(--panel-2);border:1px solid var(--border);border-radius:11px;padding:12px 8px;text-align:center;cursor:pointer;position:relative;transition:.14s;}
.tile:hover{border-color:var(--blue);transform:translateY(-2px);}
.tile .ic{font-size:20px;display:block;margin-bottom:6px;}
.tile .lb{font-size:11.5px;font-weight:700;color:#fff;}
.tile.add{border-style:dashed;color:var(--muted);display:flex;flex-direction:column;align-items:center;justify-content:center;}
.tile.add .ic{color:var(--blue-light);}
.tile .x{position:absolute;top:4px;right:6px;width:17px;height:17px;border-radius:50%;background:rgba(226,72,61,.9);color:#fff;font-size:11px;line-height:17px;display:none;}
.wrap.editing .tile .x{display:block;}
.pin{position:absolute;top:5px;right:7px;font-size:12px;color:var(--amber);}
.pill{background:var(--panel-2);border:1px solid var(--border-strong);color:var(--muted);border-radius:18px;padding:6px 14px;font-size:12px;font-weight:700;cursor:pointer;}
.pill.on{background:rgba(59,130,246,.14);border-color:var(--blue);color:var(--blue-light);}
.drawer{margin-top:14px;border-top:1px dashed var(--border-strong);padding-top:12px;}
.dtitle{font-size:11.5px;font-weight:800;color:#fff;margin-bottom:9px;}
.chips{display:flex;flex-wrap:wrap;gap:7px;}
.chip{display:flex;align-items:center;gap:6px;background:var(--panel-2);border:1px solid var(--border-strong);border-radius:8px;padding:6px 11px;font-size:11.5px;font-weight:700;color:var(--text);cursor:pointer;}
.chip .plus{color:var(--teal);font-weight:800;}
.locked{font-size:9.5px;color:var(--muted-2);margin-left:5px;}
</style>`;
const tile = (t, opts = {}) => `<div class="tile">${opts.x ? '<span class="x">×</span>' : ""}${opts.pin ? '<span class="pin">★</span>' : ""}<span class="ic">${t[1]}</span><span class="lb">${esc(t[0])}</span></div>`;
const addTile = `<div class="tile add"><span class="ic">＋</span><span class="lb">메뉴 추가</span></div>`;
const header = (title, sub, editing) => `<div class="top"><span class="h">${title}</span><span class="role">👤 보안담당자</span><button class="editbtn ${editing ? "on" : ""}">✏ ${editing ? "편집 중" : "편집"}</button></div><div class="sub">${sub}</div>`;

// ── 시안 1: 업무 주기 3섹션 + 인라인 편집(C 중심) ──────────────────────────
function v1() {
  const sec = (label, items, addable) => `<div class="seclabel">${label} <span class="cnt">${items.length}</span></div><div class="grid">${items.map((t) => tile(t, { x: true })).join("")}${addable ? addTile : ""}</div>`;
  return `<!doctype html><html><head>${HEAD}</head><body><div class="wrap editing">
  ${header("내 업무 바로가기", "역할에 맞는 메뉴가 업무 주기별로 자동 배치됩니다. ✏편집에서 원하는 메뉴를 추가·제거하세요.", true)}
  ${sec("🔵 오늘 (매일)", DAILY, true)}
  ${sec("🟢 이번 주 (주간)", WEEKLY, true)}
  ${sec("🟡 이번 달 (월간)", MONTHLY, true)}
  </div></body></html>`;
}

// ── 시안 2: 핵심 고정줄 + 내 즐겨찾기 + 메뉴 담기 서랍(B 중심) ───────────────
function v2() {
  const fav = [WEEKLY[2], MONTHLY[0], WEEKLY[4]]; // 담당자가 담은 예시
  return `<!doctype html><html><head>${HEAD}</head><body><div class="wrap">
  ${header("대시보드 메뉴", "핵심 업무는 역할 기본으로 고정되고, ‘내 바로가기’에 원하는 메뉴를 직접 담습니다.", false)}
  <div class="seclabel">⭐ 핵심 업무 <span class="locked">· 역할 기본(고정)</span></div>
  <div class="grid">${DAILY.map((t) => tile(t)).join("")}</div>
  <div class="seclabel">📌 내 바로가기 <span class="cnt">담당자 직접 구성</span></div>
  <div class="grid">${fav.map((t) => tile(t, { pin: true })).join("")}${addTile}</div>
  <div class="drawer"><div class="dtitle">＋ 메뉴 담기 (클릭해 내 바로가기에 추가)</div>
  <div class="chips">${CATALOG.map((t) => `<span class="chip"><span>${t[1]}</span>${esc(t[0])}<span class="plus">＋</span></span>`).join("")}</div></div>
  </div></body></html>`;
}

// ── 시안 3: 주기 탭 전환 + 타일 + '내 메뉴' 탭(compact) ──────────────────────
function v3() {
  return `<!doctype html><html><head>${HEAD}</head><body><div class="wrap">
  ${header("업무 메뉴", "주기 탭으로 전환하고, ‘내 메뉴’ 탭은 담당자가 원하는 대로 구성합니다.", false)}
  <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">
    <span class="pill on">🔵 오늘</span><span class="pill">🟢 주간</span><span class="pill">🟡 월간</span><span class="pill">📌 내 메뉴</span>
    <span class="pill" style="margin-left:auto;border-style:dashed">＋ 메뉴 담기</span>
  </div>
  <div class="grid">${DAILY.map((t) => tile(t)).join("")}</div>
  <div style="margin-top:16px;font-size:11px;color:var(--muted-2)">※ ‘주간/월간/내 메뉴’ 탭을 누르면 해당 타일로 전환. ‘내 메뉴’는 아래 담기에서 자유 구성.</div>
  <div class="drawer"><div class="dtitle">전체 메뉴에서 담기</div>
  <div class="chips">${[...WEEKLY.slice(0,2),...CATALOG.slice(0,6)].map((t) => `<span class="chip"><span>${t[1]}</span>${esc(t[0])}<span class="plus">＋</span></span>`).join("")}</div></div>
  </div></body></html>`;
}

fs.writeFileSync(path.join(OUT, "v1-cadence.html"), v1());
fs.writeFileSync(path.join(OUT, "v2-favorites.html"), v2());
fs.writeFileSync(path.join(OUT, "v3-tabs.html"), v3());
console.log("생성:", OUT);
