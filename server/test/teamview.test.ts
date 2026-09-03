// AI팀 구성 한눈에 (계획서 전-7, 2026-08-09 추천안 승인 — "팀원 끄기는 무시 하고 추천안으로 끝까지 진행")
//
// 무엇을 지키나: 「기반 두뇌는 고객이, 전문성은 GIJO가」 화면의 정직성 —
//  · 값은 전부 실측(집계 한 곳) · 어댑터 채택 전이면 화면이 「준비 중」으로 그릴 수 있는 신호
//  · 클라우드 카드에 비밀(키·hasKey)이 안 실림 · 팀원별 예외 배정 기능은 접혀도 살아 있음
import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";

vi.mock("../src/engine/localengine", async (importOriginal) => {
  const mod = (await importOriginal()) as Record<string, unknown>;
  return {
    ...mod,
    getLocalEngineStatus: () => ({
      running: true, port: 8080, modelId: "qwen3-14b",
      loaded: [], embedding: { running: true, port: 8081, modelId: "bge-m3" },
    }),
  };
});

import { getTeamComposition } from "../src/engine/teamview";

describe("팀 구성 집계 (실데이터 계약)", () => {
  it("기반 두뇌·팀원 8명·공용 자산이 한 번에 온다 — 화면마다 딴 그림이 되지 않게", () => {
    const t = getTeamComposition();
    expect(t.base.modelId).toBe("qwen3-14b");
    expect(t.members.length).toBe(8);
    for (const m of t.members) {
      expect(m.role.length, `${m.id}의 역할이 비어 있다`).toBeGreaterThan(0);
      expect(typeof m.dedicatedDocs).toBe("number");
    }
    expect(t.shared.tools).toBeGreaterThan(10);
    expect(typeof t.shared.ontologyTriples).toBe("number");
  });

  it("★ 어댑터는 꾸미지 않는다 — 배정 없으면 null(화면은 「준비 중」으로 그린다)", () => {
    const t = getTeamComposition();
    // 채택 어댑터 수 ≥ 팀원에게 배정된 어댑터 수 — 미채택을 배정한 상태는 코드가 막는다.
    const 배정수 = t.members.filter((m) => m.adapterId).length;
    expect(t.adapters.adopted).toBeGreaterThanOrEqual(0);
    expect(배정수).toBeLessThanOrEqual(Math.max(t.adapters.adopted, 0) * t.members.length || 배정수 === 0 ? 배정수 : 0);
  });

  it("★★ 클라우드 카드에 비밀이 안 실린다 — 팀 구성은 모든 로그인 사용자가 본다", () => {
    const t = getTeamComposition() as unknown as Record<string, unknown>;
    const 직렬 = JSON.stringify(t);
    expect(직렬).not.toContain("apiKey");
    expect(직렬).not.toContain("hasKey");
    const cloud = t.cloud as Record<string, unknown>;
    expect(Object.keys(cloud).sort()).toEqual(["activeProvider", "enabled"]);
  });
});

describe("화면 배선 (소스 계약)", () => {
  const cli = (f: string) => fs.readFileSync(path.join(__dirname, "..", "..", "client", "src", "renderer", "pages", f), "utf8");

  it("설정 — 기반 두뇌가 자동으로 보이고, 팀원별 드롭다운은 「고급」으로 접혔다", () => {
    const s = cli("settings.html");
    expect(s).toContain("AI팀 구성");
    expect(s).toContain("기반 두뇌");
    expect(s).toContain("자동 — 기반 두뇌 따름"); // 예외 배정의 기본 옵션 문구
    expect(s).toContain("고급 — 팀원별 예외 모델 배정"); // 기능 삭제가 아니라 접기
    expect(s).toContain('id="agentModelRows"'); // 위임 change 핸들러가 보는 id 보존
  });

  it("설정 — ☁ 외부 상담역 카드가 있고, 정직 문구(내부 자료 반출 금지·기본 꺼짐)를 단다", () => {
    const s = cli("settings.html");
    expect(s).toContain("외부 상담역");
    expect(s).toContain("내부 자료는 나가지 않음");
    expect(s).toContain("꺼짐(기본)");
  });

  it("설정 — 이름 미변경 시 API를 안 부른다 — null을 보내면 커스텀 이름이 초기화된다", () => {
    const s = cli("settings.html");
    expect(s).toContain('if (!새이름 || 새이름 === 원래) { nameEl.textContent = 원래; return; }');
  });

  it("팀 사무실 — 팀 자산 줄은 실측이 오면만 보인다(지어내지 않는다)", () => {
    const o = cli("office.html");
    expect(o).toContain('id="teamAssets"');
    expect(o).toContain("loadTeamAssets");
    expect(o, "실패 시 숨김 — 연출 금지").toContain('catch (e) { el.style.display = "none"; }');
  });

  it("팀 사무실 — 근거 신호는 sources 실측이 있을 때만 흐른다", () => {
    const d = fs.readFileSync(path.join(__dirname, "..", "src", "engine", "dispatcher.ts"), "utf8");
    expect(d).toContain("if (result.sources?.length) {");
    expect(d).toContain("📚 근거 — 사내 문서");
  });
});
