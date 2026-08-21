// [배색 감시 — 2026-08-21 신설(검토관 A⑨ 「이 부류를 잡는 자동 감시가 0이다」)]
//
// 부류: 다크 전용 파스텔 글자색 하드코드. 프로 흰 바탕이 토큰을 잉크색으로 뒤집는 구조라,
// 파스텔을 리터럴로 박으면 흰 테마에서 글씨가 사라진다 — 하루에 8화면에서 같은 병이 났다.
// 규칙(세 번째면 소스 감시)의 문턱을 한참 넘겨 기계로 못박는다.
//
// 계약:
//   ① 화면·공용 부품에서 파스텔 글자색은 **토큰+폴백**(var(--red-ink, #f5928a) 꼴)으로만 쓴다.
//      스윕: node tools/theme-sweep-pastel.mjs --write
//   ② 예외는 「테마 무관 고정 어두운 상자」 안뿐이다 — 상자 파일 4종(syslog·terminal·audit·agent)과
//      같은 줄에 어두운 고정 배경(#000·#1a1a19·#35342f)이 있는 인라인, 그리고 설정의 DB 복구
//      열쇠 상자(「한 번만 보입니다」). 이 예외들은 **일부러** 고정색이다(파일 주석 참조).
//   ③ 빨강 계열의 토큰은 --red가 아니라 **--red-ink**다 — --red는 화면 :root가 정의해 폴백이
//      무시되고 다크 글자가 어두워진다(2026-08-21 검토관 A① 게시 차단급의 재발 방지).
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const PAGES = path.join(__dirname, "..", "..", "client", "src", "renderer", "pages");
const PASTELS = ["#f5928a", "#ffd7d8", "#6fdcb5", "#5fe0aa", "#bff3de", "#f0a020", "#ffd88a", "#f7c777",
  "#ffe9c4", "#7ab0ff", "#5fa1ff", "#cfe0ff", "#8fb8ff", "#a7d3ff", "#dfe6ff", "#cfd6ea", "#8b7cf0"];
const 상자파일 = new Set(["syslog.html", "terminal.html", "audit.html", "agent.html"]);
const 제외 = /^(lite-|login\.html$|setup\.html$|office\.html$|pro-white\.css$)/;

function 위반들(): string[] {
  const out: string[] = [];
  for (const f of fs.readdirSync(PAGES)) {
    if (!/\.(html|js)$/.test(f) || 제외.test(f) || 상자파일.has(f)) continue;
    const lines = fs.readFileSync(path.join(PAGES, f), "utf-8").split(/\r?\n/);
    lines.forEach((l, i) => {
      if (/한 번만 보입니다|background:#000|background:#1a1a19|background:#35342f/.test(l)) return; // 예외 ②
      for (const hex of PASTELS) {
        const re = new RegExp("color:\\s*" + hex + "(?![0-9a-fA-F])");
        if (re.test(l) && !new RegExp("var\\(--[\\w-]+,\\s*" + hex + "\\)").test(l)) {
          out.push(`${f}:${i + 1} ${hex}`);
        }
      }
    });
  }
  return out;
}

describe("배색 감시 — 파스텔 글자색은 잉크 토큰으로", () => {
  it("상자 밖 파스텔 리터럴 글자색이 0이다", () => {
    const v = 위반들();
    expect(v, "흰 테마에서 사라질 글자색이다 — node tools/theme-sweep-pastel.mjs --write 로 토큰화하거나, " +
      "고정 어두운 상자 안이면 같은 줄에 어두운 배경을 두고 파일 주석 규칙을 따르라:\n  " + v.join("\n  ")).toEqual([]);
  });

  it("빨강 잉크 토큰(--red-ink)이 pro-white 한 곳에 정의돼 있다 — 이 장치가 빠지면 흰 테마 빨강이 전부 살몬으로 남는다", () => {
    const pw = fs.readFileSync(path.join(PAGES, "pro-white.css"), "utf-8");
    expect(pw).toContain("--red-ink: #b3241a");
    // ⚠ 반대 방향 감시 — 화면 :root가 --red-ink를 정의하면 다크 폴백이 죽는다(성립 조건 파괴).
    for (const f of fs.readdirSync(PAGES)) {
      if (!/\.html$/.test(f) || f === "pro-white.css") continue;
      const src = fs.readFileSync(path.join(PAGES, f), "utf-8");
      expect(src.includes("--red-ink:") && !src.includes("var(--red-ink"), `${f}가 --red-ink를 정의한다 — 금지`).toBe(false);
    }
  });

  it("어두운 상자 수리 핀 — 상자 안 대표 색이 고정색으로 남아 있다(스윕이 도로 토큰화하면 실패)", () => {
    const audit = fs.readFileSync(path.join(PAGES, "audit.html"), "utf-8");
    expect(audit).toContain(".aud .act{color:#e9e7e2");
    expect(audit).toContain(".k-block{background:rgba(226,72,61,.16);color:#f5928a;}");
    const syslog = fs.readFileSync(path.join(PAGES, "syslog.html"), "utf-8");
    expect(syslog).toContain(".log-console{background:#1a1a19;color:#e9e7e2");
  });
});
