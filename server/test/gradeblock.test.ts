// 등급 차단 — **못 보는 자료가 정말 안 나오는가** (N2SF, GIJO_AS_등급라벨_설계.md)
//
// 이 기능의 위험은 하나다: **라벨은 붙었는데 아무것도 못 막는 것.**
// 그럼 조달 검토자에게 "등급 통제 있습니다"라고 말해 놓고 실제로는 다 열린 상태가 된다 —
// 없는 것보다 나쁘다(있다고 믿고 기밀 자료를 넣는다).
// 그래서 ① 기본값이 닫히는 쪽인지 ② 검색 조건에 실제로 들어가는지를 못 박는다.
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import { gradeOf, clearanceOf, canRead, blockedGrades, GRADES, DEFAULT_DOC_GRADE } from "../src/engine/grades";

describe("★ 모르면 닫힌다", () => {
  it("자료의 등급을 못 읽으면 기밀로 본다", () => {
    // 모르는 자료를 공개로 두면 그 순간 새어 나간다.
    expect(gradeOf(undefined)).toBe("C");
    expect(gradeOf(null)).toBe("C");
    expect(gradeOf("")).toBe("C");
    expect(gradeOf("아무거나")).toBe("C");
  });

  it("사람의 열람 등급을 못 읽으면 공개만 본다", () => {
    // 모르는 사람에게 열어 주지 않는다.
    expect(clearanceOf(undefined)).toBe("O");
    expect(clearanceOf(null)).toBe("O");
    expect(clearanceOf("이상한값")).toBe("O");
  });

  it("제대로 적힌 값은 그대로 읽는다(대소문자 무관)", () => {
    expect(gradeOf("s")).toBe("S");
    expect(clearanceOf(" c ")).toBe("C");
  });
});

describe("누가 무엇을 볼 수 있나", () => {
  it("자기 등급 이하만 본다", () => {
    expect(canRead("O", "O")).toBe(true);
    expect(canRead("O", "S"), "공개 권한으로 민감을 보면 안 된다").toBe(false);
    expect(canRead("O", "C")).toBe(false);
    expect(canRead("S", "O")).toBe(true);
    expect(canRead("S", "S")).toBe(true);
    expect(canRead("S", "C"), "민감 권한으로 기밀을 보면 안 된다").toBe(false);
    expect(canRead("C", "C")).toBe(true);
  });

  it("막을 등급 목록이 권한과 맞아떨어진다", () => {
    expect(blockedGrades("O")).toEqual(["S", "C"]);
    expect(blockedGrades("S")).toEqual(["C"]);
    expect(blockedGrades("C")).toEqual([]);
  });

  it("등급 순서를 바꾸면 비교가 뒤집힌다 — 순서를 못 박는다", () => {
    expect(GRADES).toEqual(["O", "S", "C"]);
  });

  it("새 자료 기본은 민감 — 공개도 기밀도 아니다", () => {
    // 공개면 모르는 사이에 다 열리고, 기밀이면 아무도 못 봐서 담당자가 기능을 꺼 버린다.
    expect(DEFAULT_DOC_GRADE).toBe("S");
  });
});

describe("★ 검색 '전에' 막는다 — 가져온 뒤 거르지 않는다", () => {
  const memSrc = fs.readFileSync(new URL("../src/engine/memory.ts", import.meta.url), "utf8");

  it("차단이 검색 조건(where)에 들어간다", () => {
    // 가져온 뒤 지우면 AI가 이미 본 상태라 흔적이 답에 남을 수 있다.
    // 표준(OWASP RAG 등)이 한목소리로 "검색 전에 막아라"라고 하는 이유다.
    const i = memSrc.indexOf("const whereClause =");
    expect(i, "where 절을 못 찾았다 — 시험이 헛돌고 있다").toBeGreaterThan(0);
    const 절 = memSrc.slice(i, i + 420);
    expect(절, "가림 목록이 검색 조건에 안 들어간다").toContain("documentId NOT IN");
  });

  it("LanceDB 스키마를 건드리지 않는다 — 등급은 SQLite에 있다", () => {
    // 벡터 저장소에 컬럼을 더하는 일은 지식 소실 위험이 있다(과거 실사고).
    expect(memSrc).toContain("SELECT documentId, grade FROM memory_documents");
  });

  it("viewer가 없으면 가리지 않는다 — 내부 호출이 통째로 죽지 않게", () => {
    const i = memSrc.indexOf("export function hiddenDocIds");
    const 함수 = memSrc.slice(i, i + 300);
    expect(함수, "viewer 없을 때 빈 배열을 돌려줘야 한다").toContain("if (!viewer) return []");
  });
});

describe("★ 사람이 묻는 입구에서는 반드시 열람 등급을 싣는다", () => {
  // viewer를 안 실으면 등급 통제가 **한 줄도 동작하지 않는다**(가짜 통제).
  const llmSrc = fs.readFileSync(new URL("../src/engine/llm.ts", import.meta.url), "utf8");
  const dispSrc = fs.readFileSync(new URL("../src/engine/dispatcher.ts", import.meta.url), "utf8");

  it("대화 입구(/api/llm/chat)가 로그인한 사람의 등급을 넘긴다", () => {
    expect(llmSrc).toContain("viewer: { userId: who?.id, clearance: who?.clearance }");
  });

  it("디스패치 입구(/api/dispatch)도 넘긴다", () => {
    expect(dispSrc).toContain("{ userId: user?.id, clearance: user?.clearance }");
  });

  it("chat()이 받은 등급을 RAG 검색까지 흘린다", () => {
    expect(llmSrc, "ragContextFor에 안 넘기면 거기서 끊긴다").toContain("args.screen, args.viewer");
    expect(llmSrc, "검색 함수까지 안 가면 아무 소용 없다").toContain("queryMemoryRelevant(message, 4, agentId, screen, viewer)");
  });

  it("등급을 바꾸는 길이 있고, 바꾼 것이 감사에 남는다", () => {
    // 라벨을 붙일 수 없으면 기능이 아니다. 그리고 "누가 언제 누구를 어디까지 열어 줬나"는
    // 보안 사고 조사의 첫 질문이라 반드시 남아야 한다.
    const memSrc2 = fs.readFileSync(new URL("../src/engine/memory.ts", import.meta.url), "utf8");
    const usersSrc = fs.readFileSync(new URL("../src/auth/users.ts", import.meta.url), "utf8");
    expect(memSrc2, "문서 등급을 바꾸는 라우트가 없다").toContain("/api/memory/document/grade");
    expect(memSrc2.slice(memSrc2.indexOf("/api/memory/document/grade")), "문서 등급 변경이 감사에 안 남는다")
      .toContain("문서 등급 변경");
    expect(usersSrc, "계정 열람 등급을 바꾸는 라우트가 없다").toContain("/api/users/:id/clearance");
    expect(usersSrc.slice(usersSrc.indexOf("/api/users/:id/clearance")), "열람 등급 변경이 감사에 안 남는다")
      .toContain("열람 등급 변경");
  });

  it("★ 열람 등급은 관리자만 바꾼다 — 자기 등급을 스스로 올릴 수 없다", () => {
    const usersSrc = fs.readFileSync(new URL("../src/auth/users.ts", import.meta.url), "utf8");
    const i = usersSrc.indexOf('"/api/users/:id/clearance"');
    const 줄 = usersSrc.slice(i, i + 120);
    expect(줄, "adminMiddleware가 없으면 아무나 자기 등급을 올린다").toContain("adminMiddleware");
  });

  it("문서 목록이 등급을 함께 준다 — 화면이 배지를 그리려면 필요하다", () => {
    const memSrc3 = fs.readFileSync(new URL("../src/engine/memory.ts", import.meta.url), "utf8");
    expect(memSrc3).toContain("grade: meta?.grade ?? null");
  });

  it("★ 지식검색 화면(/api/memory/query)도 등급을 싣는다 — 뚫린 문이었다", () => {
    // 2026-08-01 실검증에서 발견: 대화(chat)는 등급을 지키는데 검색 라우트는 안 실었다.
    // 대화창은 잠그고 검색창은 열어 둔 셈 — 이런 우회로가 하나만 있어도 통제 전체가 무의미하다.
    const memSrc4 = fs.readFileSync(new URL("../src/engine/memory.ts", import.meta.url), "utf8");
    const i = memSrc4.indexOf('"/api/memory/query"');
    const 라우트 = memSrc4.slice(i, i + 1600);
    expect(라우트, "검색 라우트가 열람 등급을 안 넘긴다").toContain("clearance: who?.clearance");
  });

  it("★ AI 도구로 물어도 막힌다 — 요청에 사람 꼬리표가 달린다", () => {
    // 도구(search·explain)는 run(args) 한 모양이라 사람을 넘길 자리가 없다.
    // 꼬리표(AsyncLocalStorage)를 안 달면 "log4shell 찾아줘"로 기밀 문서가 그대로 나온다.
    const dispSrc2 = fs.readFileSync(new URL("../src/engine/dispatcher.ts", import.meta.url), "utf8");
    const memSrc5 = fs.readFileSync(new URL("../src/engine/memory.ts", import.meta.url), "utf8");
    expect(dispSrc2, "디스패치가 꼬리표를 안 단다").toContain("runWithViewer(viewer");
    expect(memSrc5, "검색이 꼬리표를 안 집는다").toContain("hiddenDocIds(viewer ?? currentViewer())");
  });

  it("★ 제목도 가린다 — 파일명만으로 새는 것이 있다", () => {
    // "퇴사자명단_최종.xlsx"는 열어 보지 않아도 알려 준다.
    const memSrc6 = fs.readFileSync(new URL("../src/engine/memory.ts", import.meta.url), "utf8");
    const toolSrc = fs.readFileSync(new URL("../src/engine/agenttools.ts", import.meta.url), "utf8");
    expect(memSrc6).toContain("export async function listVisibleDocuments");
    expect(toolSrc, "AI 도구가 전체 목록을 그대로 보여 준다").not.toContain("await listDocuments()");
  });

  it("★ 등급은 서버가 읽는다 — 요청이 주장할 수 없다", () => {
    // 클라이언트가 clearance를 보내 올릴 수 있으면 통제 전체가 무의미하다.
    // 두 입구 모두 req.body가 아니라 **로그인 사용자**에서 읽어야 한다.
    expect(llmSrc.includes("viewer: req.body"), "요청 본문에서 등급을 읽으면 안 된다").toBe(false);
    expect(dispSrc.includes("req.body?.clearance"), "요청 본문에서 등급을 읽으면 안 된다").toBe(false);
  });
});
