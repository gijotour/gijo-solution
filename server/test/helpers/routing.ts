// 시험용 — 문장이 **실제로 어느 도구에 닿는지** 잰다 (2026-09-01 신설 · 같은 날 재작성)
//
// ■ 왜 만들었나 (검토관 [상]이 잡은 거짓 초록)
//   라우팅 시험을 쓸 때 규칙 하나를 파일에서 떼어 내 `정규식.test(문장)`으로 확인해 왔다.
//   그러면 **자기가 만든 정규식을 자기가 확인하는** 꼴이라 늘 통과한다 —
//   제품은 규칙을 **순서대로** 훑어 **첫 매치에서 끝내므로**, 앞 규칙이 이미 삼키고 있으면
//   내 규칙은 **영영 안 걸린다.** 실제로 `set_aibom_field`가 그렇게 죽어 있었다.
//
// ■ ★★ 그런데 첫 판(같은 날 오전)은 **제품을 다시 구현했다** — 그것도 틀렸다
//   FORCED_INTENTS 배열만 파싱해 순서대로 훑었는데, 제품의 `forcedToolFor`에는 그것 말고도
//     ① `available` 게이트 — 역할(role)·화면(scope)에 없는 도구는 강제하지 않는다
//     ② 배열보다 **앞서 도는 손수 분기들**(explain·register_product_intro 등)
//   가 있다. 둘 다 빠뜨렸으니 helper의 답과 제품의 답이 갈릴 수 있었다.
//   **제품 판정을 흉내 내면 안 된다 — 제품을 부른다.** 이 저장소가 반복해 겪은
//   「같은 것을 여러 곳에 적으면 어긋난다」가 시험 도구 안에서 재현된 것이다.
//
// ■ 그래서 규칙은 하나다
//   **도착지 판정은 제품 함수(forcedToolFor)가 한다.** 아래 파싱은 「어느 규칙이 가로챘나」를
//   사람에게 알려 주는 **진단용**일 뿐, 판정에 쓰지 않는다.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { forcedToolFor } from "../../src/engine/agentloop";

const 셸경로 = join(__dirname, "..", "..", "src", "engine", "agentloop.ts");

export interface 강제규칙 {
  차례: number;
  도구: string;
  정규식: RegExp;
}

/**
 * agentloop.ts의 FORCED_INTENTS를 적힌 순서대로 읽어 온다.
 *
 * ⚠ **진단용이다.** 「어느 규칙이 먼저 잡았나」를 사람에게 보여 줄 때만 쓴다 —
 *   도착지 판정은 제품 함수가 한다(위 머리글).
 */
export function 강제규칙들(): 강제규칙[] {
  const 소스 = readFileSync(셸경로, "utf8");
  const 시작 = 소스.indexOf("const FORCED_INTENTS");
  if (시작 < 0) throw new Error("FORCED_INTENTS를 못 찾았다 — 이 helper가 낡았다");
  const 몸통 = 소스.slice(시작, 소스.indexOf("];", 시작));
  const 규칙: 강제규칙[] = [];
  const 훑기 = /re:\s*(\/[\s\S]*?\/[gimsuy]*),\s*\r?\n\s*tool:\s*"([a-z_]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = 훑기.exec(몸통))) {
    let 정규식: RegExp;
    try {
      // eslint-disable-next-line no-eval
      정규식 = eval(m[1]) as RegExp;
    } catch (e) {
      // ⚠ 조용히 건너뛰지 않는다 — 못 읽은 규칙은 진단에서 **빠진 채로 보이지 않는다.**
      throw new Error(`강제규칙 [${규칙.length}] ${m[2]}의 정규식을 못 읽었다: ${(e as Error).message}`);
    }
    규칙.push({ 차례: 규칙.length, 도구: m[2], 정규식 });
  }
  // ⚠⚠ 뽑은 수와 실제 규칙 수를 맞춰 본다. 「N개 넘으면 통과」로 두면 하나를 못 뽑아도
  //   78/79로 조용히 지나가고, 그 규칙은 **진단 밖**이 된다.
  const 실제수 = (몸통.match(/^\s*tool:\s*"[a-z_]+"/gm) ?? []).length;
  if (규칙.length !== 실제수) {
    throw new Error(
      `강제규칙 ${실제수}개 중 ${규칙.length}개만 뽑혔다 — 못 뽑은 ${실제수 - 규칙.length}개는 ` +
        `진단 밖이다. 뽑는 정규식이 규칙의 새 꼴을 못 읽는다(helpers/routing.ts).`,
    );
  }
  return 규칙;
}

/**
 * 이 문장이 **실제로** 닿는 도구. 어떤 강제 분기에도 안 걸리면 null(LLM 판단으로 간다).
 *
 * ★ **제품 함수를 그대로 부른다** — 흉내 내지 않는다. 그래야 제품이 바뀌면 시험도 따라 바뀐다.
 * @param 역할 role을 주면 그 권한에서 판정한다(admin 전용 도구가 새는지 볼 때).
 */
export function 실제도착(문장: string, 역할?: string): string | null {
  return forcedToolFor(문장, 역할 ? ({ role: 역할 } as never) : undefined)?.tool ?? null;
}

/**
 * 이 문장을 **먼저 가로채는** 규칙 — 왜 내 규칙에 안 오는지 사람에게 밝힐 때 쓴다.
 *
 * ⚠ 진단이다. 여기가 null이라도 제품이 다른 답을 낼 수 있다(배열 앞의 손수 분기·available).
 *   **판정은 실제도착()으로 한다.**
 */
export function 가로챈규칙(문장: string, 내도구: string, 규칙?: 강제규칙[]): 강제규칙 | null {
  for (const r of 규칙 ?? 강제규칙들()) {
    if (r.정규식.test(문장)) return r.도구 === 내도구 ? null : r;
  }
  return null;
}
