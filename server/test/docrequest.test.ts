// 문서함 "요청 만들기" — 담당자가 만든 파일이 **밖으로 나간다**는 전제로 계약을 확인한다.
//
// 지키려는 것:
//  · 자격증명이 문서에 실려 나가지 않는다(본문은 가린다)
//  · 그림 속은 못 가린다는 **경고가 문서에 함께 실린다**(정직 규칙 — 코드로 해결 못 하는 부분)
//  · 자동 기술 정보가 실제로 붙는다 — 이게 이 기능의 값어치다(개발자와의 왕복을 줄인다)
//  · 원장에는 본문·이미지를 담지 않는다(자격증명·스크린샷의 두 번째 사본을 만들지 않는다)
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

vi.mock("../src/engine/llm", () => ({
  // 2026-08-29 화살 #14·#15 — llm이 RAG·수집 훅을 내보낸다. 목도 표면을 따라가야 한다
  // (안 주면 그 모듈을 import하는 파일이 통째로 죽는다 — verifyroutes 6개가 실증).
  setRagProvider: vi.fn(), hasRagProvider: vi.fn(() => false), onChatRecorded: vi.fn(), chatLogListenerCount: vi.fn(() => 0),
  chat: vi.fn(async () => "ok"),
  embed: vi.fn(async (t: string[]) => t.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
}));

import { createApp } from "../src/app";
import { buildRequestDocument, listDocRequests, resetDocRequestsForTests } from "../src/engine/docrequest";

beforeEach(() => resetDocRequestsForTests());

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";

async function login(app: ReturnType<typeof createApp>) {
  const res = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });
  return res.body.accessToken as string;
}

describe("문서 조립", () => {
  it("자동 기술 정보가 붙는다 — 담당자가 안 적어도 개발자가 재현할 수 있게", () => {
    const r = buildRequestDocument(
      { kind: "bug", title: "저장이 안 됨", tried: "저장을 눌렀다", happened: "아무 반응 없음", images: [],
        screen: "설정 > 관리자", clientVersion: "4.8.0", platform: "Windows 11 / Electron 31" },
      "김담당"
    );
    for (const 필수 of ["직전 화면", "설정 > 관리자", "클라 버전", "4.8.0", "서버 커밋", "발생 시각", "김담당", "Windows 11"]) {
      expect(r.markdown, `빠짐: ${필수}`).toContain(필수);
    }
    expect(r.markdown).toContain("## 자동 수집 정보");
    expect(r.markdown).toContain("자가 진단");
  });

  it("제목·본문의 자격증명을 가린다 — 파일은 밖으로 나가는 산출물이다", () => {
    const r = buildRequestDocument(
      { kind: "bug", title: "로그인 실패", tried: "관리자 계정으로 접속",
        happened: "초기 비밀번호: P@ssw0rd-Init-2026 로 했는데 안 됩니다. API 연동 키: sk-live-QA7788TESTKEYONLY0000",
        images: [] },
      "김담당"
    );
    expect(r.markdown).not.toContain("P@ssw0rd-Init-2026");
    expect(r.markdown).not.toContain("sk-live-QA7788TESTKEYONLY0000");
    expect(r.maskedCount).toBeGreaterThanOrEqual(2);
    expect(r.markdown).toContain("자격증명");
    // 문맥은 남아야 개발자가 무슨 얘긴지 안다
    expect(r.markdown).toContain("초기 비밀번호:");
  });

  it("그림을 붙이면 '그림 속은 못 가린다'는 경고가 문서에 실린다", () => {
    const r = buildRequestDocument(
      { kind: "ui", title: "화면 깨짐", tried: "열었다", happened: "이상함", images: [PNG, PNG] },
      "김담당"
    );
    expect(r.imageCount).toBe(2);
    expect(r.markdown).toContain("![캡처1](data:image/png;base64,");
    expect(r.markdown).toContain("자동으로 가릴 수 없습니다");
  });

  it("그림이 없으면 그 경고를 띄우지 않는다 — 늘 뜨면 아무도 안 읽는다", () => {
    const r = buildRequestDocument({ kind: "etc", title: "건의", tried: "", happened: "", images: [] }, null);
    expect(r.markdown).not.toContain("자동으로 가릴 수 없습니다");
    expect(r.markdown).toContain("첨부한 화면 캡처 없음");
  });

  it("이미지가 아닌 것은 걸러낸다 — data:text/html 같은 것이 문서에 실리면 안 된다", () => {
    const r = buildRequestDocument(
      { kind: "bug", title: "t", tried: "", happened: "", images: [PNG, "data:text/html,<script>x</script>", "javascript:alert(1)"] },
      null
    );
    expect(r.imageCount).toBe(1);
    expect(r.markdown).not.toContain("text/html");
    expect(r.markdown).not.toContain("javascript:");
  });

  it("파일명이 유형·시각으로 자동으로 정해진다", () => {
    const r = buildRequestDocument({ kind: "feature", title: "이런 게 있으면", tried: "", happened: "", images: [] }, null);
    expect(r.fileName).toMatch(/^GIJO요청_기능 요청_\d{8}-\d{4}\.md$/);
  });

  it("유형이 이상하면 '기타'로 떨어진다 — 터지지 않는다", () => {
    const r = buildRequestDocument({ kind: "없는유형" as never, title: "t", tried: "", happened: "", images: [] }, null);
    expect(r.markdown).toContain("[기타]");
  });
});

describe("원장", () => {
  it("본문·이미지를 담지 않는다 — 두 번째 사본을 만들지 않는다", async () => {
    const app = createApp();
    const token = await login(app);
    await request(app)
      .post("/api/docbox/request")
      .set("Authorization", `Bearer ${token}`)
      .send({ kind: "bug", title: "저장 안 됨", tried: "비밀번호: Sup3rSecret99 로 시도", happened: "실패", images: [PNG] })
      .expect(200);

    const rows = listDocRequests();
    expect(rows).toHaveLength(1);
    const json = JSON.stringify(rows[0]);
    expect(json).not.toContain("Sup3rSecret99");
    expect(json).not.toContain("base64");
    // 대신 "무엇을 언제" 는 남는다
    expect(rows[0].title).toBe("저장 안 됨");
    expect(rows[0].imageCount).toBe(1);
    expect(rows[0].maskedCount).toBeGreaterThan(0);
  });

  it("제목 없이는 만들지 않는다", async () => {
    const app = createApp();
    const token = await login(app);
    await request(app).post("/api/docbox/request").set("Authorization", `Bearer ${token}`).send({ kind: "bug", title: "  " }).expect(400);
  });

  it("로그인해야 쓴다", async () => {
    const app = createApp();
    await request(app).post("/api/docbox/request").send({ title: "x" }).expect(401);
    await request(app).get("/api/docbox/requests").expect(401);
  });
});
