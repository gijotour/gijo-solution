// distillcorpus.test.ts — 증류 근거 코퍼스(운영 지식 저장소 → 증류기) 계약 (2026-09-03, 계획서 §3.2).
//
// 왜: 증류기가 저장소 파일만 자르면 운영에 올린 매뉴얼·지침이 재료에서 빠진다. 지식 저장소 조각을 내주되
//   ① 개인 문서(scope≠global) ② 승인 문답(origin approved-qa — 자기 답을 자기 근거로 삼는 순환) ③ 기밀 C
//   ④ 바이너리꼴 조각 ⑤ 너무 짧은 조각 은 **절대** 나가지 않는다. ref 꼬리는 본문 sha12 — 편입 검증과 같은 규칙.
import { describe, it, expect } from "vitest";
import crypto from "crypto";
import { buildDistillCorpus, 구조데이터꼴 } from "../src/engine/learncandidates";
import type { MemoryDocument } from "../src/engine/memory";

const doc = (documentId: string, over: Partial<MemoryDocument> = {}): MemoryDocument => ({
  documentId, scope: "global", chunks: 2, embeddingModel: "x", ingestedAt: null, hasSource: false,
  docClass: null, uploadedBy: null, category: "취약점", origin: null, grade: "O", ...over,
});
const 긴 = (s: string) => `${s} — 취약점 조치는 발견 즉시 담당자를 지정하고 기한 안에 패치한다. `.repeat(3);
const 바이너리 = " PDF\u0000\u0001\ufffdstream\u0008endobj".repeat(6); // 날 제어문자를 파일에 박으면 git이 바이너리로 본다 — 이스케이프로

function mem(docs: MemoryDocument[], chunksOf: Record<string, string[]>) {
  return {
    listDocuments: async () => docs,
    getDocumentChunks: async (id: string, _limit?: number) => (chunksOf[id] ?? []).map((text, chunkIndex) => ({ chunkIndex, text })),
  };
}

describe("증류 근거 코퍼스 — 무엇이 나가고 무엇이 절대 안 나가나", () => {
  it("global·비기밀·일반 문서의 읽을 수 있는 조각만 나가고 ref 꼬리는 본문 sha12다", async () => {
    // 개인 문서는 제품에서 scope=global인 채 문서 id 접두 personal:로 갈린다(memory.ts) — 그 실제 모양으로 잰다.
    const docs = [doc("지침.md"), doc("personal:abc", { scope: "global" }), doc("옛개인.md", { scope: "user:jyh" }), doc("승인문답:1", { origin: "approved-qa" }), doc("기밀.pdf", { grade: "C" }), doc("민감.md", { grade: "S" }), doc("깨진등급.md", { grade: "x" }), doc("남의문서.md")];
    const chunks = { "지침.md": [긴("A"), 바이너리, "짧다"], "personal:abc": [긴("개인")], "옛개인.md": [긴("옛개인")], "승인문답:1": [긴("문답")], "기밀.pdf": [긴("기밀")], "민감.md": [긴("민감")], "깨진등급.md": [긴("깨짐")], "남의문서.md": [긴("남의")] };
    const r = await buildDistillCorpus({ category: "취약점", 열람가능: (id) => id !== "남의문서.md" }, mem(docs, chunks));
    expect(r.chunks.map((c) => c.documentId)).toEqual(["지침.md"]);
    expect(r.docs).toBe(1);
    const c = r.chunks[0];
    expect(c.ref).toBe(`store:지침.md#${crypto.createHash("sha1").update(c.text).digest("hex").slice(0, 12)}`);
    expect(r.skipped["승인 문답"]).toBe(1);
    expect(r.skipped["개인 문서"]).toBe(1);
    expect(r.skipped["등급 제외"]).toBe(3); // 기밀 C · 민감 S(기본은 공개만) · 깨진 값(gradeOf → C)
    expect(r.skipped["열람 불가"]).toBe(1);
    expect(r.skipped["바이너리꼴"]).toBe(1);
    expect(r.skipped["너무 짧음"]).toBe(1);
    expect(JSON.stringify(r.chunks)).not.toMatch(/개인|옛개인|민감|남의|기밀/);
    // 민감(S)은 명시로 열 수 있지만 기밀(C)은 무엇을 줘도 안 나간다
    const r2 = await buildDistillCorpus({ category: "취약점", allowedGrades: ["O", "S", "C"] }, mem(docs, chunks));
    expect(r2.chunks.map((c) => c.documentId).sort()).toEqual(["남의문서.md", "민감.md", "지침.md"]);
  });

  it("JSON·CSV 덤프꼴 조각은 안 나간다 — 교사가 키 이름을 소리 나는 대로 읽어 문답을 만든다(첫 운영 증류 실측)", async () => {
    const 덤프 = '{"cve":["CVE-2015-9251"],"cwe":["693"],"cvss2_base_score":2.6,"cvss2_temporal_score":1.9,"exploited_by_malware":false,"epss_score":0.00553}'.repeat(2);
    expect(구조데이터꼴(덤프)).toBe(true);
    expect(구조데이터꼴(긴("글"))).toBe(false);
    const r = await buildDistillCorpus({}, mem([doc("a.md")], { "a.md": [덤프, 긴("본문")] }));
    expect(r.chunks.length).toBe(1);
    expect(r.skipped["구조 데이터꼴"]).toBe(1);
  });

  it("업무영역·출처로 거른다 — 다른 영역·다른 출처는 안 나간다", async () => {
    const docs = [doc("a.md", { category: "취약점", origin: "builtin" }), doc("b.md", { category: "장비운영", origin: "builtin" }), doc("c.md", { category: "취약점", origin: null })];
    const chunks = { "a.md": [긴("a")], "b.md": [긴("b")], "c.md": [긴("c")] };
    const r1 = await buildDistillCorpus({ category: "취약점" }, mem(docs, chunks));
    expect(r1.chunks.map((c) => c.documentId).sort()).toEqual(["a.md", "c.md"]);
    expect(r1.skipped["업무영역 다름"]).toBe(1);
    const r2 = await buildDistillCorpus({ category: "취약점", origins: ["builtin"] }, mem(docs, chunks));
    expect(r2.chunks.map((c) => c.documentId)).toEqual(["a.md"]);
    expect(r2.skipped["출처 제외"]).toBe(1);
  });

  it("상한 — 문서당·전체 상한을 넘는 조각은 거름 수에 남는다(조용히 잘리지 않는다)", async () => {
    const docs = [doc("a.md"), doc("b.md")];
    const chunks = { "a.md": [긴("1"), 긴("2"), 긴("3")], "b.md": [긴("4"), 긴("5")] };
    const r = await buildDistillCorpus({ maxPerDoc: 2, maxChunks: 3 }, mem(docs, chunks));
    expect(r.chunks.length).toBe(3);
    expect(r.skipped["문서당 상한"]).toBe(1);
    expect(r.skipped["전체 상한(조각)"] + r.skipped["전체 상한(문서)"]).toBeGreaterThan(0);
  });

  it("창구는 요청자 눈(열람불가공용)으로 한 번 더 거른다 — 등급 게이트 우회 금지(소스 감시)", () => {
    const fs = require("fs") as typeof import("fs");
    const path = require("path") as typeof import("path");
    const src = fs.readFileSync(path.join(__dirname, "..", "src", "engine", "learncandidates.ts"), "utf8");
    expect(src).toMatch(/buildDistillCorpus\(\{ \.\.\.b, 열람가능: \(id\) => !mem\.열람불가공용\(id, req\) \}, mem\)/);
    expect(src).toContain('import { gradeOf } from "./grades"');
  });

  it("창구는 admin 전용이고 증류기는 --source store로 그 창구를 부른다(소스 감시)", () => {
    const fs = require("fs") as typeof import("fs");
    const path = require("path") as typeof import("path");
    const src = fs.readFileSync(path.join(__dirname, "..", "src", "engine", "learncandidates.ts"), "utf8");
    expect(src).toMatch(/app\.post\("\/api\/learnloop\/distill\/corpus", authMiddleware, adminMiddleware/);
    const tool = fs.readFileSync(path.join(__dirname, "..", "..", "tools", "distill.mjs"), "utf8");
    expect(tool).toContain("/api/learnloop/distill/corpus");
    expect(tool).toContain('opt("--source", "files")');
    // 강제 로그인은 명시할 때만 — 기본값이 그 계정의 살아 있는 세션을 끊으면 안 된다(설계관 ★8)
    expect(tool).not.toContain("force: true");
    expect(tool).toContain('force: has("--force-login")');
    // 같은 서버면 코퍼스 로그인 세션을 편입에 재사용 — 같은 계정 두 번 로그인은 중복로그인 방지(409)에 걸린다
    expect(tool).toContain("코퍼스auth && CORPUS_SERVER === SERVER ? 코퍼스auth : await login()");
    // 접속 토큰 만료(긴 증류) → 편입 401은 다시 로그인해 한 번 더, 그래도 못 넣은 문답은 보고서에 남긴다
    expect(tool).toMatch(/편입 401[\s\S]*auth = await login\(\)/);
    expect(tool).toContain("report.failedItems ??= []");
  });

  // [2026-09-03 1일차 실기동] 코퍼스 갈래의 로그인·창구 호출은 **try 밖 최상위 await**이라,
  //   win 서버가 한 번 재시작되는 몇십 초에 걸리자 회차째 즉사했다. 그것도 조용히 —
  //   undici 기본 HeadersTimeout이 300초라 5분을 매달렸고 로그엔 `[distill]` 첫 줄조차 없었다.
  it("★ 최상위 코퍼스 호출은 명시 타임아웃 + 1회 재시도로 지킨다 — 서버 재시작 한 번에 회차가 죽지 않게(소스 감시)", () => {
    const fs = require("fs") as typeof import("fs");
    const path = require("path") as typeof import("path");
    const tool = fs.readFileSync(path.join(__dirname, "..", "..", "tools", "distill.mjs"), "utf8");
    // ① 명시 타임아웃 — 「느린 것」과 「없는 것」을 60초로 가른다(로그인은 1초짜리 일이다)
    expect(tool).toContain("const 창구타임아웃 = 60_000;");
    expect((tool.match(/AbortSignal\.timeout\(창구타임아웃\)/g) ?? []).length, "로그인·코퍼스 창구 둘 다").toBe(2);
    // ② 두 호출이 실제로 껍데기를 지난다(하나만 감싸면 나머지 하나로 그대로 죽는다)
    expect(tool).toContain('await 한번더("코퍼스 서버 로그인", () => login(CORPUS_SERVER))');
    expect(tool).toMatch(/await 한번더\("코퍼스 창구\(\/api\/learnloop\/distill\/corpus\)"/);
    // ③ 20초 뒤 한 번만 더 → 그래도 안 되면 사람이 읽을 사유를 남기고 exit 2
    expect(tool).toMatch(/async function 한번더\([\s\S]*setTimeout\(r, 20_000\)[\s\S]*process\.exit\(2\)/);
    expect(tool).toMatch(/두 번 다 실패했다/);
  });
});
