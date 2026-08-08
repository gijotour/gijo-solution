// 해석 한 줄 — 질문을 어느 도구로 알아들었는지 사람 말로 (Purple AI 쿼리 투명성 채택, 2026-08-09).
//
// 왜: 라우팅이 어긋난 날(예: 08-09 "담당자를 김도희로 지정해줘"가 오늘 목록으로 흡수),
// 담당자가 20분짜리 게이트가 아니라 **그 자리에서** 알아차려야 한다.
import { describe, it, expect } from "vitest";
import { toolLabel } from "../src/engine/agenttools";
import fs from "fs";
import path from "path";

describe("도구 라벨", () => {
  it("주요 도구는 전부 사람 말 라벨이 있다", () => {
    for (const t of ["today", "search", "finding_status", "list_assets", "register_asset", "compliance_status"]) {
      const l = toolLabel(t);
      expect(l, `${t}의 라벨이 없다`).toBeTruthy();
      expect(/^[a-z_]+$/.test(l!), `${t} 라벨이 내부 식별자 그대로다: ${l}`).toBe(false);
    }
  });
  it("없는 도구는 null — 지어내지 않는다", () => {
    expect(toolLabel("no_such_tool")).toBeNull();
  });
});

describe("해석을 다는 규칙 (소스 계약)", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "engine", "dispatcher.ts"), "utf8");
  it("출구 한 곳에서 단다 — 갈래마다 심지 않는다", () => {
    expect((src.match(/해석을단다\(/g) ?? []).length).toBe(2); // 정의 1 + 출구 호출 1
  });
  it("결재판·확인 대기에는 안 단다", () => {
    const 블록 = src.slice(src.indexOf("function 해석을단다"));
    expect(블록).toContain("r.approval || r.confirm");
  });
  it("라벨 없는 도구는 건너뛴다 — 내부 식별자를 내보내지 않는다", () => {
    const 블록 = src.slice(src.indexOf("function 해석을단다"));
    expect(블록).toContain("filter((x): x is string => !!x)");
  });
});
