// QA 전수조사 계층의 **짝 시험** — 「고를 수 있는 계층」과 「실제로 도는 계층」이 같은가.
//                                                        (계획서: 중-7 운영 게이트)
//
// ■ 무슨 일이 있었나 (2026-09-06 적발)
//   tools/qa-full.mjs에 run("docs", …)가 멀쩡히 적혀 있는데, picks에 "docs"가 들어갈 길이
//   **어디에도 없었다** — 매핑 규칙에도, --all 배열에도, 첫 실행 배열에도. run()은 첫 줄이
//   `if (!picks.has(name)) return;`이라, 이런 계층은 **오류 하나 없이 그냥 안 돈다.**
//   그래서 2026-08-08 신설 이래 docs 계층은 한 번도 돌지 않았고, 2026-09-05에 그 계층을 위해
//   붙인 「판정 못 함(exit 2) 회색」 처리까지 통째로 죽은 코드였다.
//   ★ 이 저장소가 되풀이하는 「만들어 놓고 조용히 안 도는 검사」의 재발이다. 정작 qa-full.mjs
//     본문에는 그 함정을 경고하는 주석이 세 군데나 있었다 — **사람의 주의력으로는 안 막힌다.**
//
// ■ 그래서 무엇을 재나 — **두 방향 다** 잰다(한쪽만 재면 반대쪽이 샌다)
//   ⓐ 도는데 못 고르는 계층: run(X)는 있는데 X를 picks에 넣는 코드가 없다 → 영원히 안 돈다(docs).
//   ⓑ 고르는데 안 도는 계층: picks에 X를 넣는데 run(X)가 없다 → 요약표에 안 뜨고, 사람은
//      「골랐으니 돌았겠지」로 읽는다(거짓 초록의 문법 그대로다).
//
// ⚠ 소스를 읽어 잰다 — tools/qa-full.mjs는 불러오는 순간 **실제 QA 계층을 돌린다**(직렬 자원·
//   운영 서버 불가침). 그래서 import가 아니라 텍스트 대조다.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const 뿌리 = path.resolve(__dirname, "..", "..");
const 소스: string = fs.readFileSync(path.join(뿌리, "tools", "qa-full.mjs"), "utf8");

/** 실제로 도는 계층 — run("이름", …) 호출에 적힌 이름. */
function 실행목록(): Set<string> {
  return new Set([...소스.matchAll(/\brun\(\s*"([^"]+)"/g)].map((m) => m[1]));
}

/** 고를 수 있는 계층 — picks에 이름이 들어갈 수 있는 모든 길. */
function 선택가능(): Set<string> {
  const s = new Set<string>();
  // ① 늘 담기는 스모크: new Set(["server"])
  const 초기 = 소스.match(/const picks = new Set\(\[([^\]]*)\]\)/);
  if (초기) for (const m of 초기[1].matchAll(/"([^"]+)"/g)) s.add(m[1]);
  // ② 이름을 콕 집어 넣는 자리: picks.add("keyleak") 등
  for (const m of 소스.matchAll(/picks\.add\(\s*"([^"]+)"\s*\)/g)) s.add(m[1]);
  // ③ 계층 이름표 단일 출처(전계층) — --all·첫 실행이 이 배열을 돈다
  const 표 = 소스.match(/const 전계층 = \[([\s\S]*?)\];/);
  if (표) for (const m of 표[1].matchAll(/"([^"]+)"/g)) s.add(m[1]);
  return s;
}

describe("QA 전수조사 — 고를 수 있는 계층과 실제로 도는 계층은 같아야 한다", () => {
  it("계층 이름표(전계층)가 tools/qa-full.mjs에 단일 출처로 있다", () => {
    // 배열을 두 곳(--all·첫 실행)에 각자 적던 것이 docs 누락의 뿌리였다.
    expect(소스, "const 전계층 = [...] 가 사라졌다 — 배열이 다시 갈라지면 같은 사고가 재발한다")
      .toMatch(/const 전계층 = \[/);
    // --all과 「첫 실행」 **둘 다** 그 배열을 돌아야 한다 — 한쪽만 돌면 다시 갈라진 것이다.
    expect((소스.match(/for \(const l of 전계층\)/g) ?? []).length,
      "--all과 첫 실행이 둘 다 전계층을 돌지 않는다 — 배열이 다시 갈라졌다").toBe(2);
    // 계층 이름을 늘어놓은 배열을 루프 자리에 **다시 박지 못하게** 한다(그것이 docs 누락의 뿌리).
    //   ⚠ CDP 미기동 스킵 루프처럼 picks에 **넣지 않는** 인라인 배열은 대상이 아니다.
    const 인라인 = [...소스.matchAll(/for \(const l of \[[^\]]*\]\)([^\n]*)/g)]
      .filter((m) => m[1].includes("picks.add(l)"));
    expect(인라인.map((m) => m[0].slice(0, 40)),
      "계층 이름 배열이 루프 자리에 그대로 박혀 있다 — 전계층 하나만 쓴다").toEqual([]);
  });

  it("★ⓐ run()이 있는 계층은 전부 **고를 수 있어야** 한다(docs가 그래서 한 번도 안 돌았다)", () => {
    const 못고름 = [...실행목록()].filter((n) => !선택가능().has(n));
    expect(
      못고름,
      `run()은 있는데 picks에 넣는 코드가 없는 계층: ${못고름.join(", ")} — ` +
        "run()의 첫 줄이 `if (!picks.has(name)) return;`이라 **오류 없이 영원히 안 돈다.** " +
        "전계층 배열에 이름을 넣거나 매핑 규칙을 주세요.",
    ).toEqual([]);
  });

  it("★ⓑ 고를 수 있는 계층은 전부 **실제로 돌아야** 한다(고르기만 하고 안 돌면 거짓 초록이다)", () => {
    const 안돔 = [...선택가능()].filter((n) => !실행목록().has(n));
    expect(
      안돔,
      `picks에 담기는데 run()이 없는 계층: ${안돔.join(", ")} — ` +
        "요약표에 아예 안 뜨는데 사람은 「골랐으니 돌았겠지」로 읽는다.",
    ).toEqual([]);
  });

  it("★ docs 계층은 문서 대장·지식·대조 도구가 바뀌면 걸린다(2026-09-06 신설 배선)", () => {
    // 실제 배선이 있는지 — 규칙이 사라지면 docs는 --all에서만 돌고 평소엔 다시 잠든다.
    expect(소스, "문서 표류 매핑(문서변경)이 없다").toMatch(/문서변경\(f\)\)\s*\{\s*picks\.add\("docs"\)/);
    expect(소스, "대상 문서의 정본은 server/docs-manifest.json이다").toContain("docs-manifest.json");
    expect(소스, "지식 코퍼스 변경도 문서 표류 대상이다").toContain("^knowledge/");
  });
});
