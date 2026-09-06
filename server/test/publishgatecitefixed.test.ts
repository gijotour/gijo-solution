// 게시 관문 ⑧″(감독 ✂ **위험 신호 자동 펼침 — 고정 자료 경로**)의 판정식을 잰다.
// (계획서 **전-4 정직한 구현** · 2026-09-07)
//
// ■ 왜 이 파일이 필요한가
//   ⑧′의 「못 뗌·통째교체면 처음부터 펴져 있어야 한다」 조항은 **운영 자료에 그 사유가 0건이라
//   한 번도 판정된 적이 없다.** 그래서 ⑧″를 새로 두어, 화면이 부르는 API 한 칸을 잠시 갈아끼워
//   고정 자료로 그 조항을 실제로 판정하게 했다(운영 DB·서버는 안 건드린다).
//   그런데 ⑧″ 자체도 실화면에서만 도는 코드라 「맞게 짰다」가 또 주장이 된다 — 그래서 여기서
//   **관문 파일의 코드를 글자 그대로 떼어** 가짜 DOM 위에서 돌린다.
//
// ■ 이 시험이 재는 것 / 안 재는 것 (정직 표시)
//   재는 것: 고정 자료 두 벌(갑·을)의 자동 펼침·배지 글자·사람의 펼침 기억 불변·가로채기 되돌림,
//            그리고 「가로채기가 막히면 초록을 주지 않는다」.
//   안 재는 것: **픽셀**과 **contextBridge의 실제 쓰기 가능 여부**. 실제 앱에서 window.gijo가
//            읽기 전용이면 관문은 가로챔:false로 **빨갛게** 끝난다 — 그 갈래를 ⓗ⑥에서 잰다.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { 감독무대세우기, 감독자료, 감독소스, type 감독무대 } from "./helpers/supervisionstage";

const 관문경로 = path.join(__dirname, "../../tools/publish-gate-ui.mjs");
const 관문src = fs.readFileSync(관문경로, "utf8");

/* ── ⑧″ 코드를 관문 파일에서 **떼어 온다**(베끼지 않는다 — 베끼면 관문을 고쳐도 여기는 옛 코드를
   계속 초록으로 재서 「시험이 있다」가 오히려 거짓 안심이 된다). */
const 섹션시작 = 관문src.indexOf('// ── ⑧″');
const 섹션끝 = 관문src.indexOf("// ── ⑨", 섹션시작 + 1);
const 섹션 = 섹션시작 >= 0 && 섹션끝 > 섹션시작 ? 관문src.slice(섹션시작, 섹션끝) : "";
const 시작표 = "await fr.evaluate(async () => {";
const a = 섹션.indexOf(시작표);
const b = 섹션.indexOf("\n  }).catch(() => null) : null;", a);
const 관문본문 = a >= 0 && b > a ? 섹션.slice(a + 시작표.length, b) : "";
const c = 섹션.indexOf("const 성립 = ", b);
const d = 섹션.indexOf("\n  ok(", c);
const 성립식 = c >= 0 && d > c ? 섹션.slice(c, d) : "";

/** 관문 ⑧″의 evaluate 본문을 **떼어 온 그대로** 돌린다(기다림만 0으로 줄인다 — 재는 것은 순서다). */
async function 관문돌리기(무대: 감독무대): Promise<any> {
  const 빠른대기 = (fn: () => void) => setTimeout(fn, 0);
  // eslint-disable-next-line no-new-func
  const f = new Function("window", "document", "localStorage", "setTimeout",
    "return (async () => {" + 관문본문 + "})();");
  return await f(무대.win, 무대.doc, 무대.ls, 빠른대기);
}
function 성립판정(r: unknown): boolean {
  // eslint-disable-next-line no-new-func
  return new Function("r", 성립식 + "\n  return 성립;")(r) as boolean;
}

/** 자동 펼침을 통째로 지운 **퇴행 화면** — 관문이 이걸 초록으로 통과시키면 헛초록이다. */
const 퇴행소스 = () => {
  const 지운 = 감독소스.replace("사유.못뗌 > 0 || 사유.통째 > 0 || ", "");
  expect(지운, "퇴행을 만들 자리를 못 찾았다 — 이 시험이 헛돈다").not.toBe(감독소스);
  return 지운;
};

/** 운영의 실제 모습 — 답은 있는데 사유는 0건(2026-09-07 현재). 관문이 여기서 출발한다. */
const 실자료 = () => 감독자료([], 3);

describe("게시 관문 ⑧″ — 운영 자료가 0건이어도 위험 신호 조항을 판정한다 (전-4)", () => {
  it("ⓗ① 헛돎 방지 — 관문 파일에서 ⑧″의 코드와 성립식을 실제로 떼어 왔다", () => {
    expect(섹션, "publish-gate-ui.mjs에서 ⑧″ 구간을 못 찾았다").not.toBe("");
    expect(관문본문, "⑧″의 evaluate 본문을 못 떼어 왔다").toContain("aiteamSupervision");
    expect(관문본문, "가로채기가 먹었는지 되읽는 코드가 없다").toContain("걸기");
    expect(성립식, "성립식을 못 떼어 왔다").toContain("r.되돌아옴");
  });

  it("ⓗ①′ 관문 주석이 「운영 자료가 0건이어도 판정한다」를 밝힌다", () => {
    // 이 한 줄이 ⑧′와 ⑧″의 역할 경계다 — 없으면 다음 사람이 둘을 같은 것으로 읽는다.
    expect(섹션).toContain("운영 자료가 0건이어도 판정한다");
    expect(섹션, "운영 DB를 안 건드린다는 약속이 적혀 있어야 한다").toMatch(/서버·DB는 안 건드린다|운영 DB에 가짜 사유를 넣지 않는다/);
  });

  it("★ ⓗ② 정상 — 고정 자료로 갑·을 둘 다 저절로 펴지고 배지가 규칙대로 나온다", async () => {
    const 무대 = 감독무대세우기(실자료(), {});
    const r = await 관문돌리기(무대);
    expect(r.오류, "관문이 도중에 터졌다: " + r.오류).toBeNull();
    expect(r.갑.가로챔, "API를 못 갈아끼웠다").toBe(true);
    expect(r.갑.펼침, "위험 사유가 있는데 접힌 채로 그려졌다").toBe(true);
    expect(r.갑.보임).toBe(true);
    // 배지 N은 「못 뗌」·「통째교체」를 안 센다 — 겹침없음 2만 세어 「사유 2건」이 정답이다.
    expect(r.갑.배지, "배지 규약(배지제외)이 바뀌었거나 관문 기대값이 낡았다").toMatch(/^사유 2건/);
    expect(r.을.배지, "배지 0건 갈래(⚠ 못 뗌 N건)가 안 나온다").toMatch(/^⚠ 못 뗌 1건/);
    expect(r.을.펼침).toBe(true);
    expect(성립판정(r), "정상인데 관문이 빨갛다: " + JSON.stringify(r)).toBe(true);
  });

  it("★ ⓗ③ 퇴행 — 자동 펼침 조건을 지우면 관문이 **빨개진다**", async () => {
    const 무대 = 감독무대세우기(실자료(), {}, 퇴행소스());
    const r = await 관문돌리기(무대);
    expect(r.갑.가로챔).toBe(true);
    expect(r.갑.펼침, "지웠는데도 펴져 있다 — 무대가 헛돈다").toBe(false);
    expect(성립판정(r), "위험 사유를 접어 놓고도 관문이 초록이다").toBe(false);
  });

  it("★ ⓗ④ 되돌림 — 잰 뒤 원래 API로 돌아가고 실제 자료로 다시 그린다", async () => {
    const 무대 = 감독무대세우기(실자료(), {});
    const 진짜함수 = 무대.win.gijo.aiteamSupervision;
    const r = await 관문돌리기(무대);
    expect(r.되돌아옴, "가짜 API가 화면에 그대로 남았다 — 관문이 제품을 망가뜨렸다").toBe(true);
    expect(무대.win.gijo.aiteamSupervision, "원래 함수가 아니다").toBe(진짜함수);
    expect(r.실자료그려짐, "되돌린 뒤 화면을 다시 안 그렸다").toBe(true);
    // 실제 자료(사유 0건)로 돌아왔으므로 화면에는 사유 토글이 없어야 한다.
    expect(무대.sup(), "고정 자료의 사유 목록이 화면에 남아 있다").not.toContain("겹침없음");
    expect(무대.sup()).toContain("사유 기록은 2026-09-06부터 쌓입니다");
  });

  it("★ ⓗ⑤ 사람의 펼침 기억은 그대로 둔다 — \"0\"은 \"0\", 없던 키는 안 만든다", async () => {
    const 접어둠 = 감독무대세우기(실자료(), { "gijo:cite-reasons-open": "0" });
    const r1 = await 관문돌리기(접어둠);
    expect(접어둠.저장["gijo:cite-reasons-open"], "접어 둔 기억을 관문이 「1」로 굳혔다").toBe("0");
    expect(r1.저장후).toBe(r1.저장전);
    expect(성립판정(r1)).toBe(true);

    const 빈PC = 감독무대세우기(실자료(), {});
    const r2 = await 관문돌리기(빈PC);
    expect("gijo:cite-reasons-open" in 빈PC.저장, "없던 키를 관문이 남겼다").toBe(false);
    expect(r2.저장전).toBeNull();
    expect(r2.저장후).toBeNull();
  });

  it("★ ⓗ⑥ 반증 — 가로채기가 막히면 **초록을 주지 않는다**(못 쟀는데 통과 금지)", async () => {
    // 실제 앱의 window.gijo는 contextBridge가 내준 칸이라 판에 따라 읽기 전용일 수 있다.
    // 그때 관문이 「쟀다」고 말하면 ⑧′가 조용히 넘어가던 것보다 나쁘다 — 거짓말이 된다.
    const 무대 = 감독무대세우기(실자료(), {});
    Object.freeze(무대.win.gijo);
    const r = await 관문돌리기(무대);
    expect(r.갑.가로챔, "얼려 뒀는데 갈아끼웠다고 말한다").toBe(false);
    expect(성립판정(r), "못 쟀는데 관문이 초록이다").toBe(false);
  });

  it("ⓗ⑦ 관문의 기대 배지는 화면의 **실제 규칙**에서 온다(소스 감시)", () => {
    // 화면의 배지글 3갈래가 바뀌면 관문 기대값도 함께 고쳐야 한다 — 한쪽만 고치면 멀쩡한 화면이 빨개진다.
    expect(감독소스, "배지글 규칙이 바뀌었다 — 관문 ⑧″의 기대값을 다시 맞출 것").toContain('"사유 " + 사유.배지 + "건"');
    expect(감독소스).toContain('"⚠ 못 뗌 " + 사유.못뗌 + "건"');
    expect(성립식, "관문이 「사유 N건」 갈래를 안 본다").toContain("사유 2건");
    expect(성립식, "관문이 「⚠ 못 뗌 N건」 갈래를 안 본다").toContain("못 뗌 1건");
  });
});
