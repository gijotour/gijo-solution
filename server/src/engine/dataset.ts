// engine/dataset.ts — 파인튜닝용 대화형 데이터셋 변환 · 증폭 · 저장 (6.2절 ②단계)
// 저장된 데이터셋(data/datasets/<id>.json)이 finetune_unsloth.py의 입력이 된다.

import type { Express } from "express";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFile } from "child_process";
import { authMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import { chat } from "./llm";
import { recordProcessOutput } from "./logs";

const DATASETS_DIR = path.join("data", "datasets");

// 업로드된 문서(PDF/HWPX/TXT 등)에서 학습용 텍스트를 추출한다 — scripts/extract_doc.py(python) 사용.
// 파일을 임시 폴더에 쓴 뒤 확장자를 유지해 스크립트가 형식을 판별하게 한다. PYTHONUTF8=1(한국어).
export async function extractDocumentText(filename: string, base64: string): Promise<string> {
  const ext = path.extname(filename).toLowerCase() || ".txt";
  const tmp = path.join(os.tmpdir(), `gijo-doc-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  await fs.promises.writeFile(tmp, Buffer.from(base64, "base64"));
  recordProcessOutput("extract-doc", "log", `$ extract_doc.py ${filename} (${ext})`);
  try {
    const text = await new Promise<string>((resolve, reject) => {
      execFile(
        "python",
        ["scripts/extract_doc.py", tmp],
        { env: { ...process.env, PYTHONUTF8: "1" }, maxBuffer: 64 * 1024 * 1024 },
        (err, stdout, stderr) => {
          if (stderr) recordProcessOutput("extract-doc", "warn", stderr);
          if (err) return reject(new Error(stderr.trim() || err.message));
          resolve(stdout);
        }
      );
    });
    recordProcessOutput("extract-doc", "log", `${filename} — ${text.length.toLocaleString()}자 추출`);
    return text;
  } finally {
    fs.promises.unlink(tmp).catch(() => {});
  }
}

export interface ConversationExample {
  question: string;
  answer: string;
}

function isExample(item: unknown): item is ConversationExample {
  return typeof item === "object" && item !== null && "question" in item && "answer" in item;
}

// LLM 응답에서 Q&A 쌍을 최대한 견고하게 뽑는다. 로컬 7B 모델은 종종 배열 앞뒤에 설명을 붙이거나
// 응답이 잘리므로: (1) 코드펜스 제거 (2) 첫 '['~마지막 ']' 슬라이스 후 JSON.parse
// (3) 그래도 실패하면 개별 {"question":..,"answer":..} 객체를 정규식으로 긁어낸다(잘린 배열도 앞부분은 살림).
function parseExamples(raw: string): ConversationExample[] {
  let s = raw.replace(/```(?:json)?/gi, "").trim();
  const start = s.indexOf("[");
  const end = s.lastIndexOf("]");
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  try {
    const parsed = JSON.parse(s) as unknown;
    if (Array.isArray(parsed)) {
      const items = parsed.filter(isExample);
      if (items.length > 0) return items;
    }
  } catch {
    /* 아래 정규식 폴백으로 */
  }
  // 폴백: 완전한 객체만 하나씩 추출 (배열이 잘렸어도 앞의 완성된 쌍은 건진다)
  const out: ConversationExample[] = [];
  const re = /\{\s*"question"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"answer"\s*:\s*"((?:[^"\\]|\\.)*)"\s*\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    try {
      out.push({ question: JSON.parse(`"${m[1]}"`), answer: JSON.parse(`"${m[2]}"`) });
    } catch {
      out.push({ question: m[1], answer: m[2] });
    }
  }
  return out;
}

// 긴 문서는 로컬 7B의 컨텍스트/안정성을 넘겨 변환이 실패하므로, 문단 경계 기준으로 청크를 나눠
// 각각 변환한 뒤 합친다. 청크 하나가 실패해도 나머지는 살린다.
const CONVERT_CHUNK_SIZE = 2500;

function chunkForConvert(text: string, size = CONVERT_CHUNK_SIZE): string[] {
  if (text.length <= size) return [text];
  const chunks: string[] = [];
  const paras = text.split(/\n\s*\n/);
  let buf = "";
  for (const p of paras) {
    if (buf && (buf + "\n\n" + p).length > size) {
      chunks.push(buf);
      buf = p;
    } else {
      buf = buf ? buf + "\n\n" + p : p;
    }
    // 한 문단이 통째로 size를 넘으면 강제로 자른다
    while (buf.length > size) {
      chunks.push(buf.slice(0, size));
      buf = buf.slice(size);
    }
  }
  if (buf.trim()) chunks.push(buf);
  return chunks;
}

async function convertChunk(chunk: string): Promise<ConversationExample[]> {
  const prompt = [
    "아래 보안 문서를 파인튜닝용 질문-답변(Q&A) 쌍으로 변환해줘.",
    '출력은 JSON 배열만: [{"question":"...","answer":"..."}, ...] 형식, 다른 텍스트 없이.',
    "문서 내용을 근거로 3~8개의 Q&A 쌍을 만들어줘.",
    "문서:",
    chunk,
  ].join("\n\n");
  // 긴 출력이 잘리지 않게 max_tokens를 넉넉히.
  return parseExamples(await chat({ agentId: "analysis", message: prompt, maxTokens: 2048 }));
}

export async function convertToConversationFormat(rawText: string): Promise<ConversationExample[]> {
  const chunks = chunkForConvert(rawText.trim());
  const all: ConversationExample[] = [];
  const seen = new Set<string>();
  for (const chunk of chunks) {
    if (!chunk.trim()) continue;
    for (const ex of await convertChunk(chunk)) {
      const key = ex.question.trim();
      if (key && !seen.has(key)) {
        seen.add(key);
        all.push(ex);
      }
    }
  }
  return all;
}

export async function amplifyDataset(examples: ConversationExample[], factor = 3): Promise<ConversationExample[]> {
  if (examples.length === 0) return [];
  const amplified: ConversationExample[] = [...examples];
  for (const example of examples) {
    const prompt = [
      `다음 질문-답변 쌍을 의미는 유지하면서 표현만 다르게 ${factor - 1}가지 버전으로 바꿔줘.`,
      "출력은 JSON 배열만: [{\"question\":\"...\",\"answer\":\"...\"}, ...] 형식, 다른 텍스트 없이.",
      `원본: ${JSON.stringify(example)}`,
    ].join("\n\n");
    const variants = parseExamples(await chat({ agentId: "analysis", message: prompt }));
    amplified.push(...variants);
  }
  return amplified;
}

// 파일명으로 그대로 쓰이므로 경로 조작이 불가능한 id만 허용한다.
const DATASET_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function saveDataset(id: string, examples: ConversationExample[]): { id: string; examples: number } {
  if (!DATASET_ID_RE.test(id)) {
    throw new Error("데이터셋 ID는 영문 소문자/숫자/하이픈만 가능합니다 (예: incident-qa-v1)");
  }
  const valid = examples.filter((e) => e && typeof e.question === "string" && typeof e.answer === "string" && e.question && e.answer);
  if (valid.length === 0) throw new Error("유효한 question/answer 쌍이 없습니다");
  fs.mkdirSync(DATASETS_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATASETS_DIR, `${id}.json`), JSON.stringify(valid, null, 2), "utf-8");
  return { id, examples: valid.length };
}

export function listDatasets(): { id: string; examples: number }[] {
  if (!fs.existsSync(DATASETS_DIR)) return [];
  return fs
    .readdirSync(DATASETS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const id = f.slice(0, -5);
      try {
        const rows = JSON.parse(fs.readFileSync(path.join(DATASETS_DIR, f), "utf-8")) as unknown[];
        return { id, examples: Array.isArray(rows) ? rows.length : 0 };
      } catch {
        return { id, examples: 0 };
      }
    });
}

export function registerDatasetRoutes(app: Express): void {
  app.post(
    "/api/dataset/convert",
    authMiddleware,
    asyncRoute(async (req, res) => {
      res.json(await convertToConversationFormat(req.body.rawText));
    })
  );
  app.post(
    "/api/dataset/amplify",
    authMiddleware,
    asyncRoute(async (req, res) => {
      res.json(await amplifyDataset(req.body.examples, req.body.factor));
    })
  );
  app.post("/api/dataset/save", authMiddleware, (req, res) => {
    try {
      res.json(saveDataset(String(req.body.id ?? ""), req.body.examples ?? []));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });
  app.get("/api/dataset/list", authMiddleware, (_req, res) => res.json(listDatasets()));

  // 문서 업로드 → 텍스트 추출 (PDF/HWPX/TXT 등). { filename, content(base64) } → { text }
  app.post(
    "/api/dataset/extract",
    authMiddleware,
    asyncRoute(async (req, res) => {
      const { filename, content } = req.body as { filename?: string; content?: string };
      if (!filename || !content) {
        res.status(400).json({ error: "filename과 content(base64)가 필요합니다" });
        return;
      }
      try {
        res.json({ text: await extractDocumentText(filename, content) });
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
      }
    })
  );
}
