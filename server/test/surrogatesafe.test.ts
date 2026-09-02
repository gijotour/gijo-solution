// surrogatesafe.test.ts — 이모지를 반으로 자른 조각이 임베딩 요청을 500으로 죽이던 실사고(2026-09-03).
//
// JS 문자열은 UTF-16이라 🛡 같은 이모지는 두 단위다. chunkText의 꼬리 겹침 `slice(-overlap)`이 그 한가운데를
// 자르면 짝 잃은 서로게이트가 남고, JSON.stringify → llama.cpp 파서가 「invalid string: surrogate」로 요청
// 전체를 거절한다. 보안제품관리_지침.md(이모지 26개)가 매 부팅 인입 실패 → 지식에서 조용히 빠져 있었다.
// 계약: ① chunkText 산출 조각에 짝 잃은 서로게이트가 없다 ② embed()가 보내기 전에 한 번 더 지운다(소스 감시).
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { chunkText, stripLoneSurrogates } from "../src/engine/memory";

const LONE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

describe("서로게이트 안전 — 이모지가 든 문서는 조각 경계에서 깨지지 않는다", () => {
  it("겹침 꼬리(overlap)가 이모지 한가운데를 잘라도 짝 잃은 단위가 남지 않는다", () => {
    // 문단을 size 근처로 맞추고 이모지를 촘촘히 박아 overlap 경계가 이모지 위에 떨어질 확률을 높인다.
    const 문단 = () => Array.from({ length: 60 }, (_, i) => `${["🛡", "📚", "🔒", "🧠", "🔧"][i % 5]} 항목 ${i} 점검 절차를 기록한다.`).join(" ");
    const text = [문단(), 문단(), 문단(), 문단()].join("\n\n");
    const chunks = chunkText(text, 800, 100);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(LONE.test(c), `짝 잃은 서로게이트: ${c.slice(0, 40)}`).toBe(false);
    // 짝이 맞는 이모지는 살아 있어야 한다(지우는 건 반쪽뿐)
    expect(chunks.join("").includes("🛡")).toBe(true);
  });

  it("실제 문서(보안제품관리 지침, 이모지 26개)를 조각내면 전부 JSON으로 보낼 수 있다", () => {
    const doc = readFileSync(join(__dirname, "..", "..", "GIJO_AS_보안제품관리_지침.md"), "utf8");
    const chunks = chunkText(doc);
    expect(chunks.length).toBeGreaterThan(0);
    for (const c of chunks) {
      expect(LONE.test(c)).toBe(false);
      // llama.cpp가 거절하던 형태 — 잘 인코딩되면 \ud로 시작하는 홑 이스케이프가 없다
      expect(JSON.stringify(c)).not.toMatch(/\\ud[c-f][0-9a-f]{2}(?!\\ud[89ab])/i);
    }
  });

  it("stripLoneSurrogates는 반쪽만 지우고 짝은 남긴다", () => {
    expect(stripLoneSurrogates("가\uD83D나")).toBe("가나");
    expect(stripLoneSurrogates("가\uDE00나")).toBe("가나");
    expect(stripLoneSurrogates("가😀나")).toBe("가😀나");
  });

  it("embed()는 보내기 전에 입구에서 한 번 더 지운다(어느 호출자가 와도 마지막 문)", () => {
    const src = readFileSync(join(__dirname, "..", "src", "engine", "embedding.ts"), "utf8");
    const fn = src.slice(src.indexOf("export async function embed("), src.indexOf("export async function embed(") + 1500);
    expect(fn).toMatch(/\\uD800-\\uDBFF\]\(\?!\[\\uDC00-\\uDFFF\]\)/);
    expect(fn).toContain("input: 정리");
  });
});
