// 등록 장비 하드닝 점검(대화, 원격) — 2026-09-12 설계관 지시서 「hardeningtargets 수동 실행 라우트」.
//
// 뿌리(계획서 §13.5.2 「9/17~24」 미완 항목, 대장 2026-08-19:275 「정직성 구멍」):
//   hardeningtargets.ts에는 등록 대상을 지금 한 번 점검하는 수동 실행 HTTP 라우트가 이미 있는데
//   (POST /api/hardening/targets/:id/scan · admin 전용 · runScanForTarget), 대화창에서 그 라우트로
//   가는 길이 하나도 없었다. 대화의 run_hardening_scan은 창구 주석대로 **항상 self**이고 target
//   인자는 「표시용 라벨」일 뿐이라, "FW-01 하드닝 점검 돌려줘"도 실제로는 우리 서버 자신을
//   점검했다. 뿌리는 라우팅 정규식이 아니라 **도구 공백**(원격 실행을 대화에서 부를 길이 없었다).
//
// 메인 결정(안C, 2026-09-12) — FORCED_INTENTS 배열은 그대로 두고, agentloop.ts [3] 분기
//   (run_hardening_scan) 안에서 대상찾기가 등록 대상을 맞히면 새 쓰기 도구 scan_hardening_target을,
//   못 맞히면 종전대로 run_hardening_scan을 돌려준다(데이터의존: true — route-explain이 조건부로
//   적는다). 새 도구는 write:true·requiredRole:"admin", 승인 뒤 runScanForTarget(…, "chatbot", …)
//   로만 실행한다(runHardeningScan 직접 호출 금지 — 이력·감사·상관 투영·악화 알림이 한 곳에서 끝남).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";

// ⚠ 실 셸/네트워크 없이 완주시킨다 — hardening-selfscan-off.test.ts와 같은 방식이다.
//   execFile을 빈 출력으로 갈아 끼우면 hostRunner(로컬)·targetRunner(SSH) **둘 다** 이 하나로
//   지나간다(같은 execFile 하나를 공유 — hardeningscan.ts:56·71). 제품 경로(창구→엔진→러너)는
//   그대로 다 지나가므로 도달 잣대를 낮추지 않는다 — 밖으로 나가는 명령만 없앤다.
vi.mock("node:child_process", async (importOriginal) => {
  const 원본 = await importOriginal<typeof import("node:child_process")>();
  const 가짜 = (...인자: unknown[]) => {
    const 콜백 = 인자.find((a) => typeof a === "function") as ((e: unknown, o: string, r: string) => void) | undefined;
    콜백?.(null, "", "");
    return undefined;
  };
  return { ...원본, execFile: 가짜 as unknown as typeof 원본.execFile };
});

vi.mock("../src/engine/llm", () => ({
  setRagProvider: vi.fn(), hasRagProvider: vi.fn(() => false), onChatRecorded: vi.fn(), chatLogListenerCount: vi.fn(() => 0),
  chat: vi.fn(async () => "[mock] LLM 응답"),
  embed: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
}));

// ⚠ 스파이로 감싼다(나머지 exports는 실제 구현 그대로) — 「승인 전에는 아무것도 안 돈다」·
//   「실행 지시는 여전히 run_hardening_scan에 닿는다」가 **제품 경로**로 실제 함수를 안 부르는지
//   재려면 정규식이 아니라 이 창구를 봐야 한다(hardening-unchecked-routing.test.ts:39-45와 같은 자세).
vi.mock("../src/engine/agenttools/handlers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/engine/agenttools/handlers")>();
  return {
    ...actual,
    runHardeningScanTool: vi.fn(actual.runHardeningScanTool),
    runScanHardeningTargetTool: vi.fn(actual.runScanHardeningTargetTool),
  };
});

import { forcedToolFor, runAgentLoop, resetContextForTests } from "../src/engine/agentloop";
import { executeApprovedTool, findAgentTool } from "../src/engine/agenttools";
import { runHardeningScanTool, runScanHardeningTargetTool } from "../src/engine/agenttools/handlers";
import { createTarget, resetHardeningForTests, listRuns } from "../src/engine/hardeningtargets";
import { 자기점검차단안내 } from "../src/engine/hardeningscan";
import { listAudit, resetAuditForTests } from "../src/engine/audit";
import { listWork, resetWorkForTests } from "../src/engine/worklog";
import { 실제도착 } from "./helpers/routing";

beforeEach(() => {
  resetHardeningForTests();
  resetWorkForTests();
  resetAuditForTests();
  resetContextForTests();
  vi.mocked(runHardeningScanTool).mockClear();
  vi.mocked(runScanHardeningTargetTool).mockClear();
});

const ENV = "GIJO_NO_SELF_SCAN";
const 원래값 = process.env[ENV];
afterEach(() => {
  if (원래값 === undefined) delete process.env[ENV];
  else process.env[ENV] = 원래값;
});

describe("① 등록 대상 0건(기본 DB) — [37] 8문장 유지", () => {
  // 실측(설계관 지시서 evidence #9) — 이 여덟은 지금 전부 run_hardening_scan(self)로 간다.
  // 등록 대상이 없으니 새 갈래(scan_hardening_target)로 갈아탈 수 없어 **그대로**여야 한다.
  const 여덟문장 = [
    "FW-01 하드닝 점검 돌려줘",
    "웹서버-01 보안설정 점검 실행해줘",
    "10.8.0.11 장비 하드닝 점검해줘",
    "방화벽-01 CCE 기준 점검 돌려줘",
    "스위치-02 KISA 기준으로 점검 수행해줘",
    "고위험 장비만 하드닝 점검 돌려줘",
    "등록 장비 전부 CCE 점검 돌려줘",
    "FW-01 하드닝 점검 해줘",
  ];
  it("전부 run_hardening_scan에 닿는다 — 도착지가 안 바뀐다", () => {
    for (const q of 여덟문장) expect(실제도착(q, "admin"), q).toBe("run_hardening_scan");
  });

  it("장비 코드 꼴 낱말이 없는 둘은 args에 표식이 안 붙는다(순수 글자 판정 그대로)", () => {
    for (const q of ["고위험 장비만 하드닝 점검 돌려줘", "등록 장비 전부 CCE 점검 돌려줘"]) {
      const r = forcedToolFor(q, { role: "admin" } as never);
      expect(r?.tool, q).toBe("run_hardening_scan");
      expect(r?.데이터의존, `${q} — 후보가 없으면 데이터의존이 아니다`).toBeUndefined();
    }
  });

  it("장비 코드 꼴 낱말이 있는 여섯은 데이터의존이 붙는다(안 붙이면 route-explain이 :memory: DB를 확정으로 오인한다)", () => {
    for (const q of ["FW-01 하드닝 점검 돌려줘", "웹서버-01 보안설정 점검 실행해줘", "10.8.0.11 장비 하드닝 점검해줘", "방화벽-01 CCE 기준 점검 돌려줘", "스위치-02 KISA 기준으로 점검 수행해줘", "FW-01 하드닝 점검 해줘"]) {
      const r = forcedToolFor(q, { role: "admin" } as never);
      expect(r?.tool, q).toBe("run_hardening_scan");
      expect(r?.데이터의존, q).toBe(true);
    }
  });
});

describe("② 등록 대상이 맞으면 scan_hardening_target으로 갈아탄다(안C 핵심)", () => {
  // ⚠ 2026-09-13 검토관 [상] 수리 — 앞 판은 `target: t.id`를 넘겨 **결재판 필수칸이 잠겼다.**
  //   id는 지시문에 없는 글자라 buildApproval이 guess로 보고 필수칸을 비운다(registry.ts:2601).
  //   그래서 이제 **사람이 친 낱말**을 넘긴다 — 아래 ②-b가 그 결과(said 배지·missing 0)를 문다.
  it("정확히 라벨이 맞으면 **사람이 친 낱말**을 target으로 돌려준다(id가 아니다 — 결재판이 잠긴다)", () => {
    createTarget({ label: "FW-01", host: "10.9.9.5", port: 22, username: "a", authMethod: "key", secret: "/k" });
    const r = forcedToolFor("FW-01 하드닝 점검 돌려줘", { role: "admin" } as never);
    expect(r?.tool).toBe("scan_hardening_target");
    expect(r?.args.target).toBe("FW-01");
    expect(r?.args.target, "id를 넘기면 지시문에 없는 글자라 결재판이 필수칸을 비운다").not.toMatch(/^tgt-/);
    // 문장이 기준을 말하지 않았으면 **싣지 않는다** — 핸들러가 등록 기준(t.standard)을 쓴다.
    expect(r?.args.standard).toBeUndefined();
    expect(r?.데이터의존).toBe(true);
  });

  it("기준(CIS)도 함께 넘어간다 — 문장이 기준을 **명시**했을 때만 싣는다", () => {
    createTarget({ label: "스위치-02", host: "10.9.9.6", port: 22, username: "a", authMethod: "key", secret: "/k" });
    const r = forcedToolFor("스위치-02 CIS 기준으로 점검해줘", { role: "admin" } as never);
    expect(r?.tool).toBe("scan_hardening_target");
    expect(r?.args.standard).toBe("cis");
  });

  it("IP를 그대로 대면 host로 찾는다(넘기는 값은 친 낱말 그대로)", () => {
    createTarget({ label: "웹서버", host: "10.8.0.11", port: 22, username: "a", authMethod: "key", secret: "/k" });
    const r = forcedToolFor("10.8.0.11 장비 하드닝 점검해줘", { role: "admin" } as never);
    expect(r?.tool).toBe("scan_hardening_target");
    expect(r?.args.target).toBe("10.8.0.11");
  });

  it("admin이 아니면(권한 문턱이 라우팅에도 반영) 등록 대상이 있어도 종전대로 self다", () => {
    createTarget({ label: "FW-01", host: "10.9.9.5", port: 22, username: "a", authMethod: "key", secret: "/k" });
    const r = forcedToolFor("FW-01 하드닝 점검 돌려줘", { role: "security_officer" } as never);
    expect(r?.tool).toBe("run_hardening_scan");
  });

  // ⚠ 2026-09-13 검토관 수리 — verify.html can[]이 「이렇게 치세요」라고 적어 준 말이 **담당자에겐
  //   거짓**이었다(그 화면을 주로 보는 사람이 비-admin이다). 안내가 전제를 밝히는지 소스로 문다.
  it("verify.html 안내가 전제(관리자)를 밝힌다 — 담당자가 그대로 치면 self로 떨어지기 때문", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(path.join(__dirname, "../src/engine/screenguide.ts"), "utf8");
    const 줄 = src.split("\n").find((l) => l.includes("FW-01 하드닝 점검 돌려줘") && !l.trimStart().startsWith("//"));
    expect(줄, "verify.html can[]에서 이 안내가 사라졌다").toBeTruthy();
    expect(줄!, "전제를 안 밝히면 담당자가 그대로 치고 self 점검을 받는다").toContain("관리자");
    expect(줄!, "바깥을 작은따옴표로 — 이스케이프하면 guidance-check 수확 정규식이 원리상 못 읽는다").not.toContain('\\"');
  });

  it("등록 안 된 이름을 대면 못 맞혀 self로 남는다(오탐 아님)", () => {
    createTarget({ label: "FW-01", host: "10.9.9.5", port: 22, username: "a", authMethod: "key", secret: "/k" });
    const r = forcedToolFor("FW-99 하드닝 점검 돌려줘", { role: "admin" } as never);
    expect(r?.tool).toBe("run_hardening_scan");
  });
});

describe("③ 이웃 뺏김 0 — 등록 대상이 있어도 이웃 도착지는 그대로다", () => {
  beforeEach(() => {
    createTarget({ label: "FW-01", host: "10.9.9.5", port: 22, username: "a", authMethod: "key", secret: "/k" });
  });

  it("조회·스케줄·probe·등록류는 여전히 강제도구 밖(⑨)이거나 제 갈래로 간다", () => {
    for (const [q, 기대] of [
      ["FW-01 접속되나 확인해줘", null],
      ["FW-01 정기점검 24시간마다 걸어줘", null],
      ["FW-01 정기점검 꺼줘", null],
      ["점검 대상 등록해줘", null],
      ["등록된 점검 대상 뭐 있어?", null],
      ["FW-01 점검 결과 알려줘", null],
      ["하드닝 점검 실행 이력 보여줘", null],
      ["정기점검 언제 돌아?", "hardening_schedule_list"],
    ] as const) {
      expect(실제도착(q, "admin"), q).toBe(기대);
    }
  });

  it("실행 지시 10문장(기존 계약)이 그대로 self로 남는다 — 장비 코드가 없어 후보 자체가 없다", () => {
    for (const q of [
      "보안장비 하드닝 점검 실행해줘", "CCE 기준 점검 돌려줘", "하드닝 점검해줘",
      "하드닝 점검 돌려줘", "보안설정 점검 해줘", "CIS 기준으로 점검해줘",
      "네트워크 장비 점검해줘", "내 PC 보안설정 점검해줘", "취약점 진단해줘",
      "내 PC 보안 설정 점검해줘",
    ]) {
      expect(실제도착(q, "admin"), q).toBe("run_hardening_scan");
    }
  });
});

describe("④ 승인 경로 — 결재판을 띄우고 승인 전에는 아무것도 돌지 않는다", () => {
  it("등록 대상을 지목하면 결재판이 뜨고 새 핸들러는 안 불린다", async () => {
    const t = createTarget({ label: "FW-01", host: "10.9.9.5", port: 22, username: "a", authMethod: "key", secret: "/k" });
    const r = await runAgentLoop("FW-01 하드닝 점검 돌려줘", "", { role: "admin" });
    expect(r, "루프가 아무것도 안 돌려줬다").not.toBeNull();
    expect(r!.approval?.tool).toBe("scan_hardening_target");
    expect(r!.approval?.args.target).toBe("FW-01");
    expect(runScanHardeningTargetTool, "승인 전에 새 핸들러가 불렸다").not.toHaveBeenCalled();
    expect(listRuns(t.id), "승인 전인데 점검 이력이 남았다").toHaveLength(0);
  });

  // ★★ 2026-09-13 검토관 [상] 재발 감시 — **args만 보면 못 잡는다.**
  //   앞 판 시험은 `approval?.args.target`(buildApproval이 안 건드리는 원 args)만 봐서 초록이었는데,
  //   담당자가 보는 칸(fields)은 비어 있었고 missing=["target"]이라 **승인 단추가 잠겨** 있었다
  //   (chatwidget.js:186·204-206). 그래서 칸·잠금·문장을 **셋 다** 문다.
  it("결재판 「대상 장비」 칸이 채워지고 승인이 잠기지 않는다(said 배지)", async () => {
    createTarget({ label: "FW-01", host: "10.9.9.5", port: 22, username: "a", authMethod: "key", secret: "/k" });
    const r = await runAgentLoop("FW-01 하드닝 점검 돌려줘", "", { role: "admin" });
    const ap = r!.approval!;
    const 칸 = ap.fields.find((f) => f.key === "target")!;
    expect(칸.value, "필수칸이 비면 화면이 승인을 막는다").toBe("FW-01");
    expect(칸.source, "지시문에 있는 낱말이므로 근거는 said다").toBe("said");
    expect(ap.missing, "필수칸이 비어 승인 단추가 잠겼다").toHaveLength(0);
    expect(ap.effect, "칸은 찼는데 문장은 되묻고 있다").not.toContain("어느 장비를 점검할지");
    expect(ap.effect).toContain("FW-01");
  });

  it("결재판 문장이 **접속 여부**를 정직하게 말한다 — 로컬 등록 대상엔 「접속해」라 안 한다", async () => {
    const 원격 = createTarget({ label: "FW-01", host: "10.9.9.5", port: 22, username: "a", authMethod: "key", secret: "/k" });
    const 로컬 = createTarget({ label: "옛로컬-01", host: "local", port: 22, authMethod: "local" });
    const tool = findAgentTool("scan_hardening_target")!;
    expect(tool.effect!({ target: 원격.label })).toContain("접속해");
    const 로컬글 = tool.effect!({ target: 로컬.label });
    expect(로컬글, "붙지도 않는 장비를 「접속해 실행합니다」로 적으면 안 된다").not.toContain("접속해");
    expect(로컬글).toContain("이 서버 자신");
  });

  it("등록 대상이 없으면(자기점검) 결재판 없이 바로 실행된다 — 종전 동작 그대로", async () => {
    const r = await runAgentLoop("하드닝 점검해줘", "", { role: "admin" });
    expect(r).not.toBeNull();
    expect(r!.approval).toBeFalsy();
    expect(r!.toolCalls.some((c) => c.tool === "run_hardening_scan")).toBe(true);
    expect(runHardeningScanTool).toHaveBeenCalled();
    expect(runScanHardeningTargetTool).not.toHaveBeenCalled();
  });
});

describe("⑤ 권한 문턱 — requiredRole:admin이 실행 문턱에서도 막는다", () => {
  it("admin이 아니면 값이 맞아도 실행이 막힌다(목록에서 숨기는 것과는 별개 문턱)", async () => {
    const t = createTarget({ label: "FW-01", host: "10.9.9.5", port: 22, username: "a", authMethod: "key", secret: "/k" });
    await expect(executeApprovedTool("scan_hardening_target", { target: t.id }, "security_officer")).rejects.toThrow("관리자만 실행할 수 있습니다");
    expect(runScanHardeningTargetTool).not.toHaveBeenCalled();
    expect(listRuns(t.id)).toHaveLength(0);
  });

  it("admin이면 완주하고 이력·감사·작업원장을 남긴다(source: chat — 스케줄러로 오표기되지 않는다)", async () => {
    const t = createTarget({ label: "FW-01", host: "10.9.9.5", port: 22, username: "a", authMethod: "key", secret: "/k" });
    const out = await executeApprovedTool("scan_hardening_target", { target: t.id }, "admin");
    expect(typeof out).toBe("string");
    expect(runScanHardeningTargetTool).toHaveBeenCalledTimes(1);

    const runs = listRuns(t.id);
    expect(runs, "runScanForTarget이 이력을 안 남겼다").toHaveLength(1);
    expect(runs[0].source).toBe("chatbot");

    const 감사 = listAudit({ limit: 50 }).filter((a) => a.action.includes("하드닝 정기점검"));
    expect(감사.length, "감사 기록이 안 남았다").toBeGreaterThan(0);

    // 작업 원장 — hardeningscan.ts:699 하드코딩 "schedule" 정정이 실제로 먹었는지.
    const 원장 = listWork(Date.now() - 60_000).filter((w) => w.kind === "hardening_scanned");
    expect(원장.length, "작업 원장에 하드닝 점검이 안 남았다").toBeGreaterThan(0);
    expect(원장[0].source, "대화에서 돌린 점검이 스케줄러 것으로 적혔다").toBe("chat");
  });

  it("등록 안 된 대상이면 값을 문장으로 정직하게 말하고 아무것도 안 남긴다", async () => {
    const out = await executeApprovedTool("scan_hardening_target", { target: "없는대상" }, "admin");
    expect(out).toContain("검색되지 않았습니다");
    expect(listAudit({ limit: 50 }).filter((a) => a.action.includes("하드닝 정기점검"))).toHaveLength(0);
  });
});

describe("⑥ 자기점검 끈 설치본(4100 전제) — 등록 원격 대상은 그대로 돈다", () => {
  // ⚠ 2026-09-13 검토관 [하] 수리 — 두 단언 모두 **제품 상수와 글자로 대조**한다.
  //   앞 판 ⑥-1은 `not.toContain("점검을 지원하지 않")`이었는데 그 문자열은 **제품 어디에도 없다**
  //   (실측: server/src 전체 grep 0건) — 어떤 코드에서도 못 나오니 늘 초록인 헛단언이었다.
  //   앞 판 ⑥-2는 `out.length > 0`뿐이라 차단 안내인지 「검색되지 않았습니다」인지 못 갈랐다.
  it("GIJO_NO_SELF_SCAN=1이어도 원격(key) 대상 점검은 막히지 않는다", async () => {
    process.env[ENV] = "1";
    const t = createTarget({ label: "FW-01", host: "10.9.9.5", port: 22, username: "a", authMethod: "key", secret: "/k" });
    const out = await executeApprovedTool("scan_hardening_target", { target: t.id }, "admin");
    expect(out, "원격 대상인데 자기점검 차단에 걸렸다").not.toBe(자기점검차단안내);
    expect(out, "점검 요약이 아니라 안내로 끝났다").toContain("준수율");
    expect(listRuns(t.id)).toHaveLength(1);
  });

  it("등록됐지만 로컬(자기점검 끈 상태)이면 차단 안내를 **글자 그대로** 돌려준다", async () => {
    delete process.env[ENV];
    const t = createTarget({ label: "옛로컬", host: "local", port: 22, authMethod: "local" });
    process.env[ENV] = "1";
    const out = await executeApprovedTool("scan_hardening_target", { target: t.id }, "admin");
    expect(listRuns(t.id)).toHaveLength(0);
    expect(out, "차단 안내가 아니라 다른 말(대상 검색 실패 등)로 끝났다").toBe(자기점검차단안내);
  });
});

describe("⑧ 등록 기준(t.standard) 존중 — 대화 경로가 kisa로 덮지 않는다", () => {
  // ⚠ 2026-09-13 검토관 [중] 수리. 앞 판은 라우팅이 늘 standard를 실어 보내(문장에 낱말이 없으면
  //   "kisa") 핸들러의 `?? t.standard` 갈래가 **원리상 도달 불가**였다. kisa_net(Cisco N-시리즈)으로
  //   등록한 스위치에 UNIX U-시리즈 명령이 나가 준수율이 실제와 무관하게 기록되고, 화면 [점검]
  //   버튼(HTTP, hardeningtargets.ts:360)과 **두 창구가 다른 숫자**를 냈다.
  it("기준 낱말이 없으면 args에 standard를 안 싣는다", () => {
    createTarget({ label: "SW-01", host: "10.9.9.7", port: 22, username: "a", authMethod: "key", secret: "/k", standard: "kisa_net" });
    const r = forcedToolFor("SW-01 하드닝 점검 돌려줘", { role: "admin" } as never);
    expect(r?.tool).toBe("scan_hardening_target");
    expect(r?.args.standard, "값을 실으면 등록 기준이 영영 안 쓰인다").toBeUndefined();
  });

  it("승인 실행이 등록 기준(kisa_net)으로 돈다 — 이력에 그 기준이 적힌다", async () => {
    const t = createTarget({ label: "SW-01", host: "10.9.9.7", port: 22, username: "a", authMethod: "key", secret: "/k", standard: "kisa_net" });
    await executeApprovedTool("scan_hardening_target", { target: "SW-01" }, "admin");
    const runs = listRuns(t.id);
    expect(runs).toHaveLength(1);
    expect(runs[0].standard, "등록 기준을 무시하고 kisa로 돌았다").toBe("kisa_net");
  });

  it("빈 문자열이 와도(결재판이 빈 선택칸을 그렇게 넘긴다) 등록 기준으로 떨어진다", async () => {
    const t = createTarget({ label: "SW-02", host: "10.9.9.8", port: 22, username: "a", authMethod: "key", secret: "/k", standard: "cis" });
    await executeApprovedTool("scan_hardening_target", { target: "SW-02", standard: "" }, "admin");
    expect(listRuns(t.id)[0].standard).toBe("cis");
  });

  it("문장이 기준을 명시하면 그 기준이 이긴다 — 등록 기준을 덮는다", async () => {
    const t = createTarget({ label: "SW-03", host: "10.9.9.9", port: 22, username: "a", authMethod: "key", secret: "/k", standard: "kisa_net" });
    await executeApprovedTool("scan_hardening_target", { target: "SW-03", standard: "cis" }, "admin");
    expect(listRuns(t.id)[0].standard).toBe("cis");
  });
});

describe("⑦ 작업 원장 source 옵션화 — HTTP 수동 실행(manual)도 함께 정정됐다", () => {
  it("runScanForTarget(source:'manual')은 작업 원장에 api로 남는다", async () => {
    const { runScanForTarget } = await import("../src/engine/hardeningtargets");
    const t = createTarget({ label: "FW-01", host: "10.9.9.5", port: 22, username: "a", authMethod: "key", secret: "/k" });
    await runScanForTarget(t, "kisa", "manual", "담당자");
    const 원장 = listWork(Date.now() - 60_000).filter((w) => w.kind === "hardening_scanned");
    expect(원장.length).toBeGreaterThan(0);
    expect(원장[원장.length - 1].source).toBe("api");
  });

  it("runScanForTarget(source:'scheduled')은 종전대로 schedule이다 — 옵션화가 스케줄러 동작을 안 바꾼다", async () => {
    const { runScanForTarget } = await import("../src/engine/hardeningtargets");
    const t = createTarget({ label: "FW-01", host: "10.9.9.5", port: 22, username: "a", authMethod: "key", secret: "/k" });
    await runScanForTarget(t, "kisa", "scheduled", "scheduler");
    const 원장 = listWork(Date.now() - 60_000).filter((w) => w.kind === "hardening_scanned");
    expect(원장[원장.length - 1].source).toBe("schedule");
  });

  // ⚠ 2026-09-13 검토관 [중] 수리 — **정정이 반쪽이었다.** 화면 수동 self 점검
  //   (POST /api/hardening/scan, 라이트 lite-scan.html·terminal.html이 쓰는 유일한 점검 길)은
  //   runScanForTarget을 안 거치고 runHardeningScan을 직접 불러 기본값 "schedule"로 떨어졌다.
  //   커밋 메시지는 「대화·화면에서 돌린 점검이 전부 스케줄러로 적히던 것이 함께 고쳐진다」고
  //   약속했으므로 약속-코드 불일치이기도 하다.
  it("POST /api/hardening/scan(화면 수동 self 점검)도 api로 남는다 — 스케줄러가 아니다", async () => {
    const { createApp } = await import("../src/app");
    const app = createApp();
    const 로그인 = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });
    const res = await request(app)
      .post("/api/hardening/scan")
      .set("Authorization", `Bearer ${로그인.body.accessToken}`)
      .send({ standard: "kisa" });
    expect(res.status).toBe(200);
    const 원장 = listWork(Date.now() - 60_000).filter((w) => w.kind === "hardening_scanned");
    expect(원장.length, "화면 점검이 작업 원장에 안 남았다").toBeGreaterThan(0);
    expect(원장[원장.length - 1].source, "사람이 화면에서 누른 점검이 스케줄러 것으로 적혔다").toBe("api");
  });
});
