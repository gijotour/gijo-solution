// 야간 회귀 결석 감지 — 2026-08-31
//
// 왜: 야간 회귀(152상황)가 **08-25·08-26 두 밤을 건너뛰고도 아무도 몰랐다.** 로그가
// 20260824 다음 20260827로 뛰어 있는데 그것을 보는 눈이 없었다. 처음도 아니다 —
// nightly-ops-sim.ps1 머리 주석이 이미 「예전 예약이 세션과 함께 사라져 이틀 결석했다
// (마지막 08-12, 발견 08-14)」고 적어 두었다. **두 번 같은 사고를 겪고서야 자를 만든다.**
//
// 결석은 **아무 일도 안 일어나는 것**이라 스스로 못 알린다. 그래서 셈하는 자(nightly-gap)를
// 따로 두고, ①다음 회차가 로그 머리에 공백을 적고 ②게시 관문이 사흘 넘게 비면 막는다.
// 이 시험은 그 **자 자체가 제대로 세는지**를 본다 — 자가 틀리면 위 둘이 다 헛돈다.
//
// ★ 2026-09-12 추가 — 설계관 실측 ①②를 문는 시험(야간 회귀 2차 패스 4100 결석 감시 + 메타 이름 인자):
//   옛 정규식이 "ops-sim-4100-nightly-*.log"를 못 봐서 2차 패스가 통째로 결석 감시 밖이었다.
//   아래 두 번째 describe가 패스 분리를, 세 번째 describe가 ops-sim-meta.mjs의 회차 이름 인자를 묻는다.
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { 결석현황, 회차들 } from "../../tools/nightly-gap.mjs";

/** 로그 파일만 있는 가짜 저장소를 만든다(내용은 안 본다 — 「돌았는가」만 세는 자다). */
function 가짜(회차: number[]): string {
  const 뿌리 = mkdtempSync(join(tmpdir(), "gijo-nightly-"));
  mkdirSync(join(뿌리, ".tmp-reports"), { recursive: true });
  for (const d of 회차) writeFileSync(join(뿌리, ".tmp-reports", `ops-sim-nightly-${d}.log`), "끝");
  return 뿌리;
}

/** 4100 패스 로그까지 섞어 만드는 가짜 저장소 — 두 패스가 서로 안 섞이는지 보는 자리에 쓴다. */
function 가짜두패스(사천패스: number[], 사천백패스: number[]): string {
  const 뿌리 = mkdtempSync(join(tmpdir(), "gijo-nightly2-"));
  mkdirSync(join(뿌리, ".tmp-reports"), { recursive: true });
  for (const d of 사천패스) writeFileSync(join(뿌리, ".tmp-reports", `ops-sim-nightly-${d}.log`), "끝");
  for (const d of 사천백패스) writeFileSync(join(뿌리, ".tmp-reports", `ops-sim-4100-nightly-${d}.log`), "끝");
  return 뿌리;
}

describe("야간 회귀 결석 — 셈하는 자가 제대로 센다", () => {
  it("빠진 날이 없으면 결석 0건", () => {
    const 뿌리 = 가짜([20260828, 20260829, 20260830]);
    try {
      const r = 결석현황(뿌리, 20260830);
      expect(r.회차수).toBe(3);
      expect(r.결석구간).toEqual([]);
      expect(r.빈날).toBe(0);
    } finally { rmSync(뿌리, { recursive: true, force: true }); }
  });

  it("★ 실제로 겪은 그 공백을 잡는다 — 08-24 다음이 08-27(2일)", () => {
    const 뿌리 = 가짜([20260823, 20260824, 20260827, 20260828]);
    try {
      const r = 결석현황(뿌리, 20260828);
      expect(r.결석구간.length, "공백을 못 봤다").toBe(1);
      expect(r.결석구간[0]).toMatchObject({ 앞: 20260824, 뒤: 20260827, 뜬날: 2 });
    } finally { rmSync(뿌리, { recursive: true, force: true }); }
  });

  it("★★ 오늘까지 이어지는 공백을 센다 — 게시 관문이 막는 잣대", () => {
    // 관문은 빈날 > 2에서 멈춘다. 경계를 못 박아 둔다.
    const 뿌리 = 가짜([20260825]);
    try {
      expect(결석현황(뿌리, 20260825).빈날, "오늘 돌았으면 0").toBe(0);
      expect(결석현황(뿌리, 20260826).빈날, "하루 비면 1 — 흔한 일이라 안 막는다").toBe(1);
      expect(결석현황(뿌리, 20260828).빈날, "사흘 비면 3 — 여기서 막는다").toBe(3);
    } finally { rmSync(뿌리, { recursive: true, force: true }); }
  });

  it("달을 넘겨도 센다 — 08-31 다음 09-02", () => {
    const 뿌리 = 가짜([20260831, 20260902]);
    try {
      const r = 결석현황(뿌리, 20260902);
      expect(r.결석구간[0]).toMatchObject({ 앞: 20260831, 뒤: 20260902, 뜬날: 1 });
    } finally { rmSync(뿌리, { recursive: true, force: true }); }
  });

  it("기록이 아예 없으면 그렇다고 말한다 — 조용히 0으로 통과하지 않는다", () => {
    const 뿌리 = mkdtempSync(join(tmpdir(), "gijo-nightly-none-"));
    try {
      const r = 결석현황(뿌리, 20260831);
      expect(r.회차수).toBe(0);
      expect(r.문장, "「기록이 없다」를 말해야 한다 — 0건 통과는 거짓 초록이다").toContain("없습니다");
    } finally { rmSync(뿌리, { recursive: true, force: true }); }
  });

  it("이름이 다른 파일은 회차로 안 센다", () => {
    const 뿌리 = 가짜([20260830]);
    try {
      writeFileSync(join(뿌리, ".tmp-reports", "ops-sim.md"), "x");
      writeFileSync(join(뿌리, ".tmp-reports", "ops-sim-nightly-오류.log"), "x");
      expect(회차들(뿌리)).toEqual([20260830]);
    } finally { rmSync(뿌리, { recursive: true, force: true }); }
  });
});

describe("결석 감지가 실제로 배선돼 있다 — 자만 만들고 안 쓰면 소용없다", () => {
  it("다음 회차가 공백을 로그에 적는다(nightly-ops-sim.ps1)", async () => {
    const { readFileSync } = await import("node:fs");
    const s = readFileSync(join(__dirname, "..", "..", "tools", "nightly-ops-sim.ps1"), "utf8");
    expect(s, "실행기가 결석을 안 적는다").toContain("nightly-gap.mjs");
  });

  it("게시 관문이 오래된 회귀에 게시를 막는다(publish-gate-ui.mjs)", async () => {
    const { readFileSync } = await import("node:fs");
    const s = readFileSync(join(__dirname, "..", "..", "tools", "publish-gate-ui.mjs"), "utf8");
    expect(s, "관문이 결석을 안 본다").toContain("nightly-gap.mjs");
    expect(s, "막는 잣대(빈날)가 없다").toMatch(/빈날\s*>\s*2/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ★ 2026-09-12 설계관 실측 ① — 야간 회귀 2차 패스(4100)도 결석 감시가 잡는다
//
// 옛 정규식 `^ops-sim-nightly-(\d{8})\.log$`은 "ops-sim-4100-nightly-*.log"의 "-4100"에
// 걸려 통째로 매치가 안 됐다 — 즉, 4100 패스 로그는 4000 패스 회차 목록에도 안 섞이고(안전),
// 동시에 **자기 패스로도 안 잡혔다**(결석 감시 밖). 아래는 회차들()/결석현황()에 세 번째
// 인자(패스)를 주면 두 패스가 서로 섞이지 않고 각자 제대로 세는지를 묻는다.
describe("★ 야간 회귀 2차 패스(4100) — 결석 감시가 패스를 따로 센다", () => {
  it("4000 로그와 4100 로그가 서로 안 섞인다", () => {
    const 뿌리 = 가짜두패스([20260910, 20260911], [20260912]);
    try {
      expect(회차들(뿌리, "4000")).toEqual([20260910, 20260911]);
      expect(회차들(뿌리, "4100")).toEqual([20260912]);
    } finally { rmSync(뿌리, { recursive: true, force: true }); }
  });

  it("패스 인자를 안 주면 기본이 4000이다(옛 호출부·다른 시험과 하위호환)", () => {
    const 뿌리 = 가짜두패스([20260910], [20260911]);
    try {
      expect(회차들(뿌리)).toEqual([20260910]);
      expect(결석현황(뿌리, 20260910).회차수).toBe(1);
    } finally { rmSync(뿌리, { recursive: true, force: true }); }
  });

  it("★ 4100에도 결석이 잡힌다 — 옛 정규식이면 이 시험이 실패했을 것", () => {
    // 4100이 09-10 다음 09-13에 돈 것 = 2일 결석. 4000은 매일 돌아 결석 없음.
    const 뿌리 = 가짜두패스([20260910, 20260911, 20260912, 20260913], [20260910, 20260913]);
    try {
      const 사천 = 결석현황(뿌리, 20260913, "4000");
      const 사천백 = 결석현황(뿌리, 20260913, "4100");
      expect(사천.결석구간, "4000은 매일 돌았으니 결석이 없어야 한다").toEqual([]);
      expect(사천백.결석구간.length, "4100의 09-10→09-13 공백을 못 잡았다").toBe(1);
      expect(사천백.결석구간[0]).toMatchObject({ 앞: 20260910, 뒤: 20260913, 뜬날: 2 });
    } finally { rmSync(뿌리, { recursive: true, force: true }); }
  });

  it("4100이 한 번도 안 돌았으면 '결석'이 아니라 '시작 전'이다 — 빈날 null, 게시를 안 막는다", () => {
    // 4000만 있고 4100 로그가 하나도 없는 상태(2026-09-12 이전 실제 상황과 같다).
    const 뿌리 = 가짜두패스([20260910, 20260911, 20260912], []);
    try {
      const 사천백 = 결석현황(뿌리, 20260912, "4100");
      expect(사천백.회차수).toBe(0);
      expect(사천백.빈날, "빈날이 숫자면 게시 관문이 '결석'으로 오판해 막을 수 있다").toBeNull();
      expect(사천백.문장).toContain("고객 QA(4100)");
    } finally { rmSync(뿌리, { recursive: true, force: true }); }
  });

  it("CLI로 직접 돌리면 두 패스를 각각 보고한다", () => {
    const 뿌리 = 가짜두패스([20260910], [20260911]);
    try {
      const r = spawnSync(process.execPath, [join(__dirname, "..", "..", "tools", "nightly-gap.mjs")], {
        encoding: "utf8", cwd: 뿌리, timeout: 10_000,
      });
      expect(r.stdout, "1차(운영 4000) 보고가 없다").toMatch(/1차·운영 4000/);
      expect(r.stdout, "2차(4100) 보고가 없다").toMatch(/2차·고객 QA 4100/);
    } finally { rmSync(뿌리, { recursive: true, force: true }); }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ★ 2026-09-12 설계관 실측 ② — ops-sim-meta.mjs가 회차 이름을 인자로 받는다
//
// 옛 코드는 .tmp-reports/ops-sim.meta.json 경로를 못박아 둬서, 2차 패스(4100)가
// --out ops-sim-4100으로 스스로 쓰는 ops-sim-4100.meta.json을 아무도 안 읽었다.
// ⚠ ops-sim-meta.mjs는 저장소 실제 경로(.tmp-reports)를 읽는 스크립트라(뿌리를
//   process.cwd()가 아니라 자기 파일 위치로 잡는다) 실제 ops-sim.meta.json을 건드리지
//   않도록, 실행 때마다 겹칠 일이 없는 임시 이름(ops-sim-meta-selftest-<pid>)으로만 시험한다.
describe("★ ops-sim-meta.mjs — 회차 이름을 인자로 받는다(4100 메타 편입)", () => {
  const 스크립트 = join(__dirname, "..", "..", "tools", "ops-sim-meta.mjs");
  const 실제뿌리 = join(__dirname, "..", "..");
  const 임시이름 = `ops-sim-meta-selftest-${process.pid}`;
  const 임시메타 = join(실제뿌리, ".tmp-reports", `${임시이름}.meta.json`);
  // ⚠ gb10 깨끗한 사본에는 .tmp-reports가 없다(tools/gb10-test.sh가 일부러 안 옮긴다 — 등급 C 재료). 폴더를 먼저 만든다(2026-09-12 gb10 게이트 실측 ENOENT).
  mkdirSync(join(실제뿌리, ".tmp-reports"), { recursive: true });

  const 돌린다 = (인자: string[]) =>
    spawnSync(process.execPath, [스크립트, ...인자], { encoding: "utf8", timeout: 10_000 });

  // vitest의 afterEach 대신 각 it 안에서 try/finally로 임시 메타 파일을 지운다(파일이 하나뿐이라 충분하다).

  it("--count로 총문항 숫자만 준다(첫 인자로 이름을 받았을 때)", () => {
    writeFileSync(임시메타, JSON.stringify({ 총문항: 77, 기록: 77, 완주: true, 시각: "2026-09-12T00:00:00Z" }));
    try {
      const r = 돌린다([임시이름, "--count"]);
      expect(r.stdout.trim(), `stderr: ${r.stderr}`).toBe("77");
      expect(r.status).toBe(0);
    } finally { rmSync(임시메타, { force: true }); }
  });

  it("--out <이름>으로도 같은 파일을 읽는다(첫 인자 방식과 동등)", () => {
    writeFileSync(임시메타, JSON.stringify({ 총문항: 88, 기록: 88, 완주: true, 시각: "2026-09-12T00:00:00Z" }));
    try {
      const r = 돌린다(["--out", 임시이름, "--count"]);
      expect(r.stdout.trim()).toBe("88");
    } finally { rmSync(임시메타, { force: true }); }
  });

  it("그 이름의 메타가 없으면 종료코드 3 + 그 이름을 메시지에 말한다(0으로 속이지 않는다)", () => {
    expect(existsSync(임시메타), "혹시 이전 회차 잔재가 남아 있으면 이 시험이 오탐한다").toBe(false);
    const r = 돌린다([임시이름]);
    expect(r.status).toBe(3);
    expect(r.stdout).toContain(임시이름);
  });

  it("경로 탈출·이상한 글자가 든 이름은 거부한다(ops-sim.mjs --out과 같은 규칙)", () => {
    const r = 돌린다(["../../etc/passwd"]);
    expect(r.status).toBe(2);
  });

  // ★★ 2026-09-12 검토관 적발 수리 — meta에 「잰문항·건너뜀」을 넣어 놓고 **읽는 입이 없었다.**
  //   사람이 아침에 먼저 보는 것은 밤 로그의 이 한 줄이라, 여기서 안 말하면 「총문항 205 ·
  //   기록 205 · 완주 예」만 남고 **몇 문항을 안 물었다는 사실이 그 자리에 없다**.
  it("★ 잰 문항·건너뜀·프로필도 한 줄에 말한다(프로필이 생겨 기록 ≠ 잰 문항이 됐다)", () => {
    writeFileSync(임시메타, JSON.stringify({
      총문항: 205, 기록: 205, 잰문항: 197, 건너뜀: 8,
      건너뜀사유별: { "설정:법령": 5, "데이터:업무": 3 }, 프로필: "qa4100",
      완주: true, 시각: "2026-09-12T00:00:00Z",
    }));
    try {
      const r = 돌린다([임시이름]);
      expect(r.status, `stderr: ${r.stderr}`).toBe(0);
      expect(r.stdout, "잰 문항 수가 없다 — 205/205로만 읽힌다").toContain("잰 문항 197");
      expect(r.stdout).toContain("건너뜀 8");
      expect(r.stdout, "건너뜀 사유가 없다").toContain("설정:법령 5");
      expect(r.stdout).toContain("qa4100");
      expect(r.stdout).toContain("총문항 205");
    } finally { rmSync(임시메타, { force: true }); }
  });

  it("그 칸이 없는 옛 회차는 종전 꼴 그대로 — 없는 숫자를 0으로 지어내지 않는다", () => {
    writeFileSync(임시메타, JSON.stringify({ 총문항: 162, 기록: 162, 완주: true, 시각: "2026-09-05T18:10:00Z" }));
    try {
      const r = 돌린다([임시이름]);
      expect(r.stdout).toContain("총문항 162 · 기록 162 · 완주 예");
      expect(r.stdout, "안 적힌 칸을 지어내 적었다").not.toContain("건너뜀");
    } finally { rmSync(임시메타, { force: true }); }
  });

  it("인자가 없으면 기본값은 그대로 ops-sim이다(소스 감시 — 실제 ops-sim.meta.json은 안 건드린다)", () => {
    const src = readFileSync(스크립트, "utf8");
    expect(src, "기본 이름이 ops-sim이 아니게 바뀌었다").toMatch(/\|\|\s*"ops-sim"/);
  });
});
