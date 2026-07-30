// 문서함 — **무엇이 고객에게 보이는가**의 경계를 시험으로 못 박는다.
//
// 위험한 실수 두 가지를 여기서 막는다:
//  ① knowledge/* 가 목록에 섞이는 것 — AI 답변 재료가 "읽는 문서"로 둔갑한다
//  ② 클라이언트가 파일 경로를 지정하는 것 — 매니페스트 밖 파일이 열리면 내부 문서가 새 나간다
//     (내부 문서에는 소스 경로·사고 이력·미구현 항목이 들어 있다)
import { describe, it, expect, vi } from "vitest";
import request from "supertest";

vi.mock("../src/engine/llm", () => ({
  chat: vi.fn(async () => "ok"),
  embed: vi.fn(async (t: string[]) => t.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
}));

import { createApp } from "../src/app";
import { listDocbox, readDocbox, searchDocbox } from "../src/engine/docbox";

async function login(app: ReturnType<typeof createApp>) {
  const res = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });
  return res.body.accessToken as string;
}

describe("문서함 목록 — 경계", () => {
  it("매니페스트의 문서를 보여주되 knowledge/* 는 제외한다", async () => {
    const docs = await listDocbox();
    expect(docs.length).toBeGreaterThan(0);
    // AI 답변 재료가 목록에 섞이면 안 된다
    expect(docs.some((d) => d.id.includes("지식"))).toBe(false);
    expect(docs.some((d) => d.title.includes("지식"))).toBe(false);
  });

  it("사람이 읽을 제목으로 나온다 — 파일명 그대로가 아니다", async () => {
    const docs = await listDocbox();
    const aibom = docs.find((d) => d.title.includes("AI-BOM"));
    expect(aibom, "AI-BOM 검토 가이드가 목록에 있어야 한다").toBeDefined();
    expect(aibom!.title).toBe("AI-BOM 검토 가이드"); // "AIBOM_검토_가이드"가 아니다
    for (const d of docs) {
      expect(d.title).not.toMatch(/\.md$/);
      expect(d.title).not.toMatch(/^GIJO_AS_/);
    }
  });

  it("두 묶음으로 나뉜다 — 사용 안내 / 업무 지침", async () => {
    const docs = await listDocbox();
    expect(docs.some((d) => d.group === "guide")).toBe(true);
    expect(docs.some((d) => d.group === "policy")).toBe(true);
  });

  it("고객용 아키텍처 개요가 포함된다(내부 아키텍처 문서가 아니라)", async () => {
    const docs = await listDocbox();
    expect(docs.some((d) => d.title === "아키텍처 개요")).toBe(true);
    // 내부 문서(RAG 아키텍처·LLM연동)는 매니페스트에 없으므로 절대 안 나온다
    expect(docs.some((d) => d.title.includes("RAG") || d.title.includes("LLM연동"))).toBe(false);
  });
});

describe("문서 본문 — 경로를 클라이언트가 못 정한다", () => {
  it("목록에 있는 id는 본문이 열린다", async () => {
    const docs = await listDocbox();
    const doc = await readDocbox(docs[0].id);
    expect(doc).not.toBeNull();
    expect(doc!.markdown.length).toBeGreaterThan(100);
    expect(doc!.title).toBe(docs[0].title);
  });

  it("목록에 없는 id는 열리지 않는다 — 경로 탈출·내부 문서 접근 차단", async () => {
    for (const 나쁜id of [
      "../../CLAUDE",
      "..%2F..%2Fetc%2Fpasswd",
      "GIJO_AS_RAG_아키텍처_LLM연동", // 내부 문서 — 매니페스트에 없다
      "knowledge/GIJO_지식_보안거버넌스_표준", // 의도적으로 제외한 것
      "GIJO_AS_시장경쟁력_전중후_계획서", // 내부 계획서
      "",
    ]) {
      expect(await readDocbox(나쁜id), `열리면 안 된다: ${나쁜id}`).toBeNull();
    }
  });
});

describe("검색", () => {
  it("본문에서 찾고 조각을 돌려준다", async () => {
    const r = await searchDocbox("취약점");
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].hits).toBeGreaterThan(0);
    expect(r[0].snippet.length).toBeGreaterThan(0);
    // 많이 나온 문서가 위로
    expect(r[0].hits).toBeGreaterThanOrEqual(r[r.length - 1].hits);
  });

  it("너무 짧은 검색어는 무시한다 — 전 문서를 훑을 이유가 없다", async () => {
    expect(await searchDocbox("가")).toHaveLength(0);
    expect(await searchDocbox(" ")).toHaveLength(0);
  });

  it("검색 결과도 목록의 문서로 한정된다", async () => {
    const ids = new Set((await listDocbox()).map((d) => d.id));
    for (const r of await searchDocbox("보안")) expect(ids.has(r.id)).toBe(true);
  });
});

describe("API 권한", () => {
  it("로그인해야 목록·본문을 볼 수 있다", async () => {
    const app = createApp();
    await request(app).get("/api/docbox").expect(401);

    const token = await login(app);
    const list = await request(app).get("/api/docbox").set("Authorization", `Bearer ${token}`).expect(200);
    expect(list.body.documents.length).toBeGreaterThan(0);

    const id = list.body.documents[0].id;
    const doc = await request(app).get(`/api/docbox/${encodeURIComponent(id)}`).set("Authorization", `Bearer ${token}`).expect(200);
    expect(doc.body.markdown).toBeTruthy();

    // 없는 문서는 404 — 500으로 터지지 않는다
    await request(app).get("/api/docbox/없는문서").set("Authorization", `Bearer ${token}`).expect(404);
  });
});

// ── 화면 안내 라우팅 ────────────────────────────────────────────────────────
// 실사고(2026-07-31): "문서함 화면에서 **뭘** 할 수 있어?"가 안내로 안 가고 RAG로 새어
// **없는 기능을 지어냈다**("변경기록부 관리·신청서 승인대기"). 원인은 `뭐 할 수`만 있고
// `뭘 할 수`가 빠진 것 — 한 글자 차이였다. 모든 화면에 같은 구멍이 있었다.
describe("화면 이름을 부르는 말투도 안내로 간다", () => {
  it("'○○ 화면에서 뭘 할 수 있어?'가 전부 안내로 간다", async () => {
    const { isHelpIntent } = await import("../src/engine/screenguide");
    const 물음 = [
      ["문서함 화면에서 뭘 할 수 있어?", "docbox.html"],
      ["취약점 화면에서 뭘 할 수 있어?", "vulnscan.html"],
      ["설정 화면에서 뭐 할 수 있어?", "settings.html"],
      ["기록 보기 메뉴에서 뭘 할 수 있어?", "audit.html"],
      ["이 화면에서 뭘 할 수 있어?", "docbox.html"],
    ] as const;
    for (const [q, s] of 물음) expect(isHelpIntent(q, s), `안내로 가야 한다: ${q}`).toBe(true);
  });

  it("⚠ 넓히면서도 업무 질문·벤더 제품은 그대로 안 샌다 — 이쪽이 더 중요하다", async () => {
    const { isHelpIntent } = await import("../src/engine/screenguide");
    const 새면안됨 = [
      ["Tenable Web App Scanning 주요기능 설명해줘", "dashboard.html"], // 2026-07-26 실사고
      ["CVE-2021-44228 뭐야", "vulnscan.html"],
      ["오늘 급한 취약점 뭐야", "vulnscan.html"],
      ["방화벽 정책 어떻게 바꿔?", "products.html"],
      ["웹서버 취약점 요약해줘", "vulnscan.html"],
    ] as const;
    for (const [q, s] of 새면안됨) expect(isHelpIntent(q, s), `화면 안내로 새면 안 된다: ${q}`).toBe(false);
  });

  it("문서함 안내에 실제 내용이 들어 있다 — 빈 껍데기가 아니다", async () => {
    const { formatScreenGuide } = await import("../src/engine/screenguide");
    const g = formatScreenGuide("docbox.html");
    expect(g).toBeTruthy();
    expect(g!).toContain("문서함");
    expect(g!).toContain("별도 창");
    // 구역 4개가 안내에 나열돼야 담당자가 이름을 넣어 되물을 수 있다
    for (const 구역 of ["사용 안내", "업무 지침", "문서 검색", "요청 만들기"]) expect(g!).toContain(구역);
    // 아직 없는 기능은 "준비 중"이라고 말해야 한다(있는 척 금지)
    expect(g!).toContain("고객사에 나가도 되는 것만");
  });
});
