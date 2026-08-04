// BYOM 모델 자동 적응(modelquirks) — GGUF 메타 파서·thinking 판별·ctx 맞춤·생각 안전망.
//
// 왜 필요한가(실측 2026-08-05): Qwen3-14B를 기본 설정으로 띄우자 생각(thinking)이 토큰 예산을
// 다 써 **답이 빈칸**이 됐다. BYOM은 고객이 아무 모델이나 올리는 구조라, 올린 모델이 조용히
// 깨지면 제품 탓이 된다 — 판별은 파일명이 아니라 GGUF 메타(템플릿)가 우선이어야 한다
// (고객 파일명은 "우리회사모델.gguf"일 수 있다).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  readGgufMeta, adaptModel, getAdaptation, stripThink,
  thinkingOverride, setThinkingOverride,
} from "../src/engine/modelquirks";

// ── 합성 GGUF 빌더 — 실파일 없이 파서를 결정적으로 검증한다 ──────────────────
function str(s: string): Buffer {
  const b = Buffer.from(s, "utf8");
  const len = Buffer.alloc(8); len.writeBigUInt64LE(BigInt(b.length));
  return Buffer.concat([len, b]);
}
function kvString(key: string, value: string): Buffer {
  const t = Buffer.alloc(4); t.writeUInt32LE(8);
  return Buffer.concat([str(key), t, str(value)]);
}
function kvU32(key: string, value: number): Buffer {
  const t = Buffer.alloc(4); t.writeUInt32LE(4);
  const v = Buffer.alloc(4); v.writeUInt32LE(value);
  return Buffer.concat([str(key), t, v]);
}
function kvF32(key: string, value: number): Buffer {
  const t = Buffer.alloc(4); t.writeUInt32LE(6);
  const v = Buffer.alloc(4); v.writeFloatLE(value);
  return Buffer.concat([str(key), t, v]);
}
function kvStrArray(key: string, values: string[]): Buffer {
  const t = Buffer.alloc(4); t.writeUInt32LE(9);
  const et = Buffer.alloc(4); et.writeUInt32LE(8);
  const cnt = Buffer.alloc(8); cnt.writeBigUInt64LE(BigInt(values.length));
  return Buffer.concat([str(key), t, et, cnt, ...values.map((v) => str(v))]);
}
function buildGguf(kvs: Buffer[]): Buffer {
  const head = Buffer.alloc(24);
  head.write("GGUF", 0, "ascii");
  head.writeUInt32LE(3, 4);                 // version 3
  head.writeBigUInt64LE(0n, 8);             // tensor_count
  head.writeBigUInt64LE(BigInt(kvs.length), 16); // kv_count
  return Buffer.concat([head, ...kvs]);
}
function writeTemp(buf: Buffer): string {
  const p = path.join(os.tmpdir(), `quirks-${Date.now()}-${Math.random().toString(36).slice(2)}.gguf`);
  fs.writeFileSync(p, buf);
  return p;
}

const 지운다: string[] = [];
afterEach(() => { for (const p of 지운다.splice(0)) { try { fs.rmSync(p); } catch { /* */ } } });

describe("GGUF 메타 파서", () => {
  it("arch·context_length·chat_template을 읽는다 (사이에 배열·실수 kv가 끼어도)", () => {
    const p = writeTemp(buildGguf([
      kvString("general.architecture", "qwen3"),
      kvString("general.name", "Qwen3 14B"),
      kvStrArray("tokenizer.ggml.tokens", ["안", "녕", "하", "세", "요"]), // 어휘 배열 — 건너뛰어야 함
      kvF32("qwen3.rope.freq_base", 1000000),
      kvU32("qwen3.context_length", 40960),
      kvString("tokenizer.chat_template", "{% if enable_thinking %}<think>{% endif %}"),
    ]));
    지운다.push(p);
    const m = readGgufMeta(p)!;
    expect(m.arch).toBe("qwen3");
    expect(m.contextLength).toBe(40960);
    expect(m.chatTemplate).toContain("enable_thinking");
  });

  it("GGUF가 아니면 null (이름 판별로 폴백할 신호)", () => {
    const p = writeTemp(Buffer.from("이건 모델이 아님"));
    지운다.push(p);
    expect(readGgufMeta(p)).toBeNull();
    expect(readGgufMeta(p + ".없는파일")).toBeNull();
  });

  it("메타가 잘려도(버퍼 밖) 그때까지 얻은 것은 살린다", () => {
    const full = buildGguf([
      kvU32("llama.context_length", 8192),
      kvString("tokenizer.chat_template", "긴 템플릿".repeat(100)),
    ]);
    const p = writeTemp(full.subarray(0, full.length - 50)); // 템플릿 중간에서 자름
    지운다.push(p);
    const m = readGgufMeta(p)!;
    expect(m.contextLength).toBe(8192); // 앞의 것은 살아 있다
    expect(m.chatTemplate).toBeUndefined();
  });
});

describe("thinking 판별 · 적응(adaptModel)", () => {
  beforeEach(() => setThinkingOverride("시험-모델", null));

  it("템플릿에 thinking 배선이 있으면 파일명이 아무래도 끈다 — BYOM 핵심", () => {
    // 고객이 이름을 아무렇게 지은 파일("우리회사모델") — 템플릿으로 잡아야 한다
    const p = writeTemp(buildGguf([
      kvString("general.architecture", "qwen3"),
      kvU32("qwen3.context_length", 40960),
      kvString("tokenizer.chat_template", "{%- if enable_thinking %}..."),
    ]));
    지운다.push(p);
    const a = adaptModel("우리회사모델", p, 32768);
    expect(a.thinking).toBe(true);
    expect(a.판별).toBe("template");
    expect(a.extraArgs).toEqual(["--reasoning", "off", "--reasoning-budget", "0"]);
  });

  it("템플릿에 배선이 없으면 이름이 그럴듯해도 안 끈다 (템플릿 > 이름)", () => {
    const p = writeTemp(buildGguf([
      kvString("general.architecture", "llama"),
      kvU32("llama.context_length", 32768),
      kvString("tokenizer.chat_template", "{{ messages }}"), // thinking 배선 없음
    ]));
    지운다.push(p);
    const a = adaptModel("qwen3-이름만-흉내", p, 32768);
    expect(a.thinking).toBe(false);
    expect(a.extraArgs).toEqual([]); // 비-thinking = 플래그 0개 — 현행 함대 무영향 계약
  });

  it("메타를 못 읽으면 이름으로 폴백 — qwen3·qwq·r1은 걸리고 qwen2.5·gijo는 안 걸린다", () => {
    const p = writeTemp(Buffer.from("메타 없음"));
    지운다.push(p);
    expect(adaptModel("qwen3-14b", p, 32768).thinking).toBe(true);
    expect(adaptModel("qwen3-14b", p, 32768).판별).toBe("name");
    expect(adaptModel("QwQ-32B", p, 32768).thinking).toBe(true);
    expect(adaptModel("deepseek-r1-distill-8b", p, 32768).thinking).toBe(true);
    expect(adaptModel("qwen2.5-14b-instruct", p, 32768).thinking).toBe(false);
    expect(adaptModel("gijo-main-orchestrator", p, 32768).thinking).toBe(false);
    expect(adaptModel("merged-lily-gijo-loop-ai-securityllm", p, 32768).thinking).toBe(false);
  });

  it("admin 수동 지정이 자동 판별을 이긴다 (마지막 문)", () => {
    const p = writeTemp(buildGguf([
      kvString("tokenizer.chat_template", "{%- if enable_thinking %}..."),
    ]));
    지운다.push(p);
    setThinkingOverride("시험-모델", false); // 자동은 true라 할 것을 사람이 끔
    const a = adaptModel("시험-모델", p, 32768);
    expect(a.thinking).toBe(false);
    expect(a.판별).toBe("override");
    expect(thinkingOverride("시험-모델")).toBe(false);
    setThinkingOverride("시험-모델", null);
    expect(thinkingOverride("시험-모델")).toBeNull();
  });

  it("컨텍스트는 native보다 크게 안 띄운다 · 티어보다는 안 키운다 · 4096 밑으로 안 내린다", () => {
    const 작은모델 = writeTemp(buildGguf([kvU32("llama.context_length", 8192), kvString("tokenizer.chat_template", "x")]));
    지운다.push(작은모델);
    expect(adaptModel("작은ctx", 작은모델, 32768).fittedCtx).toBe(8192);  // native로 줄임
    const 큰모델 = writeTemp(buildGguf([kvU32("llama.context_length", 131072), kvString("tokenizer.chat_template", "x")]));
    지운다.push(큰모델);
    expect(adaptModel("큰ctx", 큰모델, 32768).fittedCtx).toBe(32768);     // 티어 유지
    const 초소형 = writeTemp(buildGguf([kvU32("llama.context_length", 2048), kvString("tokenizer.chat_template", "x")]));
    지운다.push(초소형);
    expect(adaptModel("초소형ctx", 초소형, 32768).fittedCtx).toBe(4096);  // 바닥 4096
  });

  it("적응 내용이 상태 조회로 남는다(getAdaptation) — 리포트 카드의 근거", () => {
    const p = writeTemp(buildGguf([
      kvString("general.architecture", "qwen3"),
      kvU32("qwen3.context_length", 40960),
      kvString("tokenizer.chat_template", "enable_thinking"),
    ]));
    지운다.push(p);
    adaptModel("적응기록", p, 32768);
    const got = getAdaptation("적응기록")!;
    expect(got.arch).toBe("qwen3");
    expect(got.thinking).toBe(true);
    expect(got.fittedCtx).toBe(32768);
  });
});

describe("생각 블록 안전망(stripThink)", () => {
  it("닫힌 블록을 걷어내고 답만 남긴다 — JSON 경로도 살린다", () => {
    expect(stripThink("<think>고민고민</think>답은 42")).toBe("답은 42");
    expect(stripThink('<think>...</think>{"tool":"today"}')).toBe('{"tool":"today"}');
    expect(stripThink("<think>a</think>중간<think>b</think>끝")).toBe("중간끝");
  });
  it("닫히지 않은 태그는 태그만 뗀다 — 내용을 통째로 지우면 답이 사라진다(정직)", () => {
    expect(stripThink("<think>중단된 생각과 답")).toBe("중단된 생각과 답");
  });
  it("생각 없는 답은 그대로 (빠른 길)", () => {
    const s = "평범한 답입니다.";
    expect(stripThink(s)).toBe(s);
  });
});

describe("소스 감시 — 만든 함수를 실제로 부른다 (헛돎 방지)", () => {
  const eng = (f: string) => fs.readFileSync(path.join(__dirname, "../src/engine", f), "utf8");
  it("localengine 스폰이 adaptModel의 ctx·extraArgs를 쓴다", () => {
    const src = eng("localengine.ts");
    expect(src).toContain("adaptModel(modelId");
    expect(src).toContain("adaptation.fittedCtx");
    expect(src).toContain("...adaptation.extraArgs");
  });
  it("llm.ts 응답이 stripThink를 지난다 — rawContent 정의 자체가 지나야 스키마·채팅 두 경로가 다 걸린다", () => {
    const src = eng("llm.ts");
    // rawContent가 stripThink로 정의되면 스키마(JSON) 조기 반환도 걷어낸 값을 쓴다 —
    // 위치 비교는 함정이다(args.responseSchema의 첫 등장은 요청 만드는 쪽이라 항상 앞이다).
    expect(src, "rawContent가 stripThink를 안 지난다").toContain("const rawContent = stripThink(");
  });
  it("이 감시가 헛돌지 않는다", () => {
    expect(eng("modelquirks.ts").length).toBeGreaterThan(3000);
  });
});
