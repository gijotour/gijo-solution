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

  it("창 껍데기(OS 창 버튼 자리) 색이 상단 바와 같다", () => {
    // ⚠ 이 색은 CSS가 아니라 main.ts가 정한다 — 화면 팔레트를 바꿔도 여기가 남으면
    //   오른쪽 창 버튼 자리만 딴 색으로 떠서 "상단 바가 창 밖으로 삐져나온" 것처럼 보인다
    //   (2026-08-02 사용자 지적). 팔레트를 바꾸는 사람이 여기를 잊지 않도록 시험으로 묶는다.
    const overlay = main.match(/titleBarOverlay:\s*\{\s*color:\s*"(#[0-9a-fA-F]{6})"/)?.[1];
    const 상단바색 = 색(fs.readFileSync(path.join(화면들, "app.html"), "utf-8"), "panel-2");
    expect(overlay?.toLowerCase()).toBe(상단바색?.toLowerCase());
    // 창 바탕색도 화면 바탕과 같아야 한다 — 뜨는 순간 잠깐 다른 색이 번쩍인다.
    const 창바탕 = main.match(/backgroundColor:\s*"(#[0-9a-fA-F]{6})"/)?.[1];
    expect(창바탕?.toLowerCase()).toBe(색(fs.readFileSync(path.join(화면들, "app.html"), "utf-8"), "bg")?.toLowerCase());
  });

  it("확대·축소 단축키는 메인 프로세스 한 곳에서만 건다", () => {
    // ⚠ 화면(nav.js)에도 같은 단축키가 걸려 있었다. 두 곳이 같은 일을 하면 반드시 어긋난다 —
    //   실제로 화면 쪽 코드가 `setUiZoom(0)`을 불러 **기본으로 되돌리는 대신 최소값(80%)으로**
    //   떨어뜨렸다(2026-08-02). 거는 자리는 main.ts 하나뿐이어야 한다.
    // 주석은 뺀다 — "왜 없앴는지" 설명하는 글에 함수 이름이 들어 있어 잡히면 안 된다.
    const nav = fs
      .readFileSync(path.join(화면들, "nav.js"), "utf-8")
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join("\n");
    expect(nav, "화면에서 배율을 직접 건드리면 안 된다").not.toMatch(/stepUiZoom\(/);
    expect(nav, "화면에서 배율을 직접 건드리면 안 된다").not.toMatch(/setUiZoom\(/);
  });

  it("최대화(▢)가 켜져 있다 — 제목 줄 더블클릭이 여기에 달려 있다", () => {
    // ⚠ 하루 안에 두 번 뒤집힌 자리다(2026-08-02): 껐다가 "전체화면이 없어 불편"으로 되살렸다.
    //   maximizable:false면 ▢가 흐려질 뿐 아니라 **제목 줄 더블클릭 최대화까지 막힌다** —
    //   눈으로는 "버튼이 흐리네" 정도로만 보여서 놓치기 쉽다. 시험으로 묶어 둔다.
    expect(main).toMatch(/maximizable:\s*true/);
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
