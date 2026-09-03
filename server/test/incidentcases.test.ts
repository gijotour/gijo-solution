// incidentcases.test.ts — 📚 침해사고 히스토리(사고 사례) 계약 (2026-09-03).
//
// 왕복(등록→조회→삭제) · 검증 실패 사유 · CVE 유사 검색(규칙만) · 씨앗 멱등 · 사례 1건=지식 문서 1건의 반입/삭제 짝(결정 ①) ·
// 라우트 순서(/sources·/similar가 /:id보다 먼저) · 권한(내장은 관리자만) · 대화창 서식(숫자만 주고 끝내지 않는다) · 도구 등록.
// 시험 환경엔 임베딩이 없다 — memory는 모킹하되, 모킹이 memory_documents 메타를 실제로 남겨 「반입된 문서는 다시 안 넣는다」 멱등까지 본다.
import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import request from "supertest";

const { ingestSpy, deleteSpy } = vi.hoisted(() => ({ ingestSpy: vi.fn(), deleteSpy: vi.fn() }));
vi.mock("../src/engine/memory", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/engine/memory")>();
  return {
    ...orig,
    ingestText: async (documentId: string, raw: string, scope: string, sourcePath?: string, classify?: boolean, uploadedBy?: string, category?: string, origin?: string) => {
      ingestSpy(documentId, raw, scope, sourcePath, classify, uploadedBy, category, origin);
      const { db } = await import("../src/db");
      db.prepare("INSERT INTO memory_documents (documentId, scope, chunks, embeddingModel, sourcePath, ingestedAt, category, origin) VALUES (?, ?, 3, 'mock', NULL, ?, ?, ?) ON CONFLICT(documentId) DO UPDATE SET ingestedAt = excluded.ingestedAt")
        .run(documentId, scope, new Date().toISOString(), category ?? null, origin ?? null);
      return { documentId, chunks: 3, embeddingModel: "mock", scope };
    },
    deleteDocument: async (documentId: string) => {
      deleteSpy(documentId);
      const { db } = await import("../src/db");
      db.prepare("DELETE FROM memory_documents WHERE documentId = ?").run(documentId);
      return { documentId, deletedChunks: 3, deletedFile: false };
    },
  };
});

import { db } from "../src/db";
import {
  validateIncidentCaseInput, registerIncidentCase, deleteIncidentCase, listIncidentCases, getIncidentCase, findCasesForCves, countIncidentCases,
  seedBuiltinCases, builtinCaseId, syncIncidentCaseDocs, incidentCaseDocsIdle, caseDocText, formatIncidentCases, formatIncidentSources, listIncidentSources,
  incidentCaseDocId, INCIDENT_CASE_ORIGIN, INCIDENT_CASE_CATEGORY, CVE_ID_RE,
} from "../src/engine/incidentcases";
import { listAudit } from "../src/engine/audit";
import { findAgentTool } from "../src/engine/agenttools/registry";
import { TARGETS } from "../src/engine/datacleanup";
import { createUser } from "../src/auth/users";
import { createApp } from "../src/app";

const log4shell = {
  title: "Log4Shell 대규모 악용", oneLiner: "Log4j 원격코드실행으로 전 세계 서버가 뚫렸다",
  plainExplain: "로그를 남기는 부품(Log4j)의 구멍으로 남이 우리 서버에서 명령을 실행할 수 있었습니다. 패치가 늦은 곳부터 당했습니다.",
  year: 2021, industry: "소프트웨어", region: "해외", cves: "cve-2021-44228, CVE-2021-45046", products: "Apache Log4j", techniques: "t1190",
  lesson: "부품 목록(SBOM)이 있어야 어디에 Log4j가 있는지 하루 안에 찾는다",
  sourceUrl: "https://www.cisa.gov/news-events/alerts/2021/12/10/apache-log4j-vulnerability-guidance", sourceName: "CISA",
};
const wannacry = {
  title: "워너크라이 랜섬웨어 대유행", oneLiner: "SMB 구멍(EternalBlue)으로 하루 만에 150개국 감염", plainExplain: "윈도우 파일 공유 기능의 구멍을 타고 랜섬웨어가 스스로 옆 컴퓨터로 퍼졌습니다. 패치가 두 달 전에 나와 있었습니다.",
  year: 2017, industry: "병원", region: "해외", cves: ["CVE-2017-0144"], products: ["Windows SMBv1"], lesson: "패치 배포 지연이 곧 사고다 — 나온 지 두 달 된 패치를 안 깔아 당했다",
  sourceUrl: "https://www.ncsc.gov.uk/blog-post/what-you-need-to-know-about-wannacry", sourceName: "NCSC",
};
const 국내 = {
  title: "국내 제조사 랜섬웨어 침해", oneLiner: "VPN 계정 유출로 들어와 생산 서버를 암호화", plainExplain: "외부 접속용 VPN 계정이 유출돼 공격자가 내부로 들어왔고, 백업이 같은 망에 있어 함께 암호화됐습니다.",
  year: 2024, industry: "제조", region: "국내", cves: [], products: [], lesson: "백업은 망을 갈라 두고, VPN은 2차 인증을 켠다",
  sourceUrl: "https://www.boho.or.kr/", sourceName: "KISA 보호나라",
};

beforeEach(() => {
  db.prepare("DELETE FROM incident_cases").run();
  db.prepare("DELETE FROM memory_documents WHERE origin = ?").run(INCIDENT_CASE_ORIGIN);
  ingestSpy.mockClear(); deleteSpy.mockClear();
});
const withEnv = async (k: string, v: string, fn: () => Promise<void>) => {
  const prev = process.env[k]; process.env[k] = v;
  try { await fn(); } finally { if (prev === undefined) delete process.env[k]; else process.env[k] = prev; }
};

describe("등록 입력 검증 — 사유를 전부 모아 돌려준다", () => {
  it("빈 입력은 필수 칸 여덟을 전부 말한다", () => {
    const { errors } = validateIncidentCaseInput({});
    for (const 칸 of ["제목", "한 줄 요약", "쉬운 설명", "교훈", "업종", "연도", "지역", "출처 URL"]) expect(errors.some((e) => e.includes(칸)), `${칸} 사유가 없다: ${errors.join(" / ")}`).toBe(true);
  });
  it("URL·CVE·기법·지역·연도 꼴을 잡고, 맞는 것은 대문자·목록으로 정규화한다", () => {
    const bad = validateIncidentCaseInput({ ...log4shell, sourceUrl: "ftp://x", cves: "CVE-21-1, CVE-2021-44228", techniques: "X99", region: "국외", year: 1900 });
    expect(bad.errors.join("\n")).toMatch(/http\(s\)/);
    expect(bad.errors.join("\n")).toMatch(/CVE 꼴이 아닙니다: CVE-21-1/);
    expect(bad.errors.join("\n")).toMatch(/기법 꼴이 아닙니다: X99/);
    expect(bad.errors.join("\n")).toMatch(/「국내」 또는 「해외」/);
    expect(bad.errors.join("\n")).toMatch(/연도가 맞지 않습니다: 1900/);
    const ok = validateIncidentCaseInput(log4shell);
    expect(ok.errors).toEqual([]);
    expect(ok.value.cves).toEqual(["CVE-2021-44228", "CVE-2021-45046"]);
    expect(ok.value.techniques).toEqual(["T1190"]);
    expect(ok.value.products).toEqual(["Apache Log4j"]); // 이름 안 공백은 나누지 않는다
    expect(ok.value.year).toBe(2021);
    expect(CVE_ID_RE.test("CVE-2021-44228")).toBe(true);
  });
  it("길이 상한을 넘으면 사유에 글자 수가 찍힌다", () => {
    const { errors } = validateIncidentCaseInput({ ...log4shell, title: "x".repeat(121) });
    // 조사는 말조사()가 받침으로 고른다 — 「제목이」(josa.test 소스 감시가 「이(가)」 표기를 막는다)
    expect(errors).toEqual([expect.stringMatching(/제목이 120자를 넘습니다\(121자\)/)]);
  });
});

describe("왕복 — 등록·조회·유사 검색·삭제", () => {
  it("등록하면 감사에 남고, 검색어·CVE·연도로 찾히며, 삭제하면 사라진다", async () => {
    const a = registerIncidentCase(log4shell, "정요한");
    expect(a.id).toMatch(/^ic-[0-9a-f]{16}$/);
    expect(a.origin).toBe("user");
    expect(a.registeredBy).toBe("정요한");
    expect(listAudit({ kind: "write", limit: 5 }).some((e) => e.action === "침해사고 히스토리 등록" && e.target === a.id && e.actor === "정요한")).toBe(true);
    registerIncidentCase(wannacry, "정요한");
    registerIncidentCase(국내, "김보안");
    expect(countIncidentCases()).toBe(3);
    expect(listIncidentCases().map((r) => r.year)).toEqual([2024, 2021, 2017]); // 최근 연도 먼저
    expect(listIncidentCases({ q: "랜섬웨어" }).map((r) => r.title)).toEqual(["국내 제조사 랜섬웨어 침해", "워너크라이 랜섬웨어 대유행"]);
    expect(listIncidentCases({ q: "Log4j" }).map((r) => r.title)).toEqual(["Log4Shell 대규모 악용"]); // 제품 칸도 걸린다
    expect(listIncidentCases({ cve: "cve-2017-0144" }).map((r) => r.title)).toEqual(["워너크라이 랜섬웨어 대유행"]);
    expect(listIncidentCases({ year: 2024 }).length).toBe(1);
    expect(listIncidentCases({ limit: 1 }).length).toBe(1);
    expect(getIncidentCase(a.id)!.title).toBe(log4shell.title);
    expect(deleteIncidentCase(a.id, "정요한")).toBe(true);
    expect(deleteIncidentCase(a.id, "정요한")).toBe(false);
    expect(getIncidentCase(a.id)).toBeUndefined();
    expect(() => registerIncidentCase({ ...log4shell, sourceUrl: "" }, "정요한")).toThrow(/출처 URL/);
  });

  it("CVE 유사 검색은 규칙만 — 대문자로 맞춰 교집합, 많이 겹치는 순", () => {
    const a = registerIncidentCase(log4shell, "정요한");
    const b = registerIncidentCase({ ...log4shell, title: "Log4j 2차 악용", cves: "CVE-2021-45046" }, "정요한");
    registerIncidentCase(wannacry, "정요한");
    expect(findCasesForCves(["cve-2021-45046", "CVE-2021-44228"]).map((r) => r.id)).toEqual([a.id, b.id]); // a=2건 겹침, b=1건
    expect(findCasesForCves(["CVE-2000-0001"])).toEqual([]);
    expect(findCasesForCves([])).toEqual([]);
    expect(findCasesForCves(["CVE-2017-0144"]).map((r) => r.title)).toEqual(["워너크라이 랜섬웨어 대유행"]);
  });
});

describe("사례 1건 = 지식 문서 1건(결정 ①) — 반입·삭제가 짝이다", () => {
  it("등록하면 문서가 반입되고(위협대응·origin=incident-case·global), 이미 있으면 다시 넣지 않으며, 삭제하면 문서도 뺀다", async () => {
    await withEnv("GIJO_CASE_INGEST", "1", async () => {
      const a = registerIncidentCase(log4shell, "정요한");
      await incidentCaseDocsIdle();
      expect(ingestSpy).toHaveBeenCalledTimes(1);
      const [docId, text, scope, sourcePath, classify, uploadedBy, category, origin] = ingestSpy.mock.calls[0];
      expect(docId).toBe(incidentCaseDocId(a.id));
      expect(text).toBe(caseDocText(a));
      expect([scope, sourcePath, classify, uploadedBy, category, origin]).toEqual(["global", undefined, false, undefined, INCIDENT_CASE_CATEGORY, INCIDENT_CASE_ORIGIN]);
      expect(db.prepare("SELECT origin FROM memory_documents WHERE documentId = ?").get(docId)).toEqual({ origin: INCIDENT_CASE_ORIGIN });
      // 멱등 — 문서가 있으면 부팅 동기화가 다시 넣지 않는다
      expect((await syncIncidentCaseDocs()).queued).toBe(0);
      expect(ingestSpy).toHaveBeenCalledTimes(1);
      // 문서가 없어졌으면(옛 설치본·수동 삭제) 동기화가 채운다
      db.prepare("DELETE FROM memory_documents WHERE documentId = ?").run(docId);
      expect((await syncIncidentCaseDocs()).queued).toBe(1);
      expect(ingestSpy).toHaveBeenCalledTimes(2);
      // 삭제 → 문서도 짝으로
      expect(deleteIncidentCase(a.id, "정요한")).toBe(true);
      await incidentCaseDocsIdle();
      expect(deleteSpy).toHaveBeenCalledWith(docId);
      expect(db.prepare("SELECT 1 FROM memory_documents WHERE documentId = ?").get(docId)).toBeUndefined();
    });
  });
  it("GIJO_CASE_INGEST=0(시험 기본)이면 문서 쪽을 건너뛴다 — 표만 산다", async () => {
    const a = registerIncidentCase(log4shell, "정요한");
    await incidentCaseDocsIdle();
    expect(ingestSpy).not.toHaveBeenCalled();
    deleteIncidentCase(a.id, "정요한");
    await incidentCaseDocsIdle();
    expect(deleteSpy).not.toHaveBeenCalled();
  });
  it("문서 본문은 표 칸에서 렌더한다 — 제목·한 줄·쉬운 설명·교훈·CVE·제품·출처가 다 들어 있고 새 사실은 없다", () => {
    const a = registerIncidentCase(log4shell, "정요한");
    const t = caseDocText(a);
    for (const s of ["[침해사고 히스토리] Log4Shell 대규모 악용 (2021 · 소프트웨어 · 해외)", log4shell.oneLiner, log4shell.plainExplain, log4shell.lesson, "CVE-2021-44228, CVE-2021-45046", "Apache Log4j", "T1190", "CISA — https://www.cisa.gov"]) expect(t).toContain(s);
  });
});

describe("씨앗(내장 사례) — 파일이 없어도 뜨고, 있으면 id 기준 멱등", () => {
  const 임시 = () => path.join(os.tmpdir(), `gijo-incident-seed-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  it("없는 파일·깨진 파일은 경고만 — 던지지 않는다", () => {
    expect(seedBuiltinCases(path.join(os.tmpdir(), "없는-씨앗.json"))).toMatchObject({ inserted: 0, updated: 0, skipped: [] });
    const f = 임시(); fs.writeFileSync(f, "{ 깨짐");
    try { expect(seedBuiltinCases(f).inserted).toBe(0); } finally { fs.rmSync(f, { force: true }); }
  });
  it("두 번 돌려도 같고, 칸이 바뀐 것만 갱신하며, 틀린 줄은 사유와 함께 건너뛴다 · 담당자 등록분은 안 건드린다", async () => {
    const f = 임시();
    const 씨앗 = { cases: [{ id: "ic-0123456789abcdef", ...log4shell }, wannacry, { ...국내, sourceUrl: "" }] };
    fs.writeFileSync(f, JSON.stringify(씨앗));
    try {
      await withEnv("GIJO_CASE_INGEST", "1", async () => {
        const r1 = seedBuiltinCases(f);
        expect(r1).toMatchObject({ inserted: 2, updated: 0, unchanged: 0 });
        expect(r1.skipped).toEqual([expect.stringMatching(/국내 제조사 랜섬웨어 침해: 출처 URL/)]);
        expect(getIncidentCase("ic-0123456789abcdef")!.origin).toBe("builtin");
        expect(builtinCaseId(wannacry)).toBe(builtinCaseId({ ...wannacry, lesson: "다른 교훈" })); // id는 출처+제목에서 — 칸이 바뀌어도 같은 사례
        await incidentCaseDocsIdle();
        expect(ingestSpy).toHaveBeenCalledTimes(2);
        expect(seedBuiltinCases(f)).toMatchObject({ inserted: 0, updated: 0, unchanged: 2 });
        await incidentCaseDocsIdle();
        expect(ingestSpy).toHaveBeenCalledTimes(2); // 멱등 — 다시 반입하지 않는다
        // 칸이 바뀌면 그 건만 갱신 + 문서 재반입
        씨앗.cases[1] = { ...wannacry, lesson: "패치는 나온 그 주에 깐다" };
        fs.writeFileSync(f, JSON.stringify(씨앗));
        expect(seedBuiltinCases(f)).toMatchObject({ inserted: 0, updated: 1, unchanged: 1 });
        await incidentCaseDocsIdle();
        expect(ingestSpy).toHaveBeenCalledTimes(3);
        expect(getIncidentCase(builtinCaseId(wannacry))!.lesson).toBe("패치는 나온 그 주에 깐다");
        // ingest:false(모듈 로드 때)면 문서 큐에 안 넣고 재반입 대기로 남긴다 → 부팅 동기화가 집는다
        씨앗.cases[1] = { ...wannacry, lesson: "세 번째 교훈" };
        fs.writeFileSync(f, JSON.stringify(씨앗));
        expect(seedBuiltinCases(f, { ingest: false }).updated).toBe(1);
        await incidentCaseDocsIdle();
        expect(ingestSpy).toHaveBeenCalledTimes(3);
        expect((await syncIncidentCaseDocs()).queued).toBe(1);
        expect(ingestSpy).toHaveBeenCalledTimes(4);
        // 같은 id에 담당자 등록분이 있으면 씨앗이 덮지 않는다
        db.prepare("UPDATE incident_cases SET origin = 'user', registeredBy = '김보안' WHERE id = ?").run("ic-0123456789abcdef");
        const r3 = seedBuiltinCases(f);
        expect(r3.skipped).toEqual([expect.stringMatching(/담당자 등록 사례가 있어 건너뜀/), expect.stringMatching(/출처 URL/)]);
        expect(getIncidentCase("ic-0123456789abcdef")!.origin).toBe("user");
      });
    } finally { fs.rmSync(f, { force: true }); }
  });
});

describe("대화창 서식 — 숫자만 주고 끝내지 않는다", () => {
  it("0건은 정직하게(등록 0건과 검색 0건을 가른다), 1~2건은 쉬운 설명까지, 많으면 한 줄+교훈+출처", () => {
    expect(formatIncidentCases([])).toMatch(/등록된 사례가 아직 없습니다/);
    registerIncidentCase(log4shell, "정요한");
    registerIncidentCase(wannacry, "정요한");
    registerIncidentCase(국내, "김보안");
    const 없음 = formatIncidentCases(listIncidentCases({ q: "없는말" }), { q: "없는말" });
    expect(없음).toMatch(/^🔎 침해사고 히스토리 3건 중 「없는말」에 걸리는 사례가 없습니다/);
    expect(없음).toContain("못 찾았다는 뜻");
    const 하나 = formatIncidentCases(listIncidentCases({ cve: "CVE-2017-0144" }), { cve: "cve-2017-0144" });
    expect(하나).toMatch(/^📚 침해사고 히스토리 — 1건 \(CVE CVE-2017-0144\) · 전체 3건/);
    expect(하나).toContain(wannacry.plainExplain);
    expect(하나).toContain("교훈: 패치 배포 지연이 곧 사고다");
    expect(하나).toContain("출처: NCSC https://www.ncsc.gov.uk/");
    const 전부 = formatIncidentCases(listIncidentCases());
    expect(전부).not.toContain(wannacry.plainExplain); // 3건부터는 한 줄+교훈
    expect(전부).toContain("[2024 · 국내 · 제조] 국내 제조사 랜섬웨어 침해 — VPN 계정 유출로");
    expect(전부).toContain("CVE CVE-2021-44228, CVE-2021-45046 · 제품 Apache Log4j · 기법 T1190");
    expect(전부).toMatch(/📋 출처 링크에서 원문을 확인하세요/);
  });
  it("사례의 샘 — 파일이 없으면 없다고 말하고, 있으면 링크가 전부 http(s)다", () => {
    const all = listIncidentSources("all");
    const s = formatIncidentSources("all");
    expect(s).toMatch(/^📚 /);
    if (all.length === 0) expect(s).toContain("아직 없습니다");
    else {
      for (const x of all) {
        expect(x.url).toMatch(/^https?:\/\//);
        // 파일 칸 이름(language·what)이 바뀌면 화면의 언어·소개 칸이 조용히 빈다 — 읽기가 한쪽으로 접는지 값으로 본다
        expect(x.lang, `${x.name}: 언어(lang|language)가 비었다`).not.toBe("");
        expect(x.desc, `${x.name}: 소개(desc|what)가 비었다 — 클라 IncidentSource.desc가 이 칸을 그린다`).not.toBe("");
        expect(x.cadence, `${x.name}: 주기(cadence)가 비었다`).not.toBe("");
      }
      expect(s).toContain("외부 사이트로 나갑니다");
    }
    expect(listIncidentSources("youtube").every((x) => x.kind === "youtube")).toBe(true);
  });
});

describe("API — 라우트 순서·권한", () => {
  const 로그인 = async (app: ReturnType<typeof createApp>, username = "jyh", password = "changeme") => {
    const res = await request(app).post("/api/auth/login").send({ username, password });
    return res.body.accessToken as string;
  };
  it("/sources·/similar가 /:id보다 먼저 등록돼 있다(소스) — 뒤에 두면 :id가 'sources'를 삼킨다", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "src", "engine", "incidentcases.ts"), "utf8");
    const id = src.indexOf('"/api/incident-cases/:id"');
    expect(src.indexOf('"/api/incident-cases/sources"')).toBeLessThan(id);
    expect(src.indexOf('"/api/incident-cases/similar"')).toBeLessThan(id);
    expect(fs.readFileSync(path.join(__dirname, "..", "src", "app.ts"), "utf8")).toContain("registerIncidentCaseRoutes(app);");
  });
  it("관리자: 목록·샘·유사·상세·등록(201/400)·삭제", async () => {
    const app = createApp();
    const tok = await 로그인(app);
    const auth = { Authorization: `Bearer ${tok}` };
    expect((await request(app).get("/api/incident-cases/sources").set(auth)).status).toBe(200);
    expect((await request(app).get("/api/incident-cases/sources").set(auth)).body).toHaveProperty("sources");
    const post = await request(app).post("/api/incident-cases").set(auth).send(log4shell);
    expect(post.status).toBe(201);
    expect(post.body.cves).toEqual(["CVE-2021-44228", "CVE-2021-45046"]);
    const bad = await request(app).post("/api/incident-cases").set(auth).send({ ...log4shell, sourceUrl: "x" });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/http\(s\)/);
    const sim = await request(app).get("/api/incident-cases/similar?cves=cve-2021-44228,CVE-1999-0001").set(auth);
    expect(sim.body.cases.map((c: { id: string }) => c.id)).toEqual([post.body.id]);
    expect((await request(app).get(`/api/incident-cases?q=Log4j`).set(auth)).body.cases.length).toBe(1);
    expect((await request(app).get(`/api/incident-cases/${post.body.id}`).set(auth)).body.title).toBe(log4shell.title);
    expect((await request(app).get("/api/incident-cases/ic-nope").set(auth)).status).toBe(404);
    expect((await request(app).delete(`/api/incident-cases/${post.body.id}`).set(auth)).status).toBe(200);
    expect((await request(app).delete(`/api/incident-cases/${post.body.id}`).set(auth)).status).toBe(404);
    expect((await request(app).get("/api/incident-cases")).status).toBe(401); // 인증 없이는 못 본다
  });
  it("담당자: 등록 API는 403(등록은 결재판), 내장 사례 삭제는 403, 본인 등록분은 지운다", async () => {
    createUser({ username: "kim-ic", password: "changeme1!", displayName: "김보안", role: "security_officer" });
    const app = createApp();
    const tok = await 로그인(app, "kim-ic", "changeme1!");
    const auth = { Authorization: `Bearer ${tok}` };
    expect((await request(app).post("/api/incident-cases").set(auth).send(log4shell)).status).toBe(403);
    const 내장 = registerIncidentCase(wannacry, null, "builtin");
    const 남의것 = registerIncidentCase(log4shell, "정요한");
    const 내것 = registerIncidentCase(국내, "김보안");
    expect((await request(app).delete(`/api/incident-cases/${내장.id}`).set(auth)).status).toBe(403);
    expect((await request(app).delete(`/api/incident-cases/${남의것.id}`).set(auth)).status).toBe(403);
    expect((await request(app).delete(`/api/incident-cases/${내것.id}`).set(auth)).status).toBe(200);
    expect(countIncidentCases()).toBe(2);
    expect((await request(app).get("/api/incident-cases").set(auth)).body.cases.length).toBe(2); // 조회는 누구나
  });
});

describe("배선 — 도구·정리 대장", () => {
  it("대화창 도구 넷이 등록돼 있다 — 조회 둘은 즉답(directAnswer), 등록·삭제는 결재판(write)", () => {
    expect(findAgentTool("incident_cases")).toMatchObject({ write: false, directAnswer: true, domain: "cross" });
    expect(findAgentTool("incident_sources")).toMatchObject({ write: false, directAnswer: true });
    expect(findAgentTool("register_incident_case")).toMatchObject({ write: true });
    expect(findAgentTool("delete_incident_case")).toMatchObject({ write: true });
    // 등록 도구의 undo 안내가 약속하는 「사례 삭제」 문이 실제로 있다(안내한 말 점검)
    expect(findAgentTool("register_incident_case")!.undo).toContain("사례 삭제");
    // 결재판 「실행되면:」이 입력 부족을 미리 말한다 — 승인이 헛돌지 않게
    expect(findAgentTool("register_incident_case")!.effect!({})).toMatch(/등록되지 않습니다 — 입력이 부족합니다/);
    expect(findAgentTool("register_incident_case")!.effect!(log4shell as unknown as Record<string, string>)).toMatch(/「Log4Shell 대규모 악용」\(2021·소프트웨어·해외\)을 등록합니다 — 출처 https/);
  });
  it("incident_cases는 지식이다 — 정리 대장(TARGETS)에 없다(실사용 전환에서 안 지운다, 결정 ①)", () => {
    expect(Object.values(TARGETS).flatMap((t) => t.tables)).not.toContain("incident_cases");
  });
  it("문서 수 소비처 — 새 문서 배지·대장·중복 후보에서는 빠지고(approved-qa와 같이), 지식 건수(자가진단·팀 구성)에는 든다", () => {
    const read = (f: string) => fs.readFileSync(path.join(__dirname, "..", "src", "engine", f), "utf8");
    expect(read("memory.ts")).toMatch(/recentDocCountStmt[\s\S]{0,500}'incident-case'/);
    expect(read("docdigest.ts")).toContain("<> 'incident-case'");
    expect(read("docdupe.ts")).toContain("<> 'incident-case'");
    expect(read("observability.ts")).not.toContain("incident-case");
    expect(read("teamview.ts")).not.toContain("incident-case");
  });
});
