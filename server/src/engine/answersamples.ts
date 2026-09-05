// engine/answersamples.ts — **답 한 줄 표본**: 무엇으로 답했고 근거는 어땠나만 남긴다 (2026-09-06 · 계획서 전-4)
//
// ■ 왜 만들었나 — **측정 공백**(2026-09-06 설계관 실측)
//   「지어낸 82.3%」 사고를 조사하려니 **답 본문이 남는 저장소가 없었다.**
//     · chat_logs   = 학습 후보만 남는다(qa·noLearn·수집기 미등록이면 아무것도 없다)
//     · work_events = 도구 이름만 남는다(무슨 답을 했는지는 모른다)
//     · ops-sim.json= 하네스를 돌린 순간의 사진 한 장뿐이다(운영 실사용은 안 담긴다)
//   그래서 「배너가 실제로 얼마나 붙나 · 근거세기 분포가 어떤가 · 수치가 든 답이 몇 %인가」를
//   **아무도 답할 수 없었다.** 고친 뒤에 좋아졌는지도 같은 이유로 못 잰다.
//
// ■ 그런데 **본문은 저장하지 않는다** (이 파일의 가장 중요한 계약)
//   답 본문에는 사내 문서 조각·자산 이름·담당자 이름이 그대로 실린다. 그것을 새 표에 쌓으면
//   ⓐ 등급 게이트를 지나 온 내용이 등급 없는 표로 새고 ⓑ 백업·스냅샷에 실려 나간다.
//   그래서 **지문(sha256 앞 12자)만** 남긴다 — 같은 답이 반복되는지는 알 수 있고,
//   그 답이 무엇이었는지는 여기서 알 수 없다. 질문도 남기지 않는다(같은 이유).
//   ⚠ 이 계약을 깨려는 다음 사람에게: 본문이 필요하면 answer_feedback(사람이 직접 올린 지적)이나
//     chat_logs(학습 동의를 지난 것)를 쓴다. 여기는 **숫자를 세는 자리**다.
//
// ■ 보존 30일 — 추세를 보는 데 필요한 최소치다. 그 이상은 쌓아 봐야 아무도 안 본다.
import type { Express, Request } from "express";
import crypto from "node:crypto";
import { db, migrate } from "../db";
import { authMiddleware, adminMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import type { GijoUser } from "../auth/users";

migrate(
  "answer-samples-2026-09-06",
  `CREATE TABLE IF NOT EXISTS answer_samples (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     at INTEGER NOT NULL,
     day TEXT NOT NULL,          -- YYYY-MM-DD(KST) — 하루치 집계용
     agent TEXT,                 -- 답한 팀원(에이전트 id)
     route TEXT,                 -- 라우팅 action(chat·scan·report …)
     tool TEXT,                  -- 처음 돈 도구 이름(없으면 NULL = 자유 답)
     evidence TEXT,              -- 근거세기: 강함 | 약함 | NULL(재검색 안 돎)
     noevidence TEXT,            -- 근거없음 표식 종류(배너 5종) | NULL
     hasnum INTEGER NOT NULL,    -- 답에 사내 실적형 수치(백분율)가 들어 있나 0/1
     sha TEXT NOT NULL           -- 답 본문 지문 12자 — **본문은 저장하지 않는다**
   );
   CREATE INDEX IF NOT EXISTS idx_answer_samples_day ON answer_samples(day);`
);

/** 보존 30일 — 이보다 오래된 표본은 지운다(추세 확인에 필요한 최소치). */
export const 표본보존일 = 30;
/** 몇 번 쌓을 때마다 정리하나 — 매 insert마다 DELETE를 돌리지 않기 위한 주기(learnloop와 같은 방식). */
const 정리주기 = 200;
let 쌓인수 = 0;

const insertStmt = db.prepare(
  `INSERT INTO answer_samples (at, day, agent, route, tool, evidence, noevidence, hasnum, sha)
   VALUES (@at, @day, @agent, @route, @tool, @evidence, @noevidence, @hasnum, @sha)`
);

/** KST 기준 날짜(YYYY-MM-DD) — 보고서를 읽는 사람이 한국에 있다(ops-sim과 같은 규칙). */
function kst날짜(at: number): string {
  return new Date(at + 9 * 3600_000).toISOString().slice(0, 10);
}

export interface 답표본 {
  agent?: string | null;
  route?: string | null;
  tool?: string | null;
  근거세기?: "강함" | "약함";
  근거없음?: string | null;
  /** 답에 사내 실적형 수치가 들어 있나 — 판정은 citeguard.실적수치뽑기 한 곳이 한다. */
  수치있음: boolean;
  /** 답 본문 — **저장하지 않는다.** 지문을 만드는 데만 쓰고 즉시 버린다. */
  본문: string;
}

/**
 * 답 한 건을 표본으로 남긴다 — **실패해도 답을 막지 않는다**(측정이 제품을 죽이면 안 된다).
 * ⚠ qa·시험 답은 부르는 쪽에서 걸러 넘긴다(dispatcher). 여기서 다시 판정하지 않는다.
 */
export function recordAnswerSample(s: 답표본): void {
  try {
    const at = Date.now();
    insertStmt.run({
      at,
      day: kst날짜(at),
      agent: s.agent ?? null,
      route: s.route ?? null,
      tool: s.tool ?? null,
      evidence: s.근거세기 ?? null,
      noevidence: s.근거없음 ?? null,
      hasnum: s.수치있음 ? 1 : 0,
      sha: crypto.createHash("sha256").update(String(s.본문 ?? "")).digest("hex").slice(0, 12),
    });
    if (++쌓인수 >= 정리주기) { 쌓인수 = 0; pruneAnswerSamples(); }
  } catch { /* 표본 기록 실패가 답을 막지 않는다 */ }
}

/** 보존일이 지난 표본을 지운다. 돌려주는 값은 지운 건수. */
export function pruneAnswerSamples(보존일 = 표본보존일): number {
  const cutoff = Date.now() - 보존일 * 86400_000;
  return db.prepare("DELETE FROM answer_samples WHERE at < ?").run(cutoff).changes;
}

export interface 표본요약 {
  days: number;
  total: number;
  /** 근거세기별 답 수 — 키는 강함·약함·모름(재검색이 안 돈 답) */
  근거세기: Record<string, number>;
  /** 근거없음 표식별 답 수 — 키는 배너 종류(없으면 「없음」) */
  근거없음: Record<string, number>;
  /** 사내 실적형 수치가 든 답 수 */
  수치있는답: number;
  /** 수치가 들었는데 표식이 하나도 안 붙은 답 수 — **이 숫자가 사고의 크기다** */
  수치있고표식없음: number;
  일별: { day: string; n: number; 수치: number; 표식: number }[];
  /** 답한 팀원별 답 수 — **상위 10**(전체 종류 수는 종류수.agent) */
  agent별: 분포항[];
  /** 라우팅 action별 답 수 — 상위 10 */
  route별: 분포항[];
  /** 처음 돈 도구별 답 수 — 상위 10(도구를 안 쓴 답은 「자유 답(도구 없음)」) */
  tool별: 분포항[];
  /** 근거세기 × 근거없음 **교차** 분포 — 상위 10.
   *  왜 교차인가: 「강함인데 표식이 붙었다」·「모름인데 표식이 없다」처럼 **두 축이 만나는 칸**이
   *  실제 문제 자리다. 축을 따로 보면 그 칸이 안 보인다(각각의 합만 맞으면 멀쩡해 보인다). */
  교차: { 근거세기: string; 근거없음: string; n: number }[];
  /** 각 분포의 **전체 종류 수** — 위 목록은 상위 10만 준다.
   *  ⚠ 이 칸이 없으면 읽는 사람이 「이게 전부」로 읽는다. 10보다 크면 **잘린 것이다.** */
  종류수: { agent: number; route: number; tool: number; 교차: number };
}

/** 분포 한 칸 — 이름과 건수. */
export interface 분포항 { 이름: string; n: number }

/** 상위 N개만 추린다. 동수는 이름 순으로 갈라 **실행마다 순서가 흔들리지 않게** 한다
 *  (흔들리면 「어제와 달라졌다」가 데이터 변화인지 정렬 변덕인지 구분이 안 된다). */
function 상위(맵: Map<string, number>, n = 10): 분포항[] {
  return [...맵.entries()]
    .sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, n)
    .map(([이름, n2]) => ({ 이름, n: n2 }));
}

export function 표본요약내기(days = 7): 표본요약 {
  const cutoff = Date.now() - days * 86400_000;
  const rows = db.prepare("SELECT * FROM answer_samples WHERE at >= ? ORDER BY at DESC").all(cutoff) as {
    day: string; agent: string | null; route: string | null; tool: string | null;
    evidence: string | null; noevidence: string | null; hasnum: number;
  }[];
  const 근거세기: Record<string, number> = {};
  const 근거없음: Record<string, number> = {};
  // 누가·무엇으로 답했나 — 이 세 칸이 없어 **분포를 못 봤다**(2026-09-06 실측: 표에는 쌓이는데
  //   요약 API가 안 내려줘, 「어느 팀원이 근거 없이 답하나」를 아무도 답할 수 없었다).
  //   ⚠ NULL은 지우지 않고 **이름을 붙여 센다** — 「값이 없는 답이 몇 건인가」가 곧 배선 구멍의 크기다.
  const agent맵 = new Map<string, number>();
  const route맵 = new Map<string, number>();
  const tool맵 = new Map<string, number>();
  const 교차맵 = new Map<string, number>();
  const 세기 = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  const 일별맵 = new Map<string, { day: string; n: number; 수치: number; 표식: number }>();
  let 수치있는답 = 0, 수치있고표식없음 = 0;
  for (const r of rows) {
    const e = r.evidence ?? "모름";
    근거세기[e] = (근거세기[e] ?? 0) + 1;
    const n = r.noevidence ?? "없음";
    근거없음[n] = (근거없음[n] ?? 0) + 1;
    세기(agent맵, r.agent ?? "(팀원 미상)");
    세기(route맵, r.route ?? "(라우팅 미상)");
    세기(tool맵, r.tool ?? "자유 답(도구 없음)");
    // 구분자는 " × " — agent·route 이름에 안 쓰이는 글자라 되읽을 때 안 쪼개진다.
    세기(교차맵, `${e} × ${n}`);
    if (r.hasnum) {
      수치있는답++;
      if (!r.noevidence) 수치있고표식없음++;
    }
    const d = 일별맵.get(r.day) ?? { day: r.day, n: 0, 수치: 0, 표식: 0 };
    d.n++; if (r.hasnum) d.수치++; if (r.noevidence) d.표식++;
    일별맵.set(r.day, d);
  }
  return {
    days, total: rows.length, 근거세기, 근거없음, 수치있는답, 수치있고표식없음,
    일별: [...일별맵.values()].sort((a, b) => (a.day < b.day ? 1 : -1)),
    agent별: 상위(agent맵), route별: 상위(route맵), tool별: 상위(tool맵),
    교차: 상위(교차맵).map(({ 이름, n }) => {
      const [세기, 표식] = 이름.split(" × ");
      return { 근거세기: 세기, 근거없음: 표식, n };
    }),
    종류수: { agent: agent맵.size, route: route맵.size, tool: tool맵.size, 교차: 교차맵.size },
  };
}

export function resetAnswerSamplesForTests(): void {
  db.exec("DELETE FROM answer_samples");
  쌓인수 = 0;
}

export function registerAnswerSampleRoutes(app: Express): void {
  // 읽기는 admin — 운영 전체의 답 분포라 담당자 개인 화면에 둘 값이 아니다(본문은 애초에 없다).
  app.get(
    "/api/answer-samples",
    authMiddleware,
    adminMiddleware,
    asyncRoute(async (req, res) => {
      const days = Math.min(Math.max(Number(req.query.days ?? 7), 1), 표본보존일);
      const who = (req as Request & { user?: GijoUser }).user;
      void who; // 감사 대상 아님 — 읽기 전용 집계(본문·질문 없음)
      res.json(표본요약내기(days));
    })
  );
}
