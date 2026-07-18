import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// LanceDB 경로는 모듈 로드 시점에 읽히므로 import 전에 임시 디렉터리로 고정한다
// (개발 머신의 실제 data/memory.lancedb를 건드리지 않기 위해).
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gijo-docsbundle-"));
process.env.GIJO_MEMORY_DB_PATH = path.join(tmp, "lancedb");

// 매니페스트·문서 원본을 임시 디렉터리로 격리 — 리포지토리 루트의 실제 제품 문서를 읽지 않는다.
const MANIFEST = path.join(tmp, "docs-manifest.json");
const DOCS_DIR = path.join(tmp, "docs");
process.env.GIJO_DOCS_MANIFEST = MANIFEST;
process.env.GIJO_DOCS_DIR = DOCS_DIR;

vi.mock("../src/engine/llm", () => ({
  embed: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
  chat: vi.fn(),
  registerLlmRoutes: vi.fn(),
}));

const { bootstrapDocsBundle } = await import("../src/engine/docsbundle");
const { listDocuments, queryMemory } = await import("../src/engine/memory");

function writeManifest(files: { file: string; why?: string }[]) {
  fs.writeFileSync(MANIFEST, JSON.stringify({ scope: "global", files }), "utf-8");
}

describe("docsbundle — 제품 문서 기본 코퍼스 부트스트랩", () => {
  beforeAll(() => {
    fs.mkdirSync(DOCS_DIR, { recursive: true });
    fs.writeFileSync(path.join(DOCS_DIR, "매뉴얼.md"), "# 사용자 매뉴얼\n대시보드는 오늘 할 일을 먼저 보여줍니다.", "utf-8");
    fs.writeFileSync(path.join(DOCS_DIR, "지침.md"), "# 취약점 관리 지침\n조치 기한은 심각도에 따라 정합니다.", "utf-8");
  });

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("매니페스트에 열거된 문서를 인입하고 검색으로 찾을 수 있다", async () => {
    writeManifest([{ file: "매뉴얼.md" }, { file: "지침.md" }]);
    const r = await bootstrapDocsBundle();

    expect(r.ingested.sort()).toEqual(["매뉴얼.md", "지침.md"]);
    expect(r.failed).toEqual([]);
    expect(r.missing).toEqual([]);

    const hits = await queryMemory("대시보드가 뭘 보여주나요?");
    expect(hits.join("\n")).toContain("오늘 할 일");
  });

  it("재기동해도 이미 인입된 문서는 건너뛴다 — 중복 청크가 쌓이지 않는다", async () => {
    const before = await listDocuments();
    const beforeChunks = before.reduce((n, d) => n + d.chunks, 0);

    const r = await bootstrapDocsBundle();

    expect(r.ingested).toEqual([]);
    expect(r.skipped.sort()).toEqual(["매뉴얼.md", "지침.md"]);
    const after = await listDocuments();
    expect(after.reduce((n, d) => n + d.chunks, 0)).toBe(beforeChunks);
  });

  it("매니페스트에 있지만 파일이 없으면 missing으로 보고하고 나머지는 계속 인입한다", async () => {
    fs.writeFileSync(path.join(DOCS_DIR, "신규.md"), "# 신규 문서\n보안제품 등록은 등록부 화면에서 합니다.", "utf-8");
    writeManifest([{ file: "매뉴얼.md" }, { file: "없는문서.md" }, { file: "신규.md" }]);

    const r = await bootstrapDocsBundle();

    expect(r.missing).toEqual(["없는문서.md"]);
    expect(r.ingested).toEqual(["신규.md"]);
    expect(r.skipped).toEqual(["매뉴얼.md"]);
  });

  it("매니페스트가 없으면 조용히 아무것도 하지 않는다 (서버 기동을 막지 않는다)", async () => {
    process.env.GIJO_DOCS_MANIFEST = path.join(tmp, "없는매니페스트.json");
    try {
      const r = await bootstrapDocsBundle();
      expect(r).toEqual({ ingested: [], skipped: [], missing: [], failed: [] });
    } finally {
      process.env.GIJO_DOCS_MANIFEST = MANIFEST;
    }
  });
});

// 실제 리포지토리의 매니페스트가 가리키는 문서가 전부 존재하는지 — 여기가 깨지면 설치본의
// 지식베이스가 그만큼 비어 나간다(빌드 스크립트도 같은 이유로 누락 시 빌드를 세운다).
describe("docs-manifest.json — 실제 매니페스트 정합성", () => {
  it("열거된 제품 문서가 모두 리포지토리에 존재한다", () => {
    const repoManifest = path.resolve("docs-manifest.json");
    const manifest = JSON.parse(fs.readFileSync(repoManifest, "utf-8")) as { files: { file: string }[] };
    expect(manifest.files.length).toBeGreaterThan(0);

    const repoRoot = path.resolve("..");
    const missing = manifest.files.map((f) => f.file).filter((f) => !fs.existsSync(path.join(repoRoot, f)));
    expect(missing).toEqual([]);
  });

  it("내부 개발 문서는 코퍼스에 넣지 않는다 — 고객사 노출 방지", () => {
    const manifest = JSON.parse(fs.readFileSync(path.resolve("docs-manifest.json"), "utf-8")) as { files: { file: string }[] };
    const names = manifest.files.map((f) => f.file).join("|");
    // 실측(2026-07-19): 개발용 가이드를 근거로 주자 답변이 server/src/engine/assets.ts 경로를
    // 최종 사용자에게 그대로 노출했다. 개발·배포·계획 문서는 이름 단위로 막는다.
    expect(names).not.toMatch(/개발자|로컬LLM_프로젝트|배포_가이드|PC세팅|IA_통합설계|WSL2|계획서|다음단계|세션_산출물|제품_확인|UX피드백/);
  });
});
