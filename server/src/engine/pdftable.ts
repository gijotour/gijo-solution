// engine/pdftable.ts — **PDF에 그려진 표(테두리 격자)를 파이프 표로 되살린다** (2026-09-09, 갈래 T의 PDF 확장)
//
// ■ 왜 (정찰·설계관 실측 2026-09-08~09)
//   지식 조각의 57%가 PDF에서 온다. 그런데 PDF에는 「표」라는 구조가 없다 — 글자와 선이 좌표에
//   흩어져 있을 뿐이다. 그래서 4열 머리글이 8줄로 쪼개지고 쪽번호가 끼어들어, 「어느 칸이 무슨
//   열인가」가 통째로 사라졌다. 2026-09-08에 오피스(docx·pptx) 표를 되살렸고, 이 파일이 그 PDF판이다.
//
// ■ 왜 「그려진 테두리」인가 — **좌표 군집을 버린 이유**
//   같은 y를 한 행으로, x 간격을 열로 묶는 좌표 군집은 2026-09-08 실측에서 **표 후보 15개 중 6개가
//   오탐**이었다(이모지 칸·세 낱말 표제·①②③ 카드·ASCII 도해). 글이 나란히 놓였다는 사실만으로는
//   표와 카드를 가를 수 없기 때문이다. 반면 **테두리는 만든 사람이 「이건 표다」라고 그은 선**이다.
//   한국 업무 문서(워드·한글·파워포인트 → PDF)는 표 테두리를 실제로 그린다 — 저장소 PDF 10편에서
//   격자 73개가 나왔고 전부 참 표였다.
//   ★ 그래서 이 파일은 **격자 밖 글에 좌표 군집을 절대 쓰지 않는다.** 격자가 없으면 아무것도 안 한다.
//
// ■ 이번에 **안 하는 것**(정직하게 적는다 — 나중에 「PDF 표는 다 된다」고 읽히면 거짓이 된다)
//   · 테두리 없는 표(배경색만·탭 정렬만) — 격자가 없어 **원리상** 못 잡는다.
//   · 회전한 쪽(page.rotate≠0)·기울어진 글자 — 코퍼스에 0건이라 **못 쟀다.** 만나면 포기한다.
//   · 쪽을 넘어가는 표 이어붙이기 — **판별할 방법이 없어서** 안 한다.
//     ⚠ 처음엔 「유일한 실측 사례 1건」이라 적었는데 **틀렸다**(2026-09-09 검토관 적발 · 전수 재측정).
//       머리글이 두 번 이상 되풀이되는 표는 10편 중 4편에 있고, 사이에 쪽 바닥글만 낀 **쪽 넘김
//       후보가 5건**이다(사용자_매뉴얼 p10→p11 22+6행 · 제품소개 「레이어/기술/역할」16+3 ·
//       「완료한 것/내용」1+5 · 「파일/화면/보이는 실측 데이터」6+6 · 제안자료 「지표/합격선」2+6).
//     그런데 **같은 머리글이 반복되는 별개 표**도 실재한다 — 시장경쟁분석의 「대표 제품/성격」은
//     ×5인데 사이사이에 본문 문단이 3~4줄씩 들어 있는 **다섯 개의 다른 표**다. 머리글이 같다는
//     사실만으로 이으면 그 다섯이 한 표로 뭉친다. 「사이에 쪽 바닥글만 있나」로 가르려면 바닥글이
//     무엇인지 또 추측해야 하고, 그 추측이 틀리면 **없던 표를 만든다**(오탐 0 계약과 정면충돌).
//     원본이 머리글을 다시 그려 주므로 쪽마다 따로 내도 뒤 조각이 머리글을 잃지 않는다. 그래서 안 잇는다.
//   · 스캔 PDF(글자 없음 → OCR) — scripts/extract_doc.py 갈래에는 표 복원이 없다. 종전 그대로다.
//
// ■ 오탐 0을 지탱하는 가드는 **딱 둘**이다 (실측으로 갈래가 갈린다 — 짝 시험이 이 둘을 잰다)
//   ① **칠하지 않는 경로(endPath)를 세지 않는다.** 클립용 사각형은 눈에 안 보이는데 좌표는 표처럼
//      생겼다. 세면 오탐이 난다(픽스처의 「클립 전용 격자」가 이 갈래를 가른다).
//   ② **두꺼운 상자는 선이 아니다.** 카드·배경 상자를 「테두리 선 4개」로 읽으면 카드 묶음이 표가
//      된다 — 실측: 제안서.pdf(카드만 있는 16쪽)에서 **오탐 0 → 4**로 뛴다(p7·8·9·10의 3×3 카드).
//   ⚠ 반대로 THIN·TOL·MINLEN 같은 **숫자를 흔들어도 우리 10편에서는 결과가 안 바뀐다**(실측).
//     즉 그 값들로는 반증 시험을 못 만든다 — 「느슨하게 했더니 초록」을 「가드가 튼튼하다」로 읽지 말 것.
//
// ⚠ 파이프 표를 **여기서 새로 짜지 않는다** — dataset.ts의 파이프표()·칸글()을 그대로 쓴다.
//   두 벌이 되면 열 수 맞춤·파이프 이스케이프·구분선 규격이 갈리고, 그 순간 memory.ts의 표 술어가
//   한쪽을 표로 안 읽는다(같은 것을 여러 곳에 적으면 어긋난다).
// ⚠ 「무엇이 표인가」의 판정은 memory.ts:752-806 한 곳이다. 이 파일은 규격에 맞춰 **내기만** 한다.
import { 파이프표, 칸글 } from "./dataset";

/** 이보다 얇으면 「선」으로 본다(pt). 표 테두리는 보통 0.5~2pt다. ⚠ 이 값을 키워도 우리 10편에서는
 *  결과가 안 바뀐다 — 가드는 이 숫자가 아니라 **「두꺼우면 버린다」는 갈래 자체**다(위 ②). */
const 얇음 = 3;
/** 이보다 짧은 선은 표 테두리로 안 본다(pt) — 글머리 기호·밑줄 조각을 거른다. */
const 최소길이 = 8;
/** 좌표를 같은 줄로 붙이는 오차(pt). 같은 테두리를 두 번 그린 PDF가 흔하다. */
const 오차 = 2;
/** 쪽당 선분 상한 — 격자 묶기가 O(가로×세로)라 도해가 잔뜩 든 쪽에서 폭주하지 않게 끊는다.
 *  실측 최대 172부분경로/쪽이라 한참 여유가 있다. 넘으면 그 쪽은 **포기**(종전 흐름). */
const 쪽당_선분_상한 = 2000;
/** 표 최소 크기 — 머리글 1행 + 본문 1행 이상, 2열 이상. 1열짜리는 표가 아니라 테두리 상자다. */
const 최소행 = 2;
const 최소열 = 2;

type 선분 = { 가로: boolean; 부터: number; 까지: number; 자리: number };
type 격자 = { xs: number[]; ys: number[] };
type 글자항목 = { str: string; hasEOL: boolean; transform: number[]; width: number };

/** pdf.js 경로 연산자(DrawOPS) — pdf.js가 이 enum을 **export하지 않아** 숫자를 직접 쓴다
 *  (실측: getResolvedPDFJS().DrawOPS === undefined). 0=moveTo(2) 1=lineTo(2) 2=curveTo(6) 4=closePath(0). */
const 그리기_이동 = 0, 그리기_직선 = 1, 그리기_곡선 = 2;

/** 행렬 곱 — pdf.js의 transform은 **현재 행렬에 오른쪽으로** 곱한다(ctm = ctm × m). */
function 행렬곱(a: number[], b: number[]): number[] {
  return [
    a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}
const 점옮기기 = (m: number[], x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** 한 쪽의 **테두리 선분**을 모은다.
 *
 *  ⚠ **CTM(현재 변환 행렬)을 추적하지 않으면 좌표가 통째로 틀린다.** 우리 PDF는 내용 스트림
 *    첫 줄이 transform(0.24,0,0,-0.24,0,842.88)이라, 추적 없이 읽으면 595pt 쪽에서 좌표가
 *    2329×3319로 나온다(실측). save/restore/transform을 다 봐야 한다.
 *  ⚠ **OPS.rectangle·moveTo·lineTo는 우리 PDF 10편에서 0회다** — 전부 constructPath 한 갈래로 온다.
 *  ⚠ constructPath의 인자는 [칠하기연산, 부분경로: Float32Array[], 경계상자: Float32Array(4)]다.
 *    부분경로를 평평한 배열로 읽으면 **0개가 잡힌다**(설계관이 실제로 밟은 함정).
 *    경계상자는 **CTM 적용 전** 값이라 그대로 쓰면 안 된다 — 그래서 점을 직접 옮긴다.
 */
async function 쪽선분들(page: { getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[] }> }, OPS: Record<string, number>): Promise<선분[] | null> {
  const ol = await page.getOperatorList();
  let ctm = [1, 0, 0, 1, 0, 0];
  const 쌓기: number[][] = [];
  const 선분들: 선분[] = [];
  for (let i = 0; i < ol.fnArray.length; i += 1) {
    const fn = ol.fnArray[i];
    if (fn === OPS.save) { 쌓기.push(ctm.slice()); continue; }
    if (fn === OPS.restore) { ctm = 쌓기.pop() ?? [1, 0, 0, 1, 0, 0]; continue; }
    if (fn === OPS.transform) { ctm = 행렬곱(ctm, ol.argsArray[i] as number[]); continue; }
    if (fn !== OPS.constructPath) continue;
    const args = ol.argsArray[i] as [number, ArrayLike<number>[], unknown];
    // ★ 가드① — **칠하지 않는 경로는 테두리가 아니다.** endPath(28)는 클립 전용이라 눈에 안 보이는데
    //   좌표는 표처럼 생겼다. 여기를 열면 오탐이 난다(짝 시험 「클립 전용 격자」가 이 줄을 잰다).
    const 칠하기 = args[0];
    if (칠하기 !== OPS.stroke && 칠하기 !== OPS.fill && 칠하기 !== OPS.eoFill && 칠하기 !== OPS.fillStroke) continue;
    const 부분경로들 = args[1];
    if (!Array.isArray(부분경로들)) continue;
    for (const sp of 부분경로들) {
      if (선분들.length > 쪽당_선분_상한) return null; // 폭주 — 이 쪽은 포기한다
      let 최소x = Infinity, 최대x = -Infinity, 최소y = Infinity, 최대y = -Infinity, 점수 = 0;
      for (let k = 0; k < sp.length;) {
        const op = sp[k];
        let x: number, y: number;
        if (op === 그리기_이동 || op === 그리기_직선) { [x, y] = 점옮기기(ctm, sp[k + 1], sp[k + 2]); k += 3; }
        else if (op === 그리기_곡선) { [x, y] = 점옮기기(ctm, sp[k + 5], sp[k + 6]); k += 7; }
        else { k += 1; continue; } // closePath 등 — 좌표 없음
        점수 += 1;
        if (x < 최소x) 최소x = x; if (x > 최대x) 최대x = x;
        if (y < 최소y) 최소y = y; if (y > 최대y) 최대y = y;
      }
      if (점수 < 2) continue;
      const 폭 = 최대x - 최소x, 높이 = 최대y - 최소y;
      // ★ 가드② — **두꺼운 상자는 선이 아니다.** 여기서 「else 4변으로 쪼갠다」를 넣으면 카드가
      //   표가 된다(실측: 제안서.pdf 오탐 0 → 4). 짝 시험 「두꺼운 카드 상자」가 이 갈래를 잰다.
      if (폭 >= 최소길이 && 높이 <= 얇음) 선분들.push({ 가로: true, 부터: 최소x, 까지: 최대x, 자리: (최소y + 최대y) / 2 });
      else if (높이 >= 최소길이 && 폭 <= 얇음) 선분들.push({ 가로: false, 부터: 최소y, 까지: 최대y, 자리: (최소x + 최대x) / 2 });
      // 그 밖(두꺼운 상자·짧은 조각)은 **버린다**.
    }
  }
  return 선분들;
}

/** 가까운 좌표를 하나로 접는다 — 같은 테두리를 두 번 그린 PDF가 흔하다. */
function 좌표접기(값들: number[]): number[] {
  const 정렬 = [...값들].sort((a, b) => a - b);
  const 결과: number[] = [];
  for (const v of 정렬) if (!결과.length || v - 결과[결과.length - 1] > 오차) 결과.push(v);
  return 결과;
}

/** 교차하는 가로·세로선을 **연결성분**으로 묶어 격자를 만든다.
 *  한 표의 테두리는 서로 닿아 있으므로 자연히 한 덩어리가 되고, 떨어진 두 표는 갈린다. */
function 격자들(선분들: 선분[]): 격자[] {
  const 가로들 = 선분들.filter((s) => s.가로);
  const 세로들 = 선분들.filter((s) => !s.가로);
  const H = 가로들.length;
  const 이웃 = new Map<number, number[]>();
  const 잇기 = (a: number, b: number) => {
    if (!이웃.has(a)) 이웃.set(a, []);
    (이웃.get(a) as number[]).push(b);
  };
  for (let i = 0; i < 가로들.length; i += 1) {
    for (let j = 0; j < 세로들.length; j += 1) {
      const h = 가로들[i], v = 세로들[j];
      if (v.자리 >= h.부터 - 오차 && v.자리 <= h.까지 + 오차 && h.자리 >= v.부터 - 오차 && h.자리 <= v.까지 + 오차) { 잇기(i, H + j); 잇기(H + j, i); }
    }
  }
  const 본것 = new Set<number>();
  const 결과: 격자[] = [];
  for (let s = 0; s < H + 세로들.length; s += 1) {
    if (본것.has(s) || !이웃.has(s)) continue;
    const 대기 = [s]; 본것.add(s);
    const 덩어리: number[] = [];
    while (대기.length) {
      const c = 대기.pop() as number;
      덩어리.push(c);
      for (const n of 이웃.get(c) ?? []) if (!본것.has(n)) { 본것.add(n); 대기.push(n); }
    }
    const xs = 좌표접기(덩어리.filter((c) => c >= H).map((c) => 세로들[c - H].자리));
    const ys = 좌표접기(덩어리.filter((c) => c < H).map((c) => 가로들[c].자리));
    if (xs.length - 1 >= 최소열 && ys.length - 1 >= 최소행) 결과.push({ xs, ys });
  }
  return 결과;
}

/** 격자 안 글자 항목을 칸에 배정해 **행 배열**로 만든다. 배정 못 한 항목이 하나라도 있으면 포기한다.
 *  ⚠ 여러 줄 셀은 **셀 안이라 자연히 한 칸**이 된다 — 그게 이 방식을 고른 이유다.
 *  ⚠ 셀 안에서 항목을 이을 때 `join("")`으로 두면 **줄바꿈에서 낱말이 붙는다**(실측: 「다시」+「켠다」
 *    → 「다시켠다」 6낱말). hasEOL이면 공백을 넣는다 — 이 한 줄이 「낱말 손실 0」의 전부다. */
function 칸에담기(g: 격자, 항목들: 글자항목[], 색인들: number[]): string[][] | null {
  const 행수 = g.ys.length - 1, 열수 = g.xs.length - 1;
  const 칸: string[][] = Array.from({ length: 행수 }, () => Array.from({ length: 열수 }, () => ""));
  for (const i of 색인들) {
    const it = 항목들[i];
    // **회전한 글자**(transform[1]≠0)는 좌표를 믿을 수 없다 — 글이 세로로 흐르면 width가 가로가
    //   아니어서 x+width/2가 엉뚱한 열을 가리킨다. 코퍼스에 0건이라 **못 쟀으므로** 포기한다.
    //   ⚠ **기울임꼴(transform[2]≠0)은 막지 않는다.** 그건 가로 기울이기(shear)라 글줄과 진행
    //     방향이 그대로 가로다. 처음엔 함께 막았는데, 제품소개.pdf p4의 **빈 기울임 항목 하나**가
    //     6행4열 참 표를 통째로 죽였다(실측 2026-09-09: 표 18→17). 확인한 것만 막는다.
    if (it.transform[1] !== 0) return null;
    const cx = it.transform[4] + (it.width || 0) / 2;
    const cy = it.transform[5];
    let 열 = -1, 행 = -1;
    for (let c = 0; c < 열수; c += 1) if (cx >= g.xs[c] - 오차 && cx <= g.xs[c + 1] + 오차) { 열 = c; break; }
    // ys는 아래에서 위로 정렬돼 있다(PDF 좌표) — 화면 행 번호는 뒤집어야 한다.
    for (let r = 0; r < 행수; r += 1) if (cy >= g.ys[r] - 오차 && cy <= g.ys[r + 1] + 오차) { 행 = 행수 - 1 - r; break; }
    if (열 < 0 || 행 < 0) return null; // 격자 안인 줄 알았는데 칸을 못 찾았다 — 확신이 없으면 포기
    칸[행][열] += it.str + (it.hasEOL ? " " : "");
  }
  return 칸.map((r) => r.map(칸글));
}

/** 이 항목이 격자 **안**에 있나 — 경계에 걸친 글자(테두리에 물린 제목)까지 포함하도록 오차를 준다. */
const 격자안 = (g: 격자, it: 글자항목) => {
  const cx = it.transform[4] + (it.width || 0) / 2, cy = it.transform[5];
  return cx >= g.xs[0] - 오차 && cx <= g.xs[g.xs.length - 1] + 오차 && cy >= g.ys[0] - 오차 && cy <= g.ys[g.ys.length - 1] + 오차;
};

/** 한 쪽을 조립한다 — 표 구간은 통째로 빼고 그 자리에 파이프 표를 끼운다(**순서 보존**).
 *  실측: 저장소 PDF 10편의 격자 73개가 **전부** 항목 순서에서 연속 구간이었다. 연속이 아니면
 *  그 표는 포기한다(글이 뒤섞이는 쪽이 표를 얻는 것보다 나쁘다). */
export function 쪽조립(항목들: 글자항목[], 격자목록: 격자[]): string {
  const 소속 = new Array<number>(항목들.length).fill(-1);
  const 표글: (string | null)[] = [];
  for (let gi = 0; gi < 격자목록.length; gi += 1) {
    const g = 격자목록[gi];
    const 색인들: number[] = [];
    // ⚠ **빈 항목(str="")도 구간에 넣는다.** pdf.js는 줄바꿈 자리에 폭 0짜리 빈 항목을 끼우는데,
    //   그걸 빼면 색인이 33,35,37…로 **띄엄띄엄해져 연속 구간 판정이 통째로 실패한다**
    //   (실측 2026-09-09: 이것 때문에 격자 73개가 전부 포기됐다 — 표 0개). 빈 항목은 칸글()이
    //   어차피 접어 버리므로 담아도 글이 안 바뀐다.
    for (let i = 0; i < 항목들.length; i += 1) if (소속[i] === -1 && 격자안(g, 항목들[i])) 색인들.push(i);
    // 글자가 하나도 없는 격자(빈 표·자리잡기 테두리)는 지식이 아니다.
    if (!색인들.some((i) => 항목들[i].str.trim() !== "")) { 표글.push(null); continue; }
    // 연속 구간이 아니면 빼낼 수 없다 — 포기하고 종전 흐름에 맡긴다.
    if (색인들[색인들.length - 1] - 색인들[0] + 1 !== 색인들.length) { 표글.push(null); continue; }
    const 행들 = 칸에담기(g, 항목들, 색인들);
    const 글 = 행들 ? 파이프표(행들) : "";
    if (!글) { 표글.push(null); continue; }
    for (const i of 색인들) 소속[i] = gi;
    표글.push(글);
  }
  let 결과 = "";
  for (let i = 0; i < 항목들.length; i += 1) {
    const gi = 소속[i];
    if (gi === -1) { 결과 += 항목들[i].str + (항목들[i].hasEOL ? "\n" : ""); continue; }
    // 구간의 첫 항목 자리에 표를 한 번만 끼운다.
    if (i === 0 || 소속[i - 1] !== gi) 결과 += `\n\n${표글[gi] as string}\n\n`;
  }
  return 결과;
}

/** unpdf/pdf.js가 쪽 글을 잇는 방식 그대로 — **표 없는 PDF가 글자 하나까지 같아야** 한다.
 *  원천: unpdf dist/index.mjs getPageText + normalizeMergedText(1.8.1). 여기를 손대면 회귀 골든이 빨개진다. */
export const 쪽들잇기 = (쪽글들: string[]): string =>
  쪽글들.join("\n").replace(/[^\S\n]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n");

/** ★ **Node 20에서 getOperatorList가 통째로 죽는다** — 반드시 읽을 것 (2026-09-09 WSL 실측).
 *
 *  증상: pdf.js가 글꼴 정보를 담을 때 `ArrayBuffer.prototype.transferToFixedLength`(ES2024)를 쓰는데
 *  **Node 20에는 그 메서드가 없다.** 그런데 pdf.js는 이 오류를 **삼킨다** —
 *  「getOperatorList - ignoring errors …」 경고만 내고 **빈 연산자 목록**을 준다.
 *  그래서 겉으로는 아무 일도 안 일어난 것처럼 보이고, 표만 조용히 하나도 안 나온다.
 *
 *  ⚠ **이것이 왜 치명적인가**: 개발하는 `win`은 Node 24라 **전부 초록**이었다(표 73개 실측).
 *    그런데 **제품이 도는 WSL 운영 서버는 Node 20**이라 거기서는 기능이 **통째로 죽어 있었다.**
 *    「제품이 도는 환경에서 잰다」가 없었으면 이 상태로 게시됐다 — 시험도 Windows에서 돌렸으면
 *    초록이었다. 고객 환경(라이트 WSL 이미지·mac 올인원)도 Node 판본을 우리가 못 고른다.
 *
 *  그래서 **없을 때만** 채워 넣는다. 이미 있으면 손대지 않으므로 Node 21+에서는 아무 일도 안 한다 —
 *  **없는 것을 정의할 뿐이라 기존 동작을 바꿀 수 없다**(이 폴리필의 안전 근거가 이것이다).
 *  진짜 내장처럼 열거되지 않게(enumerable:false) 심는다.
 *  ⓘ pdf.js의 쓰임은 `s.transferToFixedLength(u)`의 **반환값만** 쓰고 원본 s를 뒤에 안 쓴다 —
 *    그래서 원본을 detach하지 않는(순수 복사) 구현으로 충분하다.
 *  ⓘ Node 20이 EOL을 지나 운영이 21+로 올라가면 이 함수는 저절로 아무 일도 안 하게 된다. 그때
 *    지워도 되지만, **지우기 전에 운영·라이트 이미지·mac 올인원의 Node 판본을 실제로 확인할 것.** */
let 보정했나 = false;
function 노드20보정(): void {
  if (보정했나) return;
  보정했나 = true;
  const 원형 = ArrayBuffer.prototype as ArrayBuffer & { transferToFixedLength?: (n?: number) => ArrayBuffer };
  if (typeof 원형.transferToFixedLength === "function") return;
  Object.defineProperty(원형, "transferToFixedLength", {
    value: function (this: ArrayBuffer, 길이?: number): ArrayBuffer {
      const n = 길이 === undefined ? this.byteLength : 길이;
      const 새것 = new ArrayBuffer(n);
      new Uint8Array(새것).set(new Uint8Array(this, 0, Math.min(n, this.byteLength)));
      return 새것;
    },
    writable: true, enumerable: false, configurable: true,
  });
}

/** ⚠ `cleanup()`은 **선택**으로 둔다 — 짝 시험이 만드는 가짜 쪽 객체는 이것을 안 갖는다.
 *  필수로 두면 시험이 제품 타입을 못 만족해 「타입을 맞추려고 시험을 고치는」 쪽으로 흐른다. */
type 쪽 = {
  rotate: number;
  getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[] }>;
  getTextContent(): Promise<{ items: unknown[] }>;
  cleanup?(): unknown;
};
type 문서 = { numPages: number; getPage(n: number): Promise<쪽> };

/** 한 쪽을 다 봤으면 **그 쪽이 물고 있는 것을 놓는다** (2026-09-09 검토관 적발⑤ · 실측으로 고침).
 *
 *  ⚠ 무엇이 문제였나: `pdf표복원`은 격자가 있든 없든 **전 쪽의 연산자 목록을 먼저 만든다.**
 *    연산자 목록에는 **디코딩된 이미지**가 딸려 오고 pdf.js는 그것을 쪽 객체에 캐시로 붙들어 둔다.
 *    쪽마다 놓아 주지 않으면 문서 하나를 읽는 동안 **전 쪽의 이미지가 동시에 살아 있게 된다.**
 *    `쪽당_선분_상한`은 선분 개수만 막을 뿐이라 이 갈래에 원리상 안 걸린다.
 *  실측(WSL·Node 20 = 운영 환경, 프로세스를 매번 새로 띄워 최대 RSS를 잰다):
 *    운영 uploads의 10.1MB·29쪽 상품소개서 — **742MB → 282MB**(-62%) · 3,482ms → 3,044ms
 *    제안서.pdf(2.0MB·16쪽) 209 → 181MB · 제품소개.pdf(5.4MB·19쪽) 267 → 259MB.
 *  ⚠ **작은 문서에서는 눈에 안 띈다** — 저장소 PDF 10편(전부 6MB 미만)을 제품 경로로 3회씩 재면
 *    최대 RSS 486~513MB(놓을 때) vs 514~527MB(안 놓을 때)이고, 걸린 시간은 5.0~5.4초 vs
 *    5.1~5.8초로 **흔들림에 묻힌다.** 값어치는 「평소가 빨라진다」가 아니라 **「큰 문서 하나가
 *    서버 메모리를 삼키지 않는다」**이다. 그러니 이 줄을 「효과 없더라」로 읽고 지우지 말 것 —
 *    지우면 10MB짜리 한 편이 다시 700MB를 물고, 운영은 그런 문서를 실제로 갖고 있다.
 *  ⓘ 두 번 도는 값(쪽마다 놓고 뒤에서 글을 다시 읽는다)은 위 실측에서 시간으로 안 드러났다.
 *  ⓘ 놓아도 글은 그대로다 — `getTextContent`는 필요하면 다시 읽는다(회귀 골든이 이것을 지킨다).
 *  ⓘ pdf.js의 cleanup()은 **동기 함수이고 렌더링 중이면 false를 돌려준다**(예외가 아니다).
 *    그래서 반환값을 안 보고, 없을 수도 있는 메서드로 다룬다(짝 시험의 가짜 쪽 객체엔 없다). */
function 쪽비우기(page: 쪽): void {
  try { page.cleanup?.(); } catch { /* 못 놓아도 글은 그대로다 — 여기서 실패해 멈추지 않는다 */ }
}

/** 문서 전체에서 표를 복원한다.
 *  **격자가 하나도 없으면 `null`을 준다** — 그러면 호출부가 종전 extractText 한 줄로 지나간다.
 *  「표 없는 문서는 종전과 글자 하나까지 같다」를 주석이 아니라 **갈래**로 못박는 자리다.
 *  ⚠ 같은 Uint8Array로 getDocumentProxy를 두 번 부르면 **DataCloneError로 즉사한다**(pdf.js가 버퍼를
 *    워커로 transfer해 detach시킨다). 그래서 호출부가 만든 문서 객체 하나를 끝까지 돌려 쓴다. */
export async function pdf표복원(doc: 문서): Promise<string | null> {
  노드20보정();
  const { getResolvedPDFJS } = await import("unpdf");
  const OPS = (await getResolvedPDFJS()).OPS as Record<string, number>;
  const 쪽별격자: (격자[] | null)[] = [];
  let 격자합 = 0;
  for (let p = 1; p <= doc.numPages; p += 1) {
    const page = await doc.getPage(p);
    // 회전한 쪽은 좌표계가 달라진다 — 코퍼스에 0건이라 **못 쟀으므로** 손대지 않는다.
    if (page.rotate) { 쪽별격자.push(null); 쪽비우기(page); continue; }
    const 선분들 = await 쪽선분들(page, OPS);
    const gs = 선분들 ? 격자들(선분들) : null;
    쪽별격자.push(gs);
    격자합 += gs?.length ?? 0;
    쪽비우기(page);
  }
  if (격자합 === 0) return null;
  const 쪽글들: string[] = [];
  for (let p = 1; p <= doc.numPages; p += 1) {
    const page = await doc.getPage(p);
    const items = (await page.getTextContent()).items as 글자항목[];
    const 항목들 = items.filter((it) => it.str != null);
    쪽글들.push(쪽조립(항목들, 쪽별격자[p - 1] ?? []));
    쪽비우기(page);
  }
  return 쪽들잇기(쪽글들);
}
