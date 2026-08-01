// 읽기 편함 — 약속과 코드가 어긋나지 않는지 지킨다 (2026-08-02).
//
// 왜 이 시험이 필요한가
//   ① 설정 화면이 "⌘/Ctrl + · − · 0(기본값)으로도 바꿀 수 있다"고 **안내만 하고** 실제로는
//      아무 데도 단축키를 걸지 않은 채 오래 있었다. 화면 글과 코드가 갈라진 자리는 눈으로 못 찾는다.
//   ② 기본 배율을 올릴 때 설정 화면의 「기본」 딱지가 옛 값에 그대로 붙어 있었다.
//   ③ 안내 글씨가 8.5~11.5px까지 내려가 "거의 안 보인다"는 지적을 받았다(2026-08-02).
// 동작 QA는 이런 어긋남을 잡지 못한다 — 화면은 멀쩡히 그려지기 때문이다.
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const 클라 = path.resolve(__dirname, "..", "..", "client", "src");
const 화면들 = path.join(클라, "renderer", "pages");
const main = fs.readFileSync(path.join(클라, "main.ts"), "utf-8");
const settings = fs.readFileSync(path.join(화면들, "settings.html"), "utf-8");

function 기본배율(): number {
  const m = main.match(/const ZOOM_DEFAULT = ([\d.]+)/);
  expect(m, "main.ts에 ZOOM_DEFAULT가 있어야 한다").toBeTruthy();
  return Number(m![1]);
}
function 프리셋(): number[] {
  const m = main.match(/const ZOOM_STEPS = \[([^\]]+)\]/);
  return m![1].split(",").map((s) => Number(s.trim()));
}

describe("화면 배율 — 말과 코드 맞추기", () => {
  it("기본 배율은 프리셋 안의 값이다", () => {
    // 설정 화면은 프리셋만 그린다 — 기본이 프리셋 밖이면 어느 칸도 선택돼 보이지 않는다.
    expect(프리셋()).toContain(기본배율());
  });

  it("기본 배율은 100%보다 크다 — 글씨가 작다는 지적의 처방이다", () => {
    expect(기본배율()).toBeGreaterThan(1);
  });

  it("설정 화면의 「기본」 딱지는 메인 프로세스가 알려 준 값에 붙는다", () => {
    // 이름표에 "기본"을 박아 두면 기본값이 바뀔 때마다 어긋난다. 딱지는 state.default로 붙인다.
    expect(main).toMatch(/ipcMain\.handle\("ui:getZoom".*default: ZOOM_DEFAULT/s);
    expect(settings).toMatch(/기본배율\s*=\s*Number\(state && state\.default\)/);
    const 이름표 = settings.match(/const ZOOM_NAME = \{([^}]*)\}/)![1];
    expect(이름표, "이름표에는 크기만 적는다 — 「기본」은 코드가 붙인다").not.toContain("기본");
  });

  it("안내한 단축키(＋ · − · 0)가 실제로 걸려 있다", () => {
    expect(settings, "설정 화면이 단축키를 안내한다").toMatch(/Ctrl \+.*0.*기본값/s);
    expect(main).toContain("before-input-event");
    expect(main, "0은 기본 배율로 되돌린다").toMatch(/k === "0"[\s\S]{0,80}화면크기적용\(ZOOM_DEFAULT\)/);
    expect(main, "＋는 한 칸 키운다").toMatch(/k === "\+"[\s\S]{0,120}화면크기한칸\(1\)/);
    expect(main, "−는 한 칸 줄인다").toMatch(/k === "-"[\s\S]{0,120}화면크기한칸\(-1\)/);
  });

  it("기본 배율을 바꾸면 저장 파일 이름도 함께 바뀌어 있다", () => {
    // 옛 저장값이 새 기본을 덮어써 "올렸는데 그대로 작다"가 됐던 사고(2026-08-02).
    expect(main).toMatch(/ui-zoom\d+\.txt/);
  });
});

describe("글자 크기 — 안내 글씨가 너무 작지 않다", () => {
  const 파일들 = fs.readdirSync(화면들).filter((f) => /\.(html|js|css)$/.test(f));

  it("11px보다 작은 글자는 없다", () => {
    const 걸린것: string[] = [];
    for (const f of 파일들) {
      const t = fs.readFileSync(path.join(화면들, f), "utf-8");
      for (const m of t.matchAll(/font-size\s*:\s*([\d.]+)px/g)) {
        if (Number(m[1]) < 11) 걸린것.push(`${f} ${m[1]}px`);
      }
    }
    expect(걸린것, `안내 글씨가 11px 미만이면 배율을 올려도 안 보인다:\n${걸린것.join("\n")}`).toEqual([]);
  });
});

describe("바탕·글자 색 — 눈부심과 대비", () => {
  function 밝기(hex: string): number {
    const n = hex.replace("#", "");
    const c = [0, 2, 4].map((i) => {
      const s = parseInt(n.slice(i, i + 2), 16) / 255;
      return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  const 대비 = (a: string, b: string) => {
    const x = 밝기(a) + 0.05, y = 밝기(b) + 0.05;
    return Math.max(x, y) / Math.min(x, y);
  };
  const 색 = (t: string, 이름: string) => t.match(new RegExp(`--${이름}\\s*:\\s*(#[0-9a-fA-F]{6})`))?.[1];

  it("본문 대비는 읽기 기준(4.5) 위, 번짐 구간(15) 아래다", () => {
    const t = fs.readFileSync(path.join(화면들, "audit.html"), "utf-8");
    const bg = 색(t, "bg")!, tx = 색(t, "text")!;
    const c = 대비(bg, tx);
    expect(c).toBeGreaterThan(4.5);
    expect(c, "어두운 바탕에서 15:1을 넘으면 글자가 번져 보인다(할레이션)").toBeLessThan(15);
  });

  it("안내 글씨(muted-2)도 읽기 최소 기준을 넘는다", () => {
    const t = fs.readFileSync(path.join(화면들, "audit.html"), "utf-8");
    expect(대비(색(t, "bg")!, 색(t, "muted-2")!)).toBeGreaterThan(4.5);
  });

  it("모든 화면이 같은 바탕색을 쓴다", () => {
    const 바탕 = new Set<string>();
    for (const f of fs.readdirSync(화면들).filter((x) => x.endsWith(".html"))) {
      const c = 색(fs.readFileSync(path.join(화면들, f), "utf-8"), "bg");
      if (c) 바탕.add(c.toLowerCase());
    }
    expect([...바탕], "화면마다 바탕색이 다르면 탭을 옮길 때 눈이 다시 적응해야 한다").toHaveLength(1);
  });
});
