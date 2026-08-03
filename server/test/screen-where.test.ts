// 「○○은 어디서 해?」 — 우리 화면 이름으로 자리를 찾는다.
//
// ★ 출처(실전 147상황, 2026-08-03): 「설정은 어디서 해?」에 32초를 쓰고
//   **"설정은 Tenable Security Center의 인터페이스에서 이루어집니다"**라고 답했다.
//   우리 제품 설정을 물었는데 **남의 제품 매뉴얼**을 읽어 준 것이다.
//   화면 이름을 알아보는 길이 없어 RAG로 샜고, RAG에는 벤더 문서가 있으니 거기서 지어냈다.
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/engine/llm", () => ({
  chat: vi.fn(async () => "[mock]"),
  embed: vi.fn(async (t: string[]) => t.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
}));

import { 이름으로화면찾기, 화면위치안내 } from "../src/engine/screenguide";

describe("이름으로화면찾기 — 자리를 물을 때만, 우리 이름으로만", () => {
  it("★ 「설정은 어디서 해?」가 우리 설정 화면을 찾는다", () => {
    const r = 이름으로화면찾기("설정은 어디서 해?");
    expect(r, "못 찾으면 RAG로 새어 벤더 매뉴얼을 읽는다").not.toBeNull();
    expect(r!.screen).toBe("settings.html");
  });

  it("여러 말로 물어도 찾는다 — 담당자는 한 가지로만 말하지 않는다", () => {
    for (const q of ["리포트 어디 있어?", "자산 목록 어느 메뉴야?", "조치·승인 어떻게 가?", "보고서 보려면 어디로?"]) {
      expect(이름으로화면찾기(q), `「${q}」를 못 찾는다`).not.toBeNull();
    }
  });

  it("★ 긴 이름이 이긴다 — 「보안 KPI」가 「KPI」로 잘리면 엉뚱한 화면이 열린다", () => {
    expect(이름으로화면찾기("보안 KPI 어디서 봐?")!.screen).toBe("kpi.html");
  });

  it("⚠ 자리를 묻는 말이 아니면 안 걸린다 — 「설정 바꿔줘」는 길찾기가 아니다", () => {
    expect(이름으로화면찾기("설정 바꿔줘")).toBeNull();
    expect(이름으로화면찾기("리포트 만들어줘")).toBeNull();
  });

  it("⚠ 우리 화면 이름이 없으면 안 걸린다 — 아무 말에나 화면을 열지 않는다", () => {
    expect(이름으로화면찾기("Tenable은 어디서 사?")).toBeNull();
    expect(이름으로화면찾기("그건 어디 있어?")).toBeNull();
  });
});

describe("화면위치안내 — 어디에 있는지와 거기서 하는 일을 함께", () => {
  it("사이드바 위치·설명·할 수 있는 일을 담는다", () => {
    const 글 = 화면위치안내("settings.html", "설정");
    expect(글).toContain("설정");
    expect(글, "어디에 있는지를 말해야 길찾기다").toMatch(/사이드바/);
    expect(글.length, "한 줄로 끝내면 안내가 아니다").toBeGreaterThan(40);
  });

  it("★ 우리 기능이 **남의 제품 안에 있다**고 말하지 않는다", () => {
    // ⚠ 처음엔 "벤더 이름이 아예 없어야 한다"로 썼다가 이 시험이 나를 되돌렸다.
    //   취약점 화면 안내의 "Tenable Nessus 등의 스캔 결과(.nessus/CSV)를 올리면…"은
    //   **맞는 말**이다 — 어떤 파일을 받는지 알려 준다. 결함은 이름이 나온 것이 아니라
    //   「설정은 Tenable Security Center의 인터페이스에서 이루어집니다」처럼
    //   **우리 화면이 남의 제품 안에 있다**고 말한 것이었다. 그 모양만 막는다.
    const 남의것안에 = /(Tenable|Qualys|Rapid7|Splunk)[^.\n]{0,20}(에서\s*(이루어|합니다|설정|관리)|의\s*(인터페이스|화면|메뉴|콘솔))/i;
    for (const s of ["settings.html", "report.html", "inventory.html", "vulnscan.html", "kpi.html"]) {
      expect(화면위치안내(s, "아무개"), `${s} 안내가 우리 기능을 남의 제품 안이라고 말한다`).not.toMatch(남의것안에);
    }
  });
});
