// explain 도구 출력의 **자리 배분** — 상한을 넘겨도 「관련 사내 문서」는 남는다
// (2026-09-11 검토관 [중] 수리)
//
// ★★ 왜 이 시험이 따로 있나
//   runExplain은 [발췌] → [온톨로지] → [관련 사내 문서] → [보유 보안제품] 순으로 쌓고 끝에서
//   총 상한(EXPLAIN_MAX_CHARS=3500)으로 자른다. 2026-09-11 커밋(2b01e479)이 발췌를 3→4로 늘려
//   발췌 블록만 최대 2,441자가 됐는데 상한은 그대로라, **뒤에 있는 「관련 사내 문서」가 먼저
//   잘려 나간다.** 그 줄은 담당자가 원문을 찾아가는 유일한 통로다.
//   전례: incidentcases.test.ts 「예전엔 끝의 3500자 컷이 안내 줄을 통째로 먹었다」.
//
// ⚠ **픽스처를 실크기로 쓴다.** toolevidence.test의 ⑥은 한 줄짜리 짧은 문서라 이 자리를
//   원리상 못 문다(발췌가 600자 컷에 안 닿아 총량이 상한 근처도 못 간다). 여기서는
//   조각 크기(memory.CHUNK_SIZE=800)에 가까운 본문 5편 + 온톨로지 12줄로 **실제로 넘긴다.**
// ⚠ 파일을 따로 둔 이유: 같은 파일에 짧은 문서가 먼저 들어가 있으면 목 임베딩(전 벡터 동일)
//   때문에 그 짧은 조각이 발췌에 섞여 크기 계산이 무너진다. ragscope로 좁히면 이번엔
//   지정범위가 걸려 온톨로지가 아예 안 실린다(runExplain 계약) — 그래서 **깨끗한 DB**가 필요하다.
import { describe, it, expect, beforeAll, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const tmpDb = fs.mkdtempSync(path.join(os.tmpdir(), "gijo-tailbudget-"));
process.env.GIJO_MEMORY_DB_PATH = tmpDb;
process.env.GIJO_INGEST_ROOT = tmpDb;

vi.mock("../src/engine/embedding", () => ({
  embed: vi.fn(async (texts: string[]) => texts.map(() => [1 / 3, 2 / 3, 1])),
}));

// 제목 토큰이 그대로 걸리게 지은 이름 — 「꼬리보전」(4자)·「실크기」(3자) 둘을 맞혀 지목이 선다.
const ids = ["가", "나", "다", "라", "마"].map((표) => `GIJO_지식_꼬리보전_실크기_${표}.md`);
const 물음 = "꼬리보전 실크기 점검 항목 알려줘";
const 상한 = 3500;

describe("★★ explain 총 상한 — 꼬리(관련 사내 문서)에 먼저 자리를 준다", () => {
  beforeAll(async () => {
    const { ingestText } = await import("../src/engine/memory");
    const { addTriples } = await import("../src/engine/ontology");
    // 조각 하나가 600자 컷을 꽉 채우도록 790자(= CHUNK_SIZE 800 미만이라 한 편당 한 조각).
    for (const [i, id] of ids.entries()) {
      const 본문 = `꼬리보전 실크기 점검 ${i} — `.padEnd(790, "가나다라마바사아자차카타파하 ");
      await ingestText(id, 본문.slice(0, 790), "global", undefined, false, undefined, undefined, "builtin");
    }
    // 온톨로지 — 제품에서는 이 자리가 늘 차 있다(내장 트리플 ~2,000개). 12줄이 발췌 뒤에 실린다.
    addTriples(
      Array.from({ length: 14 }, (_, i) => ({
        subject: "꼬리보전",
        predicate: `연결관계${i}`,
        object: `점검대상 ${i} — 실제 온톨로지 목적어는 이 정도로 길다(연결된 통제·보안제품·자산 이름이 줄줄이 붙는다)`,
      })),
    );
  });

  it("상한을 넘겨도 「관련 사내 문서」 다섯 줄이 전부 남는다 — 잘리는 쪽은 발췌의 끝자락이다", async () => {
    const { runExplain } = await import("../src/engine/agenttools/handlers");
    const out = await runExplain({ topic: 물음 });

    // ① 이 픽스처가 실제로 상한을 넘겼는가 — 안 넘기면 이 시험은 아무것도 안 문다.
    //    자리 배분이 걸리면 길이는 정확히 상한이 된다(앞을 남은 만큼만 싣기 때문).
    expect(out.length, "픽스처가 상한을 못 넘기면 옛 코드로도 초록이라 감시가 빈다").toBe(상한);

    // ② 꼬리가 통째로 살아 있다 — 담당자가 원문을 찾아가는 유일한 줄.
    expect(out).toContain("관련 사내 문서");
    for (const id of ids) {
      expect(out, `${id}가 상한에 잘려 나갔다 — 옛 코드(꼬리를 마지막에 자름)의 증상 그대로다`)
        .toContain(id);
    }

    // ③ 그래도 발췌는 앞에 실려 있다(꼬리를 지키느라 근거를 통째로 버리지 않는다).
    expect(out).toContain("사내 문서 근거(발췌)");
    expect(out.split("\n").filter((l) => l.startsWith("  · ")).length).toBeGreaterThan(0);
  });
});
