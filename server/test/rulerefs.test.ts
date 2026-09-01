// routes.ts **밖**에서 FORCED_INTENTS[N]을 번호로 가리키는 곳이 밀리지 않았나 (2026-09-01 신설)
//
// ★★ 왜 필요한가
//   CLAUDE.md가 「배열 중간에 넣으면 routes.ts 표가 통째로 어긋난다」고 경고하고, 그 표는
//   routes-renumber가 지킨다. 그런데 **표 밖에도 번호로 가리키는 곳이 있다** — 소스 주석·
//   시험 주석·기획 문서. 2026-09-01에 규칙 하나를 23번 자리로 옮겼더니 그 **9곳이 전부
//   한 칸씩 밀린 채** 남았고, 표만 맞춰 놓고 「맞췄다」고 믿었다.
//
//   ⚠ 번호로 가리키는 것 자체가 약한 방식이다. 그래서 이 시험은 두 가지를 요구한다:
//     ① 가리키는 번호가 **실재해야** 한다
//     ② 그 줄에 **도구 이름을 함께 적어야** 한다 — 그래야 밀렸을 때 눈으로 잡힌다
//        (실제로 이번에도 도구 이름을 적어 둔 두 곳 덕에 +1을 확정할 수 있었다)
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const 뿌리 = join(__dirname, "..", "..");

function 규칙도구들(): string[] {
  const s = readFileSync(join(뿌리, "server", "src", "engine", "agentloop.ts"), "utf8");
  const i = s.indexOf("const FORCED_INTENTS");
  const 몸통 = s.slice(i, s.indexOf("];", i));
  return [...몸통.matchAll(/^\s*tool:\s*"([a-z_]+)"/gm)].map((m) => m[1]);
}

/** 저장소에서 사람이 쓰는 소스·시험 파일만 훑는다(빌드 산출물·의존성 제외). */
function 볼파일들(): string[] {
  const 결과: string[] = [];
  const 건너뛸 = new Set(["node_modules", "dist", "release", ".git", "data", "models", "server-dist", ".claude"]);
  const 훑기 = (d: string, 깊이 = 0) => {
    if (깊이 > 6) return;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (건너뛸.has(e.name)) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) 훑기(p, 깊이 + 1);
      else if (/\.(ts|js)$/.test(e.name) && statSync(p).size < 2_000_000) 결과.push(p);
    }
  };
  훑기(join(뿌리, "server", "src"));
  훑기(join(뿌리, "server", "test"));
  훑기(join(뿌리, "client", "src"));
  훑기(join(뿌리, "tools"));
  return 결과;
}

describe("★★ 규칙 번호로 가리키는 곳이 밀리지 않았다", () => {
  const 도구 = 규칙도구들();

  it("규칙을 읽었다(시험 전제가 살아 있다)", () => {
    expect(도구.length).toBeGreaterThan(70);
  });

  it("★ 가리키는 번호가 **실재한다**", () => {
    const 나쁨: string[] = [];
    for (const p of 볼파일들()) {
      if (p.endsWith(join("engine", "routes.ts"))) continue; // 표 자신은 routes-renumber가 지킨다
      const 줄들 = readFileSync(p, "utf8").split("\n");
      줄들.forEach((줄, i) => {
        for (const m of 줄.matchAll(/FORCED_INTENTS\[(\d+)\]/g)) {
          const n = Number(m[1]);
          if (n >= 도구.length) 나쁨.push(`${p.replace(뿌리, "")}:${i + 1} — [${n}]은 없는 자리(규칙은 ${도구.length}개)`);
        }
      });
    }
    expect(나쁨, `없는 규칙 번호를 가리킨다:\n  ${나쁨.join("\n  ")}`).toEqual([]);
  });

  it("★★ 번호를 적을 땐 **도구 이름을 함께** 적는다 — 밀렸을 때 눈으로 잡히게", () => {
    const 나쁨: string[] = [];
    for (const p of 볼파일들()) {
      if (p.endsWith(join("engine", "routes.ts"))) continue;
      if (p.endsWith(join("test", "rulerefs.test.ts"))) continue; // 이 시험 자신
      const 줄들 = readFileSync(p, "utf8").split("\n");
      줄들.forEach((줄, i) => {
        for (const m of 줄.matchAll(/FORCED_INTENTS\[(\d+)\]/g)) {
          const n = Number(m[1]);
          const 이름 = 도구[n];
          if (!이름) continue; // 위 시험이 잡는다
          // 같은 줄이나 앞뒤 두 줄 안에 도구 이름이 있으면 통과 — 밀리면 사람이 알아챌 수 있다.
          const 둘레 = 줄들.slice(Math.max(0, i - 2), i + 3).join(" ");
          if (!둘레.includes(이름)) {
            나쁨.push(`${p.replace(뿌리, "")}:${i + 1} — [${n}]인데 그 규칙 이름(${이름})이 둘레에 없다`);
          }
        }
      });
    }
    expect(나쁨, `번호만 적어 밀려도 안 보이는 자리:\n  ${나쁨.join("\n  ")}`).toEqual([]);
  });
});
