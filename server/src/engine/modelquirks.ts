// engine/modelquirks.ts — 고객이 올린(BYOM) 모델을 이 환경·이 제품에 맞춰주는 자동 적응. (2026-08-05)
//
// ■ 왜 필요한가 (실측이 먼저 있었다)
//   Qwen3-14B를 기본 설정으로 띄워 우리 프롬프트를 던지자 **답이 빈칸으로 나왔다**(2026-08-05
//   실측 — thinking(추론) 모델이라 생각 블록이 토큰 예산을 다 쓰고 답을 못 냈다).
//   BYOM 구조에서 고객은 어떤 모델이든 올린다 — 올린 모델이 조용히 깨지면 제품 탓이 된다.
//   "좋은 모델을 올렸는데 왜 이상하지?"를 없애는 것이 이 모듈의 몫이다.
//
// ■ 판별은 파일명이 아니라 **GGUF 메타데이터**가 우선이다
//   고객이 올리는 파일 이름은 아무거나다("우리회사모델.gguf"). GGUF 머리에는 설계(architecture)·
//   기본 컨텍스트·대화 템플릿이 박혀 있고, thinking 여부는 템플릿 안 문구(enable_thinking·<think>)로
//   드러난다. 이름 규칙은 메타를 못 읽을 때의 예비다.
//
// ■ 끄는 방법은 서버 기동 플래그다 (조사 2026-08-05, llama.cpp 2026-07-18 빌드 실측 확인)
//   `--reasoning off` + `--reasoning-budget 0`. 프롬프트 토큰(/no_think)은 Qwen3 한정이고
//   Qwen3.5부터 무시된다(조사 확인) — 미래에 조용히 깨질 길이라 쓰지 않는다.
//   비-thinking 모델에는 아무 플래그도 더하지 않는다(현행 함대 무영향 — 게이트 안정).
import fs from "fs";
import path from "path";
import { db } from "../db";

// ── GGUF 메타데이터 최소 파서 ────────────────────────────────────────────────
//
// GGUF v2/v3: magic "GGUF" · version u32 · tensor_count u64 · kv_count u64 · kv[]
// kv = key(u64 길이+utf8) · type(u32) · value. 타입: 0:u8 1:i8 2:u16 3:i16 4:u32 5:i32
// 6:f32 7:bool 8:string(u64+bytes) 9:array(type u32+count u64+원소들) 10:u64 11:i64 12:f64
//
// ⚠ 전체 파일을 안 읽는다 — 머리 32MB만. 어휘(tokens) 배열이 수 MB라 그 뒤의
//   chat_template까지 닿으려면 이 정도가 필요하다(Qwen3 실측 메타 ~5MB).
const META_READ_BYTES = 32 * 1024 * 1024;

export interface GgufMeta {
  arch?: string;        // general.architecture (예: "qwen3", "llama", "exaone")
  name?: string;        // general.name
  contextLength?: number; // <arch>.context_length — 모델이 태어난 최대 컨텍스트
  chatTemplate?: string;  // tokenizer.chat_template (jinja)
}

/** GGUF 머리에서 필요한 키만 뽑는다. 형식이 어긋나면 null(이름 판별로 폴백). */
export function readGgufMeta(filePath: string): GgufMeta | null {
  let fd: number | null = null;
  try {
    fd = fs.openSync(filePath, "r");
    const size = fs.fstatSync(fd).size;
    const buf = Buffer.alloc(Math.min(META_READ_BYTES, size));
    fs.readSync(fd, buf, 0, buf.length, 0);
    if (buf.length < 24 || buf.toString("ascii", 0, 4) !== "GGUF") return null;
    const version = buf.readUInt32LE(4);
    if (version < 2 || version > 3) return null; // v1은 길이가 u32라 다른 파서가 필요 — 폴백

    let off = 8;
    off += 8; // tensor_count(u64) — 안 쓴다
    const kvCount = Number(buf.readBigUInt64LE(off)); off += 8;

    const meta: GgufMeta = {};
    const readStr = (): string | null => {
      if (off + 8 > buf.length) return null;
      const len = Number(buf.readBigUInt64LE(off)); off += 8;
      if (off + len > buf.length) return null;
      const s = buf.toString("utf8", off, off + len); off += len;
      return s;
    };
    // 값 하나를 건너뛴다(원하는 키만 담고). 버퍼를 넘어가면 false — 거기서 파싱 중단.
    const skipValue = (type: number): boolean => {
      const fixed: Record<number, number> = { 0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1, 10: 8, 11: 8, 12: 8 };
      if (type in fixed) { off += fixed[type]; return off <= buf.length; }
      if (type === 8) { return readStr() !== null; }
      if (type === 9) {
        if (off + 12 > buf.length) return false;
        const elemType = buf.readUInt32LE(off); off += 4;
        const count = Number(buf.readBigUInt64LE(off)); off += 8;
        if (elemType in fixed) { off += fixed[elemType] * count; return off <= buf.length; }
        if (elemType === 8) {
          for (let i = 0; i < count; i++) if (readStr() === null) return false;
          return true;
        }
        return false; // 중첩 배열 등 예상 밖 — 중단
      }
      return false;
    };

    for (let i = 0; i < kvCount; i++) {
      const key = readStr();
      if (key === null || off + 4 > buf.length) break;
      const type = buf.readUInt32LE(off); off += 4;

      if (key === "general.architecture" && type === 8) { meta.arch = readStr() ?? undefined; continue; }
      if (key === "general.name" && type === 8) { meta.name = readStr() ?? undefined; continue; }
      if (key.endsWith(".context_length") && (type === 4 || type === 10)) {
        meta.contextLength = type === 4 ? buf.readUInt32LE(off) : Number(buf.readBigUInt64LE(off));
        off += type === 4 ? 4 : 8;
        continue;
      }
      if (key === "tokenizer.chat_template" && type === 8) { meta.chatTemplate = readStr() ?? undefined; continue; }

      if (!skipValue(type)) break; // 버퍼 밖으로 나가면 여기까지 얻은 것만 쓴다
    }
    return meta;
  } catch {
    return null;
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch { /* 무시 */ } }
  }
}

// ── thinking(추론) 모델 판별 ────────────────────────────────────────────────

// 이름 예비 판별 — 메타를 못 읽었을 때만. 알려진 thinking 계열만 보수적으로.
// ⚠ qwen2.5는 안 걸린다(/qwen3/). 우리 커스텀(gijo-*, merged-lily)도 안 걸린다.
const THINKING_NAME_RE = /qwen[-_.]?3|qwq|deepseek[-_.]?r1|r1[-_.]?distill|exaone[-_.]?deep|magistral|gpt[-_.]?oss/i;

// 템플릿 판별 — GGUF의 대화 템플릿에 thinking 배선이 있으면 그 모델은 thinking이다.
const THINKING_TEMPLATE_RE = /enable_thinking|<think>|reasoning_content|◁think▷/;

const getStateStmt = db.prepare("SELECT value FROM app_state WHERE key = ?");
const setStateStmt = db.prepare(
  "INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
);

/** admin 수동 지정(자동 판별이 틀릴 때의 마지막 문) — null이면 지정 없음. */
export function thinkingOverride(modelId: string): boolean | null {
  try {
    const row = getStateStmt.get(`modelQuirks:${modelId}`) as { value: string } | undefined;
    if (!row) return null;
    const v = JSON.parse(row.value) as { thinking?: boolean };
    return typeof v.thinking === "boolean" ? v.thinking : null;
  } catch { return null; }
}
export function setThinkingOverride(modelId: string, thinking: boolean | null): void {
  if (thinking === null) db.prepare("DELETE FROM app_state WHERE key = ?").run(`modelQuirks:${modelId}`);
  else setStateStmt.run(`modelQuirks:${modelId}`, JSON.stringify({ thinking }));
  // ⚠ **캐시를 반드시 버린다**(2026-08-05 검토관이 잡은 결함). 안 버리면 adaptModel이
  //   파일 mtime·ctx만 보고 캐시본을 그대로 돌려줘, 사람이 고쳐도 다음 로드에 안 먹었다 —
  //   "다음에 모델을 로드할 때부터 적용됩니다"라고 답해 놓고 **노드 재시작 전엔 영영 안 먹는**
  //   상태였다. 자동 판별의 마지막 문이 잠겨 있으면 문이 없는 것과 같다.
  적응캐시.delete(modelId);
}

// ── 적응 결과 ────────────────────────────────────────────────────────────────

export interface ModelAdaptation {
  modelId: string;
  arch?: string;
  nativeCtx?: number;   // 모델이 태어난 최대 컨텍스트(GGUF 실측)
  fittedCtx: number;    // 실제로 띄운 컨텍스트 = min(티어, native)
  thinking: boolean;
  판별: "override" | "template" | "name" | "none"; // 무엇으로 알았나 — 리포트에 그대로 보인다
  extraArgs: string[];  // llama-server에 덧붙인 플래그(적응의 실체)
}

// 모델별 적응 캐시 — 파일이 바뀌면(mtime) 다시 읽는다. 상태 API가 이걸 보여준다.
const 적응캐시 = new Map<string, { mtimeMs: number; adaptation: ModelAdaptation }>();

/**
 * 모델 하나를 이 환경에 맞춘다 — 기동 직전에 부른다.
 * 반환의 extraArgs를 spawn 인자에 덧붙이고 fittedCtx를 --ctx-size로 쓴다.
 * 비-thinking 모델은 extraArgs가 빈 배열이다.
 * ⚠ 다만 **ctx는 thinking 여부와 무관하게** min(티어, native)로 산출된다 — "완전히 같다"는
 *   말은 부정확했다(2026-08-05 검토 지적). 실측으로 확인한 현재 영향은 0이다:
 *   현행 함대 native ctx = orchestrator/ko/merged-lily/qwen2.5-14b/exaone **전부 32768**(=티어값),
 *   qwen3-14b 40960·r1 131072은 티어로 내려가는 게 의도한 동작. 임베딩(bge-m3 8192)은
 *   적응 경로를 타지 않는다(채팅 풀 전용). **native가 티어보다 작은 모델을 새로 들이면
 *   그 모델의 ctx가 조용히 줄어든다** — 그때는 적응 카드·상태 도구가 그 사실을 보여준다.
 */
export function adaptModel(modelId: string, filePath: string, tierCtx: number): ModelAdaptation {
  let mtimeMs = 0;
  try { mtimeMs = fs.statSync(filePath).mtimeMs; } catch { /* 파일 없음 — 아래에서 메타 null */ }
  const cached = 적응캐시.get(modelId);
  if (cached && cached.mtimeMs === mtimeMs && cached.adaptation.fittedCtx === Math.min(tierCtx, cached.adaptation.nativeCtx ?? tierCtx)) {
    return cached.adaptation;
  }

  const meta = readGgufMeta(filePath);
  const override = thinkingOverride(modelId);

  // ⚠ 우선순위: 사람 지정 > 템플릿-긍정 > 이름-긍정 > 부정. (2026-08-05 e2e가 잡은 버그로 정정)
  //   처음엔 "템플릿을 읽었으면 템플릿이 최종"으로 짰는데, 실제 R1-Distill GGUF는 템플릿에
  //   thinking 배선이 **없고 모델이 스스로 <think>를 뱉는다** — 템플릿-부정이 이름 신호를
  //   거부권으로 누르면 그런 모델이 빈칸으로 깨진다. 끄는 플래그는 비-thinking 모델에
  //   아무 일도 안 하므로(no-op), 이름-긍정을 믿는 쪽이 안전하다.
  let thinking: boolean;
  let 판별: ModelAdaptation["판별"];
  if (override !== null) { thinking = override; 판별 = "override"; }
  else if (meta?.chatTemplate && THINKING_TEMPLATE_RE.test(meta.chatTemplate)) { thinking = true; 판별 = "template"; }
  else if (THINKING_NAME_RE.test(modelId) || (meta?.name && THINKING_NAME_RE.test(meta.name))) { thinking = true; 판별 = "name"; }
  else { thinking = false; 판별 = meta ? "template" : "none"; } // 템플릿에도 이름에도 신호 없음 = 근거 있는 false

  // 컨텍스트 맞춤 — 모델 native보다 크게 띄우면 로드 실패·품질 저하(rope 왜곡)라 줄인다.
  // 4096 밑으로는 안 내린다(RAG 프롬프트가 안 들어간다).
  const nativeCtx = meta?.contextLength;
  const fittedCtx = Math.max(4096, Math.min(tierCtx, nativeCtx ?? tierCtx));

  // thinking이면 생각을 끈다 — 우리 제품은 짧고 결정적인 답이 생명이다(복창·장황 실사고 다수).
  // `--reasoning off`(템플릿 배선 차단) + `--reasoning-budget 0`(그래도 새면 즉시 종료) 겹벨트.
  const extraArgs = thinking ? ["--reasoning", "off", "--reasoning-budget", "0"] : [];

  const adaptation: ModelAdaptation = { modelId, arch: meta?.arch, nativeCtx, fittedCtx, thinking, 판별, extraArgs };
  적응캐시.set(modelId, { mtimeMs, adaptation });
  return adaptation;
}

/** 로드된 모델의 적응 내용 — 상태 API·리포트 카드가 보여준다. 아직 적응 전이면 null. */
export function getAdaptation(modelId: string): ModelAdaptation | null {
  return 적응캐시.get(modelId)?.adaptation ?? null;
}

// ── 응답 안전망 — 생각 블록 제거 ────────────────────────────────────────────
//
// 기동 플래그가 정상이면 생각 블록은 아예 안 나온다. 이 함수는 **안전망**이다:
// 플래그 없이 이미 떠 있는 모델(재시작 전), 감지 못한 thinking 모델이 새면 여기서 걷어낸다.
// ⚠ 스키마(JSON) 경로도 지나야 한다 — 생각 블록이 앞에 붙으면 JSON.parse가 통째로 깨진다.
export function stripThink(text: string): string {
  if (!text || text.indexOf("<think") === -1) return text; // 빠른 길 — 대부분 여기서 끝
  let out = text.replace(/<think>[\s\S]*?<\/think>/g, "");
  // 닫히지 않은 <think>(예산 중단 등) — 태그만 뗀다. 내용을 통째로 지우면 답이 아예 사라진다:
  // 감춰진 빈 답보다 생각이 섞인 답이 낫다(정직 원칙 — 없는 것을 있는 척하지 않는다).
  out = out.replace(/<\/?think>/g, "");
  return out.replace(/^\s+/, "");
}
