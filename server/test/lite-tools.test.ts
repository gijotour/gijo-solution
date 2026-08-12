// 라이트 도구 목록 — **이름이 조용히 어긋나는 것**을 막는다.
//
// 왜 필요한가: `server/src/lite/lite-tools.json`은 도구를 **이름 문자열**로 가리킨다.
// 누군가 registry.ts에서 도구 이름을 바꾸거나 지우면, 라이트는 **조용히 그 기능을 잃는다.**
// 화면은 그대로 있고 답만 안 나온다 — 담당자는 「원래 안 되는 기능인가 보다」로 읽는다.
// 2026-08-12에 본 제품에서 라우팅 결함 셋이 오래 남은 이유가 정확히 그것이었다:
// **없어진 것이 눈에 안 띄었다.**
//
// ⚠ 이 시험은 「라이트에 무엇을 넣을까」를 판정하지 않는다(그건 사람의 결정이다).
//   **적어 둔 것과 실제가 같은가**만 본다.

import { describe, it, expect, afterEach } from "vitest";
import {
  listAgentTools,
  findAgentTool,
  listToolsFor,
  setToolAllowlist,
  isToolAllowed,
} from "../src/engine/agenttools/registry";
import liteTools from "../src/lite/lite-tools.json";

const 라이트도구 = liteTools.tools.map((t) => t.id);

afterEach(() => {
  // ⚠ 허용목록은 **전역 상태**다. 안 풀면 뒤 시험들이 13개짜리 카탈로그로 돌아 엉뚱하게 깨진다.
  setToolAllowlist(null);
});

describe("라이트 도구 목록", () => {
  it("적어 둔 이름이 전부 실재한다", () => {
    const 없는것 = 라이트도구.filter((n) => !findAgentTool(n));
    expect(없는것, `lite-tools.json에 없는 도구 이름: ${없는것.join(", ")}`).toEqual([]);
  });

  it("이름이 겹치지 않는다", () => {
    expect(new Set(라이트도구).size).toBe(라이트도구.length);
  });

  // ⚠ 「딱 13개」로 못 박으면 안 된다. `law_lookup`은 **허용목록과 별개로 자체 게이트**가 있어
  //   (registry.ts — getLawConfig().enabled) 꺼져 있으면 카탈로그에 안 나온다.
  //   2026-08-12 이 시험을 처음 쓸 때 13개로 박았다가 깨졌는데, **제품이 맞고 시험이 틀렸다.**
  //   그리고 그게 사장님 결정 ②(법령 조회 기본 꺼짐)가 **이미 구현돼 있다**는 증거다 —
  //   라이트에서 새로 만들 것이 아니다.
  const 자체게이트가있는것 = ["law_lookup"];

  it("허용목록 밖의 도구는 하나도 안 샌다", () => {
    setToolAllowlist(라이트도구);
    const 샌것 = listToolsFor().map((t) => t.name).filter((n) => !라이트도구.includes(n));
    expect(샌것, `라이트 목록에 없는데 카탈로그에 나온 도구: ${샌것.join(", ")}`).toEqual([]);
  });

  it("자체 게이트가 없는 도구는 전부 살아 있다", () => {
    setToolAllowlist(라이트도구);
    const 나온것 = new Set(listToolsFor().map((t) => t.name));
    const 사라진것 = 라이트도구.filter((n) => !나온것.has(n) && !자체게이트가있는것.includes(n));
    expect(사라진것, `라이트 목록에 있는데 카탈로그에서 사라진 도구: ${사라진것.join(", ")}`).toEqual([]);
  });

  it("회사 원장을 읽는 도구는 라이트에서 차단된다", () => {
    // 인자 없이도 도는데 그 「전체」가 회사 원장인 것들(2026-08-12 78개 훑기).
    // 라이트에서 열려 있으면 **빈 답이 「없습니다」로 나가** 담당자가 잘못 판단한다.
    const 회사원장 = [
      "today", "urgent_todo", "briefing", "list_assets", "get_asset", "finding_status",
      "exposed_assets", "asset_coverage", "scan_status", "kpi_status", "posture_impact",
      "analysis_status", "product_status", "maintenance_status", "report_list",
      "sbom_coverage", "aibom_status", "compliance_status", "workflow_status", "threats",
    ];
    setToolAllowlist(라이트도구);
    for (const n of 회사원장) {
      if (!findAgentTool(n)) continue; // 도구가 사라졌으면 위 시험이 잡는다
      expect(isToolAllowed(n), `${n}이 라이트에서 열려 있다`).toBe(false);
    }
  });

  it("여럿이 써야 뜻이 있는 도구도 차단된다", () => {
    // 결재·배정·인계는 1인용 라이트에서 **없는 절차**다. 열려 있으면
    // 「배정했습니다」처럼 **하지 않은 일을 했다고 답하게 된다**(GA 판정표 H).
    const 다인용 = ["assign_finding", "assign_owner", "review_finding", "handover_status", "assign_adapter"];
    setToolAllowlist(라이트도구);
    for (const n of 다인용) {
      if (!findAgentTool(n)) continue;
      expect(isToolAllowed(n), `${n}이 라이트에서 열려 있다`).toBe(false);
    }
  });

  it("모르는 이름을 넣으면 던진다 — 조용히 빠지면 안 된다", () => {
    expect(() => setToolAllowlist([...라이트도구, "존재하지않는도구"])).toThrow();
  });

  it("허용목록을 풀면 원래대로 돌아온다", () => {
    const 원래 = listAgentTools().length;
    setToolAllowlist(라이트도구);
    setToolAllowlist(null);
    expect(listAgentTools().length).toBe(원래);
  });
});
