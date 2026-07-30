// engine/docbox.ts — 문서함: 출하 문서를 담당자가 **직접 읽는** 통로.
// (계획서 중-1 확장 — 사용자 지시 2026-07-30 "가이드 문서 및 아키텍처를 사용자가 쉽게 확인하게")
//
// ■ 왜 필요한가
//   고객사에 나가는 문서가 이미 선별돼 있는데(docs-manifest.json), 담당자가 **읽을 화면이 없었다.**
//   문서는 AI 답변의 근거(RAG)로만 쓰이고, 사람이 목차를 펼쳐 볼 수는 없었다.
//
// ■ 무엇을 보여주고 무엇을 감추나
//   매니페스트의 문서 중 **knowledge/ 아래는 제외**한다. 그것들은 "AI가 답할 때 쓰는 재료"지
//   사람이 펼쳐 읽는 문서가 아니다(장비 콘솔 메뉴맵·릴리즈노트 같은 것). 궁금하면 챗봇에 물으면 된다.
//   → 매니페스트는 '무엇이 고객에게 나가는가'의 진실 원천이고, 여기서 그 부분집합을 정한다.
//      **새 경계를 만들지 않는다** — 매니페스트에 없는 문서는 문서함에도 절대 안 나온다.
//
// ■ 보안
//   클라이언트는 파일명을 **고를 수만** 있고 지정할 수 없다. 요청은 목록의 id로만 받고,
//   서버가 자기 화이트리스트에서 경로를 찾는다. 경로 탈출(../)이 애초에 성립하지 않는 구조다.
import type { Express } from "express";
import * as fs from "fs/promises";
import * as path from "path";
import { authMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";

interface ManifestFile {
  file: string;
  why?: string;
}
interface Manifest {
  files?: ManifestFile[];
}

function manifestPath(): string {
  return process.env.GIJO_DOCS_MANIFEST ?? "docs-manifest.json";
}
// docsbundle.ts와 **같은 해석**을 쓴다 — 두 곳이 다른 데를 보면 "목록엔 있는데 안 열리는" 일이 난다
// (실제로 겪었다: 문서를 엉뚱한 위치에 둬 인입이 조용히 건너뛰어졌다, 2026-07-30).
function docsDirs(): string[] {
  return process.env.GIJO_DOCS_DIR ? [process.env.GIJO_DOCS_DIR] : ["docs", ".."];
}

export interface DocboxEntry {
  id: string; // 클라이언트가 쓰는 유일한 식별자(파일명 아님)
  title: string; // 사람이 읽는 제목
  group: "guide" | "policy"; // 사용 안내 / 업무 지침
  why?: string; // 매니페스트가 적어둔 "왜 나가는 문서인가"
}

// 제목·분류 — 파일명에서 기계적으로 뽑으면 "AIBOM_검토_가이드"처럼 읽기 나쁘다. 사람 말로 둔다.
// 여기 없는 문서는 파일명 기반으로 폴백한다(새 문서를 매니페스트에 넣어도 목록에는 나오게).
const META: Record<string, { title: string; group: DocboxEntry["group"] }> = {
  "GIJO_AS_사용자_매뉴얼.md": { title: "사용자 매뉴얼", group: "guide" },
  "GIJO_AS_보안담당자_실무매뉴얼.md": { title: "보안담당자 실무매뉴얼", group: "guide" },
  "GIJO_AS_보안담당자_활용가이드.md": { title: "보안담당자 활용가이드", group: "guide" },
  "GIJO_AS_제품소개.md": { title: "제품 소개", group: "guide" },
  "GIJO_AS_아키텍처_개요.md": { title: "아키텍처 개요", group: "policy" },
  "GIJO_AS_AIBOM_검토_가이드.md": { title: "AI-BOM 검토 가이드", group: "policy" },
  "GIJO_AS_취약점관리_지침.md": { title: "취약점관리 지침", group: "policy" },
  "GIJO_AS_보안제품관리_지침.md": { title: "보안제품관리 지침", group: "policy" },
};

function idFor(file: string): string {
  return file.replace(/\.md$/i, "").replace(/[^A-Za-z0-9가-힣_-]/g, "_");
}

async function readManifest(): Promise<Manifest | null> {
  try {
    return JSON.parse(await fs.readFile(manifestPath(), "utf-8")) as Manifest;
  } catch {
    return null;
  }
}

/** 문서함에 보여줄 문서 목록 — 매니페스트 ∩ (knowledge/ 제외). */
export async function listDocbox(): Promise<DocboxEntry[]> {
  const m = await readManifest();
  const files = (m?.files ?? []).map((f) => f.file).filter((f) => f && !f.startsWith("knowledge/"));
  const whyOf = new Map((m?.files ?? []).map((f) => [f.file, f.why]));
  return files.map((file) => {
    const meta = META[file];
    return {
      id: idFor(file),
      title: meta?.title ?? file.replace(/^GIJO_AS_/, "").replace(/\.md$/i, "").replace(/_/g, " "),
      group: meta?.group ?? "policy",
      why: whyOf.get(file),
    };
  });
}

/** id → 실제 파일 경로. 목록에 없는 id는 null(경로를 클라이언트가 못 정한다). */
async function resolveById(id: string): Promise<string | null> {
  const m = await readManifest();
  const file = (m?.files ?? []).map((f) => f.file).find((f) => f && !f.startsWith("knowledge/") && idFor(f) === id);
  if (!file) return null;
  for (const dir of docsDirs()) {
    const p = path.join(dir, file);
    try {
      await fs.access(p);
      return p;
    } catch {
      /* 다음 후보 */
    }
  }
  return null;
}

export async function readDocbox(id: string): Promise<{ id: string; title: string; markdown: string } | null> {
  const p = await resolveById(id);
  if (!p) return null;
  const entry = (await listDocbox()).find((e) => e.id === id);
  try {
    return { id, title: entry?.title ?? id, markdown: await fs.readFile(p, "utf-8") };
  } catch {
    return null;
  }
}

/** 제목·본문 검색. RAG가 아니라 단순 문자열 검색이다 — 문서함은 "찾아 펼치기"지 질의응답이 아니다. */
export async function searchDocbox(q: string): Promise<{ id: string; title: string; hits: number; snippet: string }[]> {
  const needle = q.trim().toLowerCase();
  if (needle.length < 2) return [];
  const out: { id: string; title: string; hits: number; snippet: string }[] = [];
  for (const e of await listDocbox()) {
    const doc = await readDocbox(e.id);
    if (!doc) continue;
    const lower = doc.markdown.toLowerCase();
    const titleHit = e.title.toLowerCase().includes(needle);
    let hits = 0;
    let idx = lower.indexOf(needle);
    const first = idx;
    while (idx !== -1) {
      hits++;
      idx = lower.indexOf(needle, idx + needle.length);
      if (hits > 200) break; // 아주 흔한 낱말에서 무한정 세지 않는다
    }
    if (!hits && !titleHit) continue;
    const at = first >= 0 ? first : 0;
    const snippet = doc.markdown
      .slice(Math.max(0, at - 50), at + 110)
      .replace(/\s+/g, " ")
      .trim();
    out.push({ id: e.id, title: e.title, hits, snippet });
  }
  return out.sort((a, b) => b.hits - a.hits);
}

export function registerDocboxRoutes(app: Express): void {
  app.get(
    "/api/docbox",
    authMiddleware,
    asyncRoute(async (_req, res) => {
      res.json({ documents: await listDocbox() });
    })
  );

  app.get(
    "/api/docbox/search",
    authMiddleware,
    asyncRoute(async (req, res) => {
      res.json({ results: await searchDocbox(String(req.query.q ?? "")) });
    })
  );

  // ⚠ :id는 목록의 id로만 해석된다 — 파일 경로가 아니다(경로 탈출이 성립하지 않는 구조).
  app.get(
    "/api/docbox/:id",
    authMiddleware,
    asyncRoute(async (req, res) => {
      const doc = await readDocbox(String(req.params.id));
      if (!doc) {
        res.status(404).json({ error: "그런 문서가 없습니다" });
        return;
      }
      res.json(doc);
    })
  );
}
