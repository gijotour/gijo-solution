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
  validateIncidentCaseInput, registerIncidentCase, deleteIncidentCase, listIncidentCases, getIncidentCase, findCasesForCves, matchCasesForCves, countIncidentCases,
  seedBuiltinCases, builtinCaseId, syncIncidentCaseDocs, syncIncidentCaseDocsWithRetry, incidentCaseDocsIdle, caseDocText, formatIncidentCases, formatIncidentSources, listIncidentSources,
  hiddenBuiltinCaseIds, unhideBuiltinCases, incidentCaseDocId, INCIDENT_CASE_ORIGIN, INCIDENT_CASE_CATEGORY, CVE_ID_RE, LIMITS,
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
  // 내장 사례 숨김 기록도 시험마다 비운다 — 안 비우면 앞 시험이 지운 씨앗이 뒷 시험에서 안 들어와 「멱등이 깨졌다」로 보인다
  db.prepare("DELETE FROM app_state WHERE key = 'incidentcases:hiddenBuiltin'").run();
  ingestSpy.mockClear(); deleteSpy.mockClear();
});
/** 배포되는 진짜 씨앗 파일 — 실데이터로 재는 시험이 쓴다(길이·건수는 시험이 지어내지 않는다). */
const 씨앗파일 = path.join(__dirname, "..", "src", "engine", "incidentcases-seed.json");
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
  it("★ 필수가 아닌 칸도 **조용히 자르지 않는다** — 출처 이름·URL·제품 이름이 상한을 넘으면 사유로 말한다(검토관 2026-09-03)", () => {
    const { errors } = validateIncidentCaseInput({
      ...log4shell,
      sourceName: "가".repeat(LIMITS.sourceName + 1),
      sourceUrl: `https://example.com/${"a".repeat(LIMITS.sourceUrl)}`,
      products: ["제품".repeat(LIMITS.item)],
    });
    expect(errors.join("\n")).toMatch(new RegExp(`출처 이름이 ${LIMITS.sourceName}자를 넘습니다`));
    expect(errors.join("\n")).toMatch(new RegExp(`출처 URL이 ${LIMITS.sourceUrl}자를 넘습니다`));
    expect(errors.join("\n")).toMatch(new RegExp(`제품 이름이 ${LIMITS.item}자를 넘습니다`));
    // 상한 안이면 그대로 산다 — 옛 상한(80)에서 잘려 나가던 씨앗 출처가 이 길이다
    const 긴출처 = "가".repeat(290);
    expect(validateIncidentCaseInput({ ...log4shell, sourceName: 긴출처 })).toMatchObject({ errors: [], value: { sourceName: 긴출처 } });
  });
  it("★ 배포되는 씨앗 20건이 새 검증을 전부 지난다 — 표에 들어간 값이 원본과 같다(잘린 칸 0)", () => {
    const j = JSON.parse(fs.readFileSync(씨앗파일, "utf8")) as { cases: Record<string, unknown>[] };
    expect(j.cases.length, "씨앗 건수가 줄었다").toBeGreaterThanOrEqual(20);
    for (const c of j.cases) {
      const { value, errors } = validateIncidentCaseInput(c);
      expect(errors, `${String(c.title)}: ${errors.join(" · ")}`).toEqual([]);
      expect(value.sourceName, `${String(c.title)}: 출처 이름이 잘렸다`).toBe(String(c.sourceName ?? "").trim());
      expect(value.sourceUrl, `${String(c.title)}: 출처 URL이 잘렸다`).toBe(String(c.sourceUrl ?? "").trim());
    }
    // 이 시험이 헛돌지 않는가 — 옛 상한(80)을 넘는 출처가 실제로 있어야 「살렸다」가 증명된다
    expect(Math.max(...j.cases.map((c) => String(c.sourceName ?? "").length))).toBeGreaterThan(80);
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

describe("상한·총계 — 화면이 부르는 수와 서버가 주는 수가 같아야 한다", () => {
  it("★ 상한 500까지 준다(클라가 500으로 부른다) — 200에서 조용히 깎으면 화면은 전부인 줄 안다", () => {
    for (let i = 0; i < 201; i += 1) registerIncidentCase({ ...log4shell, title: `사례 ${i}`, sourceUrl: `https://example.com/case-${i}` }, "정요한");
    expect(listIncidentCases({ limit: 500 }).length).toBe(201);
    expect(listIncidentCases({ limit: 9999 }).length, "500을 넘겨 불러도 500까지").toBe(201);
    expect(listIncidentCases().length, "안 적으면 기본 50").toBe(50);
    expect(listIncidentCases({ limit: 1 }).length).toBe(1);
  });
  it("총계는 목록과 **같은 조건**으로 센다 — 목록이 잘려도 「전체 몇 건」은 정직하다", () => {
    registerIncidentCase(log4shell, "정요한");
    registerIncidentCase(wannacry, "정요한");
    registerIncidentCase(국내, "김보안");
    expect(countIncidentCases()).toBe(3);
    expect(countIncidentCases({ q: "랜섬웨어" })).toBe(2);
    expect(countIncidentCases({ cve: "cve-2017-0144" })).toBe(1);
    expect(countIncidentCases({ year: 2024 })).toBe(1);
    expect(countIncidentCases({ q: "없는말" })).toBe(0);
    // 목록을 1건으로 깎아도 총계는 그대로 — 이 둘이 어긋나면 화면의 「N건 중 M건」이 거짓이 된다
    expect(listIncidentCases({ q: "랜섬웨어", limit: 1 }).length).toBe(1);
    expect(countIncidentCases({ q: "랜섬웨어" })).toBe(2);
  });
  it("CVE 유사 검색도 상한 전(matchCasesForCves)과 상한 후(findCasesForCves)를 가른다 — 칩의 N과 판의 줄 수가 같게", () => {
    for (let i = 0; i < 7; i += 1) registerIncidentCase({ ...log4shell, title: `Log4j 사례 ${i}`, sourceUrl: `https://example.com/l-${i}` }, "정요한");
    expect(matchCasesForCves(["CVE-2021-44228"]).length).toBe(7);
    expect(findCasesForCves(["CVE-2021-44228"]).length, "기본 5건").toBe(5);
    expect(findCasesForCves(["CVE-2021-44228"], 3).length).toBe(3);
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
  it("★ 반입 끄개가 켜져 있으면 부팅 동기화 재시도가 바로 끝난다 — 20초씩 기다린 끝에 「반입 실패」를 찍지 않는다", async () => {
    registerIncidentCase(log4shell, "정요한");
    const t = Date.now();
    await syncIncidentCaseDocsWithRetry(3, 20_000); // 끄개가 없으면 40초 이상 걸리고 오류를 찍는다
    expect(Date.now() - t, "끄개가 켜졌는데도 재시도를 돌았다").toBeLessThan(1000);
    expect(ingestSpy).not.toHaveBeenCalled();
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

  it("★ 내장 사례를 지우면 **숨김**으로 남아 재기동 씨앗이 되살리지 않는다 — 관리자가 되살릴 수 있다(검토관 2026-09-03)", () => {
    const f = 임시();
    fs.writeFileSync(f, JSON.stringify({ cases: [log4shell, wannacry] }));
    try {
      expect(seedBuiltinCases(f)).toMatchObject({ inserted: 2, hidden: 0 });
      const id = builtinCaseId(wannacry);
      expect(deleteIncidentCase(id, "정요한")).toBe(true);
      expect(hiddenBuiltinCaseIds()).toEqual([id]);
      // 재기동 — 지운 것이 되살아나지 않는다(예전엔 씨앗이 같은 id로 다시 넣어 「지웠는데 다시 있다」였다)
      expect(seedBuiltinCases(f)).toMatchObject({ inserted: 0, unchanged: 1, hidden: 1 });
      expect(getIncidentCase(id)).toBeUndefined();
      // 관리자 되살리기 — 도구 문구가 약속한 문이 실제로 돈다(안내한 말 점검)
      expect(unhideBuiltinCases()).toBe(1);
      expect(seedBuiltinCases(f)).toMatchObject({ inserted: 1, hidden: 0 });
      expect(getIncidentCase(id)!.origin).toBe("builtin");
      // 담당자 등록분은 숨김에 안 들어간다 — 지우면 그대로 끝이다
      const 내것 = registerIncidentCase(국내, "김보안");
      deleteIncidentCase(내것.id, "김보안");
      expect(hiddenBuiltinCaseIds()).toEqual([]);
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
  it("★ 씨앗 20건을 그대로 실어도 머리의 「N건」·📋 안내가 살아 있고 「… 외 N건」으로 끝난다(3500 컷에 안 기댄다)", () => {
    // 예전엔 끝의 3500자 컷이 **안내 줄을 통째로 먹었다** — 실데이터(씨앗 20건)로 잰다(짧은 가짜 3건으로는 안 드러난다).
    expect(seedBuiltinCases(씨앗파일).inserted).toBe(20);
    const rows = listIncidentCases({ limit: 500 });
    expect(rows.length).toBe(20);
    const s = formatIncidentCases(rows);
    const 줄 = s.split("\n");
    expect(s.length, `답이 3500자 컷에 닿았다(${s.length}자) — 건당 상한을 다시 봐야 한다`).toBeLessThan(3500);
    expect(줄[0]).toBe("📚 침해사고 히스토리 — 20건");
    expect(줄[1], "안내 줄이 머리 바로 아래에 있어야 컷에 안 먹힌다").toMatch(/^📋 출처 링크에서 원문을 확인하세요/);
    expect(줄.at(-1), "잘리지 않고 「외 N건」으로 끝난다").toMatch(/^… 외 15건 —/);
    // 다섯 건까지만 싣는다 — 번호 6은 없다
    expect(s).toContain("5. [");
    expect(s).not.toContain("\n6. [");
    // 건당 상한 — 교훈은 200자까지, 출처 이름은 60자까지(넘으면 말줄임이 보인다)
    for (const 줄하나 of 줄.filter((x) => x.startsWith("   교훈: "))) expect(줄하나.length).toBeLessThanOrEqual(3 + 4 + 201);
    expect(s, "잘린 자리는 말줄임으로 보인다").toContain("…");
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
        // 이용 경계(licenseNote) — 파일엔 28곳 모두 있는데 읽기가 버려 화면 툴팁이 그릴 재료가 없었다(검토관 2026-09-03)
        expect(x.licenseNote, `${x.name}: 이용 경계(licenseNote)가 비었다 — 화면 툴팁이 이 칸을 그린다`).not.toBe("");
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
    expect(sim.body.total, "칩이 「N건」을 말하려면 상한 전 총계가 함께 와야 한다").toBe(1);
    const 목록 = await request(app).get(`/api/incident-cases?q=Log4j`).set(auth);
    expect(목록.body.cases.length).toBe(1);
    expect(목록.body.total, "목록과 같은 조건으로 센 총계").toBe(1);
    // 상한에 잘려도 총계는 정직하다 — 화면이 「전부인 척」하지 않게
    registerIncidentCase({ ...log4shell, title: "Log4j 두 번째", sourceUrl: "https://example.com/l2" }, "정요한");
    const 잘림 = await request(app).get(`/api/incident-cases?q=Log4j&limit=1`).set(auth);
    expect(잘림.body.cases.length).toBe(1);
    expect(잘림.body.total).toBe(2);
    expect((await request(app).get(`/api/incident-cases/${post.body.id}`).set(auth)).body.title).toBe(log4shell.title);
    expect((await request(app).get("/api/incident-cases/ic-nope").set(auth)).status).toBe(404);
    expect((await request(app).delete(`/api/incident-cases/${post.body.id}`).set(auth)).status).toBe(200);
    expect((await request(app).delete(`/api/incident-cases/${post.body.id}`).set(auth)).status).toBe(404);
    expect((await request(app).get("/api/incident-cases")).status).toBe(401); // 인증 없이는 못 본다
    // 내장 사례 되살리기 — 삭제 도구가 약속한 「다시 보이려면 관리자」의 실제 문(약속만 있고 문이 없으면 거짓말이다)
    const 되살림 = await request(app).post("/api/incident-cases/builtin/restore").set(auth);
    expect(되살림.status).toBe(200);
    expect(되살림.body).toHaveProperty("unhidden");
    expect(countIncidentCases(), "되살리기가 씨앗을 다시 넣는다").toBeGreaterThan(0);
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
    expect((await request(app).post("/api/incident-cases/builtin/restore").set(auth)).status, "되살리기는 관리자만").toBe(403);
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
    // 조사는 손으로 적지 않는다 — 앞말이 값이라 「…해외)를」이다(조사()가 닫는 괄호를 건너뛰고 「외」의 받침을 본다, josa.test 소스 감시)
    expect(findAgentTool("register_incident_case")!.effect!(log4shell as unknown as Record<string, string>)).toMatch(/「Log4Shell 대규모 악용」\(2021·소프트웨어·해외\)를 등록합니다 — 출처 https/);
    // 삭제 결재판 — 내장 사례는 「숨김」이라고 미리 말한다(지운 줄 알았는데 되살아나던 결함의 짝)
    const 내장 = registerIncidentCase(wannacry, null, "builtin");
    expect(findAgentTool("delete_incident_case")!.effect!({ id: 내장.id })).toMatch(/제품 내장 사례를 지우고 지식 문서도 함께 뺍니다 · 내장 사례는 \*\*숨김\*\*/);
    const 담당자것 = registerIncidentCase(국내, "김보안");
    expect(findAgentTool("delete_incident_case")!.effect!({ id: 담당자것.id })).toMatch(/김보안 등록을 지우고/); // 받침 있는 앞말은 「을」
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

  // ★ 2026-09-03 검토관: 안내글이 「판 전체 목록은 최대 **200건**」이라 적어 놓았는데 서버 상한은 **500**이었다.
  //   같은 숫자가 세 곳(서버 clamp · 판 화면 상한 · 안내글)에 손으로 적혀 있어 한 곳만 낡은 것이다 —
  //   담당자는 「200건까지만 보이나 보다」 하고 좁혀 묻는데 화면엔 500건이 그려진다. 세 번째면 소스 감시.
  it("★ 안내가 말하는 상한이 코드의 상한과 같다 (안내한 말 점검)", () => {
    const 엔진 = fs.readFileSync(path.join(__dirname, "..", "src", "engine", "incidentcases.ts"), "utf8");
    const 목록상한 = Number(/Math\.max\(1,\s*Math\.min\((\d+),\s*Number\(opts\.limit\)/.exec(엔진)?.[1]);
    const 좁힘상한 = Number(/Math\.max\(1,\s*Math\.min\((\d+),\s*Number\(q\.limit\)/.exec(엔진)?.[1]);
    expect(목록상한, "listIncidentCases의 상한을 소스에서 못 읽었다 — 꼴이 바뀌었다면 이 감시부터 고친다").toBeGreaterThan(0);
    expect(좁힘상한, "/similar의 상한을 소스에서 못 읽었다 — 꼴이 바뀌었다면 이 감시부터 고친다").toBeGreaterThan(0);
    const 안내 = fs.readFileSync(path.join(__dirname, "..", "src", "engine", "screenguide.ts"), "utf8");
    const 판안내 = /"히스토리 보는 법":\s*"([^"]+)"/.exec(안내)?.[1] ?? "";
    expect(판안내, "📚 판 안내(screenguide panels)를 못 읽었다").not.toBe("");
    expect(판안내, `안내가 말하는 판 상한이 코드(${목록상한})와 다르다`).toContain(`최대 ${목록상한}건`);
    expect(판안내, `안내가 말하는 좁힘 상한이 코드(${좁힘상한})와 다르다`).toContain(`${좁힘상한}건`);
    // 화면도 같은 수를 쓴다 — 작게 부르면 화면이 스스로 잘라 놓고 「N건」이라 말한다(거짓 숫자의 뿌리).
    const 화면 = fs.readFileSync(path.join(__dirname, "..", "..", "client", "src", "renderer", "pages", "incidentcases.html"), "utf8");
    expect(화면, "판 목록 상한").toContain(`var 상한 = ${목록상한};`);
    expect(화면, "?cve= 좁힘 상한").toContain(`var 좁힘상한 = ${좁힘상한};`);
  });

  // ★ 2026-09-03 검토관: 칩이 「📚 비슷한 사례 N건」이라 말하는데 N을 **받은 줄 수**로 셌다.
  //   /similar는 { cases, total }을 주고 cases는 기본 5건까지만 실린다 — 6건 이상 걸린 CVE는 늘 「5건」이었다.
  //   판을 열면 더 나오니 그 자리에서 들통나는 거짓 숫자다. 세는 곳은 서버 total 하나다.
  it("★ 「비슷한 사례」 칩의 N은 서버가 센 total이다 — 다리(preload)도 limit을 실제로 넘긴다", () => {
    const 취약점화면 = fs.readFileSync(path.join(__dirname, "..", "..", "client", "src", "renderer", "pages", "vulnscan.html"), "utf8");
    expect(취약점화면, "칩의 N이 total이 아니면 기본 5건에 갇힌 거짓 숫자가 된다").toMatch(/typeof r\.total === "number" \? r\.total/);
    // 다리가 limit을 안 넘기면 화면이 넘기는 척만 하고 서버는 기본 5건을 준다(조용히 무시되는 인자).
    const preload = fs.readFileSync(path.join(__dirname, "..", "..", "client", "src", "preload.ts"), "utf8");
    expect(preload, "preload 다리가 limit을 받아 넘겨야 한다").toMatch(/incidentCasesSimilar:\s*\(cves: string\[\], limit\?: number\)\s*=>\s*api\.incidentCasesApi\.similar\(cves, limit\)/);
  });
});
