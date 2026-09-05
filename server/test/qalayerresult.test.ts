// QA 전수조사 계층 판정(tools/qa-layer-result.mjs)의 **「판정 못 함」 회귀 시험**. (계획서: 중-7 운영 게이트)
//
// ■ 무슨 일이 있었나 (2026-09-05)
//   tools/docs-drift.mjs는 fc396fdb부터 종료 코드에 뜻을 나눠 준다 — 0=같음 · 1=어긋남 · **2=판정 못 함**.
//   그런데 tools/qa-full.mjs의 run()은 `r.status === 0` 하나로만 봐서 **2를 1과 똑같이 ✗ 실패로** 셌다.
//   그러면 「이 도구를 돌릴 환경이 아니었다(win 호스트 전용인데 WSL에서 돌렸다)」가
//   「문서가 어긋났다」로 보고되고, 마커까지 안 갱신돼 다음 실행이 같은 변경을 또 돈다.
//   ★ **재지 못한 것을 빨강으로 칠하는 것도 거짓말이다** — 이 저장소가 거짓 초록으로 데었던 것과
//     뿌리가 같다(모르는 것을 아는 척하기). 그래서 세 번째 자리를 만들었다: 회색(?) + 원인 문구.
//
// ⚠ 이 시험은 **가짜 종료 코드**로 잰다 — 실제 QA 계층을 돌리지 않는다(직렬 자원·운영 서버 불가침).
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { 계층결과, 기호, 변경목록 } from "../../tools/qa-layer-result.mjs";

const 뿌리 = path.resolve(__dirname, "..", "..");
const qaFull: string = fs.readFileSync(path.join(뿌리, "tools", "qa-full.mjs"), "utf8");
const docs옵션 = { 판정못함코드: [2], 판정못함사유: "이 도구는 win 호스트 전용이다" };

describe("QA 계층 판정 — 「판정 못 함」은 「어긋남」이 아니다", () => {
  it("★ docs 계층의 exit 2는 실패가 아니라 **판정 못 함**이다(회색 + 원인 문구)", () => {
    const r = 계층결과("docs", 2, 1234, docs옵션);
    expect(r.ok, "exit 2가 실패(false)로 세어졌다 — 환경 문제가 문서 결함으로 둔갑한다").not.toBe(false);
    expect(r.판정못함).toBe(true);
    expect(기호(r)).toBe("?");            // 초록도 빨강도 아니다
    expect(r.note).toContain("종료코드 2");
    expect(r.note).toContain("win 호스트 전용"); // 원인 문구가 반드시 붙는다
  });

  it("★ exit 0은 통과 · exit 1은 **여전히 실패**다(회색이 진짜 실패를 삼키면 안 된다)", () => {
    expect(계층결과("docs", 0, 1, docs옵션).ok).toBe(true);
    expect(기호(계층결과("docs", 0, 1, docs옵션))).toBe("✓");
    const 실패 = 계층결과("docs", 1, 1, docs옵션);
    expect(실패.ok).toBe(false);
    expect(실패.판정못함).toBeUndefined();
    expect(기호(실패)).toBe("✗");
  });

  it("★ 약속하지 않은 계층의 exit 2는 **그대로 실패**다 — 아무 데나 봐주면 결함이 회색에 숨는다", () => {
    const r = 계층결과("vitest", 2, 1); // opts 없음
    expect(r.ok).toBe(false);
    expect(r.판정못함).toBeUndefined();
    expect(기호(r)).toBe("✗");
  });

  it("사유를 안 주면 비워 두지 않고 **무엇을 하라고** 적는다", () => {
    const r = 계층결과("docs", 2, 1, { 판정못함코드: [2] });
    expect(String(r.note).trim().length).toBeGreaterThan(10);
    expect(r.note).toContain("다시 돌리세요");
  });

  it("기호 — 스킵(―)과 판정 못 함(?)은 다른 자리다", () => {
    expect(기호({ name: "sweep", ok: null, ms: 0, note: "스킵(Electron 미기동)" })).toBe("―");
    expect(기호({ name: "docs", ok: null, ms: 0, 판정못함: true })).toBe("?");
    expect(기호({ name: "server", ok: false, ms: 0 }, true)).toBe("⚠"); // 알려진 이슈
  });
});

describe("QA 전수조사 — 판정 규칙이 **한 곳**이고, 미판정이 「통과」로 덮이지 않는다(소스 감시)", () => {
  it("run()은 판정을 직접 하지 않고 계층결과()에 맡긴다 — 두 곳에 적으면 어긋난다", () => {
    expect(qaFull).toContain('from "./qa-layer-result.mjs"');
    expect(qaFull).toContain("계층결과");
    expect(qaFull).toMatch(/results\.push\(계층결과\(name, r\.status, ms, opts\)\)/);
    // 옛 판정문이 남아 있으면 단일 출처가 아니다.
    expect(/results\.push\(\{ name, ok: r\.status === 0/.test(qaFull), "옛 판정문이 남아 있다").toBe(false);
  });

  it("★ docs 계층이 실제로 판정못함코드 2를 달고 불린다(안 달면 이 수리가 무의미하다)", () => {
    expect(qaFull).toMatch(/run\("docs", "node", \["tools\/docs-drift\.mjs"\], \{[\s\S]*?판정못함코드: \[2\]/);
  });

  it("★ 마무리 문장이 「전 계층 통과」로 미판정을 덮지 않는다", () => {
    expect(/✓ 전 계층 통과/.test(qaFull), "미판정이 있어도 「전 계층 통과」라고 말한다").toBe(false);
    expect(qaFull).toContain("잰 계층은 전부 통과");
    expect(qaFull).toContain("재지 못했다");
  });

  it("마커·리포트에도 미판정이 남는다 — 안 남기면 기록에서 사라진다", () => {
    expect(qaFull).toMatch(/미판정: 미판정\.map/);
    expect(qaFull).toContain("판정못함");
  });
});

// ── 곁다리로 적발한 실결함 (2026-09-05) ───────────────────────────────────────
//   위 수리를 실화면으로 확인하다 리포트에 「- ools/local-digest.mjs」가 찍힌 것을 봤다.
//   qa-full.mjs의 git 헬퍼가 출력을 통째로 `.trim()`해서 porcelain **첫 줄의 앞 공백**이
//   깎였고, slice(3)이 경로의 첫 글자까지 먹었다. 그 파일은 계층 매핑에 하나도 안 걸려
//   **돌아야 할 계층이 조용히 안 돌았다** — 이 저장소가 되풀이해 겪은 그 함정이다.
describe("QA 전수조사 — 변경 파일 이름이 **한 글자도 깎이지 않는다**", () => {
  it("★ 미스테이지 수정(줄 앞 공백)의 첫 줄에서도 경로가 온전하다", () => {
    // 실측 사고 재현: git()이 통째 trim한 값 — 첫 줄의 앞 공백 한 칸이 없다.
    const 깎인출력 = "M tools/local-digest.mjs\n M tools/qa-full.mjs\n?? .tmp-findings.json";
    const 원문 = " M tools/local-digest.mjs\n M tools/qa-full.mjs\n?? .tmp-findings.json";
    expect(변경목록(원문)[0]).toBe("tools/local-digest.mjs");
    expect(변경목록(원문)).toEqual(["tools/local-digest.mjs", "tools/qa-full.mjs", ".tmp-findings.json"]);
    // 깎인 입력을 주면 첫 글자가 사라진다 — 그래서 **원문을 그대로 넘겨야 한다**는 증거.
    expect(변경목록(깎인출력)[0]).not.toBe("tools/local-digest.mjs");
  });

  it("★ 이 깎임이 계층 매핑을 통째로 빗나가게 한다(왜 실결함인가)", () => {
    const 원문 = " M server/src/engine/dispatcher.ts";
    const [온전] = 변경목록(원문);
    expect(온전.startsWith("server/")).toBe(true); // 서버 계층에 걸린다
    expect("erver/src/engine/dispatcher.ts".startsWith("server/")).toBe(false); // 깎이면 안 걸린다
  });

  it("이름 바뀐 항목은 **새 이름**만 본다 · 빈 줄·짧은 줄은 버린다", () => {
    expect(변경목록("R  tools/old.mjs -> tools/new.mjs")).toEqual(["tools/new.mjs"]);
    expect(변경목록("")).toEqual([]);
    expect(변경목록(undefined)).toEqual([]);
    expect(변경목록("\n\n M a/b.ts\n")).toEqual(["a/b.ts"]);
  });

  it("qa-full은 porcelain을 **원문 그대로** 넘긴다(소스 감시)", () => {
    expect(qaFull).toMatch(/변경목록\(execSync\("git status --porcelain"/);
    expect(/git\("status --porcelain"\)/.test(qaFull), "다듬은 값을 넘기던 옛 코드가 남아 있다").toBe(false);
  });
});
