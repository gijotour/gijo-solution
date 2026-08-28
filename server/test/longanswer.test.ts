// 오래 걸리는 지시를 리포트로 돌리고 끝나면 알려주는 장치(2026-07-26 사용자 요청).
// REPORT_DIR을 임시 폴더로 격리한다 — 운영 data/reports를 건드리지 않기 위함.
import { describe, it, expect, beforeEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const tmpReportDir = fs.mkdtempSync(path.join(os.tmpdir(), "gijo-longanswer-"));
process.env.GIJO_REPORT_DIR = tmpReportDir;

vi.mock("../src/engine/llm", () => ({
  // 2026-08-29 화살 #14·#15 — llm이 RAG·수집 훅을 내보낸다. 목도 표면을 따라가야 한다
  // (안 주면 그 모듈을 import하는 파일이 통째로 죽는다 — verifyroutes 6개가 실증).
  setRagProvider: vi.fn(), hasRagProvider: vi.fn(() => false), onChatRecorded: vi.fn(), chatLogListenerCount: vi.fn(() => 0),
  chat: vi.fn(async () => "[mock]"),
  embed: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
}));

const { db } = await import("../src/db");
const { startLongAnswer, finishLongAnswer, failLongAnswer, pendingNotices, markNotified, reapStaleRunning, LONG_ANSWER_MS } =
  await import("../src/engine/longanswer");

beforeEach(() => {
  db.prepare("DELETE FROM long_answers").run();
});

describe("longanswer — 오래 걸린 요청을 리포트로", () => {
  it("기본 전환 시간은 30초다(사용자 결정 2026-07-26, 10초→30초 상향)", () => {
    expect(LONG_ANSWER_MS).toBe(30_000);
  });

  it("작성이 끝나면 리포트 파일과 사이드카를 남긴다", async () => {
    const id = startLongAnswer("Tenable Web App Scanning 주요기능 설명해줘", "u1");
    const base = await finishLongAnswer(id, "본문입니다.", "정요한");

    const md = fs.readFileSync(path.join(tmpReportDir, `${base}.md`), "utf-8");
    expect(md).toContain("Tenable Web App Scanning 주요기능 설명해줘");
    expect(md).toContain("본문입니다.");
    expect(md).toContain("정요한");

    const meta = JSON.parse(fs.readFileSync(path.join(tmpReportDir, `${base}.json`), "utf-8"));
    expect(meta.type).toBe("answer"); // 리포트 이력 화면이 종류로 읽는다
    expect(meta.md).toBe(`${base}.md`);
    expect(meta.createdBy).toBe("정요한");
  });

  it("완료된 건은 한 번만 알린다 — 받아가면 다시 뜨지 않는다", async () => {
    const id = startLongAnswer("주간 보고서 만들어줘", "u1");
    expect(pendingNotices("u1")).toHaveLength(0); // 아직 진행 중이면 안 알린다

    await finishLongAnswer(id, "내용", "정요한");
    const first = pendingNotices("u1");
    expect(first).toHaveLength(1);
    expect(first[0].status).toBe("done");
    expect(first[0].reportBase).toMatch(/^answer-\d+$/);

    markNotified(id);
    expect(pendingNotices("u1")).toHaveLength(0);
  });

  it("남의 요청은 알리지 않는다", async () => {
    const id = startLongAnswer("내 요청", "u1");
    await finishLongAnswer(id, "내용", null);
    expect(pendingNotices("u2")).toHaveLength(0);
    expect(pendingNotices("u1")).toHaveLength(1);
  });

  it("실패해도 알린다 — 조용히 사라지면 담당자가 기다리게 된다", () => {
    const id = startLongAnswer("실패할 요청", "u1");
    failLongAnswer(id, "모델이 응답하지 않았습니다");
    const n = pendingNotices("u1");
    expect(n).toHaveLength(1);
    expect(n[0].status).toBe("failed");
    expect(n[0].error).toContain("모델이 응답하지 않았습니다");
  });

  it("서버가 재시작되면 진행 중이던 건을 실패로 정리한다(영원히 대기 방지)", () => {
    startLongAnswer("재시작 중 끊긴 요청", "u1");
    expect(reapStaleRunning()).toBe(1);
    const n = pendingNotices("u1");
    expect(n).toHaveLength(1);
    expect(n[0].error).toContain("재시작");
  });
});
