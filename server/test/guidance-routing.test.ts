// 제품이 「이렇게 말하세요」라고 안내한 말은 흔들리면 안 된다 — [2026-08-04 · 계획서 중-3]
//
// 왜 이 시험이 생겼나:
//   147상황을 회차마다 재는데 **매번 144/147이고 불편 건이 바뀌었다.** 147개 중 95개가
//   모델 판단이라 거기서 흔들린다. 규칙을 하나씩 못 박는 방식은 무엇이 튀어나올지 몰라
//   끝을 알 수 없었다 — 두더지잡기였다.
//
//   그래서 재는 대상을 좁혔다. 담당자가 아무렇게나 친 말은 모델이 잘 골라 주면 된다.
//   그러나 **제품이 직접 「이렇게 물어보세요」라고 적어 준 말**은 다르다 —
//   시킨 대로 쳤는데 답이 회차마다 다르면 그건 제품이 자기 말을 못 지킨 것이다.
//   이건 유한하고, 셀 수 있고, 전부 결정적으로 만들 수 있다.
//
// ⚠ 쓰기(배정·기한)는 예외다. **결재판이 사람에게 확인받고** 실행하므로 모델이 대상을
//   잘못 골라도 담당자가 승인 창에서 본다. 오히려 정규식으로 못 박으면 엉뚱한 대상에
//   결재판이 뜬다 — 그게 더 나쁘다.
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");

function 점검(): string {
  return execFileSync(process.execPath, [join(ROOT, "tools", "guidance-check.mjs")], {
    encoding: "utf8",
    cwd: ROOT,
  });
}

describe("★★ 안내한 말이 실제로 걸리는가", () => {
  const out = 점검();

  it("⚠ 점검이 헛돌지 않는가 — 안내 문구와 규칙을 실제로 읽었다", () => {
    // 소스 형식이 바뀌어 하나도 못 읽으면 「공백 0」이 되어 **항상 통과한다.**
    // 그건 지키는 게 아니라 눈을 감은 것이다(도구 자체도 20개 미만이면 멈춘다).
    const m = out.match(/안내 문구 (\d+)개 · 규칙 (\d+)개/);
    expect(m, "점검 결과를 읽지 못했다").toBeTruthy();
    expect(Number(m![1]), "안내 문구를 못 읽었다").toBeGreaterThanOrEqual(15);
    expect(Number(m![2]), "라우팅 규칙을 못 읽었다").toBeGreaterThanOrEqual(20);
  });

  it("★★ 읽기 안내는 **전부** 결정적이어야 한다", () => {
    const m = out.match(/읽기인데 모델 판단 (\d+)개/);
    expect(m).toBeTruthy();
    const 남은 = Number(m![1]);
    // 남은 것이 있으면 어떤 말인지 그대로 보여 준다 — 숫자만 보면 무엇을 고칠지 모른다.
    const 목록 = out.includes("읽기인데 모델 판단으로 가는 안내")
      ? out.slice(out.indexOf("읽기인데 모델 판단으로 가는 안내"))
      : "";
    expect(남은, `제품이 안내해 놓고 흔들리는 말이 남아 있다:\n${목록}`).toBe(0);
  });

  it("쓰기 안내는 결재판이 받쳐 주므로 못 박지 않는다 — 그 예외가 살아 있다", () => {
    expect(out).toMatch(/쓰기 안내 \d+개 — 모델 판단이지만/);
  });
});
