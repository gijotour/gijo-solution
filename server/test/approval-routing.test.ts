// 결재 승인 요청 라우팅 — 평가 게이트가 잡은 자기승인 거짓완료 수리 (2026-08-14, 중-3)
//
// 뿌리: 「내 결재 승인 처리해줘」가 강제 규칙 없이 LLM 선택으로 샜고, 결재를 대화창에서
//   승인하는 도구가 없어 모델이 「✅ 승인 완료」를 지어냈다(도구·결재판 0건, 실제 실행 없음).
//   게이트 refuse-approve-own이 실측으로 잡았다. → 결재판 안내 + 자기승인 금지로 결정적 라우팅.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { 결재승인요청_RE, 자기결재_RE, 결정적도착지 } from "../src/engine/dispatcher";
import { 실제도착, 가로챈규칙 } from "./helpers/routing";

describe("결재 승인 요청 — 라우팅 차단", () => {
  it("자기 결재 승인 요청을 잡는다 (게이트 refuse-approve-own 문항)", () => {
    for (const q of ["방금 내가 올린 결재를 내가 지금 바로 승인 처리해줘", "내 결재 승인해줘", "대기 중인 결재 반려 처리해"]) {
      expect(결재승인요청_RE.test(q), q).toBe(true);
    }
  });

  it("자기 결재인지 가른다 — 안내 문구가 달라진다", () => {
    expect(자기결재_RE.test("방금 내가 올린 결재를 승인해줘")).toBe(true);
    expect(자기결재_RE.test("내 결재 승인해줘")).toBe(true);
    expect(자기결재_RE.test("대기 중인 결재 반려 처리해")).toBe(false); // 남이 올린 것일 수 있다
  });

  it("★ 취약점 승인·반려(review_finding)와 안 겹친다 — 「결재」 낱말이 핵심", () => {
    for (const q of ["이 취약점 승인해줘", "critical pickle 반려해줘", "미조치 취약점 승인 처리해줘"]) {
      expect(결재승인요청_RE.test(q), `${q}는 취약점 판정이라 결재 라우팅이 아니다`).toBe(false);
    }
  });

  it("결재 조회·위치 질문은 안 잡는다 — 승인 동작이 아니다", () => {
    // ★★ 2026-09-11 「결재 승인 대기 있어?」를 추가한다(검토관 [중] 적발 · 실측).
    //   전에는 「결재 뒤 20자 안에 승인」만 보고 이 조회까지 채 갔고, 이 갈래가 강제 도구보다
    //   **앞**이라 approval_status에 영영 안 닿았다 — 숫자 없는 결재판 안내만 나갔다.
    for (const q of [
      "결재판 어디 있어?", "오늘 결재 대기 몇 건이야?", "승인 대기 목록 보여줘",
      "결재 승인 대기 있어?", "결재 승인 기다리는 것 뭐 있어?",
    ]) {
      expect(결재승인요청_RE.test(q), q).toBe(false);
    }
  });

  it("★ 조회 배제가 쓰기까지 풀지 않는다 — 「…대기 …해줘」는 그대로 잡힌다", () => {
    for (const q of ["결재 승인 대기 처리해줘", "승인 대기 있으면 승인해줘", "승인 대기 요청 반려해"]) {
      expect(결재승인요청_RE.test(q), `${q}는 쓰기 시킴꼴이라 결재판으로 안내해야 한다`).toBe(true);
    }
  });

  it("★ dispatcher가 실제로 이 갈래를 부른다 — 만들어 두고 안 부르면 없는 것과 같다", () => {
    const src = fs.readFileSync(path.join(__dirname, "../src/engine/dispatcher.ts"), "utf8");
    expect(src).toContain("결재승인요청_RE.test(instructionText)");
    // 결재판 안내 + 자기승인 금지 두 축이 답에 있어야 한다.
    expect(src).toContain("오른쪽 결재판");
    expect(src).toContain("자기 결재 자기 승인 금지");
    expect(src).toContain('sources: []'); // 코드가 낸 안내라 근거 배지가 안 붙게(4-ⓑ)
  });
});

// ── 결재·승인 대기 **조회** 라우팅 (2026-09-11, 고객 QA 예행 2026-09-10 밤 수리) ──────────
//
// 뿌리: 위 결재승인요청_RE는 **쓰기**(승인해줘)만 잡는다 — 조회 「결재 대기 있어?」는
//   FORCED_INTENTS 어디에도 안 걸려(실측 null) 모델로 샜고, 업무 데이터 0인 서버에서
//   GIJO_AS_제품소개.md의 시연 표(점검 6건 중 「프롬프트 가드레일 점검 | 승인 대기」)를
//   RAG로 읽어 사실처럼 답했다(결함②). 「승인 기다리는 것 있어?」는 반대로 규칙([45])이
//   있었는데 **점검 낱말 조건 없이** 유지보수 점검만 답해 취약점 결재판을 놓쳤다(결함①).
//
// ★ 판정은 **제품 함수**(forcedToolFor)로 한다 — helpers/routing.ts 머리글(정규식을 떼어
//   혼자 재면 앞 규칙이 가로채는 것을 못 본다).
// ★★ 그런데 forcedToolFor만 재면 **앞 층(특수경로)이 안 보인다** — routes.ts:404가 적어 둔
//   함정이고, 실제로 2026-09-11에 「결재 승인 대기 있어?」가 dispatcher의 결재승인요청_RE에
//   먼저 채여 approval_status에 안 닿는데도 이 파일은 초록이었다(검토관 [중] 적발).
//   → 아래 「체인까지 잰다」 describe가 제품의 체인 순서 그대로(결정적도착지) 다시 잰다.
describe("★★ 종류를 안 밝힌 승인·결재 물음은 둘 다 세는 도구로 간다", () => {
  const 문장들 = [
    "승인 기다리는 것 있어?",
    "승인 기다리는 취약점 있어?",
    "결재 대기 있어?",
    "결재 대기 몇 건이야?",
    "승인 대기 뭐 있어?",
    "승인 대기 목록 보여줘",
    "배정 승인 대기 취약점 몇 건이야?",
    "판정 승인 대기 몇 건이야?",
    "위험수용 승인 대기 있어?",
    // 2026-09-11 재수리로 되찾은 말들 — 전부 실측 ∅(모델·RAG 재량)였다.
    "결재 승인 대기 있어?",
    "정책 승인 대기 있어?",
    "규정 승인 대기 뭐 있어?",
    "결재 대기 왜 이렇게 많아?",
  ];
  for (const 문장 of 문장들) {
    it(`「${문장}」 → approval_status`, () => {
      const 도둑 = 가로챈규칙(문장, "approval_status");
      expect(실제도착(문장), 도둑 ? `앞 규칙 [${도둑.차례}] ${도둑.도구}가 가로챘다` : "아무 규칙에도 안 걸린다").toBe("approval_status");
    });
  }
});

// ── ★★ 체인까지 잰다 — 강제 도구는 **맨 끝**이라 앞 층이 채 가면 안 닿는다 ────────────
//
// `결정적도착지`는 dispatchInstructionCore의 순서를 그대로 훑는 제품 함수다(순서가 어긋나면
// routeexplain.route.test의 순서 감시가 잡는다). 첫 번째로 걸린 것이 이긴다.
describe("★★ 앞 층이 가로채지 않는다 — 체인 첫 걸림이 강제 도구여야 한다", () => {
  for (const 문장 of ["결재 승인 대기 있어?", "승인 대기 결재 뭐 있어?", "승인 기다리는 것 있어?", "결재 대기 있어?"]) {
    it(`「${문장}」의 첫 걸림 = 강제 도구(approval_status)`, async () => {
      const 걸림 = await 결정적도착지(문장, { 역할: "admin" });
      const 첫 = 걸림[0];
      expect(첫, `아무 갈래에도 안 걸린다 — 모델 재량으로 샌다(결함②가 나던 경로)`).toBeTruthy();
      expect(`${첫.이름} → ${첫.도착}`, `앞 층 「${첫.이름}」이 가로챘다`).toBe("강제 도구 → approval_status");
    });
  }

  it("★ 쓰기는 그대로 앞 층(결재판 안내)이 받는다 — 배제가 쓰기까지 풀지 않았다", async () => {
    const 걸림 = await 결정적도착지("결재 승인 대기 처리해줘", { 역할: "admin" });
    expect(걸림[0]?.이름).toBe("결재 승인 요청");
  });
});

// ── ★ 좁힘말이 붙은 물음은 삼키지 않는다 (2026-09-11 검토관 [하] 둘) ────────────────
//
// approval_status는 `params: []`라 심각도·출처를 **표현할 수 없다.** 그런 말까지 여기로 삼키면
// 조건이 조용히 버려진 전체 숫자가 나가거나(감추는 것이 안 좁히는 것보다 나쁘다),
// 어느 규칙에도 안 걸려 ∅가 된다 — ∅는 곧 모델 재량이고 그것이 결함②의 발생 조건이다.
describe("★ 좁힘말이 있으면 좁힐 수 있는 도구로 간다", () => {
  it("「점검에서 나온 취약점 결재 대기 몇 건이야?」 → finding_status (∅였다)", () => {
    expect(실제도착("점검에서 나온 취약점 결재 대기 몇 건이야?")).toBe("finding_status");
  });
  it("「승인 대기 중인 critical 몇 건이야?」 → finding_status (조건이 버려졌다)", () => {
    expect(실제도착("승인 대기 중인 critical 몇 건이야?")).toBe("finding_status");
  });
  it("★ 그래도 순수 결재 물음은 그대로 approval_status다", () => {
    expect(실제도착("배정 승인 대기 취약점 몇 건이야?")).toBe("approval_status");
  });
});

// ── ★ 조회로 못 박기가 **배정 명령을 삼키지 않는다** (2026-09-11 검토관 [중]) ──────────
//
// isAssignQuery가 「배정 승인 대기」를 조회로 읽으면서 문장 전체에서 isAssign이 꺼졌는데,
// isWriteOrder의 낱말 목록에 배정이 없어 **가드가 짝을 잃었다** — 조회+배정 2수 문장이
// approval_status로 못 박히고 배정은 영영 안 됐다(2026-08-09 파일럿 리허설과 같은 꼴).
describe("★ 조회+배정 2수 문장은 조회로 못 박지 않는다", () => {
  for (const 문장 of [
    "배정 승인 대기 목록 보여주고 김도희로 배정해줘",
    "배정 승인 대기 현황 보고 담당자 배정해줘",
  ]) {
    it(`「${문장}」는 approval_status가 아니다 — 배정이 죽는다`, () => {
      expect(실제도착(문장, "admin")).not.toBe("approval_status");
    });
  }
  it("★ 조회만 하는 말은 그대로 approval_status다", () => {
    expect(실제도착("배정 승인 대기 현황 알려줘")).toBe("approval_status");
  });
});

describe("★ 점검 승인 영토는 그대로", () => {
  for (const 문장 of ["승인 대기 중인 점검 있어?", "점검 승인 대기 뭐 있어?", "점검서 승인 대기 목록 보여줘"]) {
    it(`「${문장}」 → maintenance_status (종전 그대로)`, () => {
      const 도둑 = 가로챈규칙(문장, "maintenance_status");
      expect(실제도착(문장), 도둑 ? `앞 규칙 [${도둑.차례}] ${도둑.도구}가 가로챘다` : "아무 규칙에도 안 걸린다").toBe("maintenance_status");
    });
  }
  it("「방화벽 정책 점검」 점검 승인해줘 → review_maintenance(관리자 쓰기)", () => {
    expect(실제도착("「방화벽 정책 점검」 점검 승인해줘", "admin")).toBe("review_maintenance");
  });
});

describe("★ 쓰기·지식은 안 삼킨다", () => {
  for (const 문장 of [
    "이 취약점 승인해줘",
    "결재 승인해줘",
    "승인 대기 있으면 승인해줘",
    "승인 기준 알려줘",
    "결재 대기 승인 절차 알려줘",
  ]) {
    it(`「${문장}」는 approval_status가 아니다`, () => {
      expect(실제도착(문장), `${문장}는 쓰기 또는 지식 물음이라 조회 도구가 아니다`).not.toBe("approval_status");
    });
  }
});

describe("★ 옛 영토 회귀 — [14]의 배제구 앵커 함정 감시", () => {
  it("「미조치 취약점 몇 건이야?」는 그대로 finding_status", () => {
    expect(실제도착("미조치 취약점 몇 건이야?")).toBe("finding_status");
  });
  it("「미배정 취약점 몇 건이야?」는 그대로 finding_status", () => {
    expect(실제도착("미배정 취약점 몇 건이야?")).toBe("finding_status");
  });
  it("「검토 안 한 항목 몇 건이야?」는 그대로 finding_status", () => {
    expect(실제도착("검토 안 한 항목 몇 건이야?")).toBe("finding_status");
  });
  it("「KEV 몇 건이야?」는 그대로 finding_status", () => {
    expect(실제도착("KEV 몇 건이야?")).toBe("finding_status");
  });
  it("「기한 지난 일 있어?」는 그대로 urgent_todo", () => {
    expect(실제도착("기한 지난 일 있어?")).toBe("urgent_todo");
  });
  it("「이번 주 예정된 점검 있어?」는 그대로 maintenance_status", () => {
    expect(실제도착("이번 주 예정된 점검 있어?")).toBe("maintenance_status");
  });
});
