// 「보고 있던 목록」 배관이 **한 칸도 끊기지 않았는지** 전선을 따라가며 본다.
//
// ⚠ 이 배관이 왜 특별히 위험한가: 화면 → 셸 → 대화창 → 서버 → 도구까지 **다섯 칸**을 지난다.
//   한 칸만 빠져도 **아무 오류 없이 조용히 죽는다** — 화면은 멀쩡하고, 대화도 되고, 그냥
//   「이것들 전부 배정해줘」가 예전처럼 안 될 뿐이다. 그러면 「설계는 다 됐고 쓰인 적 없다」가 된다.
//   이 저장소가 실제로 반복해 겪은 부류다(선택 맥락 fields가 셸에서 조용히 사라졌던 일 등).
//
// ⚠ 특히 **결재판 칸(registry params)**이 제일 잘 빠지는 자리다. 승인 버튼은 화면에 보이는
//   칸만 모아 서버로 되돌리므로(console.js collect), params에 없는 값은 **승인하는 순간
//   증발한다.** 실행은 되는데 값만 없어서 「왜 조건이 없다고 하지?」가 된다.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { parseViewIds, stripPickMarks, VIEW_MARK, VIEW_MAX } from "../src/engine/picklist";
import { findAgentTool } from "../src/engine/agenttools";

const 읽기 = (p: string) => fs.readFileSync(new URL(p, import.meta.url), "utf8");
const pages = "../../client/src/renderer/pages/";

describe("보는목록 배관 — 다섯 칸이 이어져 있다", () => {
  it("① 화면(approvals.html)이 목록을 알린다", () => {
    const s = 읽기(pages + "approvals.html");
    expect(s, "gijo:view를 보내는 곳이 없다").toContain('type: "gijo:view"');
    expect(s, "신원을 assetId::findingKey로 안 만든다 — 서버가 못 읽는다").toMatch(/\$\{r\.assetId\}::\$\{r\.findingKey\}/);
    expect(s, "목록이 비었을 때 비우지 않는다 — 옛 목록이 남는다").toMatch(/보는목록알림\(null\)/);
    expect(s, "renderList 끝에서 알리지 않는다").toMatch(/보는목록알림\(filtered\)/);
    // ⚠ \0(구분자)을 실어 보내면 DOM·postMessage를 오가며 유실된다 — 이 화면이 427행에 적어 둔 함정.
    expect(/postMessage\(\s*\{[^}]*gijo:view[^}]*keyOf/.test(s), "gijo:view에 keyOf(\\0)를 실었다").toBe(false);
  });

  it("② 셸(app.html)이 걸러서 넘긴다 — iframe 값을 그대로 믿지 않는다", () => {
    const s = 읽기(pages + "app.html");
    expect(s, "셸이 gijo:view를 안 받는다 — 화면이 보내도 대화창까지 못 간다").toContain('d.type === "gijo:view"');
    expect(s, "대화창의 view를 안 부른다").toMatch(/gijoConsole\.view\(/);
    expect(s, "값 방어(길이·형식 확인)가 없다").toMatch(/indexOf\("::"\)/);
  });

  it("③ 대화창(console.js)이 받아 표식으로 싣는다", () => {
    const s = 읽기(pages + "console.js");
    expect(s, "gijoConsole에 view가 안 붙었다 — 셸이 불러도 없는 함수다").toMatch(/view:\s*setViewList/);
    expect(s, "지시문에 표식을 안 붙인다").toContain("#보는목록 ");
    // 보내는 글과 보이는 글이 갈려 있어야 한다 — 표식이 대화에 그대로 보이면 sha1이 줄줄이 남는다.
    expect(s, "보낼글을 따로 만들지 않았다 — 표식이 대화에 그대로 보인다").toMatch(/var 보낼글 = text;/);
    expect(s, "전송이 보낼글을 안 쓴다 — 표식을 만들고 안 보내는 꼴이다").toMatch(/sendInstruction\(보낼글,/);
    expect(s, "체크한 건(#고른건)이 있을 때 비켜서지 않는다").toContain('text.indexOf("#고른건")');
    expect(s, "화면을 옮길 때 목록을 안 버린다 — 아까 목록에 조치가 걸린다").toMatch(/보는목록 = null/);
  });

  it("④ 서버가 표식을 규칙으로 읽는다 (LLM에 안 맡긴다)", () => {
    expect(parseViewIds(`이것들 전부 배정해줘\n${VIEW_MARK} a::1,b::2`)).toBe("a::1,b::2");
    expect(parseViewIds("표식 없는 평범한 질문"), "표식이 없으면 빈 문자열").toBe("");
    // 상한을 넘으면 **자르지 않고 아예 안 쓴다** — 잘린 절반을 대상으로 삼는 게 제일 나쁘다.
    const 많이 = Array.from({ length: VIEW_MAX + 1 }, (_, i) => `a::${i}`).join(",");
    expect(parseViewIds(`${VIEW_MARK} ${많이}`), `${VIEW_MAX}건을 넘으면 안 써야 한다`).toBe("");
    const 딱 = Array.from({ length: VIEW_MAX }, (_, i) => `a::${i}`).join(",");
    expect(parseViewIds(`${VIEW_MARK} ${딱}`).split(",").length, "상한 딱 맞으면 써야 한다").toBe(VIEW_MAX);
    // 기록·표시에서는 떼어 낸다 — 안 떼면 작업 내역에 지문이 줄줄이 남는다.
    expect(stripPickMarks(`이것들 배정\n${VIEW_MARK} a::1,b::2`)).toBe("이것들 배정");
  });

  it("⑤ 결재판 칸에 viewIds가 등록돼 있다 — 없으면 승인 때 증발한다", () => {
    const t = findAgentTool("bulk_update");
    expect(t, "bulk_update 도구를 못 찾았다 — 이 검사가 헛돈다").toBeTruthy();
    const 칸 = t!.params.map((p) => p.name);
    expect(칸, "viewIds가 결재판 칸에 없다 — 승인 버튼이 보이는 칸만 모으므로 조용히 사라진다").toContain("viewIds");
    expect(칸, "ids 칸이 사라졌다").toContain("ids");
    // viewIds는 사람이 손으로 적는 값이 아니다 — 필수로 두면 승인이 막힌다.
    expect(t!.params.find((p) => p.name === "viewIds")!.required).toBe(false);
  });

  it("⑥ dispatcher가 결재판 칸에 값을 채운다 — 만들어 놓고 안 넣으면 소용없다", () => {
    const s = fs.readFileSync(new URL("../src/engine/dispatcher.ts", import.meta.url), "utf8");
    expect(s, "dispatcher가 parseViewIds를 안 부른다").toContain("parseViewIds");
    expect(s, "결재판 칸(viewIds)을 찾아 채우지 않는다").toMatch(/f\.key === "viewIds"/);
    // 이미 값이 있으면 덮지 않는다 — 사람이 고쳐 둔 것을 화면이 되돌리면 안 된다.
    expect(s, "이미 채워진 값을 덮어쓴다").toMatch(/칸 && !칸\.value/);
  });

  it("⑦ 결재판 문구와 실제 실행이 같은 갈래를 탄다", () => {
    // ⚠ effect(결재판이 보여 주는 말)와 run(실제로 하는 일)이 다른 판단을 하면
    //   「없음」이라 적어 놓고 실행되는 일이 생긴다 — 관문이 관문 노릇을 못 한다.
    const t = findAgentTool("bulk_update")!;
    const 말 = t.effect!({ filter: "이것들", viewIds: "", assignee: "정요한" });
    expect(말, "조건이 뜻을 잃고 보던 목록도 없으면 그렇게 말해야 한다").toMatch(/안 좁혀짐|정하지 않음/);
    expect(() => t.run({ filter: "이것들", assignee: "정요한" }), "말과 달리 실행되면 안 된다").toThrow();
  });
});
