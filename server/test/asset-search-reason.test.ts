// 자산 검색 — 이름이 IP뿐인 자산을 담당자의 말로 찾는다.
//
// ★ 출처: **실사용자 brian의 지적**(2026-07-31, 답변 지적 id=3). 3일간 미처리로 남아 있다가
//   중-1 피드백 루프를 실제로 완주해 보면서 발견했다.
//     물음: "자산 목록에서 서버이름이 oracle 찾아줘"
//     답  : 엉뚱한 자산 2건
//     지적: "Host name이 oracle인 서버의 IP는 192.168.219.98이다"
//
//   조사해 보니 그 자산은 **등록부에 있었다** — id `vuln:192.168.219.98`, 출처
//   `Oracle Server Scan.nessus`, Oracle Database 취약점 다수. 못 찾은 이유는 스캐너가 이름을
//   안 줘서 name=IP·hostname=null이었기 때문이다. 담당자가 부르는 말과 등록부의 말이 어긋난다.
//   그래서 **올린 파일 이름까지** 본다 — 그 파일은 담당자가 이름 붙여 올린 것이다.
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/engine/llm", () => ({
  chat: vi.fn(async () => "[mock]"),
  embed: vi.fn(async (t: string[]) => t.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
}));

import * as fs from "fs";
import * as path from "path";
import { 자산이걸린이유 } from "../src/engine/agenttools";
import { registerAsset, recordFindings, getAsset } from "../src/engine/assets";

const SRC = path.resolve(__dirname, "../src/engine/agenttools.ts");

/** brian이 겪은 그 자산을 그대로 만든다 — 이름은 IP뿐, hostname 없음, 출처만 오라클. */
function 오라클서버() {
  registerAsset({ id: "vuln:192.168.219.98", name: "192.168.219.98", path: "192.168.219.98", assetType: "infra-host", owner: "" });
  recordFindings("vuln:192.168.219.98", [
    { finding_type: "Oracle Database Server (Apr 2024 CPU)", severity: "high", evidence: "포트: tcp/1521", source_tool: "Oracle Server Scan.nessus", key: "o1", state: "active" },
  ]);
  return getAsset("vuln:192.168.219.98")!;
}

describe("자산이걸린이유 — 담당자의 말로 찾는다", () => {
  it("★ brian의 지적: 이름이 IP뿐이어도 올린 파일 이름으로 찾힌다", () => {
    const a = 오라클서버();
    const r = 자산이걸린이유(a, "oracle", ["oracle"]);
    expect(r, "못 찾으면 brian이 겪은 그대로다").not.toBeNull();
    expect(r, "왜 걸렸는지 밝혀야 담당자가 오답으로 오해하지 않는다").toContain("Oracle Server Scan.nessus");
  });

  it("이름으로 걸리면 이유를 붙이지 않는다 — 보면 아는 자리다", () => {
    registerAsset({ id: "as-r1", name: "경계 방화벽", path: "p", assetType: "infra-host", owner: "" });
    expect(자산이걸린이유(getAsset("as-r1")!, "방화벽", ["방화벽"])).toBe("");
  });

  it("⚠ 호스트명 가지는 두지 않는다 — hostname은 name에서 유도할 뿐 따로 저장되지 않는다", () => {
    // 처음엔 hostname 가지를 넣었다가 이 시험을 쓰면서 **절대 안 타는 죽은 코드**임을 알았다.
    // registerAsset이 hostname을 받지 않고 assets.ts가 name에서 뽑아 쓰기 때문이다 —
    // hostname으로 걸릴 자산은 이미 name으로 걸린다. "호스트명으로도 찾습니다"는 거짓말이 된다.
    registerAsset({ id: "as-r2", name: "was-prod-01 (172.20.0.9)", path: "p", assetType: "infra-host", owner: "" });
    const a = getAsset("as-r2")!;
    expect(a.hostname, "hostname은 name에서 유도된다").toBe("was-prod-01");
    expect(자산이걸린이유(a, "was-prod", ["was-prod"]), "name으로 이미 걸리므로 이유가 붙지 않는다").toBe("");
  });

  it("안 걸리는 것은 안 걸린다 — 넓혔다고 다 걸리면 목록이 뜻을 잃는다", () => {
    expect(자산이걸린이유(오라클서버(), "방화벽", ["방화벽"])).toBeNull();
  });

  it("⚠ 취약점 본문으로는 찾지 않는다 — 넣으면 'Log4j 찾아줘'에 자산 수십 대가 쏟아진다", () => {
    registerAsset({ id: "as-r3", name: "10.1.1.1", path: "p", assetType: "infra-host", owner: "" });
    recordFindings("as-r3", [
      { finding_type: "Apache Log4j 원격코드실행 (Log4Shell)", severity: "critical", evidence: "e", source_tool: "웹서버 점검.pdf", key: "l1", state: "active" },
    ]);
    expect(자산이걸린이유(getAsset("as-r3")!, "log4j", ["log4j"]), "취약점 이름은 취약점 검색이 맡는다").toBeNull();
  });
});

describe("★ 소스 감시 — 검색 조건이 두 벌로 갈리지 않는가", () => {
  // 왜 소스를 읽나: 이 저장소의 단골 결함은 "함수를 만들어 놓고 호출부가 안 부르는" 것이다.
  // 목록 조회(list_assets)와 통합 검색(searchOne)이 각각 filter를 짜면, 같은 "oracle"에
  // 한쪽만 답이 나온다. 동작 시험은 그 어긋남을 못 잡는다 — 둘 다 "답이 나오긴" 하기 때문이다.
  const src = fs.readFileSync(SRC, "utf8");

  // ⚠ **주석을 걷고 센다.** 처음엔 그냥 셌다가 설명 주석 안의 `자산이걸린이유()` 언급까지
  //   세어 3이 나왔다. 주석이 호출로 잡히면, 코드가 안 부르는데도 주석만 늘려 통과시킬 수 있다.
  const 코드만 = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("자산을 거르는 자리는 자산이걸린이유() 하나뿐이다", () => {
    const 정의 = (코드만.match(/export function 자산이걸린이유\(/g) || []).length;
    const 전체 = (코드만.match(/자산이걸린이유\(/g) || []).length;
    expect(정의, "한 곳에만 정의한다").toBe(1);
    expect(전체 - 정의, "목록 조회 · 통합 검색 두 곳이 부른다").toBe(2);
  });

  it("★ 감시가 헛돌지 않는지 — 두 호출부가 실제로 그 함수 안에 있다", () => {
    // 이름만 세면 주석 안의 언급도 세어 통과할 수 있다. 두 함수 본문을 잘라서 확인한다.
    const 목록 = src.slice(src.indexOf("function runListAssets"), src.indexOf("// 자산 상세"));
    const 통합 = src.slice(src.indexOf("async function searchOne"), src.indexOf("  // 취약점 — 전 자산을"));
    expect(목록.length, "runListAssets 본문을 못 잘랐다").toBeGreaterThan(300);
    expect(통합.length, "searchOne 본문을 못 잘랐다").toBeGreaterThan(300);
    expect(목록, "목록 조회가 공용 판정을 안 쓴다").toContain("자산이걸린이유(");
    expect(통합, "통합 검색이 공용 판정을 안 쓴다").toContain("자산이걸린이유(");
    // 옛 방식(각자 matchesLoose로 filter)이 되살아나지 않았는지도 본다.
    expect(목록, "목록 조회가 자기 조건을 다시 짰다").not.toContain("matchesLoose(a.name");
    expect(통합, "통합 검색이 자기 조건을 다시 짰다").not.toContain("matchesLoose(a.name");
  });
});
