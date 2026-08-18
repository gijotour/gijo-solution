// 「보는목록」 표식이 **판단하는 관문들을 오염시키지 않는지** 동작으로 본다.
//
// ⚠ 검토관이 찾은 실결함 (2026-08-18):
//   `#고른건`은 dispatcher가 곧바로 결재판으로 빠져나가 LLM을 안 탄다. 그런데 `#보는목록`은
//   그 화면에서 보내는 **모든 말**에 붙고 빠져나가는 자리가 없어, **글자를 보고 판단하는
//   관문을 전부 통과**했다:
//     · isTooVague — "?" 뒤에 표식 1,300여 자(50 × 자산::sha1)가 붙으면 「두 글자 이하」가
//       거짓이 되어 **되묻기가 안 뜬다**. 뜻 모를 입력이 그대로 LLM으로 간다.
//     · 한낱말되묻기 — 정규식이 `^취약점$`라 "취약점\n#보는목록 …"이면 **안 맞는다.**
//       34초 헤매던 그 경로로 되돌아간다(2026-08-01 실측).
//
// ⚠ 이 시험이 왜 「글자 대조」가 아니라 **함수를 직접 부르는가**: 같은 검토에서
//   viewcontract.test.ts가 소스 문자열만 대조하다가 **배관이 죽은 것을 못 잡은** 일이 있었다.
//   「그 줄이 있는가」와 「그래서 되는가」는 다른 질문이다. 여기서는 뒤쪽을 묻는다.
import { describe, it, expect } from "vitest";
import { isTooVague, 한낱말되묻기 } from "../src/engine/scopeguard";
import { parseViewIds, stripViewMark, stripPickMarks, VIEW_MARK, PICK_MARK, VIEW_MAX } from "../src/engine/picklist";

/** 실제로 붙는 모양 그대로 만든다 — 자산::sha1 16자 × N건. */
function 표식달기(말: string, 건수 = VIEW_MAX): string {
  const ids = Array.from({ length: 건수 }, (_, i) => `asset-${i}::${"a1b2c3d4e5f60718".slice(0, 16)}${i}`);
  return `${말}\n${VIEW_MARK} ${ids.join(",")}`;
}

describe("보는목록 표식이 관문을 오염시키지 않는다", () => {
  it("표식이 진짜로 길다 — 이 시험의 전제 확인", () => {
    // 헛돎 방지: 표식이 짧으면 아래 검사들이 우연히 통과할 수 있다.
    const 붙은글 = 표식달기("?");
    expect(붙은글.length, "표식이 예상보다 짧다 — 시험 전제가 깨졌다").toBeGreaterThan(1000);
  });

  it("떼어 내면 원래 말만 남는다", () => {
    expect(stripViewMark(표식달기("취약점"))).toBe("취약점");
    expect(stripViewMark(표식달기("?"))).toBe("?");
    expect(stripViewMark("표식 없는 말"), "표식이 없으면 그대로").toBe("표식 없는 말");
  });

  it("★ 뗀 뒤에는 모호 판정이 살아난다 — 안 떼면 되묻기가 사라진다", () => {
    for (const 말 of ["?", "ㅁ", "1", "  ", "."]) {
      expect(isTooVague(말), `"${말}"은 원래 모호해야 한다`).toBe(true);
      // 표식이 붙은 채로는 모호하지 않다고 판정된다 — 이것이 결함의 모습이다.
      expect(isTooVague(표식달기(말)), `"${말}"에 표식이 붙으면 모호 판정이 죽는다(그래서 떼는 것)`).toBe(false);
      // 떼면 되살아난다.
      expect(isTooVague(stripViewMark(표식달기(말))), `"${말}"을 떼고 나면 다시 모호해야 한다`).toBe(true);
    }
  });

  it("★ 뗀 뒤에는 한 낱말 되묻기가 살아난다", () => {
    for (const 말 of ["취약점", "자산", "점검", "오늘", "리포트", "방화벽"]) {
      expect(한낱말되묻기(말), `"${말}"은 원래 되묻기가 떠야 한다`).toBeTruthy();
      expect(한낱말되묻기(표식달기(말)), `"${말}"에 표식이 붙으면 되묻기가 죽는다(그래서 떼는 것)`).toBeNull();
      expect(한낱말되묻기(stripViewMark(표식달기(말))), `"${말}"을 떼면 다시 되물어야 한다`).toBeTruthy();
    }
  });

  it("떼어 내도 값은 잃지 않는다 — 떼기 전에 읽어 두면 된다", () => {
    const 붙은글 = 표식달기("이것들 전부 정요한한테 배정해줘", 3);
    const 값 = parseViewIds(붙은글);
    expect(값.split(",").length, "3건을 읽어야 한다").toBe(3);
    expect(stripViewMark(붙은글)).toBe("이것들 전부 정요한한테 배정해줘");
  });

  it("체크한 건(#고른건) 표식은 건드리지 않는다 — 그건 다른 길로 간다", () => {
    // ⚠ stripViewMark가 #고른건까지 떼면 parsePickCommand가 못 읽어 **결재판이 안 뜬다.**
    const 섞인글 = `고른 2건을 배정\n${PICK_MARK} a::1,b::2\n#조치 assign\n#값 정요한\n${VIEW_MARK} c::3`;
    const 결과 = stripViewMark(섞인글);
    expect(결과, "#고른건이 사라졌다 — 결재판이 안 뜨게 된다").toContain(PICK_MARK);
    expect(결과, "#조치가 사라졌다").toContain("#조치");
    expect(결과, "#보는목록은 떨어져야 한다").not.toContain(VIEW_MARK);
  });

  it("기록에는 두 표식 다 안 남는다 — 대화 내역이 지문 범벅이 되면 안 된다", () => {
    const 섞인글 = `고른 2건을 배정\n${PICK_MARK} a::1\n#조치 assign\n#값 정요한\n${VIEW_MARK} c::3`;
    const 기록 = stripPickMarks(섞인글);
    expect(기록).toBe("고른 2건을 배정");
  });
});
