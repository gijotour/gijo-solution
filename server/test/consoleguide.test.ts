// 대화창 조작 안내 (계획서 전-7, 2026-08-09) — 만든 기능을 안내에 싣는다.
//
// 왜: 📌 선택 칩·🧭 해석 한 줄·흐르는 답을 만들어 놓고 안내에 안 실으면 담당자는 **그런 기능이
// 있는 줄도 모른다**. 원칙(설명은 전부 챗봇으로)대로 화면이 아니라 screenguide에 싣는다.
//
// ⚠ 함께 지키는 것: 안내가 '"선택 칩" 사용법 알려줘'라고 **적어 놓은 이름은 실제로 답해야 한다** —
//   적어 놓고 못 찾으면 그게 「안내한 말 점검」이 잡던 어긋남이다.
import { describe, it, expect } from "vitest";
import { formatScreenGuide, screenTips } from "../src/engine/screenguide";

const 안내 = (q: string, screen?: string) => formatScreenGuide(screen, q);

describe("대화창 조작이 안내에 실려 있다", () => {
  it("전체 안내에 새 조작 4종이 구역으로 있다", () => {
    const g = 안내("이 화면에서 뭐 할 수 있어?");
    for (const 이름 of ["선택 칩", "해석 한 줄", "화면 맥락 떼기", "답이 흐르는 것"]) {
      expect(g, `${이름}이 안내에 없다`).toContain(이름);
    }
  });

  it("★ 안내가 적어 놓은 구역 이름은 실제로 답한다 — 적어 놓고 못 찾으면 거짓 안내다", () => {
    const 목록 = 안내("이 화면에서 뭐 할 수 있어?");
    // ⚠ 「구역별 상세」 줄만 본다 — 전체에서 따옴표를 긁으면 예시 질문("오늘 뭐부터 볼까?")까지
    //   구역 이름으로 오해한다(2026-08-09 이 시험을 쓰다 그 함정에 한 번 빠졌다).
    const 상세줄 = 목록.split("\n").find((l) => l.startsWith("구역별 상세:")) ?? "";
    const 이름들 = [...상세줄.matchAll(/"([^"]+)"/g)].map((m) => m[1]).filter((n) => !n.includes("사용법"));
    expect(이름들.length, "구역별 상세 줄이 없다").toBeGreaterThan(0);
    for (const 이름 of 이름들) {
      const 답 = 안내(`${이름} 사용법 알려줘`);
      expect(답, `「${이름}」을 안내에 적어 놓고 답하지 못한다`).not.toContain("이 화면 사용 안내");
      expect(답).not.toContain("undefined");
    }
  });

  it("담당자가 부르는 말로도 찾는다 — 사람은 정식 이름으로 말하지 않는다", () => {
    expect(안내("📌 이거 뭐야?")).toContain("선택 칩");
    expect(안내("칩 어떻게 떼?"), "선택칩 별명").toContain("선택 칩");
    expect(안내("스트리밍이 뭐야?")).toContain("답이 흐르는 것");
    expect(안내("🧭 무슨 뜻이야?")).toContain("해석 한 줄");
  });

  it("★★ 다른 화면에서 물어도 같은 답 — 대화창 조작은 어느 화면에서나 같다", () => {
    // 화면별 안내에 사본을 두면 화면 수만큼 어긋난다. 공통 한 벌을 어디서든 찾는 것이 계약.
    const a = 안내("선택 칩 사용법 알려줘", "vulnscan.html");
    const b = 안내("선택 칩 사용법 알려줘", "inventory.html");
    expect(a).toContain("다루는 중"); // 2026-08-20 맥락 문장 개편 — 📌 칩은 폐지, 문장이 싣는다
    expect(a).toBe(b);
  });

  it("화면 고유 구역이 공통에 가려지지 않는다 — 화면 것이 먼저다", () => {
    const 대시 = 안내("오늘 할 일 사용법 알려줘", "dashboard.html");
    expect(대시).toContain("오늘 할 일");
    expect(대시).not.toContain("📌 이름");
  });
});

describe("알아두기(팁 줄)에도 실린다 — 어느 화면에서나 눈에 띈다", () => {
  it("새 조작 3종이 규칙 줄에 있다", () => {
    const { rules } = screenTips("vulnscan.html");
    const 전부 = rules.join("\n");
    expect(전부).toContain("📌");
    expect(전부).toContain("🧭");
    expect(전부).toMatch(/흐르|흘러/);
  });

  // ★★ 규칙이 **실제로 나가는 출구**를 지킨다(2026-08-19). 상수(PRODUCT_RULES)만 검사하던
  //    시험은 소비자(대시보드 팁 줄)가 07-28 개편에서 지워져도 초록이었다 — 11줄이 20일 넘게
  //    어느 화면에도 안 떴다. 살아 있는 출구는 챗봇 「이 화면 사용법」 답이다.
  it("★★ 화면 사용법 답에 알아두기 규칙이 실린다 — 상수가 아니라 출구를 검사한다", () => {
    const 답 = 안내("이 화면 사용법 알려줘", "vulnscan.html");
    expect(답).toContain("📋 알아두기");
    // 대표 규칙 셋 — 승인 창·근거 배지·기본 사내 처리(조건부 문구로 정정된 판).
    expect(답).toContain("승인 창");
    expect(답).toContain("근거");
    expect(답, "「무조건 안 나간다」는 클라우드 답변선을 켠 배치에서 거짓 — 조건부 문구여야 한다").toContain("기본적으로 사내에서만");
    // 규칙은 하나도 빼지 않는다(2026-07-26 사용자 지시) — 개수로 잠근다.
    const { rules } = screenTips();
    for (const r of rules) expect(답, `규칙이 빠졌다: ${r.slice(0, 30)}…`).toContain(r.slice(0, 24));
  });
});
