// chatlogorigin.test.ts — 문답의 출처(origin) 컬럼 계약 (증류학습 계획서 §3.6-2, 2026-09-03).
//
// ★ 왜 이 시험이 있나
//   같은 종류의 컬럼(topic, 2026-08-07)을 더할 때 서버는 다 고쳤는데 **클라 타입에 빠졌다** —
//   화면은 그 값을 쓰는데 타입엔 없어 아무도 몰랐다(설계관 2026-09-03 발견). 이번엔 INSERT 자리
//   두 곳 · 행 매핑 · 서버 타입 · 클라 타입을 한 시험이 함께 지킨다.
//   또 이름을 `source`로 하지 않는다 — 후보함의 source(어디서 찾았나)와 뜻이 다르다.
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { recordChatLog, listChatLogs, resetLearnloopForTests, CHAT_LOG_ORIGINS } from "../src/engine/learnloop";

const root = join(__dirname, "..");
const learnloopSrc = readFileSync(join(root, "src", "engine", "learnloop.ts"), "utf8");
const candSrc = readFileSync(join(root, "src", "engine", "learncandidates.ts"), "utf8");
const clientTypes = readFileSync(join(root, "..", "client", "src", "api", "llm-engine.ts"), "utf8");

describe("chat_logs.origin — 어떻게 생긴 문답인가", () => {
  beforeEach(() => resetLearnloopForTests());

  it("실대화 수집은 origin=chat로 남고 API에 실린다(옛 NULL 행도 chat으로 읽는다)", () => {
    recordChatLog("orchestrator", "미조치 취약점 알려줘", "미조치 취약점은 자산별로 정리해 드립니다. 우선순위는 악용 여부와 노출을 함께 봅니다.");
    const { logs } = listChatLogs(10, 0);
    expect(logs.length).toBe(1);
    expect(logs[0].origin).toBe("chat");
    expect(logs[0].teacher).toBeNull();
    expect(logs[0].cites).toEqual([]);
  });

  it("출처 값은 네 가지뿐이다", () => {
    expect([...CHAT_LOG_ORIGINS]).toEqual(["chat", "worksession", "seed", "distill"]);
  });

  it("INSERT 자리 두 곳 다 origin을 적는다 — 한 곳만 고치면 반쪽이다", () => {
    expect(learnloopSrc).toMatch(/INSERT INTO chat_logs \([^)]*origin\)[^;]*'chat'\)/);
    expect(candSrc).toMatch(/INSERT INTO chat_logs \([^)]*topic, origin\)/);
    expect(candSrc).toContain('origin: "worksession"');
    expect(candSrc).toContain('origin: "seed"');
    expect(candSrc).toMatch(/INSERT INTO chat_logs \([^)]*teacher, cites, promptHash\)[^;]*'distill'/);
  });

  it("클라 타입도 같은 컬럼을 안다(topic·origin·teacher·cites) — 서버만 고치고 끝내지 않는다", () => {
    const block = clientTypes.slice(clientTypes.indexOf("export interface LearnloopChatLog"), clientTypes.indexOf("export interface LearnloopRun"));
    for (const k of ["topic:", "origin:", "teacher:", "cites:"]) expect(block, `LearnloopChatLog에 ${k} 없음`).toContain(k);
    expect(clientTypes).toContain('source: "chatlog" | "worksession" | "distill"');
  });

  it("컬럼 이름은 origin이다 — source(후보함의 다른 축)와 섞지 않는다", () => {
    expect(learnloopSrc).not.toMatch(/ALTER TABLE chat_logs ADD COLUMN source/);
    expect(learnloopSrc).toMatch(/ALTER TABLE chat_logs ADD COLUMN origin TEXT/);
  });
});
