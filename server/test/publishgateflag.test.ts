// 게시 관문 ⑧⁗(💬 답 지적)의 **판정식 자체**를 잰다 — 2026-09-07 라운드 F.
// (계획서 중-1 「파일럿 실사용 피드백 루프」 · 전-4 「정직한 구현」)
//
// ■ 왜 이 파일이 필요한가 — publishgatecite.test.ts와 **같은 이유**다.
//   ⑧⁗는 설치본 + CDP에서만 도는 코드라, 지금까지 「맞게 짰다」는 **주장**이다. 그리고 실화면
//   판정은 운영 데이터에 기댄다 — 지금 운영에 답 지적이 0건이면 (나)는 「0건이라고 말한다」
//   갈래로만 통과하고, 목록 갈래의 논리는 **한 번도 판정을 안 한다.** 그 논리를 여기서 돌린다.
//
// ■ 재는 것 / 안 재는 것 (정직 표시)
//   재는 것: ⑧⁗의 **성립식** 논리(관문 파일에서 글자 그대로 떼어 온다) + 그 절이 서버로
//            아무것도 안 보낸다는 소스 계약.
//   안 재는 것: **실화면**. 호버·CSS 특이도·굳은 단추는 진짜 브라우저에서만 드러난다 —
//            그건 관문이 잰다. 이 시험이 초록이어도 「실화면에서 통과했다」고 말하면 안 된다.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const 관문src = fs.readFileSync(path.join(__dirname, "..", "..", "tools", "publish-gate-ui.mjs"), "utf8");

/* ── ⑧⁗ 절을 관문 파일에서 **떼어 온다** ────────────────────────────────────────────
   ⚠ 베끼지 않는다. 베끼면 관문을 고쳐도 여기는 옛 코드를 계속 초록으로 재서 「시험이 있다」가
     오히려 거짓 안심이 된다(이 저장소의 「같은 것을 여러 곳에 적으면 어긋난다」). */
const 시작 = 관문src.indexOf("// ── ⑧⁗");
const 끝 = 관문src.indexOf("// ── ⑨", 시작 + 1);
const 절 = 시작 >= 0 && 끝 > 시작 ? 관문src.slice(시작, 끝) : "";

/** `const <이름> = …;` 다음 줄의 `ok(` 앞까지를 식으로 떼어 온다. */
function 성립식(이름: string): string {
  const a = 절.indexOf(`const ${이름} = `);
  expect(a, `${이름} 성립식을 관문에서 못 찾았다 — 이 시험이 헛돈다`).toBeGreaterThan(-1);
  const b = 절.indexOf("\n  ok(", a);
  expect(b, `${이름} 뒤의 ok(가 없다`).toBeGreaterThan(a);
  // ⚠ 줄 끝 주석을 떼고 나서 `;`를 뗀다. 안 떼면 `… === true;  // 왜` 가 통째로 식에 들어가
  //   `return (…;//…)` 이 되어 **문법 오류**로 25개가 한꺼번에 빨개진다(2026-09-07 실측).
  //   ⚠ 이 떼기는 「식 안에 `//`가 없다」는 전제 위에 있다 — 정규식에 `//`를 쓰면 여기서 깨진다.
  //     아래 시험이 그 전제를 지킨다(성립식에 // 가 든 문자열·정규식이 없다).
  const 식 = 절.slice(a + `const ${이름} = `.length, b);
  return 식.replace(/\/\/[^\n]*/g, "").trim().replace(/;\s*$/, "");
}
/** 떼어 온 식을 실제로 돌린다(가짜 값으로). */
function 판정(이름: string, 인자: Record<string, unknown>): boolean {
  const 키 = Object.keys(인자);
  const f = new Function(...키, `return (${성립식(이름)});`);
  return !!f(...키.map((k) => 인자[k]));
}

describe("떼어 오기가 성립한다(먼저 이것부터 — 못 떼면 아래가 전부 헛초록)", () => {
  it("⑧⁗ 절을 찾았고 검사 넷이 다 있다", () => {
    expect(절.length, "⑧⁗ 절을 못 떼었다 — 관문의 머리말 표식이 바뀌었을 수 있다").toBeGreaterThan(2000);
    for (const 이름 of ["꼬리성립", "세그성립", "처리성립", "칩성립"]) {
      expect(절, `${이름}이 없다`).toContain(`const ${이름} = `);
    }
    expect((절.match(/\n  ok\(/g) || []).length, "ok( 넷이 아니다").toBe(4);
  });

  it("★ 떼기의 전제 — 성립식 안에 주석 기호(//)가 든 문자열·정규식이 없다", () => {
    // 위 성립식()은 줄 끝 주석을 지운다. 식 **안쪽**에 //가 들어오면 그 지우기가 식을 잘라
    // 조용히 다른 것을 재게 된다(「시험이 있다」가 거짓 안심이 되는 자리).
    for (const 이름 of ["꼬리성립", "세그성립", "처리성립", "칩성립"]) {
      const 식 = 성립식(이름);
      expect(식, `${이름} 식에 //가 남았다`).not.toContain("//");
      expect(식.length, `${이름} 식이 너무 짧다 — 주석 지우기가 식을 잘랐다`).toBeGreaterThan(60);
    }
  });

  it("★ 앞선 절(⑧′)의 떼어 오기를 망가뜨리지 않았다 — 새 절을 ⑨ 앞에 끼워 넣었기 때문", () => {
    // publishgatecite.test.ts는 「⑧′ ~ ⑨」를 떼어 그 안의 **첫** evaluate/성립식을 쓴다.
    // 내 절이 그 사이에 들어갔으므로, 첫 번째가 여전히 ⑧′의 것인지 여기서도 한 번 못 박는다.
    const a = 관문src.indexOf("// ── ⑧′");
    const b = 관문src.indexOf("// ── ⑨", a + 1);
    const 넓은절 = 관문src.slice(a, b);
    expect(넓은절.indexOf("const 성립 = "), "⑧′의 성립식이 사라졌다").toBeGreaterThan(-1);
    expect(넓은절.indexOf("const 성립 = "), "내 절이 ⑧′의 첫 성립식보다 앞에 끼었다")
      .toBeLessThan(넓은절.indexOf("const 꼬리성립 = "));
  });
});

describe("① 운영 원장에 실입력을 하지 않는다(소스 계약)", () => {
  // ⚠ 관문은 운영 서버(4000)에 admin으로 붙는다. 지적을 진짜로 보내면 결재판에 **관문이 만든 줄**이
  //   쌓이고, 그 줄로 잰 「아직 고칠 것 N건」은 아무도 못 믿는다(측정이 데이터를 만드는 것).
  const 금지 = [
    "sendAnswerFeedback", "setAnswerFeedbackStatus", "setAnswerFeedbackKind",
    "setAnswerFeedbackExpected", "buildAnswerFeedbackDraft", "removeAnswerFeedback",
  ];
  for (const 이름 of 금지) {
    it(`window.gijo.${이름}을 부르지 않는다`, () => expect(절).not.toContain(이름));
  }
  it("★ 대신 **우리 창구(ops)** 로 부품을 돌린다 — 서버로 한 바이트도 안 나간다", () => {
    expect(절, "가짜 창구를 안 넘겼다 — 그러면 진짜 접수가 일어난다").toContain("send: () =>");
    expect(절).toContain("remove: () =>");
    expect(절, "버릴 줄을 안 지운다 — 운영 화면에 관문 자국이 남는다").toContain('document.querySelectorAll("#gateFlagRow").forEach');
  });
  it("결재판·감독·문서함 절은 **읽기와 열기**만 한다(승인·닫기 단추를 안 누른다)", () => {
    for (const 이름 of ["fxResolve", "fxPromote", "fxDismiss", "fxSaveExp", "fxDraftBtn"]) {
      expect(절, `${이름}을 눌렀다 — 남의 지적 상태를 관문이 바꾼다`).not.toContain(이름);
    }
  });
});

describe("② 꼬리 성립식 — 옳은 결과만 통과한다", () => {
  const 좋음 = () => ({
    준비: { 부품없음: false, 단추: true },
    꼬리: {
      접힘호버: "inline-block", 펼침호버: "none",
      입력줄: { 보임: true, 종류칩: 3, 갈래: "갈래 미분류" },
      영수증: { 글: "✓ 결재판에 올림 결재판 열기 취소", 열기: true, 취소: true },
      무른뒤: { 글: "무른 지적입니다 — 기록에 남지 않았습니다.", 단추돌아옴: true },
      다시올리기: { 글자: "올리기", disabled: false, 눌림: true },
    },
  });
  it("정상 결과는 통과한다", () => {
    const g = 좋음();
    expect(판정("꼬리성립", g)).toBe(true);
  });

  // ★ 반증 — 하나씩 망가뜨려 **전부 빨개지는지** 본다. 안 빨개지는 칸은 재고 있지 않은 칸이다.
  const 반증: [string, (g: ReturnType<typeof 좋음>) => void][] = [
    ["펼친 뒤 호버에 접힘 단추가 되살아남(이번 CSS 수리)", (g) => { g.꼬리.펼침호버 = "inline-block"; }],
    ["접힘 상태에서 호버해도 안 드러남(기존 계약이 깨짐)", (g) => { g.꼬리.접힘호버 = "none"; }],
    ["무른 뒤 올리기가 「올리는 중…」으로 굳음", (g) => { g.꼬리.다시올리기.글자 = "올리는 중…"; }],
    ["무른 뒤 올리기가 disabled로 남음", (g) => { g.꼬리.다시올리기.disabled = true; }],
    ["★ 눌러도 클릭이 안 감(가짜 DOM이 못 잡던 자리)", (g) => { g.꼬리.다시올리기.눌림 = false; }],
    ["종류 칩이 셋이 아님", (g) => { g.꼬리.입력줄.종류칩 = 2; }],
    ["갈래를 화면이 지어냄(서버가 저장 안 하는 값)", (g) => { g.꼬리.입력줄.갈래 = "갈래 제품"; }],
    ["영수증에 결재판 열기가 없음(출구 없음)", (g) => { g.꼬리.영수증.열기 = false; }],
    ["무른 뒤 꼬리 단추가 안 돌아옴(다시 지적 못 함)", (g) => { g.꼬리.무른뒤.단추돌아옴 = false; }],
    ["부품 자체가 없음", (g) => { g.준비.단추 = false; }],
  ];
  for (const [이름, 망가뜨리기] of 반증) {
    it(`반증 — ${이름}`, () => {
      const g = 좋음();
      망가뜨리기(g);
      expect(판정("꼬리성립", g), "이 결함을 성립식이 통과시킨다").toBe(false);
    });
  }
});

describe("③ 결재판 세그먼트 성립식 — 「0건」과 「못 읽음」을 가른다", () => {
  const 좋음 = (p: Record<string, unknown> = {}) => ({
    세그: {
      라벨: "💬 답 지적 3", 숫자: "3", 갈래칸: 4, 막힘: false, 줄수: 3, 빈말: false,
      그림띠: "none", vex: "none", ...p,
    },
  });
  it("목록이 뜬 경우 통과", () => expect(판정("세그성립", 좋음())).toBe(true));
  it("★ 진짜 0건(빈말)도 통과 — 지적이 없는 것은 결함이 아니다", () => {
    expect(판정("세그성립", 좋음({ 줄수: 0, 빈말: true, 라벨: "💬 답 지적 0", 숫자: "0" }))).toBe(true);
  });
  it("★★ 빈 상자는 통과 못 한다 — 0건이면 **그렇다고 말해야** 한다", () => {
    expect(판정("세그성립", 좋음({ 줄수: 0, 빈말: false }))).toBe(false);
  });
  it("★ 403(관리자 아님) 안내가 뜨면 실패 — 게시본이 admin에게 목록을 못 주는 상태다", () => {
    expect(판정("세그성립", 좋음({ 막힘: true }))).toBe(false);
  });
  it("갈래 칸이 넷이 아니면 실패(0건 갈래도 늘 선다)", () => {
    expect(판정("세그성립", 좋음({ 갈래칸: 3 }))).toBe(false);
  });
  it("★ 취약점 원장의 그림 띠·VEX가 지적 목록 위에 남아 있으면 실패(두 원장 오염)", () => {
    expect(판정("세그성립", 좋음({ 그림띠: "" }))).toBe(false);
    expect(판정("세그성립", 좋음({ vex: "" }))).toBe(false);
  });
  it("세그먼트가 아예 없으면 실패", () => {
    expect(판정("세그성립", { 세그: { 세그없음: true } })).toBe(false);
    expect(판정("세그성립", { 세그: null })).toBe(false);
  });
});

describe("④ 감독 성립식 — 줄이 없을 때와 있을 때", () => {
  /* ★★ 2026-09-07 검토관 [중] 수리 — 옛 판은 열린탭에 `"supervision.html|approvals.html?fix=open"`
     이라는 **실화면 DOM이 만들어 낼 수 없는 값**을 손으로 먹였다. 판정식은 떼어 왔는데 **그 식에
     들어가는 값의 생산자는 아무도 안 쟀고**, 실제 생산자(관문의 evaluate)가 늘 ""을 내던 사실이
     여기서는 초록으로 보였다 — 「시험이 있다」가 거짓 안심이 되는 자리다.
     고침 ① 아래 ⑥에서 **생산자 쪽 소스 계약**을 따로 잰다(무엇으로 탭을 읽는가).
     고침 ② 관문이 이제 전·후를 견줘 한 문장(`새로열림:…`)으로 만들므로, 여기 값도 그 문장이다. */
  const 좋음 = (p: Record<string, unknown> = {}) => ({
    처리: { 있음: true, 단추: true, 라벨: "🗔 결재판에서 처리", 열림기준: true, 갈래: 4, ...p },
    열린탭: "새로열림:approvals.html?fix=open",
  });
  it("줄이 있고 단추가 **누른 뒤에** 결재판을 열면 통과", () => expect(판정("처리성립", 좋음())).toBe(true));
  it("★ 옛 서버라 줄이 아예 없으면 넘어간다 — 없는 것을 있다고 우기지 않는다", () => {
    expect(판정("처리성립", { 처리: { 줄없음: true, 글: "" }, 열린탭: "" })).toBe(true);
  });
  it("★★ 단추를 눌렀는데 결재판 탭이 안 열리면 실패(죽은 단추 — 이 저장소 최악의 결함)", () => {
    expect(판정("처리성립", { ...좋음(), 열린탭: "전=supervision.html/supervision.html 후=supervision.html/supervision.html" })).toBe(false);
  });
  it("★★ **누르기 전에 이미 열려 있던** 결재판으로는 통과 못 한다(앞 검사 (나)가 열어 둔 탭)", () => {
    // 옛 판정(/approvals\.html/ 부분일치)이라면 이 값도 초록이었다 — 단추가 죽어 있어도.
    expect(판정("처리성립", { ...좋음(), 열린탭: "전=approvals.html?fix=open 후=approvals.html?fix=open" })).toBe(false);
    expect(판정("처리성립", { ...좋음(), 열린탭: "전=approvals.html 후=approvals.html|supervision.html" })).toBe(false);
  });
  it("★ 옛 selector가 늘 내던 빈 문자열로는 통과 못 한다(관문이 자기 눈을 감고 있던 상태)", () => {
    expect(판정("처리성립", { ...좋음(), 열린탭: "" })).toBe(false);
  });
  it("「열림 기준(0건도 그립니다)」 문구가 사라지면 실패", () => {
    expect(판정("처리성립", 좋음({ 열림기준: false }))).toBe(false);
  });
  it("갈래가 넷 미만이면 실패(0건 갈래를 숨겼다 — 부재와 무지가 같아 보인다)", () => {
    expect(판정("처리성립", 좋음({ 갈래: 3 }))).toBe(false);
  });
});

/* ── ⑥ **생산자**를 잰다 — 판정식에 들어가는 값이 실화면에서 만들어질 수 있나 ─────────────
   ■ 왜(2026-09-07 검토관 [상]): ⑧⁗ 검사 ③이 열린 탭을 `#tabBar [data-page], #tabBar button`으로
     읽었는데 셸의 탭줄에는 그런 요소가 **하나도 없다** — app.html의 #tabBar 자식은 renderTab이
     만드는 div.tab뿐이고(dataset.page 안 넣음, 파일 전체 data-page 0건), 「모두 닫기」류 button은
     #tabBar **밖 형제**(.tb-act)다. 그래서 그 값은 늘 ""이었고 검사는 **실화면에서 절대 참이 될 수
     없었다** — 🔧 줄이 서면 게시가 막힌다. 위 성립식 시험은 값을 손으로 먹여서 이것을 못 봤다.
   ■ 여기서는 관문 소스가 **무엇으로 읽는가**를 잰다. 실화면 DOM은 vitest가 못 띄우므로, 대신
     ① 금지된 읽기(그 selector)가 없고 ② 셸이 실제로 내놓는 API(gijoTabs.list/activeScreen)를
     쓰며 ③ 그 API가 app.html에 정말 있는지를 함께 못 박는다(생산자-소비자 짝). */
describe("⑥ 탭 읽기의 생산자 — 셸이 실제로 내놓는 것으로만 읽는다", () => {
  const 셸 = fs.readFileSync(
    path.join(__dirname, "..", "..", "client", "src", "renderer", "pages", "app.html"), "utf8");
  // ⚠ **주석을 뺀 코드**만 본다 — 관문 주석에는 「옛 판은 이 selector로 읽었다」는 설명이 남아
  //   있고(왜 고쳤는지는 남겨야 한다), 그것까지 세면 이 감시가 늘 빨개진다. 재는 것은 코드다.
  const 절코드 = 절.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");

  it("★★ 관문이 #tabBar의 data-page·button으로 탭을 읽지 않는다(그런 요소가 없다)", () => {
    expect(절코드.length, "주석 빼기가 절을 통째로 지웠다 — 이 시험이 헛돈다").toBeGreaterThan(1500);
    expect(절코드, "#tabBar [data-page] 읽기가 되살아났다 — 실화면에서 늘 빈 값이 된다")
      .not.toMatch(/#tabBar\s*\[data-page\]/);
    expect(절코드, "#tabBar button 읽기가 되살아났다 — 그 button은 #tabBar 밖 형제다")
      .not.toMatch(/#tabBar\s+button/);
  });

  it("★ 없다는 근거 — app.html의 #tabBar는 data-page를 안 달고 button도 안 품는다", () => {
    expect(셸, "탭줄 자체가 사라졌다 — 이 시험의 전제가 무너졌다").toContain('id="tabBar"');
    expect(셸.includes("data-page"), "app.html에 data-page가 생겼다 — 옛 selector를 다시 볼 것").toBe(false);
    // renderTab이 만드는 것은 div.tab + span들뿐이다(button 아님).
    expect(셸, "renderTab이 더는 div.tab을 만들지 않는다").toMatch(/el\.className = "tab"/);
  });

  it("★ 관문이 gijoTabs.list()·activeScreen()으로 읽고, 셸이 그 둘을 정말 내놓는다", () => {
    expect(절, "관문이 gijoTabs.list()를 안 쓴다").toMatch(/gijoTabs[\s\S]{0,40}\.list\(\)/);
    expect(절, "관문이 activeScreen()을 안 쓴다").toMatch(/activeScreen\(\)/);
    expect(셸, "셸이 list를 안 내놓는다 — 관문이 늘 빈 값을 읽게 된다").toMatch(/list: function \(\)/);
    expect(셸, "셸이 activeScreen을 안 내놓는다").toMatch(/activeScreen: function \(\)/);
  });

  it("★★ 판정이 **누르기 전후**를 견준다 — 앞 검사가 열어 둔 탭으로는 못 통과한다", () => {
    expect(절, "누르기 전 상태를 안 적는다 — 죽은 단추가 통과한다").toContain("누르기전");
    expect(절, "누른 뒤 상태를 안 적는다").toContain("누른뒤");
    expect(성립식("처리성립"), "판정이 아직 부분일치(/approvals\.html/)다 — 앞서 열린 탭도 통과한다")
      .toContain("새로열림");
  });

  /* ★★ 2026-09-07 게시 실측 수리 — 「굳은 단추」의 **재는 순간**을 못 박는다.
     ■ 무슨 일이 있었나: 5.92.0 게시가 이 절에 막혔는데 **제품은 성했다.** 관문이 글자·disabled를
       `go.click()` **뒤에** 읽었기 때문이다 — 성한 제품의 go 리스너는 첫 줄에서 동기로
       `go.disabled = true; go.textContent = "올리는 중…"`을 하므로(chatparts.js), 그 값은
       **고쳐진 제품에서도 늘** 「올리는 중…」·true다. 즉 이 절은 **원리상 통과할 수 없었다.**
       (같은 실행에서 눌림=true였다 — 클릭은 갔는데 모습만 보고 빨갛다고 한 것이다.)
     ■ 위 ② 반증 시험은 값을 손으로 먹이므로 이것을 못 본다. ④ 열린탭 때와 **같은 부류**의
       생산자 결함이고, 이 파일이 ⑥ 머리말에서 경고한 자리에서 두 번째로 났다.
     ■ 그래서 소스로 못 박는다: 모습(글자·disabled)은 클릭 **앞**에서 읽는다. */
  it("★★ 굳은 단추 판정 — 글자·disabled를 go.click() **앞에서** 읽는다(뒤면 늘 「올리는 중…」)", () => {
    const i = 절코드.indexOf("꼬리.다시올리기 = await");
    expect(i, "다시올리기 절을 못 찾았다 — 이 시험이 헛돈다").toBeGreaterThan(-1);
    const 블록 = 절코드.slice(i, i + 700);
    const 읽기 = 블록.search(/const\s+글자\s*=\s*go\.textContent/);
    const 클릭 = 블록.indexOf("go.click()");
    expect(읽기, "글자를 미리 안 뜬다 — go.click() 뒤에 읽으면 성한 제품도 빨개진다").toBeGreaterThan(-1);
    expect(클릭, "클릭이 사라졌다 — 굳은 단추를 실제로 눌러 보지 않는다").toBeGreaterThan(-1);
    expect(읽기, "모습을 클릭 **뒤에** 읽는다 — 이 절이 원리상 통과할 수 없게 된다").toBeLessThan(클릭);
    expect(블록, "반환값이 미리 읽은 값을 안 쓴다(go.textContent를 다시 읽으면 같은 함정)")
      .toMatch(/글자\s*,\s*disabled\s*,/);
    // 눌림은 그대로 **클릭 뒤**에 센다 — 이것까지 앞으로 옮기면 죽은 단추를 못 잡는다.
    expect(블록.indexOf("눌림:"), "눌림을 클릭 앞에서 센다 — 죽은 단추가 통과한다").toBeGreaterThan(클릭);
  });

  it("★ 심어 둔 상자 청소가 if 밖이다 — 부품이 null을 줘도 화면에 안 남는다", () => {
    // `if (준비 && 준비.단추) {` 블록이 끝난 **뒤**에 gateFlagRow 지우기가 와야 한다.
    const 블록시작 = 절.indexOf("if (준비 && 준비.단추)");
    expect(블록시작, "if 블록을 못 찾았다 — 이 시험이 헛돈다").toBeGreaterThan(-1);
    // 청소는 그 블록 **밖**에 한 번만 온다. 되돌아가면(if 안으로) 여기서 빨개진다.
    const 안쪽마지막 = 절.indexOf("꼬리.셈 = await");
    const 밖표식 = 절.indexOf("청소는 **if 밖**이다");
    const 청소 = 절.indexOf("delete window.__gateFlag;");
    expect(안쪽마지막, "if 블록 안 마지막 줄을 못 찾았다 — 이 시험이 헛돈다").toBeGreaterThan(블록시작);
    expect(밖표식, "청소를 if 밖으로 뺀 표식이 없다").toBeGreaterThan(안쪽마지막);
    expect(청소, "청소 한 곳을 못 찾았다").toBeGreaterThan(밖표식);
    // if 블록 **안쪽**에는 지우기가 남아 있으면 안 된다(두 곳이 되면 하나가 늙는다).
    expect(절.slice(블록시작, 안쪽마지막).includes('#gateFlagRow").forEach'),
      "if 블록 안에 아직 지우기가 있다 — 청소가 두 곳이 됐다").toBe(false);
  });
});

describe("⑤ 문서함 칩 성립식 — 0건이면 칩도 배지도 없다(양방향)", () => {
  const 좋음 = (p: Record<string, unknown> = {}) => ({
    칩: { 행: 120, 칩들: ["조각 없음(대장 21개)"], 없음: 1, 배지: "⚠ 1", 배지수: 1, 꼴: true, 딴칩: [], ...p },
  });
  it("유령 1건 — 칩과 배지가 맞으면 통과", () => expect(판정("칩성립", 좋음())).toBe(true));
  it("★ 재인입해서 0건이 되어도 통과 — 관문이 「고친 것」을 결함이라 말하면 안 된다", () => {
    expect(판정("칩성립", 좋음({ 칩들: [], 없음: 0, 배지: "", 배지수: 0 }))).toBe(true);
  });
  it("★★ 칩은 있는데 배지가 0이면 실패(배지와 대화 답이 갈린다)", () => {
    expect(판정("칩성립", 좋음({ 배지: "", 배지수: 0 }))).toBe(false);
  });
  it("★ short·extra를 배지가 함께 세면 실패 — 서버 「⚠ 조각 없음 N건」은 missing만 센다", () => {
    expect(판정("칩성립", 좋음({ 칩들: ["조각 없음(대장 21개)", "조각 일부 사라짐"], 없음: 1, 배지수: 2, 배지: "⚠ 2" }))).toBe(false);
  });
  it("★ 화면이 서버에 없는 문구를 지어내면 실패", () => {
    expect(판정("칩성립", 좋음({ 딴칩: ["조각 깨짐"] }))).toBe(false);
  });
  it("문구 꼴이 어긋나면 실패(서버 docledger.상태꼬리와 글자가 달라진 것)", () => {
    expect(판정("칩성립", 좋음({ 꼴: false }))).toBe(false);
  });
  it("목록이 아예 안 그려졌으면 실패(빈 화면을 초록으로 세지 않는다)", () => {
    expect(판정("칩성립", 좋음({ 행: 0 }))).toBe(false);
  });
});
