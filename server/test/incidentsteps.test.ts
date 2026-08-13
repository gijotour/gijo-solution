// 장비 장애 초동 절차 (계획서 전-4, 2026-08-09)
//
// 실측 배경: 「방화벽 장비가 갑자기 죽었어」에 **도구 0개 · 8~13초 · 「근거 약함」 배너**.
// 지식 저장소에 장애 자료가 없어 모델이 일반론을 썼다(제품은 정직했지만 담당자는 급할 때
// 출처 없는 글을 10초 기다렸다). 급한 절차는 코드가 즉답한다.
//
// ⚠ 병렬 세션 보고("취약점 조치표가 나온다")는 이 회차에 **3화면×3문장 모두 재현되지 않았다** —
//   고친 것은 그 증상이 아니라 아래의 실제 공백이다(고쳤다 말하기 전에 잰다).
import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";

vi.mock("../src/engine/securityproducts", async (importOriginal) => {
  const mod = (await importOriginal()) as Record<string, unknown>;
  return { ...mod, listProducts: () => [{ id: "p1", name: "SECUI MF2", owner: "김도희" }] };
});
vi.mock("../src/engine/assets", async (importOriginal) => {
  const mod = (await importOriginal()) as Record<string, unknown>;
  return { ...mod, listAssets: () => [{ id: "a1", name: "안전대부 웹서버", owner: "이영희" }] };
});

import { 장애질문인가, 장애초동절차 } from "../src/engine/incidentsteps";

describe("장애 질문 판별 — 좁게 잡는다", () => {
  it("★ 실측 문장이 잡힌다", () => {
    expect(장애질문인가("방화벽 장비가 갑자기 죽었어")).toBe(true);
    expect(장애질문인가("IPS가 다운됐어 어떻게 해야 해?")).toBe(true);
    expect(장애질문인가("웹서버 접속이 안 돼")).toBe(true);
    expect(장애질문인가("스위치가 먹통이야")).toBe(true);
  });

  it("★★ 예방·점검·설정 질문은 삼키지 않는다 — 진짜 지시를 가로채면 그게 더 나쁘다", () => {
    expect(장애질문인가("방화벽 취약점 알려줘"), "취약점 축").toBe(false);
    expect(장애질문인가("방화벽 점검 주기 어떻게 정해?"), "점검 축").toBe(false);
    expect(장애질문인가("WAF 룰셋 설정 방법 알려줘"), "설정 축").toBe(false);
    expect(장애질문인가("이번 주 예정된 점검 있어?")).toBe(false);
  });

  it("대상이 없는 넋두리는 장애 질문이 아니다", () => {
    expect(장애질문인가("오늘 일이 안 돼")).toBe(false);
    expect(장애질문인가("접속이 안 되네")).toBe(false); // 장비어도 등록부 이름도 없다
  });

  it("★ 우리 등록부 이름이면 장비 낱말이 없어도 잡는다 — 담당자는 제품 이름으로 부른다", () => {
    // 실측(2026-08-09 배포 후): 「SECUI MF2가 먹통이야」가 장비 낱말이 없어 분기를 비켜
    // 8.8초 LLM 답으로 갔다. 이름이 곧 대상이다.
    expect(장애질문인가("SECUI MF2가 먹통이야")).toBe(true);
    expect(장애질문인가("안전대부 웹서버 죽었어")).toBe(true);
  });

  it("★★ 등록부에 없는 이름도 받는다 — 고객마다 장비 이름이 다르다", () => {
    // 실측(2026-08-09 배포 후 재측정): 실서버 등록부에 SECUI MF2가 없어 여전히 12.4초
    // LLM 답이었다. 등록 여부에 기대면 고객 환경마다 다르게 동작한다.
    expect(장애질문인가("PaloAlto PA-3220 다운됐어")).toBe(true);
    // 영문이 없는 넋두리는 여전히 아니다(위 부정 시험이 이 균형을 지킨다).
    expect(장애질문인가("오늘 일이 안 돼")).toBe(false);
  });
});

describe("초동 절차 — 급할 때 읽는 글", () => {
  it("★ 보안장비 특유의 함정(우회 구간 무방비)이 반드시 들어간다", () => {
    // 이 한 줄이 일반 IT 장애 절차와 우리를 가르는 자리다.
    const s = 장애초동절차("방화벽이 죽었어");
    expect(s).toContain("우회");
    expect(s).toMatch(/무방비|임시 차단/);
  });

  it("★★ 증거 보존이 재부팅보다 앞선다 — 순서가 뒤집히면 원인이 사라진다", () => {
    const s = 장애초동절차("IPS 다운됐어");
    expect(s.indexOf("로그 확보")).toBeLessThan(s.indexOf("이중화"));
    expect(s).toContain("재부팅 **전에**");
  });

  it("우리 등록부에 있는 장비면 담당자까지 붙인다 — 남의 매뉴얼과 다른 지점", () => {
    const s = 장애초동절차("SECUI MF2가 먹통이야");
    expect(s).toContain("SECUI MF2");
    expect(s).toContain("김도희");
  });

  it("★★ 못 찾으면 못 찾았다고 한다 — 없는 장비를 지어내지 않는다", () => {
    const s = 장애초동절차("듣보장비가 죽었어");
    expect(s).toContain("검색되지 않았습니다");
    expect(s).not.toContain("담당 ");
  });

  it("일반 순서임을 밝힌다 — 장비별 세부는 매뉴얼이 기준", () => {
    expect(장애초동절차("서버가 멈췄어")).toContain("일반 순서");
  });
});

describe("배선 감시 — dispatcher가 실제로 부른다", () => {
  it("★★ 되묻기 관문 뒤에 놓인다 — 대상 없는 대명사는 먼저 되물어야 한다", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "src", "engine", "dispatcher.ts"), "utf8");
    expect(src).toContain("if (장애질문인가(instructionText)) {");
    // 관문(!선택 && 대명사…)이 장애 분기보다 앞에 있어야 한다.
    expect(src.indexOf("if (!선택 && (대명사뿐인가")).toBeLessThan(src.indexOf("if (장애질문인가"));
  });
});
