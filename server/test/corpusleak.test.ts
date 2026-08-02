// RAG 코퍼스에 **개발 문서가 섞이지 않는가.**
//
// 왜 필요한가(2026-08-02 하루 실전 시뮬레이션에서 발견):
//   docs-manifest.json 머리말은 스스로 경고한다 — "개발 맥락(소스 경로·빌드 명령·내부 계획·
//   미구현 기능)이 담긴 문서는 최종 사용자 답변에 그대로 인용돼 새어 나간다(실측:
//   server/src/engine/assets.ts 경로가 사용자에게 노출됐다)".
//   **그런데 바로 그 문서가 목록에 있었다.** 경고를 적어 두는 것과 지키는 것은 다르다.
//
//   같은 날 또 하나: 용어사전에 개발 이력("609건 중 608건이 스캔 오류였다")을 적었더니
//   담당자 질문의 답으로 그 문장이 그대로 나왔다. **내가 넣은 것이 그대로 고객에게 갔다.**
//
// ★ 여기서 지키는 것: 코퍼스 문서에 **소스 경로·빌드 명령·개발 이력**이 없을 것.
//   문서 자체를 못 넣게 막는 게 아니라, 넣으려면 그 문장을 사용자 말로 고치게 만든다.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const 뿌리 = path.join(__dirname, "../..");
const manifest = JSON.parse(fs.readFileSync(path.join(뿌리, "server/docs-manifest.json"), "utf8"));

function 코퍼스문서(): { file: string; 본문: string }[] {
  const 목록: string[] = [];
  (function 훑기(o: unknown): void {
    if (Array.isArray(o)) { o.forEach(훑기); return; }
    if (o && typeof o === "object") {
      const f = (o as { file?: unknown }).file;
      if (typeof f === "string" && f.endsWith(".md")) 목록.push(f);
      Object.values(o as Record<string, unknown>).forEach(훑기);
    }
  })({ ...manifest, _제외: undefined });   // ⚠ _제외(뺀 문서)는 보지 않는다
  const out: { file: string; 본문: string }[] = [];
  for (const f of 목록) {
    for (const d of [뿌리, path.join(뿌리, "docs")]) {
      const p = path.join(d, f);
      if (fs.existsSync(p)) { out.push({ file: f, 본문: fs.readFileSync(p, "utf8") }); break; }
    }
  }
  return out;
}

/** 고객 답변에 나가면 안 되는 것들. 이유를 함께 둔다 — 무엇이 왜 문제인지 알아야 고친다. */
const 새는말: { 이름: string; re: RegExp; 왜: string }[] = [
  { 이름: "소스 경로", re: /\b(server|client|tools)\/src\/[\w./-]+|\b[\w-]+\.(ts|tsx|mjs)\b/, 왜: "담당자에게 코드 경로는 아무 뜻이 없고, 우리 내부 구조를 알려 준다" },
  { 이름: "빌드·실행 명령", re: /\bnpm (run |ci|install)|\bnpx \b|\btsc\b|\bvitest\b/, 왜: "제품을 쓰는 사람은 빌드하지 않는다" },
  { 이름: "개발 이력·실측 기록", re: /실측\s*\(?\s*20\d\d-\d\d-\d\d|실사고|회귀 하네스|커밋 [0-9a-f]{7}/, 왜: "우리 개발 뒷이야기가 고객 답변에 인용된다(실제로 나갔다)" },
  { 이름: "미구현·계획 표현", re: /미구현|아직 없습니다만|구현 예정|TODO|남은 건 .{0,20}조립/, 왜: "없는 기능을 있는 것처럼, 또는 제품이 미완성인 것처럼 읽힌다" },
];

describe("RAG 코퍼스 — 개발 문서가 섞이지 않는다", () => {
  it("코퍼스 문서에 소스 경로·빌드 명령·개발 이력이 없다", () => {
    const 걸린것: string[] = [];
    for (const { file, 본문 } of 코퍼스문서()) {
      for (const { 이름, re, 왜 } of 새는말) {
        const 줄 = 본문.split("\n").map((l, i) => [i + 1, l] as const).filter(([, l]) => re.test(l));
        if (줄.length) {
          걸린것.push(`${file} — ${이름} ${줄.length}줄 (${왜})\n      ${줄[0][0]}: ${줄[0][1].trim().slice(0, 90)}`);
        }
      }
    }
    expect(
      걸린것,
      "코퍼스 문서는 **고객 답변의 근거**가 된다 — 여기 적힌 문장은 그대로 인용돼 나간다.\n" +
      "  개발 맥락이면 문서를 코퍼스에서 빼거나, 그 문장을 사용자 말로 고칠 것:\n\n  " +
      걸린것.join("\n  ")
    ).toEqual([]);
  });

  it("이 감시가 헛돌고 있지 않다", () => {
    // ⚠ 매니페스트 파싱이 빈손이면 위 시험은 통과하면서 아무것도 안 본다.
    const 문서 = 코퍼스문서();
    expect(문서.length, "코퍼스 문서를 하나도 못 읽었다 — 빈 검사다").toBeGreaterThanOrEqual(8);
    expect(문서.every((d) => d.본문.length > 100), "본문이 비어 있는 문서가 있다").toBe(true);
  });

  it("코퍼스에서 뺀 문서는 이유가 남아 있다", () => {
    // ⚠ 이유를 안 남기면 다음 사람이 "빠졌네" 하고 도로 넣는다.
    for (const x of (manifest._제외 ?? []) as { file?: string; why?: string }[]) {
      expect(x.file, "제외 목록에 파일명이 없다").toBeTruthy();
      expect((x.why ?? "").length, `${x.file} 제외 사유가 너무 짧다`).toBeGreaterThan(30);
    }
  });
});
