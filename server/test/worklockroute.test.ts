// 내 할 일 라우팅의 **자물쇠** — 뺏어도 되는 말과 뺏으면 안 되는 말.
//
// ★ 2026-08-01 검토에서 이 자리로 두 번 데었다. 둘 다 "좁혔다"고 주석에 적어 놓고
//   실제로는 안 좁혀져 있었다.
//   ① 완료 판정에 낱말 제외어(취약점|점검|자산|CVE)를 썼다 → 정작 **업무 이름 자체가**
//      그 낱말로 만들어져("10.10.20.41 — 취약점 점검") 목록이 시킨 그대로 친 말이 안 통했다.
//   ② 절차 질문의 부분일치에 길이 하한이 없었다 → **"점검"** 두 글자가 "웹서버-01 — 취약점
//      점검"에 걸려, 일반 지식 질문에 특정 호스트 체크리스트가 답으로 나갈 뻔했다.
//
// 그래서 이 파일은 **양쪽을 함께** 본다: 잡아야 할 말을 잡는가, 그리고 남의 말을 안 뺏는가.
import { describe, it, expect, beforeEach } from "vitest";
import { 내할일절차질문, 내할일완료말 } from "../src/engine/dispatcher";
import { createTask, resetTasksForTests } from "../src/engine/tasks";

describe("★ 잡아야 할 말은 잡는다", () => {
  beforeEach(() => {
    resetTasksForTests();
    createTask({ text: "10.10.20.41 — 취약점 점검" });
    createTask({ text: "제품유지보수" });
  });

  it("목록이 시킨 그대로 친 완료가 통한다", async () => {
    // 이 이름은 죄다 '취약점·점검'으로 만들어진다 — 낱말 제외어를 쓰면 여기서 막힌다.
    expect(await 내할일완료말("10.10.20.41 — 취약점 점검 완료")).toBe("10.10.20.41 — 취약점 점검");
    expect(await 내할일완료말("제품유지보수 끝냈어")).toBe("제품유지보수");
    expect(await 내할일완료말("제품유지보수 다 했습니다")).toBe("제품유지보수");
  });

  it("절차 질문도 같은 이름으로 통한다", async () => {
    expect(await 내할일절차질문("10.10.20.41 — 취약점 점검 어떻게 해?")).toBe("10.10.20.41 — 취약점 점검");
    expect(await 내할일절차질문("제품유지보수 뭐부터 해?")).toBe("제품유지보수");
  });
});

describe("★ 남의 말을 뺏지 않는다", () => {
  beforeEach(() => {
    resetTasksForTests();
    createTask({ text: "웹서버-01 — 취약점 점검" });
  });

  it("유형명 두 글자로는 안 걸린다", async () => {
    // "점검 절차 알려줘"는 일반 지식 질문이다. 여기 걸리면 특정 호스트 체크리스트가 답이 된다.
    expect(await 내할일절차질문("점검 절차 알려줘")).toBeNull();
    expect(await 내할일절차질문("조치 어떻게 해?")).toBeNull();
  });

  it("이름의 절반도 안 대면 안 걸린다", async () => {
    // "취약점 점검"은 유형명이지 이 일감을 특정하지 못한다(호스트가 여럿일 수 있다).
    expect(await 내할일절차질문("취약점 점검 어떻게 해?")).toBeNull();
  });

  it("화면 사용법은 screenguide의 몫이다", async () => {
    expect(await 내할일절차질문("이 화면 어떻게 써?")).toBeNull();
    expect(await 내할일절차질문("이 메뉴 뭐부터 해?")).toBeNull();
  });

  it("취약점 상태를 바꾸는 지시는 완료로 가로채지 않는다", async () => {
    // 그건 update_finding_status의 몫이다 — 어형으로 가른다(낱말이 아니라).
    expect(await 내할일완료말("CVE-2021-44228 조치 완료 처리해줘")).toBeNull();
    expect(await 내할일완료말("웹서버-01 상태를 완료로 바꿔줘")).toBeNull();
  });

  it("목록에 없는 이름은 안 걸린다", async () => {
    expect(await 내할일완료말("점심 완료")).toBeNull();
    expect(await 내할일절차질문("Log4Shell 어떻게 해?")).toBeNull();
  });
});
