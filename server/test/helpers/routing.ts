// 시험용 — 문장이 **실제로 어느 도구에 닿는지** 잰다 (2026-09-01 신설)
//
// ■ 왜 만들었나 (검토관 [상]이 잡은 거짓 초록)
//   라우팅 시험을 쓸 때 규칙 하나만 파일에서 떼어 내 `정규식.test(문장)`으로 확인해 왔다.
//   그러면 **자기가 만든 정규식을 자기가 확인하는** 꼴이라 늘 통과한다 —
//   정작 제품에서는 FORCED_INTENTS를 **배열 순서대로** 훑어 **첫 매치에서 끝내므로**,
//   앞 규칙이 이미 삼키고 있으면 내 규칙은 **영영 안 걸린다.**
//
//   2026-09-01 실제로 그랬다: `set_aibom_field`(기입, 배열 끝)가 앞의
//   `/ai[-\s_]?bom/i`(조회, idx 23)에 통째로 가로채여 **쓰기 요청이 읽기 도구로 갔다.**
//   담당자는 적으라고 시켰는데 목록만 받고 아무것도 안 적혔는데, 시험은 초록이었다.
//
// ■ 그래서 규칙은 하나다
//   **라우팅 시험은 이 helper를 쓴다.** 규칙을 홀로 test하지 않는다.
//   홀로 재면 「내 규칙이 문장을 잡는가」를 알 수 있을 뿐, 「그 문장이 내게 오는가」는 모른다.
//   둘은 다른 질문이고, 담당자에게 중요한 것은 뒤쪽이다.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const 셸경로 = join(__dirname, "..", "..", "src", "engine", "agentloop.ts");

export interface 강제규칙 {
  차례: number;
  도구: string;
  정규식: RegExp;
}

/** agentloop.ts의 FORCED_INTENTS를 **적힌 순서 그대로** 읽어 온다. */
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
    } catch {
      continue; // 못 읽는 규칙은 건너뛰되, 아래에서 개수로 알아챈다
    }
    규칙.push({ 차례: 규칙.length, 도구: m[2], 정규식 });
  }
  // ⚠⚠ **뽑은 수와 실제 규칙 수를 맞춰 본다.**
  //   「50개 넘으면 통과」로 두면, 규칙 하나를 못 뽑아도 78/79로 조용히 지나간다 —
  //   그 규칙은 **감시 밖**이 되고, 아무도 모르는 채로 앞 규칙에 가려질 수 있다.
  //   이 helper 자체가 틀리면 그 위의 라우팅 시험이 전부 거짓이 되므로, 여기서 크게 실패한다.
  const 실제수 = (몸통.match(/^\s*tool:\s*"[a-z_]+"/gm) ?? []).length;
  if (규칙.length !== 실제수) {
    throw new Error(
      `강제규칙 ${실제수}개 중 ${규칙.length}개만 뽑혔다 — 못 뽑은 ${실제수 - 규칙.length}개는 ` +
        `라우팅 감시 밖이다. 뽑는 정규식이 규칙의 새 꼴을 못 읽는다(helpers/routing.ts).`,
    );
  }
  if (규칙.length < 50) throw new Error(`강제규칙을 ${규칙.length}개밖에 못 읽었다 — 뽑는 방식이 낡았다`);
  return 규칙;
}

/**
 * 이 문장이 **실제로** 닿는 도구. 어떤 규칙에도 안 걸리면 null(LLM 판단으로 간다).
 *
 * ⚠ 제품과 같은 규칙을 쓴다 — **배열 순서대로, 첫 매치에서 끝.**
 */
export function 실제도착(문장: string, 규칙?: 강제규칙[]): string | null {
  for (const r of 규칙 ?? 강제규칙들()) {
    if (r.정규식.test(문장)) return r.도구;
  }
  return null;
}

/** 이 문장을 **먼저 가로채는** 규칙 — 왜 내 규칙에 안 오는지 밝힐 때 쓴다. */
export function 가로챈규칙(문장: string, 내도구: string, 규칙?: 강제규칙[]): 강제규칙 | null {
  for (const r of 규칙 ?? 강제규칙들()) {
    if (r.정규식.test(문장)) return r.도구 === 내도구 ? null : r;
  }
  return null;
}
