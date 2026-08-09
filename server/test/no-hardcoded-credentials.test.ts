// 비밀번호를 코드에 적지 않는다 — 소스 감시(2026-08-09 신설).
//
// 왜 생겼나: 저장소를 남과 공유하려다 계정 비밀번호가 도구 **7곳에** 그대로 박혀 있는 것을
// 발견했다. 한 곳씩 고치는 방식은 이미 6번 실패했다(그때마다 새 도구가 또 적었다).
// 파일에서 지워도 **git 이력에는 남으므로** 새는 자리를 막는 것이 유일하게 효과 있는 조치다.
//
// 계정은 tools/qa-account.mjs 한 곳에서 환경변수로 읽는다. 여기 걸리면 그 쪽을 쓰면 된다.
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "..", "..");

/** git이 추적하는 파일만 본다 — 남이 받아 가는 것이 곧 이 목록이다. */
function 추적파일들(): string[] {
  return execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 })
    .split("\n")
    .filter(Boolean);
}

// 값이 **진짜 비밀번호 꼴**일 때만 잡는다.
//   · 아스키 4자 이상(라벨 "🔒 비밀번호" 같은 한글·이모지는 비밀번호가 아니다)
//   · 일부러 쓰는 가짜값(wrong·guest·test·dummy·sample·example·changeme)은 제외 —
//     시험이 **틀린 비밀번호로 거절을 확인**하는 것은 정상이다.
const 값 = `(?!(?:changeme|wrong|guest|test|dummy|sample|example|password|1234)[^"'\`\\n]*["'\`])[A-Za-z0-9!@#$%^&*_.\\-]{4,}`;
const 위험한꼴: { 이름: string; re: RegExp }[] = [
  { 이름: 'password: "…"(로그인 본문)', re: new RegExp(`\\bpassword\\s*:\\s*["'\`]${값}["'\`]`) },
  { 이름: 'fill("#password", "…")(폼 채우기)', re: new RegExp(`#password["'\`]\\s*,\\s*["'\`]${값}["'\`]`) },
  { 이름: "env 기본값에 박은 비밀번호", re: new RegExp(`process\\.env\\.[A-Z_]*(?:PASS|PW|PASSWORD)[A-Z_]*\\s*(?:\\?\\?|\\|\\|)\\s*["'\`]${값}["'\`]`) },
];

/**
 * 단위 시험(server/test/*.ts)은 보지 않는다 — 메모리 DB에 그때 만들어 그때 버리는 값이라
 * 남에게 넘어가도 아무 문을 열지 못한다. 감시가 지키려는 것은 **실 서버·실 장비에 붙는** 코드다.
 * ⚠ 이 예외를 넓히지 말 것. 넓히면 감시가 이름만 남는다.
 */
const 감시대상 = (f: string): boolean =>
  /^(tools|server\/tools)\/.*\.(mjs|cjs|js|sh|ps1)$/.test(f) ||
  /^(server\/src|client\/src)\/.*\.(ts|tsx|js|mjs|html)$/.test(f);

// 예외는 **이유와 함께**만 둔다(예외가 늘면 감시가 무의미해진다).
const 예외: Record<string, string> = {
  "server/src/auth/users.ts": "첫 설치 기본 비밀번호(changeme) — 공개된 초기값이고 첫 로그인에 바꾸게 안내한다",
};

describe("★★ 비밀번호가 코드에 없다", () => {
  const 파일들 = 추적파일들();

  it("⚠ 감시가 헛돌지 않는가 — 파일을 실제로 읽었다", () => {
    // 목록을 못 읽으면 「0건 발견」이 되어 **항상 통과한다.** 그건 지키는 게 아니라 눈 감은 것이다.
    expect(파일들.length, "추적 파일 목록을 못 읽었다").toBeGreaterThan(200);
    expect(파일들.filter(감시대상).length, "감시 대상이 없다 — 경로 규칙이 어긋났다").toBeGreaterThan(20);
  });

  it("⚠ 감시가 헛돌지 않는가 — 실제로 있었던 유출을 다시 넣으면 잡는다", () => {
    // 2026-08-09에 실제로 저장소에 있던 두 꼴. 규칙을 느슨하게 고치면 여기서 먼저 깨진다.
    const 있었던유출 = [
      `body: JSON.stringify({ username: "jyh", password: "gijohn00", force: true })`,
      `const SUDO_PW = process.env.SCAN_SUDO_PW || "007700";`,
      `await page.fill("#password", "gijohn00");`,
    ];
    for (const 줄 of 있었던유출) {
      expect(위험한꼴.some(({ re }) => re.test(줄)), `못 잡는다: ${줄}`).toBe(true);
    }
    // 반대로 정상인 것을 잡으면 아무도 이 감시를 안 쓰게 된다.
    const 정상 = [
      `const authBadge = (a) => ({ key: "🔑 SSH 키", password: "🔒 비밀번호" }[a]);`,
      `.send({ username: "jyh", password: "wrong" })`,
      `body: JSON.stringify({ username: USER, password: PASS, force: true })`,
      `password: "changeme"`,
    ];
    for (const 줄 of 정상) {
      expect(위험한꼴.some(({ re }) => re.test(줄)), `잘못 잡는다: ${줄}`).toBe(false);
    }
  });

  it("추적 중인 소스 어디에도 비밀번호가 적혀 있지 않다", () => {
    const 걸린것: string[] = [];
    for (const f of 파일들) {
      if (예외[f]) continue;
      if (!감시대상(f)) continue;
      const full = path.join(ROOT, f);
      let src: string;
      try { src = fs.readFileSync(full, "utf8"); } catch { continue; }
      for (const { 이름, re } of 위험한꼴) {
        const m = re.exec(src);
        if (m) {
          const 줄 = src.slice(0, m.index).split("\n").length;
          걸린것.push(`${f}:${줄} — ${이름}`);
        }
      }
    }
    expect(
      걸린것,
      "비밀번호가 코드에 있다. tools/qa-account.mjs의 account()로 환경변수에서 읽으세요:\n  " +
        걸린것.join("\n  ")
    ).toEqual([]);
  });

  it("점검 도구들은 계정을 한 곳(qa-account)에서 읽는다", () => {
    const 도구들 = [
      "tools/hardening-e2e.mjs",
      "tools/hardening-remote-e2e.mjs",
      "tools/terminal-scan-smoke.mjs",
      "server/tools/menu-edgecheck.mjs",
      "server/tools/menu-dispatch-accuracy.mjs",
      "server/tools/vpn-access-check.mjs",
    ];
    for (const f of 도구들) {
      const src = fs.readFileSync(path.join(ROOT, f), "utf8");
      expect(src, `${f}가 계정을 스스로 정한다 — qa-account를 쓰세요`).toContain("qa-account.mjs");
    }
  });
});
