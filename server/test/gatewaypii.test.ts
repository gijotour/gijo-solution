// 개인정보 가리기(PII) — 관문 층 (2026-08-09, 중-1·후-6 연장, 사용자 승인 "추천대로 전체 진행")
//
// 계약: ① 주민등록번호·카드번호는 LLM에 닿기 전 가린다(요청은 진행) ② 전화·이메일은
// **가리지 않고 기록만**(이 제품에선 업무 데이터 — 리포트 수신자·담당자 연락처) ③ IP·호스트명은
// 손대지 않는다 ④ 가림·기록은 privacy 감사로 남는다 ⑤ 호출자 4곳(dispatch·chat·memory·cloud)은
// 원문이 아니라 gate.text를 이후 경로에 쓴다 — 안 쓰면 가림이 장식이다(소스 감시).
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import { maskPii, gateUserInput } from "../src/engine/gateway";
import { listAudit } from "../src/engine/audit";

describe("maskPii — 가릴 것", () => {
  it("주민등록번호(하이픈)를 가린다", () => {
    const r = maskPii("담당자 주민번호가 900101-1234567 입니다");
    expect(r.text).toContain("<주민등록번호 가림>");
    expect(r.text).not.toContain("900101-1234567");
    expect(r.masked["주민등록번호"]).toBe(1);
  });

  it("주민등록번호(붙여 쓴 13자리)도 생년월일이 맞으면 가린다", () => {
    const r = maskPii("9001011234567 확인 부탁");
    expect(r.text).toContain("<주민등록번호 가림>");
  });

  it("밀리초 epoch(13자리)는 주민번호가 아니다 — 월 자리가 어긋난다", () => {
    // 로그 분석 입력에 흔한 숫자다. 가려 버리면 시각 정보가 사라져 분석이 깨진다.
    const r = maskPii("이벤트 시각 1786176659365 로그 분석해줘");
    expect(r.text).toContain("1786176659365");
    expect(r.masked["주민등록번호"]).toBeUndefined();
  });

  it("카드번호는 Luhn 검산 통과 시에만 가리고 끝 4자리를 남긴다", () => {
    const r = maskPii("결제 카드 4539-1488-0343-6467 문의"); // Luhn 유효한 시험용 번호
    expect(r.text).toContain("<카드번호 가림·끝 6467>");
    expect(r.text).not.toContain("4539-1488");
  });

  it("검산에 실패하는 16자리(자산 일련번호 등)는 건드리지 않는다", () => {
    const r = maskPii("장비 일련번호 1234-5678-9012-3456 등록 확인");
    expect(r.text).toContain("1234-5678-9012-3456");
    expect(r.masked["카드번호"]).toBeUndefined();
  });
});

describe("maskPii — 기록만 할 것·손대지 않을 것", () => {
  it("이메일은 가리지 않는다(리포트 수신자 지시가 깨진다) — 기록만", () => {
    const r = maskPii("리포트를 kim@corp.co.kr 로 보내줘");
    expect(r.text).toContain("kim@corp.co.kr");
    expect(r.noted["이메일"]).toBe(1);
  });

  it("전화번호는 가리지 않는다 — 기록만", () => {
    const r = maskPii("담당자 연락처 010-1234-5678 등록해줘");
    expect(r.text).toContain("010-1234-5678");
    expect(r.noted["전화번호"]).toBe(1);
  });

  it("IP·호스트명은 기록조차 하지 않는다 — 보안 업무의 원료다", () => {
    const r = maskPii("192.168.219.98 서버의 취약점 점검해줘");
    expect(r.text).toContain("192.168.219.98");
    expect(Object.keys(r.masked)).toHaveLength(0);
    expect(Object.keys(r.noted)).toHaveLength(0);
  });
});

describe("관문 통합", () => {
  it("gate.text가 가린 본을 돌려주고 privacy 감사가 남는다", () => {
    const before = listAudit({ kind: "privacy" }).length;
    const gate = gateUserInput("주민번호 900101-2345678 가진 직원 계정 점검", "dispatch");
    expect(gate.allowed).toBe(true); // 가림은 차단이 아니다
    expect(gate.text).toContain("<주민등록번호 가림>");
    const after = listAudit({ kind: "privacy" });
    expect(after.length).toBe(before + 1);
    expect(after[0].action).toContain("개인정보 가림");
    // 감사 상세에도 원문 숫자가 남지 않는다 — 남기면 감사로그가 유출 지점이 된다
    expect(JSON.stringify(after[0])).not.toContain("2345678");
  });

  it("깨끗한 입력은 원문 그대로, 감사도 안 남긴다", () => {
    const before = listAudit({ kind: "privacy" }).length;
    const gate = gateUserInput("오늘 취약점 현황 알려줘", "chat");
    expect(gate.text).toBe("오늘 취약점 현황 알려줘");
    expect(listAudit({ kind: "privacy" }).length).toBe(before);
  });
});

describe("★ 소스 감시 — 호출자가 가린 본(gate.text)을 실제로 쓴다", () => {
  // 함수를 만들어도 안 부르는 호출부가 계속 샌다(feedback_source_watch_tests, 9곳 실측).
  // 관문이 가린 텍스트를 돌려줘도 호출자가 원문을 계속 쓰면 **아무것도 안 가려진다.**
  const read = (f: string) => fs.readFileSync(new URL(`../src/engine/${f}`, import.meta.url), "utf8");

  it("dispatcher가 guard.text로 갈아탄다", () => {
    const src = read("dispatcher.ts");
    const i = src.indexOf('gateUserInput(instructionText, "dispatch")');
    expect(i, "관문 호출을 못 찾았다 — 시험이 헛돌고 있다").toBeGreaterThan(0);
    expect(src.slice(i, i + 400)).toContain("instructionText = guard.text");
  });

  it("chat(llm.ts)이 gate.text로 갈아탄다", () => {
    const src = read("llm.ts");
    const i = src.indexOf('gateUserInput(args.message, "chat")');
    expect(i).toBeGreaterThan(0);
    expect(src.slice(i, i + 400)).toContain("args.message = gate.text");
  });

  it("memory 질의가 gate.text로 갈아탄다", () => {
    const src = read("memory.ts");
    const i = src.indexOf('"memory-query"');
    expect(i).toBeGreaterThan(0);
    expect(src.slice(i, i + 500)).toContain("req.body.question = gate.text");
  });

  it("명령 추천(cmdsuggest)이 gate.text로 넘긴다", () => {
    // 처음 배선 때 실제로 빠뜨렸던 곳이다 — 아래 '정확히 이 5곳' 감시가 잡아냈다.
    const src = read("cmdsuggest.ts");
    const i = src.indexOf('gateUserInput(request, "chat")');
    expect(i).toBeGreaterThan(0);
    expect(src.slice(i, i + 400)).toContain("suggestCommand(gate.text)");
  });

  it("cloud 질의가 gate.text로 갈아탄다 — 밖으로 나가는 경로가 제일 중요하다", () => {
    const src = read("cloudllm.ts");
    const i = src.indexOf('gateUserInput(q, "cloud")');
    expect(i).toBeGreaterThan(0);
    expect(src.slice(i, i + 600)).toContain("q = gate.text");
  });

  it("이 감시가 헛돌고 있지 않다 — 관문 입구는 정확히 이 5곳이다", () => {
    // 새 입구가 생기면 이 시험이 알아채고, 그 입구도 gate.text를 쓰게 만든다.
    // ⚠ routes.ts는 뺀다 — **실행하지 않는 표**다(그 파일 머리글). 2026-09-04에 결정적 체인을
    //   표로 옮기면서 `감시` 칸에 「const guard = gateUserInput(instructionText」라는 **코드
    //   글자를 그대로** 적었더니 입구로 세어졌다. 부르는 곳이 아니라 적어 둔 곳이라, 안 빼면
    //   이 감시가 「입구가 6곳」이라고 거짓을 말한다(빼는 이유를 여기 적는 것이 이 저장소 관례).
    const files = fs.readdirSync(new URL("../src/engine/", import.meta.url)).filter((f) => f.endsWith(".ts"));
    const 입구 = files.filter((f) => read(f).includes("gateUserInput(") && f !== "gateway.ts" && f !== "routes.ts");
    expect(입구.sort()).toEqual(["cloudllm.ts", "cmdsuggest.ts", "dispatcher.ts", "llm.ts", "memory.ts"]);
  });
});
