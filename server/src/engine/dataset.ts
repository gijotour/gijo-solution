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
import { serverPython } from "../util/pythonbin";
// 학습 데이터가 디스크에 닿는 유일한 자리라, 위생을 여기서 건다(호출부마다 붙이면 또 빠뜨린다).
import { cleanForTraining, type 데이터종류 } from "./datasethygiene";

// 테스트가 실제 데이터셋(data/datasets/*.json)을 덮어쓰거나 지우지 않도록 경로를 env로 격리 가능하게 한다
// (vitest.config.ts가 임시 디렉터리로 지정). 미설정 시 운영 경로.
const DATASETS_DIR = process.env.GIJO_DATASETS_DIR ?? path.join("data", "datasets");

// 업로드된 문서(PDF/HWPX/TXT 등)에서 학습용 텍스트를 추출한다 — scripts/extract_doc.py(python) 사용.
// 파일을 임시 폴더에 쓴 뒤 확장자를 유지해 스크립트가 형식을 판별하게 한다. PYTHONUTF8=1(한국어).
export async function extractDocumentText(filename: string, base64: string): Promise<string> {
  const ext = path.extname(filename).toLowerCase() || ".txt";
  // ★ 텍스트 계열은 파이썬 추출기(scripts/extract_doc.py)를 **거치지 않는다** — 이미 텍스트라 추출이
  //   필요 없고, 그 스크립트가 없는 환경에서 **텍스트까지 전량 실패**했다(max 발견#5 ★치명 2026-08-17:
  //   라이트 빌드의 server-dist가 scripts/를 안 담아 .md 넣기가 서버400). base64를 UTF-8로 바로 푼다.
  //   바이너리(PDF·HWPX·docx…)만 추출기로 보낸다.
  const 텍스트계열 = new Set([".md", ".markdown", ".txt", ".text", ".csv", ".tsv", ".log", ".json", ".yaml", ".yml"]);
  if (텍스트계열.has(ext)) {
    const text = Buffer.from(base64, "base64").toString("utf8");
    recordProcessOutput("extract-doc", "log", `${filename} — 텍스트 직접 읽음(${text.length.toLocaleString()}자, 파이썬 추출 생략)`);
    return text;
  }
  const tmp = path.join(os.tmpdir(), `gijo-doc-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  await fs.promises.writeFile(tmp, Buffer.from(base64, "base64"));
  recordProcessOutput("extract-doc", "log", `$ extract_doc.py ${filename} (${ext})`);
  try {
    const text = await new Promise<string>((resolve, reject) => {
      execFile(
        // ⚠ 맨 "python"을 부르면 안 된다 — 운영(WSL)에는 그 이름이 없어(python3만 존재)
        //   추출이 **한 번도 성공한 적 없었다**(2026-08-08 실측). 그 여파로 경로 인입이
        //   PDF를 글자로 그냥 읽어 저장소 조각의 73%가 압축 바이트였다.
        serverPython(),
        ["scripts/extract_doc.py", tmp],
        { env: { ...process.env, PYTHONUTF8: "1" }, maxBuffer: 256 * 1024 * 1024 },
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
  return parseExamples(await chat({ agentId: "analysis", message: prompt, maxTokens: 2048, trusted: true }));
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
    const variants = parseExamples(await chat({ agentId: "analysis", message: prompt, trusted: true }));
    amplified.push(...variants);
  }
  return amplified;
}

// 파일명으로 그대로 쓰이므로 경로 조작이 불가능한 id만 허용한다.
const DATASET_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function saveDataset(id: string, examples: ConversationExample[], 종류: 데이터종류 = "지식"): { id: string; examples: number } {
  if (!DATASET_ID_RE.test(id)) {
    throw new Error("데이터셋 ID는 영문 소문자/숫자/하이픈만 가능합니다 (예: incident-qa-v1)");
  }
  const valid = examples.filter((e) => e && typeof e.question === "string" && typeof e.answer === "string" && e.question && e.answer);
  if (valid.length === 0) throw new Error("유효한 question/answer 쌍이 없습니다");

  // ★ 위생은 **여기서** 건다 — 학습 데이터가 디스크에 닿는 곳이 이 함수뿐이기 때문이다.
  //
  // ⚠ 2026-08-01 검토에서 잡힌 것: 위생 주석은 "어느 길로 들어오든 거치는 마지막 관문"이라
  //   적어 놨는데 실제 호출은 learnloop 한 곳뿐이었다. `POST /api/dataset/save`,
  //   orchestrator-dataset, 그리고 학습 시작에 datasetId를 직접 넘기는 길이 **그냥 지나갔다.**
  //   담당자가 화면에서 「Q&A 변환」→「저장」 하고 그 ID로 파인튜닝을 걸면 시점 데이터·
  //   시험 문항·프롬프트 누출이 한 번도 안 걸러지고 학습된다.
  //   호출부마다 붙이면 또 빠뜨린다 — **저장 자체를 관문으로 만든다.**
  //   cleanForTraining은 멱등이라 learnloop가 이미 건 것을 다시 걸어도 결과가 같다.
  const 위생 = cleanForTraining(valid, 종류);
  if (위생.kept.length === 0) {
    const 사유 = Object.entries(위생.dropped).map(([k, v]) => `${k} ${v}건`).join(" · ") || "없음";
    throw new Error(`위생 검사를 통과한 문답이 없습니다 (${valid.length}건 전부 걸러짐).\n걸러진 것: ${사유}`);
  }
  fs.mkdirSync(DATASETS_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATASETS_DIR, `${id}.json`), JSON.stringify(위생.kept, null, 2), "utf-8");
  return { id, examples: 위생.kept.length };
}

// 팀장이 "오늘 확인할 항목"에 직접 추가한 일과를 학습 데이터셋으로 축적한다(파인튜닝 반영 경로).
// routine-feedback.json에 Q&A로 쌓여 학습 루프에서 그대로 학습할 수 있고,
// 추천 가이드(tasks.routineSuggestions) 프롬프트에도 인용돼 다음 추천에 반영된다.
export function appendRoutineExample(text: string): void {
  fs.mkdirSync(DATASETS_DIR, { recursive: true });
  const file = path.join(DATASETS_DIR, "routine-feedback.json");
  let rows: ConversationExample[] = [];
  try {
    rows = JSON.parse(fs.readFileSync(file, "utf-8")) as ConversationExample[];
    if (!Array.isArray(rows)) rows = [];
  } catch {
    rows = [];
  }
  rows.push({ question: "보안 운영에서 오늘/이번 주 확인할 점검 항목을 추천해줘", answer: text });
  fs.writeFileSync(file, JSON.stringify(rows, null, 2), "utf-8");
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
