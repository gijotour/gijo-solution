// 예시데이터 머리말이 「점검 시드」를 놓치던 결함의 소스 감시 (계획서 §13.5.2, 2026-09-13).
//
// 뿌리(정찰 2026-09-11 발견): 첫 기동 시드는 여섯 곳(datacleanup.ts:76 「seedXIfEmpty 6곳」 —
// 자산 2 · 점검 6건 · 조치 3건 · 제품 4건 · CTI 5건)인데, 예시데이터뿐인가()(assets.ts)는
// 오래 **자산 표 하나만** 봤다. 고객이 진짜 자산을 하나 등록하면 그 순간 판정이 false가 되어
// 나머지 넷의 시드는 대화창·보고서에 고지 없이 숫자로 흘러갔다. 이 시험은 그 짝이 다시
// 벌어지는 것을 소스 단계에서 잡는다 — demo-disclosure.test.ts(시연데이터알림)와 같은 형식이다.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { agenttoolsSource } from "./util/toolsrc";
import { resetAssetsForTests, registerAsset, 예시데이터뿐인가 } from "../src/engine/assets";
import { resetMaintenanceForTests, createMaintenanceItem } from "../src/engine/maintenance";
import { resetTasksForTests } from "../src/engine/tasks";
import { resetSecurityProductsForTests, createProduct } from "../src/engine/securityproducts";
import { resetFeedsForTests } from "../src/engine/cti";

const ENGINE = path.join(__dirname, "..", "src", "engine");

function engineSource(): { files: string[]; joined: string } {
  const files = (fs.readdirSync(ENGINE, { recursive: true }) as string[]).filter((f) => f.endsWith(".ts"));
  const joined = files.map((f) => fs.readFileSync(path.join(ENGINE, f), "utf8")).join("\n");
  return { files, joined };
}

describe("① 시드 함수가 여섯 개 그대로인가 — engine/ 전체 소스 감시", () => {
  it("★ 감시가 헛돌고 있지 않다 — engine 파일을 실제로 읽었다", () => {
    const { files } = engineSource();
    expect(files.length, "engine 폴더를 못 읽었다 — 감시가 헛돈다").toBeGreaterThan(50);
  });

  it("seed*IfEmpty 함수 정의가 정확히 6개다 — 늘거나 줄면 datacleanup.ts:76 주석과 이 시험을 함께 고친다", () => {
    // ⚠ server/src/auth/users.ts의 seedDefaultAdminIfEmpty()는 **관리자 계정 시드**라
    //   이 6곳(데모 데이터 시드)과 다르다 — engine/ 밖이라 이 스캔에 애초에 안 잡힌다.
    const { joined } = engineSource();
    const 정의 = joined.match(/function seed[A-Za-z]*IfEmpty\(\)/g) ?? [];
    expect(정의.length, `찾은 시드 함수: ${정의.join(", ")}`).toBe(6);
  });

  it("여섯 함수의 이름이 정확히 이 다섯 파일에 있다 — 하나가 다른 파일로 옮겨가도 잡는다", () => {
    const 기대 = [
      ["assets.ts", "seedSampleAssetsIfEmpty"],
      ["assets.ts", "seedSampleVulnHostIfEmpty"],
      ["maintenance.ts", "seedSamplesIfEmpty"],
      ["tasks.ts", "seedSampleRemediationTasksIfEmpty"],
      ["securityproducts.ts", "seedSampleProductsIfEmpty"],
      ["cti.ts", "seedSampleFindingsIfEmpty"],
    ] as const;
    for (const [file, fn] of 기대) {
      const src = fs.readFileSync(path.join(ENGINE, file), "utf8");
      expect(src, `${file}에 ${fn}이 없다`).toMatch(new RegExp(`function ${fn}\\(\\)`));
    }
  });
});

describe("② 그 여섯이 전부 판정(예시데이터뿐인가)의 소스에 이름으로 나타나는가", () => {
  it("assets.ts 소스가 점검·조치·제품·CTI 네 시드의 식별 표식을 전부 담고 있다", () => {
    const src = fs.readFileSync(path.join(ENGINE, "assets.ts"), "utf8");
    // 점검 6쌍 — maintenance.ts:406-464 seedSamplesIfEmpty()의 title과 글자까지 같아야 한다.
    const 점검제목 = [
      "방화벽 정책 정기 점검", "VPN 게이트웨이 인증서 점검", "프롬프트 가드레일 점검",
      "WAF 룰셋 점검", "학습데이터 접근권한 점검", "오탐 룰 점검",
    ];
    for (const t of 점검제목) expect(src, `점검 시드 제목 "${t}"이 판정 소스에 없다`).toContain(t);
    // 제품 4종 — securityproducts.ts:536-556 seedSampleProductsIfEmpty()의 name과 글자까지 같아야 한다.
    const 제품이름 = ["경계 방화벽 (FW-01)", "임직원 단말 EDR", "정보유출 방지 (DLP)", "웹방화벽 (WAF-01)"];
    for (const n of 제품이름) expect(src, `제품 시드 이름 "${n}"이 판정 소스에 없다`).toContain(n);
    // 조치 시드 공통 담당자 — tasks.ts:252 seedSampleRemediationTasksIfEmpty().
    expect(src, "조치 시드 표식(담당자=샘플담당)이 판정 소스에 없다").toContain("샘플담당");
    // CTI 시드 공통 출처 — cti.ts:230 seedSampleFindingsIfEmpty().
    expect(src, "CTI 시드 표식(출처=샘플(데모))이 판정 소스에 없다").toContain("샘플(데모)");
    // 자산 시드(기존부터 있던 것) — 판정을 넓히며 지운 게 아닌지 확인.
    expect(src).toContain("SAMPLE_ASSET_IDS");
    expect(src).toContain("SAMPLE_VULN_HOST_ID");
  });

  it("★ 이 감시가 헛돌고 있지 않다 — 판정 함수가 실제로 살아서 다섯 갈래를 구분한다", () => {
    resetAssetsForTests();
    resetMaintenanceForTests();
    resetTasksForTests();
    resetSecurityProductsForTests();
    resetFeedsForTests();

    // 아무것도 없으면 false.
    expect(예시데이터뿐인가()).toBe(false);

    // 진짜 자산 하나 + 점검 시드 하나만 남아도 계속 true(이 항목이 고치려던 사각지대).
    registerAsset({ id: "seeddisc-real", name: "진짜 자산", path: "/srv/real", assetType: "LLM 서비스", owner: "보안팀" });
    createMaintenanceItem({ title: "오탐 룰 점검", productName: "샘플-이상행위 탐지 엔진", scheduleDate: "2026-01-01" });
    expect(예시데이터뿐인가(), "점검 시드가 남았는데도 예시 고지가 꺼졌다").toBe(true);

    // 점검 시드까지 치우고 조치·제품·CTI도 전부 비면 false로 돌아온다(하드코딩 true가 아니다).
    resetMaintenanceForTests();
    expect(예시데이터뿐인가(), "판정이 늘 true로 굳어 있다 — 감시가 헛돈다").toBe(false);

    createProduct({ name: "임직원 단말 EDR", category: "EDR" });
    expect(예시데이터뿐인가()).toBe(true);
  });
});

describe("③ 머리말이 「숫자를 주장하는 도구」에서 실제로 불리는가 — agenttools 소스 감시", () => {
  it("정의는 한 곳뿐이고, 부르는 자리는 정확히 9곳이다(7개 도구 — 결재·점검 두 곳은 갈래가 둘)", () => {
    // 부르는 곳: today(1) · approval_status(취약점 결재/점검 승인 갈래 2) · product_status(1) ·
    //   maintenance_status(미완료 있음/없음 갈래 2) · urgent_todo(1) · kpi_status(1) · exec_brief(1).
    // ⚠ product_status·maintenance_status는 2026-09-13 이전엔 0곳이었다(이 항목이 고친 구멍).
    const src = agenttoolsSource();
    const 정의 = (src.match(/function 예시데이터머리말\(\)/g) ?? []).length;
    const 전체 = (src.match(/예시데이터머리말\(/g) ?? []).length;
    expect(정의, "예시데이터머리말은 한 곳에만 정의한다").toBe(1);
    expect(전체 - 정의, "부르는 자리 수가 바뀌었다 — 늘었으면 이 숫자를, 줄었으면 원인을 먼저 확인한다").toBe(9);
  });

  it("runMaintenanceStatus·runProductStatus 본문에 머리말 호출이 있다 — 이 항목이 새로 붙인 두 곳", () => {
    const src = agenttoolsSource();
    for (const fn of ["function runMaintenanceStatus", "function runProductStatus"]) {
      const i = src.indexOf(fn);
      expect(i, `${fn}을 못 찾았다`).toBeGreaterThanOrEqual(0);
      const 본문 = src.slice(i, i + 2000);
      expect(본문, `${fn}이 숫자를 말하면서도 예시 고지가 없다`).toContain("예시데이터머리말(");
    }
  });

  it("runThreats에는 붙이지 않는다 — 줄마다 「출처 샘플(데모)」가 이미 찍혀 스스로 밝힌다(설계관 지시서 근거)", () => {
    const src = agenttoolsSource();
    const i = src.indexOf("export async function runThreats");
    expect(i).toBeGreaterThanOrEqual(0);
    const 본문 = src.slice(i, i + 2500);
    expect(본문, "runThreats는 이번 범위 밖이다 — 붙이면 지시서와 어긋난다").not.toContain("예시데이터머리말(");
  });
});
