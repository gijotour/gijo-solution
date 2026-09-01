// 지형도 v2 — 라이브 아티팩트 본문(base.html)에 토큰·범례·CSS·새 구간·푸터를 끼워 넣는다.
// 결과 자리({{…}})는 fill.js가 values.json으로 채운다. 두 번 돌려도 같은 결과(base에서 다시 만든다).
const fs = require('fs');
let h = fs.readFileSync('base.html', 'utf8');
const rep = (a, b, all) => { if (!h.includes(a)) throw new Error('missing: ' + a.slice(0, 60)); h = all ? h.split(a).join(b) : h.replace(a, b); };

rep('--accent:#0f8f86; --git:#b3771a; --good:#2f9455; --warn:#b3771a;', '--accent:#0f8f86; --git:#b3771a; --good:#2f9455; --warn:#b3771a; --client:#b5497a; --bad:#c23b3b;', true);
rep('--accent:#2ec4b9; --git:#e2a745; --good:#5cba7c; --warn:#e2a745;', '--accent:#2ec4b9; --git:#e2a745; --good:#5cba7c; --warn:#e2a745; --client:#e07aa8; --bad:#ef6b6b;', true);

rep('그리고 폰까지 이어주는 클라우드 세션 디렉터리. <b>무엇을 어디서 만들고 어디서 재는가</b>를 그렸다.',
    '그리고 폰까지 이어주는 클라우드 세션 디렉터리 — 여기에 <b>고객사 담당자 PC</b>가 설치본으로 붙는다. <b>무엇을 어디서 만들고 어디서 재는가</b>, 그리고 <b>담당자가 설치부터 로그인·업무 화면까지 무엇을 겪는가</b>(2026-09-01 점검)를 그렸다.');
rep('<span><span class="lg-dot" style="background:var(--gb)"></span>GB10 (DGX Spark)</span>',
    '<span><span class="lg-dot" style="background:var(--gb)"></span>GB10 (DGX Spark)</span>\n      <span><span class="lg-dot" style="background:var(--client)"></span>담당자 PC (설치본)</span>');
rep('<td>Claude 계정</td><td>디렉터리 멤버</td></tr>', '<td>Claude 계정</td><td>디렉터리 멤버 · <span style="color:var(--good)">✓ 2026-09-01 여정 점검 · GB10 코드 검토 · 문서 통독 (origin/main f1bfd98 기준)</span></td></tr>');

rep('  @media print{', `  /* ── 05 고객사 배치 · 06 담당자 여정 · 07 GB10 검토 · 08 문서 통합 (2026-09-01 추가) ── */
  .jr{display:grid; grid-template-columns:repeat(6,1fr); gap:10px}
  @media (max-width:900px){.jr{grid-template-columns:repeat(3,1fr)}}
  @media (max-width:560px){.jr{grid-template-columns:1fr 1fr}}
  .stg{border:1px solid var(--border); border-radius:12px; background:var(--surface); padding:12px 13px; box-shadow:var(--shadow); display:flex; flex-direction:column; gap:6px; min-width:0}
  .stg .st-n{font-family:var(--mono); font-size:.7rem; letter-spacing:.12em; text-transform:uppercase; color:var(--client); font-weight:600}
  .stg .st-t{font-size:.92rem; font-weight:700; line-height:1.25}
  .stg .st-p{display:flex; gap:5px; flex-wrap:wrap}
  .pill{font-family:var(--mono); font-size:.7rem; font-weight:650; padding:2px 7px; border-radius:999px; border:1px solid var(--border); color:var(--muted); background:var(--surface-2); font-variant-numeric:tabular-nums}
  .pill.p0{border-color:var(--bad); color:var(--bad)}
  .pill.p1{border-color:var(--warn); color:var(--warn)}
  .pill.p2{border-color:var(--border); color:var(--muted)}
  .pill.ok{border-color:var(--good); color:var(--good)}
  .stg .st-d{font-size:.8rem; color:var(--ink-soft); line-height:1.45}
  .sev{font-family:var(--mono); font-size:.72rem; font-weight:650}
  .sev.p0{color:var(--bad)} .sev.p1{color:var(--warn)} .sev.p2{color:var(--muted)}
  .note{border:1px solid var(--border); border-left:3px solid var(--accent); border-radius:10px; background:var(--surface-2); padding:13px 15px; font-size:.85rem; color:var(--ink-soft); line-height:1.6}
  .note.warn{border-left-color:var(--warn)} .note.bad{border-left-color:var(--bad)} .note.client{border-left-color:var(--client)}
  .note b{color:var(--ink)}
  .chk{margin:0; padding-left:1.3em; font-size:.86rem; color:var(--ink-soft); display:flex; flex-direction:column; gap:6px}
  .chk li::marker{font-family:var(--mono); color:var(--gb); font-weight:600}
  .facts{list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:8px; font-size:.85rem}
  .facts li{display:grid; grid-template-columns:118px 1fr; gap:10px; align-items:baseline}
  .facts .fk{font-family:var(--mono); font-size:.74rem; color:var(--muted); letter-spacing:.04em}
  .facts a{color:var(--accent); text-decoration:none; border-bottom:1px dotted var(--accent)}
  .kpi{display:grid; grid-template-columns:repeat(4,1fr); gap:12px}
  @media (max-width:760px){.kpi{grid-template-columns:1fr 1fr}}
  .kpi .k{border:1px solid var(--border); border-radius:12px; background:var(--surface); padding:12px 14px; box-shadow:var(--shadow)}
  .kpi .kv{font-family:var(--mono); font-size:1.35rem; font-weight:650; font-variant-numeric:tabular-nums; letter-spacing:-.01em}
  .kpi .kl{font-size:.76rem; color:var(--muted); margin-top:2px}
  .link{color:var(--accent); text-decoration:none; border-bottom:1px dotted var(--accent)}
  @media print{`);

const sections = fs.readFileSync('map_sections.html', 'utf8');
rep('  <div class="foot">', sections + '\n  <div class="foot">');
rep('· GB10(aarch64) · 검증 2026-08-13</span>', '· GB10(aarch64) · 담당자 PC(설치본) · 검증 2026-08-13 · 여정·GB10·문서 점검 2026-09-01</span>');

fs.writeFileSync('지형도_v2.html', h);
const left = (h.match(/\{\{[A-Z0-9_]+\}\}/g) || []);
console.log('ok', h.length, 'placeholders:', [...new Set(left)].join(' '));
