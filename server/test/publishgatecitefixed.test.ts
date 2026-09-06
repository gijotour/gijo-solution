// 감독 화면 — 위험 신호(못 뗌·통째교체)가 있으면 ✂ 사유가 **처음부터 펴져 있다**.
// 운영 자료가 0건이어도 판정되도록 **고정 자료**로 잰다.
// (계획서 **전-4 정직한 구현** · 2026-09-07)
//
// ■ 왜 이 판정이 필요한가
//   게시 관문 ⑧′(tools/publish-gate-ui.mjs)의 「못 뗌·통째교체면 처음부터 펴져 있어야 한다」
//   조항은 **운영 자료에 그 사유가 0건이라 한 번도 판정된 적이 없다.** 조항이 코드에 적혀 있는
//   것과 판정이 실제로 도는 것은 다르다 — 이 저장소가 반복해 밟은 「있다 ≠ 된다」다.
//
// ■ 왜 관문(실화면)이 아니라 **여기서** 재나 — 2026-09-07에 자리를 옮겼다(정직 표시)
//   처음 판은 관문이 실앱에서 `window.gijo.aiteamSupervision` 한 칸을 잠시 갈아끼워 재게 했다.
//   **실앱에서는 원리상 안 된다.** contextBridge가 내준 `window.gijo`는 Electron이 얼려 내주고
//   (속성이 writable:false·configurable:false) 대입도 defineProperty도 먹지 않는다.
//   저장소가 이미 두 번 적어 둔 사실이다 — client/src/preload.ts:129
//   「contextBridge로 노출한 객체는 렌더러에서 못 고친다(조용히 무시된다. 실제로 그렇게
//   시도했다가 아무 일도 안 일어났다)」.
//   그대로 뒀다면 관문이 **늘 빨개져 게시가 통째로 막히고**, 사람은 `--skip-ui-gate`로 도망쳤을
//   것이다 — 그 스위치는 이 검사 하나가 아니라 **실화면 관문 전부**를 끈다. 검사 하나를 살리려다
//   안전망을 통째로 잃는 거래다.
//   → 그래서 갈아끼우기가 되는 유일한 자리, **가짜 DOM 위의 진짜 화면 스크립트**에서 잰다.
//     화면 코드는 흉내가 아니라 supervision.html의 인라인 스크립트 **그 자체**다(helpers/supervisionstage).
//
// ■ 재는 것 / 안 재는 것
//   재는 것: 고정 자료 두 벌(갑·을)의 자동 펼침 · 배지 두 갈래 · 사람의 펼침 기억 불변,
//            그리고 관문 ⑧″가 「가로채기가 된다」에 다시 기대지 않는지(회귀 가드).
//   안 재는 것: **픽셀**과 실제 운영 자료. 그 둘은 관문 ⑧′가 실화면에서 잰다.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { 감독무대세우기, 감독자료, 감독소스, type 감독무대 } from "./helpers/supervisionstage";

const 관문경로 = path.join(__dirname, "../../tools/publish-gate-ui.mjs");
const 관문src = fs.readFileSync(관문경로, "utf8");
const 섹션시작 = 관문src.indexOf("// ── ⑧″");
const 섹션끝 = 관문src.indexOf("// ── ⑨", 섹션시작 + 1);
const 관문섹션 = 섹션시작 >= 0 && 섹션끝 > 섹션시작 ? 관문src.slice(섹션시작, 섹션끝) : "";

type 잰것 = {
  가로챔: boolean; 그려짐?: boolean; 토글?: boolean; 펼침?: boolean; 보임?: boolean;
  배지?: string | null; 사유글?: string | null;
};

/** 기간 단추는 같은 값으로 눌러도 load()를 다시 돈다 — 새 API를 안 만들고 있는 조작으로 다시 그린다. */
async function 다시그리기(무대: 감독무대): Promise<boolean> {
  const 전 = 무대.판수();
  const b = 무대.doc.querySelector("#range button.on") || 무대.doc.querySelector("#range button");
  if (!b) return false;
  b.click();
  for (let i = 0; i < 200; i++) {
    if (무대.판수() > 전 && 무대.doc.querySelector("#sup .sup-line")) return true;
    await new Promise((r) => setTimeout(r, 0));
  }
  return false;
}

/** 첫 그리기(load()는 async라 무대를 세운 직후엔 아직 빈 화면이다)를 기다린다. */
async function 첫그림(무대: 감독무대): Promise<boolean> {
  for (let i = 0; i < 200; i++) {
    if (무대.판수() > 0 && 무대.doc.querySelector("#sup .sup-line")) return true;
    await new Promise((r) => setTimeout(r, 0));
  }
  return false;
}

/** 감독 API 한 칸을 고정 자료로 갈아끼우고 화면을 다시 그려, ✂ 줄이 어떻게 나오는지 본다. */
async function 재기(무대: 감독무대, 사유들: [string, number][]): Promise<잰것> {
  const 가짜 = async () => 감독자료(사유들, 3);
  // ⚠ 얼어 있는 칸이면 **던진다**(이 파일은 ESM이라 strict mode다) — 실앱의 contextBridge가
  //   바로 그 모양이다. 던지든 조용히 무시되든 결론은 하나: 못 걸었다.
  try { 무대.win.gijo.aiteamSupervision = 가짜; } catch { /* 봉인된 칸 */ }
  // ⚠ 먹었는지 **되읽는다** — 조용히 무시되면 「고정 자료로 쟀다」가 거짓이 된다.
  if (무대.win.gijo.aiteamSupervision !== 가짜) return { 가로챔: false };
  const 그려짐 = await 다시그리기(무대);
  const 줄 = (무대.doc.querySelectorAll("#sup .sup-line") as any[])
    .find((el) => String(el.textContent).includes("인용 제거"));
  const btn = 줄 ? 줄.querySelector(".cite-why") : null;
  const box = 줄 ? 줄.querySelector(".cite-reasons") : null;
  return {
    가로챔: true, 그려짐, 토글: !!btn,
    펼침: !!btn && btn.getAttribute("aria-expanded") === "true",
    보임: !!box && box.style.display !== "none",
    배지: btn ? String(btn.textContent).trim() : null,
    사유글: box ? String(box.textContent || "").replace(/\s+/g, " ").trim() : null,
  };
}

/**
 * 판정식 — 한 곳에만 적는다.
 * ⚠ 기대 배지는 supervision.html의 **실제 규칙**에서 온다(배지글 3갈래):
 *     사유.배지 > 0 → 「사유 N건」 · 아니고 못뗌 > 0 → 「⚠ 못 뗌 N건」 · 아니고 통째 > 0 → 「통째교체 N건」
 *   그리고 배지 N은 「못 뗌」·「통째교체」를 **안 센다**(사유줄계산의 배지제외 규약).
 *   그래서 갑의 정답은 「⚠ 못 뗌 1건」이 아니라 **「사유 2건」**이다(겹침없음 2가 있으니까).
 *   여기 숫자를 바꿀 땐 화면의 배지제외 규약을 먼저 읽을 것 — 안 그러면 멀쩡한 화면을 거짓으로 몬다.
 */
function 성립(갑: 잰것, 을: 잰것, 기억불변: boolean): boolean {
  return !!갑.가로챔 && !!갑.그려짐 && !!갑.토글
    && 갑.펼침 === true && 갑.보임 === true                     // ⓐ 위험 사유면 **처음부터** 펴져 있다
    && /^사유 2건/.test(String(갑.배지 || ""))                  // ⓑ 배지 — 못 뗌·통째교체는 N에서 뺀다
    && /못 뗌 1/.test(String(갑.사유글 || "")) && /통째교체 1/.test(String(갑.사유글 || ""))
    && !!을.가로챔 && 을.펼침 === true && 을.보임 === true
    && /^⚠ 못 뗌 1건/.test(String(을.배지 || ""))               // ⓑ′ 배지 0건일 때의 갈래
    && 기억불변;                                                 // ⓒ 사람의 펼침 기억은 안 건드린다
}

/** 자동 펼침을 통째로 지운 **퇴행 화면** — 이걸 초록으로 통과시키면 헛초록이다. */
const 퇴행소스 = () => {
  const 지운 = 감독소스.replace("사유.못뗌 > 0 || 사유.통째 > 0 || ", "");
  expect(지운, "퇴행을 만들 자리를 못 찾았다 — 이 시험이 헛돈다").not.toBe(감독소스);
  return 지운;
};

/** 운영의 실제 모습 — 답은 있는데 사유는 0건(2026-09-07 현재). 여기서 출발한다. */
const 실자료 = () => 감독자료([], 3);
const 갑자료: [string, number][] = [["겹침없음", 2], ["못 뗌", 1], ["통째교체", 1]];
const 을자료: [string, number][] = [["못 뗌", 1]];

describe("감독 ✂ 위험 신호 자동 펼침 — 운영 자료가 0건이어도 판정한다 (전-4)", () => {
  it("ⓗ⓪ 헛돎 방지 — 진짜 화면 스크립트를 올려 놓고 잰다", async () => {
    expect(감독소스, "supervision.html을 못 읽었다").toContain('class="cite-why"');
    const 무대 = 감독무대세우기(실자료(), {});
    expect(await 첫그림(무대), "화면이 한 번도 안 그려졌다").toBe(true);
    expect(무대.sup()).toContain("sup-line");
  });

  it("★ ⓗ① 정상 — 고정 자료 갑·을 둘 다 저절로 펴지고 배지가 규칙대로 나온다", async () => {
    const 무대 = 감독무대세우기(실자료(), {});
    const 갑 = await 재기(무대, 갑자료);
    const 을 = await 재기(무대, 을자료);
    expect(갑.가로챔, "고정 자료를 못 걸었다 — 무대가 헛돈다").toBe(true);
    expect(갑.그려짐, "기간 단추를 눌러도 화면이 다시 안 그려졌다").toBe(true);
    expect(갑.펼침, "위험 사유가 있는데 접힌 채로 그려졌다").toBe(true);
    expect(갑.보임).toBe(true);
    // 배지 N은 「못 뗌」·「통째교체」를 안 센다 — 겹침없음 2만 세어 「사유 2건」이 정답이다.
    expect(갑.배지, "배지 규약(배지제외)이 바뀌었거나 기대값이 낡았다").toMatch(/^사유 2건/);
    expect(을.배지, "배지 0건 갈래(⚠ 못 뗌 N건)가 안 나온다").toMatch(/^⚠ 못 뗌 1건/);
    expect(을.펼침).toBe(true);
    expect(성립(갑, 을, true), "정상인데 판정이 빨갛다: " + JSON.stringify({ 갑, 을 })).toBe(true);
  });

  it("★ ⓗ② 퇴행 — 자동 펼침 조건을 지우면 **빨개진다**", async () => {
    const 무대 = 감독무대세우기(실자료(), {}, 퇴행소스());
    const 갑 = await 재기(무대, 갑자료);
    const 을 = await 재기(무대, 을자료);
    expect(갑.가로챔).toBe(true);
    expect(갑.펼침, "지웠는데도 펴져 있다 — 무대가 헛돈다").toBe(false);
    expect(성립(갑, 을, true), "위험 사유를 접어 놓고도 판정이 초록이다").toBe(false);
  });

  it("★ ⓗ③ 반증 — 갈아끼우기가 막히면 **초록을 주지 않는다**(못 쟀는데 통과 금지)", async () => {
    // 실앱의 window.gijo가 바로 이 모양이다(contextBridge 봉인). 그 자리에서 「쟀다」고 말하면
    // 조용히 넘어가는 것보다 나쁘다 — 거짓말이 된다.
    const 무대 = 감독무대세우기(실자료(), {});
    Object.freeze(무대.win.gijo);
    const 갑 = await 재기(무대, 갑자료);
    expect(갑.가로챔, "얼려 뒀는데 갈아끼웠다고 말한다").toBe(false);
    expect(성립(갑, 갑, true), "못 쟀는데 판정이 초록이다").toBe(false);
  });

  it("★ ⓗ④ 되돌림 — 원래 API로 돌려놓으면 화면이 실제 자료(사유 0건)로 돌아온다", async () => {
    const 무대 = 감독무대세우기(실자료(), {});
    const 진짜 = 무대.win.gijo.aiteamSupervision;
    await 재기(무대, 갑자료);
    무대.win.gijo.aiteamSupervision = 진짜;
    expect(await 다시그리기(무대), "되돌린 뒤 화면을 다시 안 그렸다").toBe(true);
    expect(무대.sup(), "고정 자료의 사유 목록이 화면에 남아 있다").not.toContain("겹침없음");
    expect(무대.sup()).toContain("사유 기록은 2026-09-06부터 쌓입니다");
  });

  it("★ ⓗ⑤ 사람의 펼침 기억은 그대로 둔다 — \"0\"은 \"0\", 없던 키는 안 만든다", async () => {
    const 접어둠 = 감독무대세우기(실자료(), { "gijo:cite-reasons-open": "0" });
    await 재기(접어둠, 갑자료);
    await 재기(접어둠, 을자료);
    expect(접어둠.저장["gijo:cite-reasons-open"], "접어 둔 기억을 판정이 「1」로 굳혔다").toBe("0");

    const 빈PC = 감독무대세우기(실자료(), {});
    await 재기(빈PC, 갑자료);
    expect("gijo:cite-reasons-open" in 빈PC.저장, "없던 키를 판정이 남겼다").toBe(false);
  });

  it("ⓗ⑥ 기대 배지는 화면의 **실제 규칙**에서 온다(소스 감시)", () => {
    // 화면의 배지글 3갈래가 바뀌면 위 기대값도 함께 고쳐야 한다 — 한쪽만 고치면 멀쩡한 화면이 빨개진다.
    expect(감독소스, "배지글 규칙이 바뀌었다 — 이 파일의 기대값을 다시 맞출 것").toContain('"사유 " + 사유.배지 + "건"');
    expect(감독소스).toContain('"⚠ 못 뗌 " + 사유.못뗌 + "건"');
  });
});

describe("게시 관문 ⑧″ — 실앱에서 **못 하는 일**에 기대지 않는다 (2026-09-07 회귀 가드)", () => {
  // ★ 이 묶음이 이번 적발의 자리다. 관문이 다시 「렌더러에서 window.gijo를 갈아끼워 잰다」로
  //   돌아가면 **모든 게시가 막힌다**(가로챔:false → 성립 false → exit 1 → publish-release throw).
  //   빠져나갈 길이 --skip-ui-gate뿐이라, 실화면 관문 전체가 꺼진 채로 게시가 나간다.
  it("ⓘ① 관문에 ⑧″ 구간이 있고, 고정 자료 판정은 **이 시험 파일**을 가리킨다", () => {
    expect(관문섹션, "publish-gate-ui.mjs에서 ⑧″ 구간을 못 찾았다").not.toBe("");
    expect(관문섹션, "고정 자료 판정이 어디로 갔는지 관문이 안 알려 준다")
      .toContain("publishgatecitefixed.test.ts");
  });

  it("★ ⓘ② 관문의 성립 조건은 **봉인돼 있음**이다 — 갈아끼우기 성공에 기대지 않는다", () => {
    const c = 관문섹션.indexOf("const 성립 = ");
    const d = 관문섹션.indexOf("\n  ok(", c);
    const 성립식 = c >= 0 && d > c ? 관문섹션.slice(c, d) : "";
    expect(성립식, "⑧″의 성립식을 못 찾았다").not.toBe("");
    expect(성립식, "관문이 봉인(writable:false)을 통과 조건으로 삼지 않는다")
      .toMatch(/writable\s*===\s*false/);
    // 「가로챘어야 통과」로 되돌아가면 실앱에서 절대 통과할 수 없다 — 게시가 통째로 막힌다.
    expect(성립식, "관문이 다시 「가로채기 성공」을 요구한다 — 실앱에서는 원리상 못 한다")
      .not.toMatch(/가로챔\s*===\s*true/);
  });

  it("★ ⓘ③ 관문은 감독 자료를 **지어내지 않는다** — 제품 화면에 가짜 숫자를 남길 길이 없다", () => {
    expect(관문섹션, "관문이 고정 자료(citeReasons)를 다시 만들고 있다")
      .not.toContain("citeReasons");
  });

  it("ⓘ④ 왜 실앱에서 못 하는지 관문이 **근거와 함께** 적어 둔다", () => {
    // 근거를 안 적으면 다음 사람이 「되는데 왜 안 했지」 하고 그대로 되돌린다(이번에 그랬다).
    expect(관문섹션).toContain("contextBridge");
    expect(관문섹션, "저장소의 실측 기록(preload.ts:129)을 안 가리킨다").toMatch(/preload\.ts/);
  });
});
