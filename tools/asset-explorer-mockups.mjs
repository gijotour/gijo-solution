// tools/asset-explorer-mockups.mjs — 대시보드 자산 탐색기 "선택·등록·터미널 연결" 시안 3종.
import * as fs from "node:fs";
import * as path from "node:path";
const OUT = path.resolve("D:/Connect AI/mockups/asset-explorer");
fs.mkdirSync(OUT, { recursive: true });

const HEAD = `<meta charset="utf-8"><style>
:root{--bg:#0a0e1a;--panel:#121a2e;--panel-2:#0e1526;--border:rgba(255,255,255,.08);--border-strong:rgba(255,255,255,.16);--blue:#3b82f6;--blue-light:#5fa1ff;--text:#e7eaf3;--muted:#8b93ab;--muted-2:#5f6785;--red:#e2483d;--amber:#f0a020;--teal:#1eb980;}
*{box-sizing:border-box;margin:0;padding:0;font-family:"Pretendard","Malgun Gothic","Segoe UI",sans-serif;}
body{background:#070b14;color:var(--text);padding:18px;display:flex;gap:18px;align-items:flex-start;}
.exp{width:250px;background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:12px 10px;flex:0 0 auto;}
.et{display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:800;color:#fff;padding:2px 4px 10px;}
.et .acts{margin-left:auto;display:flex;gap:5px;}
.ic{width:22px;height:22px;border-radius:6px;background:var(--panel-2);border:1px solid var(--border-strong);color:var(--muted);display:flex;align-items:center;justify-content:center;font-size:12px;cursor:pointer;}
.ic.b{color:var(--blue-light);border-color:var(--blue);}
.fold{display:flex;align-items:center;gap:5px;font-size:12px;font-weight:700;color:var(--text);padding:6px 4px;cursor:pointer;}
.fold .cnt{color:var(--muted-2);font-weight:600;font-size:11px;}
.fold .fa{margin-left:auto;display:flex;gap:4px;}
.sub{font-size:10px;font-weight:800;color:var(--muted-2);padding:6px 6px 3px;}
.leaf{display:flex;align-items:center;gap:6px;padding:6px 8px;border-radius:7px;font-size:11.5px;font-weight:600;color:var(--text);cursor:pointer;position:relative;}
.leaf:hover{background:var(--panel-2);}
.leaf .nm{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.b{font-size:9px;font-weight:800;padding:1px 6px;border-radius:4px;}
.b.red{background:rgba(226,72,61,.16);color:#f5928a;}.b.teal{background:rgba(30,185,128,.16);color:var(--teal);}
.mini{display:none;gap:3px;}
.leaf:hover .mini{display:flex;}
.mi{width:19px;height:19px;border-radius:5px;background:var(--panel);border:1px solid var(--border-strong);font-size:10px;display:flex;align-items:center;justify-content:center;color:var(--muted);}
.chk{width:14px;height:14px;border:1px solid var(--border-strong);border-radius:3px;flex:0 0 auto;}
.chk.on{background:var(--blue);border-color:var(--blue);}
.actbar{margin-top:10px;border-top:1px solid var(--border);padding-top:9px;display:flex;flex-wrap:wrap;gap:6px;}
.abtn{background:var(--panel-2);border:1px solid var(--border-strong);color:var(--text);border-radius:7px;padding:5px 9px;font-size:10.5px;font-weight:700;cursor:pointer;}
.abtn.blue{background:var(--blue);border-color:var(--blue);color:#fff;}
.note{font-size:10px;color:var(--muted-2);margin-top:8px;line-height:1.5;}
/* 팝오버/모달 */
.card{width:290px;background:var(--panel-2);border:1px solid var(--blue);border-radius:12px;padding:13px;flex:0 0 auto;}
.card h4{font-size:13px;color:#fff;margin-bottom:8px;display:flex;align-items:center;gap:6px;}
.kv{font-size:11px;color:var(--muted);margin:3px 0;}.kv b{color:var(--text);}
.links{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;}
.links button{background:var(--panel);border:1px solid var(--border-strong);color:var(--text);border-radius:7px;padding:6px 10px;font-size:10.5px;font-weight:700;cursor:pointer;}
.links button.term{background:rgba(30,185,128,.14);border-color:var(--teal);color:var(--teal);}
.field{margin-bottom:8px;}.field label{font-size:10px;color:var(--muted-2);font-weight:700;display:block;margin-bottom:2px;}
.field input,.field select{width:100%;background:var(--panel);border:1px solid var(--border-strong);border-radius:6px;padding:6px 8px;color:var(--text);font-size:11px;}
.title{font-size:11px;font-weight:800;color:var(--muted-2);margin-bottom:8px;}
</style>`;

function tree(opts = {}) {
  const leaf = (nm, badge, extra = "") => `<div class="leaf">${opts.chk ? `<span class="chk ${extra === "on" ? "on" : ""}"></span>` : ""}<span class="nm">${nm}</span>${badge}${opts.mini ? '<span class="mini"><span class="mi" title="터미널 연결">🖥</span><span class="mi" title="상세">⋯</span></span>' : ""}</div>`;
  const foldActs = opts.foldAdd ? '<span class="fa"><span class="ic" title="자산 등록">＋</span></span>' : "";
  return `<div class="fold">▾ AI 자산 <span class="cnt">5</span>${foldActs}</div>
  <div class="sub">◆ AI-BOM 2</div>
  ${leaf("이상거래탐지 AI(FDS)", '<span class="b red">취약점 3</span>')}
  ${leaf("보안 상담 챗봇", '<span class="b teal">정상</span>')}
  <div class="sub">▤ SBOM 3</div>
  ${leaf("fortigate-vpn-01", '<span class="b red">취약점 2</span>', "on")}
  ${leaf("oracle-db-01", '<span class="b teal">정상</span>')}
  ${leaf("cisco-core-01", '<span class="b red">취약점 1</span>')}
  <div class="fold">▸ 보안제품 관리 <span class="cnt">8</span></div>
  <div class="fold">▸ 문서 · 분석</div>`;
}

// 시안 1 — 팝오버 액션 확장 + 폴더 등록 아이콘(최소 변경)
function v1() {
  return `<!doctype html><html><head>${HEAD}</head><body>
  <div class="exp"><div class="et">자산 탐색기<span class="acts"><span class="ic b" title="자산 등록">＋</span><span class="ic" title="새로고침">⟳</span></span></div>${tree({ foldAdd: true })}</div>
  <div class="card"><h4>fortigate-vpn-01 <span class="b red" style="margin-left:auto">취약점 2</span></h4>
    <div class="kv"><b>유형</b> infra-host</div><div class="kv"><b>주소</b> 10.20.0.5:22</div><div class="kv"><b>마지막 스캔</b> 2026-07-20 09:11</div>
    <div class="links"><button class="term">🖥 터미널 연결</button><button>AI-BOM ↗</button><button>취약점 ↗</button><button>재스캔 ▶</button></div>
    <div class="note">자산 클릭 → 상세 팝오버. ‘터미널 연결’은 호스트면 ssh 명령을 미리 채워 터미널로 이동. 폴더 ＋ 또는 상단 ＋로 등록.</div></div>
  </body></html>`;
}
// 시안 2 — 탐색기 상단 툴바 + 자산 호버 미니 액션
function v2() {
  return `<!doctype html><html><head>${HEAD}</head><body>
  <div class="exp"><div class="et">자산 탐색기<span class="acts"><span class="ic b" title="자산 등록">＋ 자산</span></span></div>
  <div class="actbar" style="margin-top:0;border-top:0;padding-top:2px;padding-bottom:8px"><button class="abtn blue">＋ 자산 등록</button><button class="abtn">🖥 터미널</button><button class="abtn">⟳</button></div>
  ${tree({ mini: true })}
  <div class="note">자산에 마우스 올리면 🖥(터미널 연결)·⋯(상세) 미니 버튼 노출 → 바로 실행. 상단 툴바로 등록·터미널.</div></div>
  <div class="card" style="border-color:var(--border-strong)"><div class="title">＋ 자산 등록 (상단 버튼 → 모달)</div>
  <div class="field"><label>이름</label><input value="fortigate-vpn-02"></div>
  <div class="field"><label>유형</label><select><option>infra-host</option><option>LLM 서비스</option><option>분류 모델</option></select></div>
  <div class="field"><label>주소/경로</label><input placeholder="10.20.0.6 또는 models/x.gguf"></div>
  <div class="links"><button style="background:var(--blue);border-color:var(--blue);color:#fff">등록</button><button>취소</button></div></div>
  </body></html>`;
}
// 시안 3 — 선택 모드(체크박스) + 하단 액션바(벌크)
function v3() {
  return `<!doctype html><html><head>${HEAD}</head><body>
  <div class="exp"><div class="et">자산 탐색기<span class="acts"><span class="ic b" title="선택 모드">☑ 선택</span><span class="ic" title="자산 등록">＋</span><span class="ic" title="새로고침">⟳</span></span></div>
  ${tree({ chk: true })}
  <div class="actbar"><span style="font-size:10px;color:var(--muted);align-self:center">선택 1건 —</span><button class="abtn blue">🖥 터미널 연결</button><button class="abtn">▶ 재스캔</button><button class="abtn">🗑 삭제</button></div>
  <div class="note">‘☑ 선택’ 토글 → 자산에 체크박스. 여러 장비 다중 선택 후 하단 액션바로 일괄(터미널·재스캔·삭제). ＋로 등록.</div></div>
  </body></html>`;
}

fs.writeFileSync(path.join(OUT, "v1-popover.html"), v1());
fs.writeFileSync(path.join(OUT, "v2-toolbar.html"), v2());
fs.writeFileSync(path.join(OUT, "v3-select.html"), v3());
console.log("생성:", OUT);
