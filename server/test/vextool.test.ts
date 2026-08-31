// VEX 현황 도구 — 대화로 (2026-09-01 · 대장 §4 끊김 2 · 계획서 중-7 SBOM 갈래)
//
// 왜: 엔진(vexexport buildVexDocument)과 화면 [VEX 내보내기] 단추는 **처음부터 있었는데**
// 대화 도구가 없어 「VEX 파일 내보내줘」가 모델 판단으로 샜다.
//
// ⚠ **읽기 도구다.** 대화창은 파일을 건네지 못하므로 「지금 내보내면 어떤 상태로 나가는지」를
//   숫자로 보여 주고 파일 받는 자리를 알려 준다. 「내보냈습니다」라고 말하면 안 된다 —
//   실제로 파일을 안 만들었는데 만들었다고 하는 것이라 「하지 않은 일을 했다고 말함」이 된다.
import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../src/db";
import { runVexStatus } from "../src/engine/agenttools/handlers";
import { readFileSync } from "node:fs";
import { join } from "node:path";

beforeEach(() => {
  db.exec("DELETE FROM finding_approvals");
});

describe("VEX 현황 — 없는 것을 있다고 하지 않는다", () => {
  it("★★ 상태 이름이 **우리말로 나온다** — 영어 원값이 새어 나오면 열쇠가 안 맞은 것이다", async () => {
    // 2026-09-01 실제 결함: 표준 문서를 보고 exploitable·resolved·in_triage를 열쇠로 적었는데
    // 우리 엔진(vexexport toVexAnalysis)이 내보내는 값은 under_investigation·affected·fixed·
    // not_affected 넷뿐이라 **한 건도 안 맞아** 영어가 그대로 화면에 나왔다.
    // 시험이 내 표만 들여다보면 이걸 못 잡는다 — **실제 출력**을 봐야 잡힌다.
    const 답 = await runVexStatus({});
    if (답.includes("실릴 취약점")) {
      for (const 원값 of ["under_investigation", "affected", "fixed", "not_affected"]) {
        expect(답, `상태 ${원값}이 우리말로 안 바뀌고 그대로 나왔다`).not.toContain("- " + 원값);
      }
    }
  });

  it("★★ 파일을 만들지 않았으므로 **「내보냈습니다」라고 말하지 않는다**", async () => {
    const 답 = await runVexStatus({});
    expect(답, "하지 않은 일을 했다고 말한다").not.toContain("내보냈습니다");
    expect(답, "하지 않은 일을 했다고 말한다").not.toContain("저장했습니다");
  });

  it("없는 자산을 대면 있는 것을 보여 준다 — 지어내지 않는다", async () => {
    const 답 = await runVexStatus({ asset: "없는자산이름XYZ" });
    expect(답).toContain("못 찾았습니다");
  });
});

describe("계약 — 읽기 도구이고, 파일 받는 자리를 알려 준다", () => {
  const 등록 = readFileSync(join(__dirname, "..", "src", "engine", "agenttools", "registry.ts"), "utf8");
  const 핸들 = readFileSync(join(__dirname, "..", "src", "engine", "agenttools", "handlers.ts"), "utf8");

  it("write:false다 — 결재판이 뜨면 안 된다(자료를 안 바꾼다)", () => {
    const i = 등록.indexOf('name: "vex_status"');
    expect(i, "vex_status가 등록부에 없다").toBeGreaterThan(-1);
    expect(등록.slice(i, i + 260), "쓰기 도구로 등록돼 있다").toContain("write: false");
  });

  it("★ 파일 받는 자리를 **말한다** — 대화창이 못 하는 일을 그냥 안 된다고 두지 않는다", () => {
    const i = 핸들.indexOf("export async function runVexStatus");
    // ⚠ 「결재판」은 **쓰기 승인 팝업**의 이름이지 화면 이름이 아니다(검토관 [중]).
    //   실제 판 이름은 grouppanels.js의 「✅ 조치·승인」이다 — 없는 이름을 가리키면
    //   담당자는 그 화면을 찾다가 못 찾는다.
    expect(핸들.slice(i, i + 2600), "파일 받는 자리를 안 알려 준다").toContain("조치·승인");
  });

  it("★ CVE가 없어 빠지는 건수를 밝힌다 — 조용히 줄어들면 안 된다", () => {
    // VEX는 CVE를 열쇠로 쓴다. 스캐너가 CVE를 안 준 항목은 빠지는데,
    // 그 사실을 안 밝히면 담당자는 판정한 것이 다 실린 줄 안다.
    const i = 핸들.indexOf("export async function runVexStatus");
    const 본문 = 핸들.slice(i, i + 2600);
    expect(본문, "빠지는 건수를 안 밝힌다").toContain("CVE없음");
    expect(본문, "왜 빠지는지 안 말한다").toContain("CVE 번호가 없어");
  });

  it("상태 우리말은 **표준 값 그대로**를 열쇠로 쓴다(새로 짓지 않는다)", () => {
    const i = 핸들.indexOf("const VEX상태글");
    expect(i, "상태 라벨 표가 없다").toBeGreaterThan(-1);
    const 표 = 핸들.slice(i, i + 320);
    // ⚠ 원천은 **vexexport.ts가 실제로 내보내는 값**이지 CycloneDX 표준 목록이 아니다.
    //   표준을 보고 넷 밖의 값을 적으면 영원히 안 맞는 열쇠가 된다(2026-09-01 실제 결함).
    const 원천 = readFileSync(join(__dirname, "..", "src", "engine", "vexexport.ts"), "utf8");
    const 내보내는값 = [...원천.matchAll(/state:\s*"([a-z_]+)"/g)].map((m) => m[1]);
    expect(new Set(내보내는값).size, "vexexport에서 상태값을 못 읽었다").toBeGreaterThan(2);
    for (const st of new Set(내보내는값)) {
      expect(표, `엔진이 내보내는 상태 ${st}가 우리말 표에 없다 — 영어가 그대로 나온다`).toContain(st);
    }
  });
});
