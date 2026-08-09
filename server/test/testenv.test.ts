// **어디서 재고 있는가**를 시험이 스스로 말한다 (2026-08-10, 계획서 중-3).
//
// ■ 왜 (2026-08-09~10 실사고)
//   서버 시험을 **Windows 호스트**에서 돌리고 있었다. 제품은 WSL에서 도는데.
//   그 결과:
//     · Windows의 `python3`은 **0바이트 껍데기**(스토어 stub) → 「제품 결함」으로 오판
//     · 운영에 pypdf·netmiko가 없어 PDF 추출·장비 접속이 **죽어 있던 것을 원리상 못 잡음**
//     · 한 파일에 14분 → 전체는 밤새 못 끝냄 → **게이트를 통과 못 한 채 배포**한 날이 있었다
//   규칙을 CLAUDE.md에 적었지만, **문서는 잊힌다.** 그래서 시험이 스스로 말하게 한다.
//
// ■ 무엇을 하지 않는가
//   ⚠ **실패시키지 않는다.** Windows에서도 소스 검사류는 정상적으로 유용하고,
//     빨간불을 만들면 「원래 빨간불이야」가 자리 잡아 감시 전체가 죽는다
//     (2026-08-09에 그렇게 죽어 있던 감시를 둘 봤다).
//   → **알린다**: 지금 어디서 재고 있는지, 그리고 여기서 못 잡는 것이 무엇인지.
import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";

/** WSL 안인가 — /proc/version에 microsoft가 박혀 있다(WSL1·2 공통). */
function wsl인가(): boolean {
  if (process.platform !== "linux") return false;
  try {
    return /microsoft/i.test(fs.readFileSync("/proc/version", "utf8"));
  } catch {
    return false;
  }
}

const 환경 = process.platform === "win32" ? "Windows 호스트" : wsl인가() ? "WSL" : process.platform === "darwin" ? "macOS" : "Linux";

describe("시험 환경 — 지금 어디서 재고 있나", () => {
  it("환경을 판별한다 — 「모른다」로 두면 이 시험이 헛돌고 있다", () => {
    expect(["Windows 호스트", "WSL", "macOS", "Linux"]).toContain(환경);
  });

  it(`★ 지금 환경: ${환경}`, () => {
    // 이 시험은 **항상 통과한다.** 목적은 판정이 아니라 **기록**이다 —
    // 시험 결과를 읽는 사람이 "어디서 잰 숫자인가"를 알 수 있어야 한다.
    if (환경 === "Windows 호스트") {
      console.warn(
        [
          "",
          "⚠ 서버 시험을 **Windows 호스트**에서 돌리고 있습니다 — 제품은 WSL에서 돕니다.",
          "  여기서는 원리상 못 잡는 것들이 있습니다:",
          "    · 운영에 파이썬 의존이 설치돼 있는가 (Windows의 python3은 0바이트 껍데기)",
          "    · 운영 환경에서만 나는 경로·권한 문제",
          "  그리고 느립니다 — 실측 한 파일 14분(전체는 못 끝냄) ↔ WSL 전체 2,979개 27초.",
          "",
          "  → 서버 시험은 이렇게 돌리세요:",
          '     wsl -d Ubuntu-24.04 -- bash "/mnt/d/Connect AI/tools/wsl-test.sh"',
          "",
        ].join("\n"),
      );
    }
    expect(환경).toBeTruthy();
  });

  it("★★ 환경 규칙이 문서에 살아 있다 — 기계와 문서가 어긋나면 사람이 문서를 믿는다", () => {
    // 이 시험이 있어도 CLAUDE.md에서 규칙이 사라지면 다음 사람은 규칙을 모른다.
    const md = fs.readFileSync(new URL("../../CLAUDE.md", import.meta.url), "utf8");
    expect(md, "CLAUDE.md에 환경별 역할 표가 있어야 한다").toContain("환경별 역할");
    expect(md, "서버 시험은 WSL이라는 규칙").toMatch(/서버 시험.*WSL|WSL.*wsl-test\.sh/s);
  });

  it("WSL 시험 도구가 실제로 있다 — 안내만 하고 도구가 없으면 죽은 안내다", () => {
    const p = new URL("../../tools/wsl-test.sh", import.meta.url);
    expect(fs.existsSync(p), "tools/wsl-test.sh").toBe(true);
    const src = fs.readFileSync(p, "utf8");
    // 운영을 건드리지 않는다는 계약 — 이게 깨지면 시험이 운영 DB를 망칠 수 있다.
    expect(src, "운영이 아닌 사본에서 돈다").toContain("gijo-as-test");
    expect(src, "못 도는 시험을 끝에 알린다").toContain("SKIP_NOTE");
  });

  it("참고 — 이 기계 정보(실패 판정 아님, 기록용)", () => {
    console.info(`  플랫폼=${process.platform} · node=${process.version} · cpu=${os.cpus().length}코어`);
    expect(true).toBe(true);
  });
});
