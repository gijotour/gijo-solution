// test/workprogress.test.ts — 업무 진행 리포트 + 할 일 감사 공백 봉합 (3연결 시나리오, 2026-08-09)
//
// 시나리오 실측에서 찾은 끊김 2개의 회귀 방지:
// ① 담기·완료가 작업 내역(감사)에 안 남던 공백 ② 모르는 리포트 type이 취약점 리포트로
// 조용히 폴백되던 것(틀린 리포트는 없느니만 못하다). + 선택한 작업 내역이 리포트에 실린다.

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import * as fs from "fs";
import * as path from "path";
import { createApp } from "../src/app";
import { listAudit } from "../src/engine/audit";
import { createSession } from "../src/engine/worksessions";

async function login(app: ReturnType<typeof createApp>) {
  const res = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });
  return res.body.accessToken as string;
}

const REPORT_DIR = process.env.GIJO_REPORT_DIR || path.join("data", "reports");
const 만든파일: string[] = [];

afterAll(() => {
  for (const f of 만든파일) fs.rmSync(f, { force: true });
});

describe("할 일 담기·완료가 작업 내역에 남는다", () => {
  let app: ReturnType<typeof createApp>;
  let token: string;
  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeEach(async () => {
    app = createApp();
    token = await login(app);
  });

  it("담기 → 완료 → 감사 기록 2건 (삭제만 남던 공백 봉합)", async () => {
    const made = await request(app).post("/api/tasks").set(auth()).send({ text: "진행리포트시험-패치 승인" });
    expect(made.status).toBe(200);
    await request(app).post(`/api/tasks/${made.body.id}/complete`).set(auth());
    const audits = listAudit({ kind: "write", limit: 20 });
    const acts = audits.map((a) => `${a.action}:${a.target}`);
    expect(acts.some((s) => s.startsWith("할 일 담기:진행리포트시험"))).toBe(true);
    expect(acts.some((s) => s.startsWith("할 일 완료:진행리포트시험"))).toBe(true);
    await request(app).delete(`/api/tasks/${made.body.id}`).set(auth());
  });
});

describe("업무 진행 리포트 (type: work-progress)", () => {
  let app: ReturnType<typeof createApp>;
  let token: string;
  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeEach(async () => {
    app = createApp();
    token = await login(app);
  });

  it("모르는 type은 400 — 취약점 리포트로 조용히 폴백하지 않는다", async () => {
    const r = await request(app).post("/api/report/generate").set(auth()).send({ type: "없는종류" });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain("알 수 없는 리포트 종류");
  });

  it("계획·수행 내역·선택 표기가 요약에 실리고 DOCX와 사이드카가 생긴다", async () => {
    const t1 = await request(app).post("/api/tasks").set(auth()).send({ text: "진행리포트시험-오늘 계획 A" });
    await request(app).post(`/api/tasks/${t1.body.id}/complete`).set(auth());
    const s = createSession("진행리포트시험-웹서버 재스캔 확인", undefined, "시험");

    const r = await request(app).post("/api/report/generate").set(auth()).send({ type: "work-progress", sessionIds: [s.id] });
    expect(r.status).toBe(200);
    expect(r.body.executiveSummary).toMatch(/계획 \d+건 중 \d+건 완료/);
    expect(r.body.executiveSummary).toContain("담당자 선택");
    expect(r.body.executiveSummary).toContain("작업 내역 1건");
    expect(fs.existsSync(r.body.filePath)).toBe(true);
    만든파일.push(r.body.filePath);
    const base = path.basename(r.body.filePath, ".docx");
    const metaPath = path.join(REPORT_DIR, `${base}.json`);
    expect(fs.existsSync(metaPath)).toBe(true);
    만든파일.push(metaPath);
    expect(JSON.parse(fs.readFileSync(metaPath, "utf8")).type).toBe("work-progress");
    await request(app).delete(`/api/tasks/${t1.body.id}`).set(auth());
  });
});
