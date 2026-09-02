// 지형도 v2 — base(08-13 라이브 본문)에 splice.js 규칙으로 새 구간을 끼운 뒤, values.json으로 {{자리}}를 채운다.
// 사용: node fill.js            → 지형도_v2.html 생성(자리 남으면 목록 출력, 종료코드 1)
//       node fill.js --check    → 남은 자리만 확인
// 두 번 돌려도 같은 결과(항상 base에서 다시 만든다). 파일은 전부 이 폴더 기준.
const fs = require('fs');
const path = require('path');
const here = __dirname;
const rd = (f) => fs.readFileSync(path.join(here, f), 'utf8').replace(/\r\n/g, '\n');

// 1) splice.js는 'base.html'·'map_sections.html'을 cwd에서 읽고 '지형도_v2.html'을 쓴다 — 임시로 이름을 맞춰 준다.
const tmpBase = path.join(here, 'base.html');
fs.writeFileSync(tmpBase, rd('지형도_base_2026-08-13.html'));
process.chdir(here);
try {
  require('./splice.js');
} finally {
  fs.unlinkSync(tmpBase);
}

// 2) 자리 채우기
let h = rd('지형도_v2.html');
const values = fs.existsSync(path.join(here, 'values.json')) ? JSON.parse(rd('values.json')) : {};
for (const [k, v] of Object.entries(values)) {
  const token = '{{' + k + '}}';
  if (!h.includes(token)) { console.warn('경고: 자리 없음 —', k); continue; }
  h = h.split(token).join(Array.isArray(v) ? v.join('\n') : String(v));
}
fs.writeFileSync(path.join(here, '지형도_v2.html'), h);

const left = [...new Set(h.match(/\{\{[A-Z0-9_]+\}\}/g) || [])];
console.log('지형도_v2.html', h.length, 'bytes · 남은 자리:', left.length ? left.join(' ') : '없음');
if (left.length) process.exitCode = 1;
