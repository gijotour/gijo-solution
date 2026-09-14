// 계획서: 중-7 + 전-4 — 계약·생애주기 라우팅(FORCED_INTENTS[93] lifecycle_status · [94] set_lifecycle)
//
// ■ 판정은 제품 함수로만 한다 — 결정적도착지(dispatcher.ts)를 그대로 부른다(정규식을 떼어
//   혼자 재면 앞 규칙이 가로채는 것을 못 본다, helpers/routing.ts 머리글과 같은 원칙).
//
// ■ ★★ 이 시험이 새로 찾은 것(2026-09-14, route-explain --no-build 실측) — 지시서가 준
//   기대값 중 **둘이 틀렸다**. 지어내지 않고 실측대로 적는다(CLAUDE.md "실환경 검증" 원칙):
//   ① "FW-01 EOL 2026-12-31로 기록해줘"는 set_lifecycle이 **아니라 eol_check**로 간다 —
//     eol_check 정규식 `/(EOL|EOS)\b|.../i`이 배열에서 **먼저** 나오고 "EOL"이라는 낱말 하나로
//     걸려, 뒤(배열 끝, [94])의 set_lifecycle은 원리상 못 이긴다. "지원 종료일 …기록해줘"로
//     바꿔도 마찬가지다(eol_check가 "지원\s*종료"도 잡는다) — "EOL/지원종료" 계열 낱말로는
//     set_lifecycle에 쓰기 지시를 못 보낸다는 뜻이다(구조적 함정, 이 라운드 범위 밖의 되돌려보낼
//     조건 ② "eol_check 정규식을 넓혀야 할 것 같으면 멈춘다"에 해당 — eol_check를 안 건드렸다).
//     실사용 우회로: "FW-01 EOS 2026-12-31로 기록해줘"도 같은 이유로 안 되고, 이 계열은
//     "계약 만료일 2027-01-01로 기록해줘"처럼 "계약/구독/유지보수" 낱말로 표현해야 한다.
//   ② "EOL이 뭐야?"는 ⑨(모델 선택)가 **아니라 eol_check**로 간다 — agentloop.ts:2014
//     `/(EOL|EOS)\b/`의 `\b`가 "EOL"과 "이" 사이(영문자→한글)에서도 성립해 "EOL이"에 걸린다.
//     지시서의 "EOL이 뭐야?" → ⑨ 예상은 이 사실을 몰랐다. 아래 표는 실측대로 eol_check로 적는다.
import { describe, it, expect } from "vitest";
import { 결정적도착지 } from "../src/engine/dispatcher";
import { 쓰기흐름인가 } from "../src/engine/writeflow";

async function 도착(문장: string): Promise<string | null> {
  const 걸림 = await 결정적도착지(문장, { 역할: "admin" });
  return 걸림[0]?.도착 ?? null;
}

describe("계약·생애주기 라우팅 — FORCED_INTENTS[93] lifecycle_status · [94] set_lifecycle", () => {
  // 헛돌기 방지 — 이 줄이 먼저 초록이어야 나머지가 뜻이 있다.
  it("헛돌기 방지 — 「만료 임박 계약 알려줘」의 첫 걸림이 lifecycle_status다", async () => {
    expect(await 도착("만료 임박 계약 알려줘")).toBe("lifecycle_status");
  });

  describe("양성 18 — lifecycle_status(조회)", () => {
    const 문장들 = [
      "만료 임박 계약 알려줘", "계약 만료 임박한 거 있어?", "구독 만료 언제야?", "라이선스 현황 알려줘",
      "협력사 연락처 알려줘", "계약 현황 알려줘", "만료 임박 알려줘", "만료 임박한 계약 목록 보여줘",
      "구독 끝나는 거 있어?", "라이선스 만료 임박한 거 알려줘", "공급업체 담당자 알려줘", "계약 목록 보여줘",
      "구독 현황 보여줘", "만료된 계약 있어?", "협력사 계약 현황 알려줘", "라이선스 종료일 알려줘",
      "계약 만료 언제야?", "만료 임박 계약 현황 보여줘",
    ];
    for (const 문장 of 문장들) {
      it(`「${문장}」 → lifecycle_status`, async () => expect(await 도착(문장)).toBe("lifecycle_status"));
    }
  });

  describe("양성 5 — set_lifecycle(등록)", () => {
    // ⚠ "FW-01 EOL 2026-12-31로 기록해줘"는 여기 없다 — 위 머리글 ①의 실측대로 eol_check로 간다
    //   (별도 it로 그 사실을 못박는다, 아래 "EOL·EOS 계열은 eol_check에 막힌다" 참고).
    const 문장들 = [
      "FW-01 유지보수 2027-03-31까지 등록해줘",
      "웹서버-01 유지보수 2027-03-31까지 등록해줘",
      "FW-01 협력사 SECUI 담당자 010-1234-5678로 등록해줘",
      "FW-01 구독 종료일 2027-03-31로 설정해줘",
      "계약 만료일 2027-01-01로 기록해줘",
    ];
    for (const 문장 of 문장들) {
      it(`「${문장}」 → set_lifecycle`, async () => expect(await 도착(문장)).toBe("set_lifecycle"));
    }
  });

  it("★★ 실측 정정 ① — 'FW-01 EOL 2026-12-31로 기록해줘'는 set_lifecycle이 아니라 eol_check로 간다(구조적 함정, 이 라운드에서 안 고침)", async () => {
    expect(await 도착("FW-01 EOL 2026-12-31로 기록해줘")).toBe("eol_check");
  });

  describe("음성 — 다른 영토가 이긴다(오늘 실측 도착 그대로)", () => {
    const 표: [string, string | null][] = [
      // 데이터 vs 지식 6
      ["구독 라이선스랑 영구 라이선스 차이 알려줘", "explain"],
      ["라이선스가 뭐야?", null],
      ["계약이 뭐야?", null],
      ["오픈소스 라이선스 뭐가 문제야?", null],
      // ★★ 실측 정정 ② — 지시서는 ⑨을 예상했지만 실제로는 eol_check다(위 머리글 참고).
      ["EOL이 뭐야?", "eol_check"],
      ["라이선스 종류 설명해줘", null],
      // 조건어 3
      ["고위험 자산 계약 만료 알려줘", "list_assets"],
      ["만료 임박한 취약점 알려줘", null],
      ["SSL 인증서 만료 임박 취약점 알려줘", null],
      // 어미·남의 영토 8
      ["유지보수 계약 만료 알려줘", "maintenance_status"],
      ["유지보수 계약 현황 알려줘", "maintenance_status"],
      ["유지보수 종료일 알려줘", "maintenance_status"],
      ["지식 번들 구독 현황 알려줘", "knowledge_bundle_status"],
      ["계약서 어디 있어?", null],
      ["비밀번호 만료 정책 알려줘", "explain"],
      ["라이선스 위험 알려줘", null],
      ["모델 라이선스 알려줘", null],
      // eol_check 영토 3 + 반례 1(blocker ① 증거 — 오늘도 신설 뒤에도 ⑨다)
      ["지원 끝난 장비 있어?", "eol_check"],
      ["지원 종료된 장비 있어?", "eol_check"],
      ["EOL 확인해줘", "eol_check"],
      ["지원 끝나는 장비 있어?", null],
      // 쓰기 음성 5
      ["라이선스 문서 등록해줘", null],
      ["계약서 파일 등록해줘", null],
      ["점검 일정 등록해줘", null],
      ["보안제품 등록해줘", null],
      ["계약 등록 어떻게 해?", null],
    ];
    for (const [문장, 기대] of 표) {
      it(`「${문장}」 → ${기대 ?? "⑨(모델 선택)"} · lifecycle_status·set_lifecycle 아님`, async () => {
        const 결과 = await 도착(문장);
        expect(결과, `실제 도착: ${결과}`).not.toBe("lifecycle_status");
        expect(결과, `실제 도착: ${결과}`).not.toBe("set_lifecycle");
        expect(결과, `실제 도착: ${결과}`).toBe(기대);
      });
    }
  });

  describe("쓰기 흐름 결합 3 — lifecycle_status가 배정·승인을 삼키지 않는다(조회로못박지않을것 Set)", () => {
    const 문장들 = [
      "만료 임박 계약 알려주고 김보안한테 배정해줘",
      "계약 현황 알려주고 승인해줘",
      "라이선스 현황 알려주고 담당자 정해줘",
    ];
    for (const 문장 of 문장들) {
      it(`「${문장}」 — 쓰기흐름인가()=true 이고 lifecycle_status가 아니다(⑨로 넘어가 배정까지 처리)`, async () => {
        expect(쓰기흐름인가(문장)).toBe(true);
        const 결과 = await 도착(문장);
        expect(결과, `실제 도착: ${결과}`).not.toBe("lifecycle_status");
      });
    }
  });
});
