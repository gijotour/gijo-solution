// ragscope — ☑ 근거 지정·📎 지난 작업 첨부의 요청 꼬리표(노트북형 2026-08-30).
//
// ★ 지키는 것 넷
//   ① 소독 상한 — docIds는 사용자가 임의 문자열을 넣는 새 창구다(50개·200자·중복 제거).
//   ② ALS 전파 — 비동기 체인을 넘어 꼬리표가 살아 있다(도구·배지·normaltic이 이걸 믿는다).
//   ③ 보안 겹침 — 지정 필터(IN)는 등급 가림(NOT IN)에 AND로 겹친다. 지정이 가림을 푸는
//     코드 모양이 되면 즉시 실패해야 한다(기밀 문서를 ☑로 콕집는 우회 = 6번째 구멍).
//   ④ 첨부 압축은 「같은 세션」이라 말하지 않는다 — 다른 세션의 기록이니까(거짓말 방지).
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  runWithRagScope, currentDocIds, currentAttachText,
  sanitizeDocIds, sanitizeAttachIds, DOC_IDS_MAX, ATTACH_MAX,
} from "../src/engine/ragscope";
import { db } from "../src/db";
import { createSession, appendTurn, attachSessionText } from "../src/engine/worksessions";

const MEMORY_SRC = readFileSync(join(__dirname, "..", "src", "engine", "memory.ts"), "utf-8");
const LLM_SRC = readFileSync(join(__dirname, "..", "src", "engine", "llm.ts"), "utf-8");
const DISPATCHER_SRC = readFileSync(join(__dirname, "..", "src", "engine", "dispatcher.ts"), "utf-8");

describe("ragscope — 입구 소독", () => {
  it("배열이 아니면·문자열 아니면 빈 배열, 개수·길이 상한, 중복 제거", () => {
    expect(sanitizeDocIds(undefined)).toEqual([]);
    expect(sanitizeDocIds("a.md")).toEqual([]); // 배열 아님
    expect(sanitizeDocIds(["a.md", 3, null, "a.md", " b.pdf "])).toEqual(["a.md", "b.pdf"]);
    const 많이 = sanitizeDocIds(Array.from({ length: 99 }, (_, i) => `d${i}`));
    expect(많이.length, "개수 상한이 안 걸린다").toBe(DOC_IDS_MAX);
    const 긴것 = sanitizeDocIds(["x".repeat(999)]);
    expect(긴것[0].length, "길이 상한이 안 걸린다").toBe(200);
  });

  it("문서명에 공백·한글이 있어도 살아남는다 — 표식 통로가 아니라 배열 통로를 고른 이유", () => {
    expect(sanitizeDocIds(["202506_SafeBreach_제품소개.pptx", "취약점 관리 지침.md"]))
      .toEqual(["202506_SafeBreach_제품소개.pptx", "취약점 관리 지침.md"]);
  });

  it("첨부는 최대 3개", () => {
    expect(sanitizeAttachIds(["a", "b", "c", "d", "e"]).length).toBe(ATTACH_MAX);
  });
});

describe("ragscope — ALS 전파", () => {
  it("꼬리표가 비동기 체인을 따라간다·밖에서는 비어 있다", async () => {
    expect(currentDocIds()).toEqual([]);
    const 결과 = await runWithRagScope({ docIds: ["a.md"], attachText: "첨부" }, async () => {
      await new Promise((r) => setTimeout(r, 5));
      return { d: currentDocIds(), a: currentAttachText() };
    });
    expect(결과.d).toEqual(["a.md"]);
    expect(결과.a).toBe("첨부");
    expect(currentDocIds(), "밖으로 샜다").toEqual([]);
  });

  it("빈 꼬리표는 무동작 — 기존 요청과 완전 동일 경로", () => {
    runWithRagScope({ docIds: [], attachText: undefined }, () => {
      expect(currentDocIds()).toEqual([]);
    });
  });
});

describe("ragscope — 소스 계약(소비처가 실제로 배선돼 있나)", () => {
  it("★③ memory.ts: 지정 IN 필터가 등급 가림 NOT IN과 **같은 whereClause에 AND로** 겹친다", () => {
    // 「가림 NOT IN … + 지정 IN …」 한 식이어야 한다 — 지정이 가림을 대체하는 모양이 되면
    // 기밀 문서를 ☑로 콕집는 우회가 열린다.
    const i가림 = MEMORY_SRC.indexOf("AND documentId NOT IN");
    const i지정 = MEMORY_SRC.indexOf("AND documentId IN");
    expect(i가림, "등급 가림이 사라졌다").toBeGreaterThan(0);
    expect(i지정, "지정 필터가 안 걸려 있다").toBeGreaterThan(0);
    // 같은 whereClause 표현식 안(300자 이내)에 붙어 있어야 한다
    expect(Math.abs(i지정 - i가림), "두 필터가 같은 whereClause에 있지 않다").toBeLessThan(600);
    expect(MEMORY_SRC, "지정 문서명이 이스케이프를 안 지난다")
      .toMatch(/지정문서\.map\(\(d\) => `'\$\{escapeLiteral\(d\)\}'`\)/);
    expect(MEMORY_SRC).toContain('import { currentDocIds } from "./ragscope"');
  });

  it("llm.ts: 지정 0건은 지정범위배너 — 자료없음배너 재사용 금지(범위를 좁힌 것뿐)", () => {
    expect(LLM_SRC).toContain("지정범위배너");
    expect(LLM_SRC, "배너 분기가 지정 여부를 안 본다").toMatch(/currentDocIds\(\)\.length\s*\n?\s*\? 지정범위배너/);
    // normaltic 엄격 그라운딩도 지정 여부를 가른다(소비처 2곳 — 설계관이 잡은 누락)
    expect(LLM_SRC).toContain("지정하신 문서 범위에는 관련 내용이 없습니다");
  });

  it("llm.ts: 📎 첨부는 systemContent로만 — message/contextText에 섞지 않는다(배지 희석 방지)", () => {
    expect(LLM_SRC).toMatch(/\[systemPromptFor\(args\.agentId\), grounding, rag, 첨부\]/);
    expect(LLM_SRC).toContain("currentAttachText()");
  });

  it("dispatcher.ts: 두 입구(통짜·스트림) 모두 소독+꼬리표를 단다 — 한 곳만 하면 샌다", () => {
    expect((DISPATCHER_SRC.match(/sanitizeDocIds\(req\.body\?\.docIds\)/g) || []).length).toBe(2);
    expect((DISPATCHER_SRC.match(/runWithRagScope\(\{ docIds: 지정문서, attachText: 첨부글 \}/g) || []).length).toBe(2);
    // 400 안내에 새 필드가 적혀 있다(코드-문서 일치)
    expect((DISPATCHER_SRC.match(/docIds: "string\[\]\?"/g) || []).length).toBe(2);
  });
});

describe("attachSessionText — 📎 첨부 압축", () => {
  beforeEach(() => {
    db.exec("DELETE FROM work_session_turns; DELETE FROM work_sessions;");
  });

  it("★④ 「같은 세션」이라 말하지 않고, 제목과 함께 결정적으로 압축한다", () => {
    const s = createSession("웹서버 취약점 조치");
    appendTurn(s.id, "user", "web-01 취약점 조치 요청서 만들어줘");
    appendTurn(s.id, "assistant", "조치 요청서 초안을 만들었습니다.");
    const t = attachSessionText(s.id);
    expect(t).toContain("웹서버 취약점 조치");
    expect(t).toContain("web-01");
    expect(t, "다른 세션 기록인데 「같은 세션」이라 말한다 — 거짓 문장").not.toContain("같은 세션):");
    expect(t).toContain("첨부한 지난 작업");
  });

  it("없는 세션·빈 세션은 빈 문자열 — 호출부가 거른다", () => {
    expect(attachSessionText("없는-id")).toBe("");
    const s = createSession("빈 세션");
    expect(attachSessionText(s.id)).toBe("");
  });

  it("★ 예산 상한 + **최신 턴 보존** — 앞자르기면 결론이 빠진다(검토관 적발)", () => {
    // 옛 구현이 slice(0, maxChars)라 「최근 6턴」에서 정작 최신 턴이 통째로 빠졌다 —
    // 첨부의 존재 이유(아까 그 작업 이어서)가 죽는다. 길이만 재던 시험도 그걸 통과시켰다.
    const s = createSession("긴 세션");
    for (let i = 0; i < 6; i += 1) appendTurn(s.id, "user", `지시 ${i} ` + "가".repeat(400));
    const t = attachSessionText(s.id, 1200);
    expect(t.length).toBeLessThan(1200 + 120); // 본문 1200 + 머리말
    expect(t, "가장 최신 턴(지시 5)이 잘려 나갔다 — 예산은 최신부터 지켜야 한다").toContain("지시 5");
    expect(t, "잘렸으면 오래된 쪽이 빠져야 한다").not.toContain("지시 0");
  });

  it("dispatcher — 첨부 조립은 두 입구가 한 함수(첨부글만들기)·빈 세션은 사실을 싣는다", () => {
    expect((DISPATCHER_SRC.match(/첨부글만들기\(req\.body\?\.attachSessions\)/g) || []).length,
      "두 입구가 같은 조립기를 안 쓴다").toBe(2);
    expect(DISPATCHER_SRC, "빈 세션을 조용히 버린다 — 「첨부한 척」").toContain("내용을 싣지 못했습니다");
  });
});

describe("노트북형 ③(123진행) — 인용→문서·전체 지정·분리창 릴레이 배선 계약", () => {
  const CHATPARTS = readFileSync(join(__dirname, "..", "..", "client", "src", "renderer", "pages", "chatparts.js"), "utf-8");
  const APP = readFileSync(join(__dirname, "..", "..", "client", "src", "renderer", "pages", "app.html"), "utf-8");
  const MYDOCS = readFileSync(join(__dirname, "..", "..", "client", "src", "renderer", "pages", "mydocs.html"), "utf-8");
  const CONSOLE = readFileSync(join(__dirname, "..", "..", "client", "src", "renderer", "pages", "console.js"), "utf-8");
  const NAV = readFileSync(join(__dirname, "..", "..", "client", "src", "renderer", "pages", "nav.js"), "utf-8");

  it("인용→문서 사슬 3단이 전부 실재한다 — 한 단만 빠지면 눌러도 조용히 무동작", () => {
    expect(CHATPARTS, "발신(배지 문서명)이 없다").toContain('type: "gijo:opendoc"');
    expect(APP, "셸 분기가 없다").toContain('d.type === "gijo:opendoc"');
    expect(MYDOCS, "내 문서 수신이 없다").toContain('"gijo:opendoc"');
    expect(NAV, "분리창 대화의 인용 클릭이 셸로 안 나른다").toContain('"gijo:opendoc"');
  });

  it("전체 지정은 50 상한에서 **막고 이유를 말한다** — 조용히 자르면 「체크 120=칩 50」 거짓", () => {
    expect(MYDOCS).toContain("dchkall");
    expect(MYDOCS, "상한 안내가 없다").toContain("검색으로 좁힌 뒤 전체 지정");
  });

  it("분리창 대화창 동기화 — 셸이 두 신호를 broadcast하고, console이 bridge로 받는다", () => {
    expect((APP.match(/broadcastToWindows\(\{ type: "gijo:docscope"/g) || []).length, "docscope 중계 없음").toBeGreaterThanOrEqual(1);
    expect((APP.match(/broadcastToWindows\(\{ type: "gijo:attach"/g) || []).length, "attach 중계 없음").toBeGreaterThanOrEqual(1);
    expect(CONSOLE, "분리창 인스턴스 수신(onShellBridge)이 없다").toMatch(/onShellBridge[\s\S]{0,400}gijo:docscope/);
    // 분리창 칩 × → 셸로 되보내 화면 체크까지 되돌린다(비대칭 재발 방지)
    expect(CONSOLE).toContain('bridgeToShell({ type: "gijo:docscope", docIds: [] })');
    expect(APP, "빈 목록 신호가 화면 해제(gijoDocScopeCleared)로 안 이어진다").toMatch(/!문서들\.length && window\.gijoDocScopeCleared/);
  });

  it("말풍선 근거 표시·범위 라벨 — 보낸 그때의 사실을 남긴다(시안 약속)", () => {
    expect(CONSOLE).toContain("cs-scopeline");
    expect(CONSOLE).toContain("cs-glabel");
  });
});
