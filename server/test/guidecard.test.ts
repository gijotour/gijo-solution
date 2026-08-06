// 「이렇게 쓰면 됩니다」 — **약속과 실제가 어긋나지 않는지**를 소스에서 확인한다.
//
// 2026-08-06 사용자 지시로 대시보드 카드가 **문서함 매뉴얼**(GIJO_AS_이렇게_쓰면_됩니다.md)로
// 이관됐다. 이 시험도 카드가 아니라 문서를 지키도록 함께 이사했다 — 지키는 계약은 그대로다:
//   ① 문서가 가르치는 대화창 지시문은 **시연 패키지의 실측된 문장**이어야 한다.
//      실측되지 않은 말을 담당자에게 외우게 하면 안 된다(카드 시절부터의 1원칙).
//   ② 문서는 문서함 목록(docs-manifest)에 실제로 등록돼 있어야 한다 — 만들고 안 실으면
//      "문서함에 있습니다"라는 화면 안내(screenguide)가 거짓이 된다.
//   ③ 카드는 대시보드에서 **완전히** 사라졌어야 한다 — 같은 안내가 두 곳이면 한쪽이 낡는다
//      (온보딩 오버레이 → 카드 이관 때 확립된 원칙 그대로).
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const pagesDir = path.join(__dirname, "..", "..", "client", "src", "renderer", "pages");
const repoRoot = path.join(__dirname, "..", "..");
const 문서 = fs.readFileSync(path.join(repoRoot, "GIJO_AS_이렇게_쓰면_됩니다.md"), "utf8");
const dashboard = fs.readFileSync(path.join(pagesDir, "dashboard.html"), "utf8");

// 문서에서 대화창 지시문을 뽑는다 — 「대화창에: **"…"**」 꼴.
const asks = [...문서.matchAll(/\*\*"([^"]+)"\*\*/g)].map((m) => m[1]);

describe("이렇게 쓰면 됩니다 (문서함 매뉴얼)", () => {
  it("4가지 상황이 전부 있고, 대화창 지시문이 8개 이상이다", () => {
    for (const 상황 of ["오늘 뭐부터 할지 정하기", "담당자 인수인계 남기기", "이거 해도 되는지 확인하기", "보고서 만들기"]) {
      expect(문서, `상황 「${상황}」이 문서에서 사라졌다`).toContain(상황);
    }
    expect(asks.length, "대화창 지시문이 줄었다 — 카드 시절 8개가 최소선이다").toBeGreaterThanOrEqual(8);
  });

  it("★ 가르치는 지시문이 시연 패키지의 실측 문장과 같다", () => {
    // 문서가 단일 출처다 — 매뉴얼은 그것을 옮긴 것이어야 한다(카드 시절과 같은 계약).
    const demo = fs.readFileSync(path.join(repoRoot, "GIJO_AS_시연_패키지.md"), "utf8");
    const 없는것 = asks.filter((q) => !demo.includes(q));
    expect(없는것, "매뉴얼이 실측되지 않은 지시문을 가르치고 있다").toEqual([]);
  });

  it("★ 문서함 목록(docs-manifest)에 등록돼 있다 — 안 실으면 화면 안내가 거짓이 된다", () => {
    const m = JSON.parse(fs.readFileSync(path.join(repoRoot, "server", "docs-manifest.json"), "utf8"));
    expect(m.files.some((f: { file: string }) => f.file === "GIJO_AS_이렇게_쓰면_됩니다.md")).toBe(true);
  });

  it("★ 카드는 대시보드에서 완전히 사라졌다 — 같은 안내가 두 곳이면 한쪽이 낡는다", () => {
    for (const 잔재 of ["var SCENARIOS", "guideCard", "renderGuide", "GUIDE_KEY", "gijo:guide"]) {
      expect(dashboard, `카드 잔재가 남아 있다: ${잔재}`).not.toContain(잔재);
    }
  });

  it("화면 안내(screenguide)가 문서함으로 안내한다 — 없는 카드를 누르라고 하지 않는다", () => {
    const sg = fs.readFileSync(path.join(repoRoot, "server", "src", "engine", "screenguide.ts"), "utf8");
    const i = sg.indexOf('"이렇게 쓰면 됩니다":');
    expect(i, "화면 안내에서 항목이 통째로 사라졌다 — 안내 없이 지우면 못 찾는다").toBeGreaterThan(0);
    const 본문 = sg.slice(i, i + 600);
    expect(본문).toContain("문서함");
    expect(본문, "화면에 없는 [물어보기] 버튼을 안내하면 담당자가 없는 것을 찾는다").not.toContain("[물어보기]");
  });

  it("온보딩 오버레이는 여전히 없다 — 이관의 이관까지 거슬러 확인", () => {
    expect(fs.existsSync(path.join(pagesDir, "onboarding.js"))).toBe(false);
    expect(dashboard).not.toContain("gijoObSlot");
  });
});
