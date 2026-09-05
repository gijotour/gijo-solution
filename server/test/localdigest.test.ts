// gb10 발췌 창구(tools/local-digest.mjs)의 **큰 파일 실패 회귀 시험**. (계획서: 중-7 운영 게이트)
//
// ■ 무슨 일이 있었나 (2026-09-05 실사고)
//   1,300줄급 파일 발췌가 「⚠ 조각 786~1181 실패: ssh 실패:」 **한 줄만** 내고 396줄을 통째로
//   버렸다. 이유가 안 적힌 게 아니라 **이유를 버리고 있었다** — curl에 `-s`(silent)가 붙어 있어
//   curl이 제 실패 이유를 stderr에 한 글자도 안 쓴다. 그래서 `(r.stderr || "")`가 빈 문자열이 되고
//   문구가 「ssh 실패: 」로 끝난다.
//   ★ 실측으로 갈랐다(2026-09-05):
//     · `-s  --max-time 1` → status 28 · stderr **0바이트** → 「ssh 실패: 」   ← 사고 때 본 그 줄
//     · `-sS --max-time 1` → status 28 · stderr 77바이트 "curl: (28) Operation timed out …"
//     · 문맥 초과는 **이 경로가 아니다** — status 0 + JSON 400(exceed_context_size_error)로 온다.
//     · 명령줄 길이(ARG_MAX)도 **아니다** — 본문은 argv가 아니라 stdin(`--data-binary @-`)으로 간다.
//   그래서 고친 것은 셋이다: ① 이유를 버리지 않는다 ② 다시 해 본다 ③ 그래도 안 되면 **반으로 잘라**
//   다시 묻는다(수백 줄을 한 번에 버리지 않는다).
//
// ⚠ 이 시험은 **gb10을 부르지 않는다.** 순수 함수와 소스 감시만 본다 —
//   실호출을 넣으면 이 시험이 「네트워크가 살아 있는가」를 재는 물건으로 바뀐다.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { 조각나누기, 조각글자수, 겹침줄, 실패설명, 다시해볼만한가 } from "../../tools/local-digest.mjs";

const 뿌리 = path.resolve(__dirname, "..", "..");
const 도구 = path.join(뿌리, "tools", "local-digest.mjs");
const 소스: string = fs.readFileSync(도구, "utf8");
/** 주석을 뺀 **실제로 도는 줄**만 — 사고 설명이 주석에 그대로 인용돼 있어 통째로 재면 헛걸린다. */
const 코드줄 = 소스.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

describe("local-digest — 조각 분할이 한계를 넘지 않는다(부르기 전에 실패가 예약되지 않게)", () => {
  const 예산 = 500;
  const 줄들 = Array.from({ length: 400 }, (_, i) => `줄 ${i + 1} ` + "가".repeat(20));

  it("★ 어떤 조각도 글자 예산을 넘지 않는다 — 넘으면 gb10이 400(문맥 초과)으로 되돌린다", () => {
    for (const [s, e] of 조각나누기(줄들, 예산, 20)) {
      const 글자 = 줄들.slice(s, e).reduce((a, l) => a + l.length + 1, 0);
      // 마지막 한 줄은 예산을 넘어도 담는다(최소 한 줄 규칙) — 그 경우만 예외로 허용한다.
      const 한줄뿐 = e - s === 1;
      expect(한줄뿐 || 글자 <= 예산, `조각 ${s + 1}~${e}이 예산 ${예산}자를 넘었다(${글자}자)`).toBe(true);
    }
  });

  it("★ 파일의 모든 줄이 어느 조각엔가 담긴다 — 구멍이 생기면 조용히 못 본 구간이 된다", () => {
    const 담김 = new Set<number>();
    for (const [s, e] of 조각나누기(줄들, 예산, 20)) for (let i = s; i < e; i++) 담김.add(i);
    expect(담김.size).toBe(줄들.length);
  });

  it("조각은 겹친다 — 경계에 걸친 함수를 놓치지 않기 위해서다", () => {
    const 목록 = 조각나누기(줄들, 예산, 20);
    expect(목록.length).toBeGreaterThan(2);
    for (let i = 1; i < 목록.length; i++) expect(목록[i][0]).toBeLessThan(목록[i - 1][1]);
  });

  it("한 줄이 예산보다 길어도 **앞으로 나아간다**(무한 루프 금지)", () => {
    const 괴물 = ["가".repeat(9999), "짧은 줄", "가".repeat(9999)];
    const 목록 = 조각나누기(괴물, 100, 10);
    expect(목록.length).toBeGreaterThan(0);
    expect(목록[목록.length - 1][1]).toBe(괴물.length);
  });

  it("실제 큰 파일에서도 조각이 두뇌 문맥 예산 안에 들어온다", () => {
    // 실측 기준: 예산 17,661자 ≈ 10,500토큰 < 슬롯 16,384토큰(자당 1.68토큰 실측 최악값 적용).
    const 큰파일 = path.join(뿌리, "server", "src", "engine", "dispatcher.ts");
    if (!fs.existsSync(큰파일)) return;
    const lines = fs.readFileSync(큰파일, "utf8").split("\n");
    for (const [s, e] of 조각나누기(lines)) {
      const 글자 = lines.slice(s, e).reduce((a, l) => a + l.length + 1, 0);
      expect(e - s === 1 || 글자 <= 조각글자수).toBe(true);
    }
    expect(조각글자수).toBeLessThan(30000); // 두뇌를 바꿔 예산이 폭주하면 여기서 걸린다
    expect(겹침줄).toBeGreaterThan(0);
  });
});

describe("local-digest — 실패를 **빈 문구로 흘리지 않는다**", () => {
  it("★ stderr가 0바이트여도 이유가 남는다 — 옛 「ssh 실패: 」가 다시 나오면 안 된다", () => {
    const 말 = 실패설명({ status: 28, stderr: "", signal: null } as never);
    expect(말.trim()).not.toBe("");
    expect(말).toContain("28");
    expect(말).toContain("시간 초과");
  });

  it("★ 아무 단서가 없어도 「설명 없음」이라고 **적는다**(빈 문자열 금지)", () => {
    for (const r of [{ status: null, stderr: null }, { status: undefined, stderr: undefined }, {}]) {
      expect(실패설명(r as never).trim().length).toBeGreaterThan(0);
    }
  });

  it("stderr가 있으면 그대로 싣는다 · signal·spawn 오류도 이름이 남는다", () => {
    expect(실패설명({ status: 28, stderr: "curl: (28) Operation timed out" } as never)).toContain("Operation timed out");
    expect(실패설명({ status: null, signal: "SIGTERM", stderr: "" } as never)).toContain("SIGTERM");
    expect(실패설명({ status: null, error: { code: "EPIPE" }, stderr: "" } as never)).toContain("EPIPE");
  });

  it("다시 해 볼 실패와 아닌 실패를 가른다 — 아무거나 3번 되풀이하면 시간만 3배로 쓴다", () => {
    for (const c of [7, 28, 52, 56, 255]) expect(다시해볼만한가({ status: c } as never), `${c}는 재시도 대상`).toBe(true);
    for (const c of [1, 2, 22]) expect(다시해볼만한가({ status: c } as never), `${c}는 재시도 대상이 아니다`).toBe(false);
    expect(다시해볼만한가({ status: null, error: { code: "EPIPE" } } as never)).toBe(true);
  });
});

describe("local-digest — 소스 감시(같은 사고가 다시 들어오는 길을 막는다)", () => {
  it("★ curl은 `-sS`다 — 홑 `-s`는 실패 이유를 통째로 버린다(사고의 뿌리)", () => {
    expect(/curl\s+-s(?!S)/.test(코드줄), "curl -s(홑)가 코드에 남아 있다").toBe(false);
    expect(코드줄).toContain("curl -sS");
  });

  it("★ 본문은 **stdin으로만** 간다 — argv에 실으면 명령줄 길이 한계에 걸린다", () => {
    expect(코드줄).toContain("--data-binary @-");
    expect(코드줄).toMatch(/input:\s*보낼것/);
    // 프롬프트가 ssh 인자 배열에 직접 끼어드는 길이 없어야 한다.
    expect(/spawnSync\("ssh",\s*\[[^\]]*prompt/.test(코드줄), "프롬프트가 argv로 간다").toBe(false);
  });

  it("★ 조각이 실패하면 **반으로 잘라 다시 묻는다**(수백 줄을 한 번에 버리지 않는다)", () => {
    expect(코드줄).toMatch(/조각묻기\(s, 반, 깊이 \+ 1\)/);
    expect(코드줄).toMatch(/조각묻기\(반, e, 깊이 \+ 1\)/);
    // 「못 봤다」는 **더 못 쪼개는 자리에서만** 적힌다 — 한 곳뿐이어야 한다.
    expect((코드줄.match(/못본조각\.push/g) ?? []).length).toBe(1);
    expect(코드줄).toMatch(/깊이 >= 최대분할/);
  });

  it("★ 실패해도 종료코드로 말한다 — 글로만 적으면 엮어 쓰는 쪽이 못 알아챈다", () => {
    expect(코드줄).toMatch(/못본조각\.length\)\s*process\.exitCode = 1/);
  });

  it("진입점 관문이 있다 — import(시험)로는 아무것도 돌지 않는다", () => {
    expect(코드줄).toMatch(/path\.resolve\(process\.argv\[1\]\) === path\.resolve\(이파일\)\) main\(\)/);
  });

  it("재시도 횟수·제한 시간은 **env로 조절되고 기본값이 박혀 있다**", () => {
    expect(코드줄).toMatch(/GIJO_DIGEST_RETRY/);
    expect(코드줄).toMatch(/GIJO_DIGEST_TIMEOUT/);
  });
});
