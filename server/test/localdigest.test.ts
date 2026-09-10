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
import {
  조각나누기, 조각글자수, 겹침줄, 실패설명, 다시해볼만한가,
  두뇌풀기, 두뇌목록, 병렬수, 재시도대기ms, 왕복안내, 동시실행, 크기관문, 최대줄수,
} from "../../tools/local-digest.mjs";

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
    // 2026-09-10부터 spawnSync가 아니라 **비동기 spawn**이다(조각을 동시에 보내려고) —
    //   본문이 stdin으로 간다는 계약은 그대로다. 옛 `input: 보낼것`이 아니라 `stdin.end(보낼것)`.
    expect(코드줄).toMatch(/stdin\.end\(보낼것\)/);
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
    // ⚠ 2026-09-10부터 main이 **비동기**라 `) main()` 한 줄이 아니라 `) { main().catch(…) }`다.
    //   그래서 「글자 그대로 붙어 있나」가 아니라 **관문 뒤에서만 부르나**를 본다.
    const 관문 = 코드줄.indexOf("path.resolve(process.argv[1]) === path.resolve(이파일)");
    expect(관문, "진입점 관문이 없다 — import만 해도 gb10을 부르게 된다").toBeGreaterThan(-1);
    const 부름 = 코드줄.indexOf("main().catch(");
    expect(부름, "main()을 부르는 자리가 없다").toBeGreaterThan(-1);
    expect(부름, "관문보다 먼저 main()을 부른다").toBeGreaterThan(관문);
    // ★ 비동기가 된 뒤로는 **깨진 약속을 손수 받아야** 한다 — 안 받으면 실패가 조용히 0으로 끝난다.
    expect((코드줄.match(/main\(\)\.catch\(/g) ?? []).length).toBe(1);
  });

  it("재시도 횟수·제한 시간은 **env로 조절되고 기본값이 박혀 있다**", () => {
    expect(코드줄).toMatch(/GIJO_DIGEST_RETRY/);
    expect(코드줄).toMatch(/GIJO_DIGEST_TIMEOUT/);
  });
});

// ── 2026-09-10 갈래 T — 동시 보내기·크기 관문·지수 재시도 ─────────────────────
//
// ■ 무슨 일이 있었나
//   실행자 둘이 같은 날 이 도구를 **버렸다**: 2,500줄급 파일에서 2분을 넘겨 grep+sed로 갈아탔다.
//   「800줄 넘으면 gb10 먼저」 규율은 이 도구가 grep보다 빠를 때만 도는데, 그 전제가 깨진 것이다.
//   ★ 실측(2026-09-10 · localengine.ts 1,320줄 → 5조각 · 질문을 매번 바꿔 캐시를 뺀 값):
//       동시 1 → 76·77초 │ 동시 2 → 71·74초 │ 동시 3(슬롯 초과) → 77초
//     즉 **동시로 보내도 5%뿐**이다(요청 하나로 이미 GPU 포화). 느림의 뿌리는 **조각 수**라
//     실제 해법은 크기 관문이다. 그래도 동시 수는 슬롯을 넘지 않게 **잣대 한 곳**에서 나와야 한다.
describe("local-digest — 동시 보내기는 **교사 슬롯 수**가 상한이다", () => {
  it("★ 기본 동시 수는 두뇌의 슬롯 수다 — 코드에 박은 숫자가 아니다", () => {
    expect(병렬수({ 슬롯수: 2 }, {}).수).toBe(2);
    expect(병렬수({ 슬롯수: 1 }, {}).수).toBe(1);
    expect(병렬수({ 슬롯수: 2 }, {}).말).toBe("");
  });

  it("낮추는 건 그대로 받는다(슬롯 안쪽)", () => {
    expect(병렬수({ 슬롯수: 2 }, { GIJO_DIGEST_PARALLEL: "1" }).수).toBe(1);
  });

  it("★ 슬롯보다 크게 부르면 **조용히 깎지 않는다** — 깎되 그 사실을 말한다", () => {
    const r = 병렬수({ 슬롯수: 2 }, { GIJO_DIGEST_PARALLEL: "5" });
    expect(r.수).toBe(2);
    expect(r.말).toContain("슬롯");
    expect(r.말.trim()).not.toBe("");
  });

  it("실측용으로 넘겨 보낼 수는 있지만 **말없이는 안 된다**(줄만 선다는 사실을 적는다)", () => {
    const r = 병렬수({ 슬롯수: 2 }, { GIJO_DIGEST_PARALLEL: "3", GIJO_DIGEST_OVERSUBSCRIBE: "1" });
    expect(r.수).toBe(3);
    expect(r.말).toContain("줄");
    expect(병렬수({ 슬롯수: 2 }, { GIJO_DIGEST_PARALLEL: "99", GIJO_DIGEST_OVERSUBSCRIBE: "1" }).수).toBe(8);
  });

  it("망가진 값(0·음수·글자)은 기본으로 되돌아간다 — 0을 받으면 아무 일도 안 일어난다", () => {
    for (const v of ["0", "-3", "abc", ""]) expect(병렬수({ 슬롯수: 2 }, { GIJO_DIGEST_PARALLEL: v }).수).toBe(2);
  });

  it("★ 슬롯당 문맥은 **전체 ÷ 슬롯**이다 — 손으로 적으면 두뇌를 바꿀 때 어긋난다", () => {
    expect(두뇌풀기({ 전체문맥: 32768, 슬롯수: 2 }).슬롯문맥).toBe(16384);
    expect(두뇌풀기({ 전체문맥: 65536, 슬롯수: 1 }).슬롯문맥).toBe(65536);
    expect(두뇌풀기({ 전체문맥: 32768 }).슬롯수).toBe(1); // 안 적었으면 1로 본다(넉넉한 쪽)
  });

  it("★ 짝 대조 — 기동 명령의 --parallel N과 슬롯수가 **같은 수**다", () => {
    for (const [이름, 정의] of Object.entries(두뇌목록 as Record<string, { 슬롯수?: number; 기동?: string }>)) {
      const m = /--parallel\s+(\d+)/.exec(정의.기동 ?? "");
      if (!m) continue; // 제품이 띄우는 두뇌는 기동 줄에 --parallel이 없다
      expect(Number(m[1]), `${이름}: 기동 --parallel ${m[1]} ≠ 슬롯수 ${정의.슬롯수}`).toBe(정의.슬롯수);
    }
  });

  it("★ 동시실행은 상한을 안 넘고, 결과는 **넣은 순서 그대로**다", async () => {
    let 지금 = 0, 최고 = 0;
    const 작업들 = Array.from({ length: 7 }, (_, i) => async () => {
      지금++; 최고 = Math.max(최고, 지금);
      await new Promise((r) => setTimeout(r, 5 + (i % 3) * 5));
      지금--;
      return i;
    });
    const 결과 = await 동시실행(작업들, 3);
    expect(최고).toBeLessThanOrEqual(3);
    expect(최고).toBeGreaterThan(1); // 정말 겹쳐서 돌았나 — 1이면 그냥 순차다
    expect(결과).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("동시실행: 빈 목록·1개도 안 죽는다", async () => {
    expect(await 동시실행([], 3)).toEqual([]);
    expect(await 동시실행([async () => "하나"], 3)).toEqual(["하나"]);
  });
});

describe("local-digest — 너무 큰 파일은 **받지 않고 더 빠른 길을 알려 준다**", () => {
  it("상한 안쪽은 그냥 통과한다", () => {
    expect(크기관문(1200, "server/src/engine/localengine.ts").통과).toBe(true);
    expect(최대줄수).toBeGreaterThanOrEqual(1000);
  });

  it("★ 상한을 넘으면 막되 **무엇을 대신 하면 되는지** 적는다(막기만 하면 다시 온다)", () => {
    const r = 크기관문(4479, "server/src/engine/agenttools/handlers.ts");
    expect(r.통과).toBe(false);
    expect(r.말).toContain("grep");
    expect(r.말).toContain("sed");
    expect(r.말).toContain("GIJO_DIGEST_FORCE=1");
    expect(r.말.split("\n").length).toBeGreaterThan(2);
  });

  it("정말 통째로 돌리겠다면 길은 열려 있다 — 막힌 문이 아니라 **느린 문**이다", () => {
    expect(크기관문(9999, "x.ts", 4000, true).통과).toBe(true);
  });

  it("상한은 env로 옮길 수 있다(잣대를 바꿀 자리가 하나 있다)", () => {
    expect(크기관문(500, "x.ts", 100).통과).toBe(false);
    expect(크기관문(500, "x.ts", 1000).통과).toBe(true);
  });
});

describe("local-digest — 다시 걸 때는 **지수로 벌리고 이유를 말한다**", () => {
  it("★ 간격이 2·4·8초로 벌어진다 — 1초씩 세 번 두드리면 셋 다 같은 이유로 죽는다", () => {
    expect(재시도대기ms(1)).toBe(2000);
    expect(재시도대기ms(2)).toBe(4000);
    expect(재시도대기ms(3)).toBe(8000);
    expect(재시도대기ms(2)).toBeGreaterThan(재시도대기ms(1));
  });

  it("아무리 커져도 상한이 있다 — 재시도 횟수를 올려도 하루를 기다리지 않는다", () => {
    expect(재시도대기ms(30)).toBeLessThanOrEqual(15000);
  });

  it("★ 255는 **WireGuard 왕복**을 짚어 준다 — 종료코드만 적으면 다음에 뭘 할지 모른다", () => {
    expect(왕복안내(255)).toContain("WireGuard");
    expect(왕복안내(255)).toContain("ssh gb10");
  });

  it("7·28·52도 한 줄이 있고, 모르는 코드엔 **지어내지 않는다**", () => {
    expect(왕복안내(7)).toContain("up");
    expect(왕복안내(28)).not.toBe("");
    expect(왕복안내(52)).not.toBe("");
    expect(왕복안내(0)).toBe("");
    expect(왕복안내(1)).toBe("");
  });
});
