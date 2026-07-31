// engine/mywork.ts — '내 업무' 화면이 쓰는 통합 API.
//
// ■ 왜 합쳐 주는가 (2026-07-31 사용자 지시)
//   "사용자가 주요 업무를 해당 화면에서 **가이드 주는 대로 일하는 데 문제없게** 하는 게 핵심."
//   담당자가 볼 것은 하나인데 출처는 셋이었다 — 직접 적은 할 일(tasks), AI가 찾아낸 오늘
//   할 일(today), 자주 하는 업무 추천(routineSuggestions). 화면이 셋을 각각 부르면
//   섞는 규칙이 화면마다 달라지고, 그때부터 "왜 여기만 다르지"가 시작된다.
//   **섞는 규칙은 서버 한 곳에만 둔다.**
//
// ■ 같은 목록이 세 군데 있었다 (조사 중 발견)
//   대시보드 '오늘 할 일' 카드 · 팀 사무실 창 '오늘의 할일' · 이 화면 — 전부 같은 /api/tasks다.
//   창구(적어 넣는 곳)는 이 화면 하나로 모으고 나머지는 읽기만 하게 바꿨다.
//
// ■ AI가 찾은 일은 **담기 전까지 저장하지 않는다**
//   today 항목은 규칙으로 매번 다시 계산되는 값이다. 미리 tasks에 넣어 두면 조건이 풀린
//   뒤에도 남아 "이미 끝난 일"이 계속 보인다. 그래서 목록에는 그대로 보여주되,
//   담당자가 손을 대는 순간(가이드 단계 실행·담기) tasks로 승격한다.
import type { Express, Request } from "express";
import { authMiddleware } from "../auth/auth";
import type { GijoUser } from "../auth/users";
import { asyncRoute } from "../util/asyncRoute";
import { recordAudit } from "./audit";
import {
  listTasks, createTask, getTask, setGuideStepDone, type TaskItem,
} from "./tasks";
import { routineSuggestions, recordRoutineFeedback } from "./tasks";
import { buildToday } from "./today";
import { getGuide, guessGuideKey, listGuides, type WorkGuide } from "./workguide";

const DAY = 24 * 3600_000;

export interface MyWorkItem {
  id: string; // tasks의 id, 또는 아직 안 담긴 AI 제안이면 "today:<원본id>"
  text: string;
  origin: "me" | "ai" | "routine";
  saved: boolean; // tasks에 들어와 있나(false면 AI 제안 상태)
  done: boolean;
  priority: TaskItem["priority"];
  dueAt?: number;
  overdue: boolean;
  recur?: "weekly" | "monthly";
  why?: string; // AI가 찾은 일이면 왜 지금인지
  ref?: string;
  guideKey?: string;
  guideTotal: number; // 가이드 단계 수(0이면 가이드 없음)
  guideDoneCount: number;
  guideDoneList: number[]; // 끝낸 단계 번호 — 화면이 오른쪽 가이드를 그릴 때 쓴다
}

export interface MyWorkPayload {
  today: MyWorkItem[];
  week: MyWorkItem[];
  later: MyWorkItem[];
  done: MyWorkItem[];
  counts: { today: number; overdue: number; doneToday: number };
}

/** 오늘 끝인지 — 자정 기준으로 본다(“24시간 안”이 아니라 담당자가 말하는 '오늘'). */
function endOfToday(now: number): number {
  const d = new Date(now);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

function toItem(t: TaskItem, now: number): MyWorkItem {
  const guide = getGuide(t.guideKey);
  return {
    id: t.id,
    text: t.text,
    origin: t.origin ?? "me",
    saved: true,
    done: t.done,
    priority: t.priority,
    dueAt: t.dueAt,
    overdue: !t.done && t.dueAt != null && t.dueAt < now,
    recur: t.recur,
    ref: t.ref,
    guideKey: t.guideKey,
    guideTotal: guide?.steps.length ?? 0,
    guideDoneCount: (t.guideDone ?? []).length,
    guideDoneList: t.guideDone ?? [],
  };
}

const RANK: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
function byUrgency(a: MyWorkItem, b: MyWorkItem): number {
  if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
  const r = (RANK[a.priority] ?? 9) - (RANK[b.priority] ?? 9);
  if (r) return r;
  return (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity);
}

export async function buildMyWork(now = Date.now()): Promise<MyWorkPayload> {
  const tasks = listTasks().map((t) => toItem(t, now));
  const todayEnd = endOfToday(now);
  const weekEnd = todayEnd + 6 * DAY;

  // AI가 찾은 일 — 이미 담긴 것(ref가 같은 task가 있음)은 두 번 보여주지 않는다.
  const savedRefs = new Set(listTasks().map((t) => t.ref).filter(Boolean) as string[]);
  let aiItems: MyWorkItem[] = [];
  try {
    const brief = await buildToday(false); // 브리핑 문장은 이 화면에 필요 없다(LLM 호출 생략 = 빠르다)
    aiItems = brief.items
      .filter((i) => !savedRefs.has(i.id))
      .map((i) => ({
        id: `today:${i.id}`,
        // ⚠ 제목만 쓰면 안 된다(2026-07-31 실화면에서 발견). today 항목의 title은 "보안제품 관리"처럼
        //   **유형 이름**이라, 제품이 다섯이면 목록에 똑같은 줄이 다섯 개 뜬다 — 담당자가 무엇을
        //   고르는지 알 수 없다. 대상(subtitle)을 앞에 붙여 줄마다 구분되게 한다.
        //   담을 때도 이 이름으로 저장돼 나중에 봐도 무슨 일이었는지 남는다.
        text: i.subtitle ? `${i.subtitle} — ${i.title}` : i.title,
        origin: "ai" as const,
        saved: false,
        done: false,
        priority: i.urgency === "now" ? ("P0" as const) : ("P1" as const),
        overdue: i.urgency === "now",
        why: [i.subtitle, i.why].filter(Boolean).join(" · "),
        ref: i.id,
        guideKey: guessGuideKey(i.title, i.id) ?? undefined,
        guideTotal: getGuide(guessGuideKey(i.title, i.id))?.steps.length ?? 0,
        guideDoneCount: 0,
        guideDoneList: [],
      }));
  } catch {
    // AI 제안을 못 만들어도 **내가 적은 일은 보여야 한다** — 화면 전체를 죽이지 않는다.
    aiItems = [];
  }

  const open = tasks.filter((t) => !t.done);
  const done = tasks.filter((t) => t.done);

  const today = [...aiItems, ...open.filter((t) => t.dueAt != null && t.dueAt <= todayEnd)].sort(byUrgency);
  const week = open.filter((t) => t.dueAt != null && t.dueAt > todayEnd && t.dueAt <= weekEnd).sort(byUrgency);
  const later = open.filter((t) => t.dueAt == null || t.dueAt > weekEnd).sort(byUrgency);

  const todayStart = todayEnd - DAY + 1;
  const doneToday = done.filter((t) => {
    const raw = listTasks().find((x) => x.id === t.id);
    return raw?.completedAt != null && raw.completedAt >= todayStart;
  });

  return {
    today, week, later,
    done: doneToday.slice(0, 20),
    counts: {
      today: today.length,
      overdue: today.filter((t) => t.overdue).length,
      doneToday: doneToday.length,
    },
  };
}

export function registerMyWorkRoutes(app: Express): void {
  app.get("/api/mywork", authMiddleware, asyncRoute(async (_req, res) => {
    res.json(await buildMyWork());
  }));

  // ⚠ '자주 하는 업무' 추천은 **따로 뗐다**(2026-07-31 실측). 이건 RAG+LLM으로 만드는 값이라
  //   0.7~6.9초가 걸리는데, 목록과 한 덩어리로 묶여 있어서 **항목을 고를 때마다 그 대기가
  //   그대로 얹혔다** — 가이드가 몇 초 뒤에야 뜨니 "가이드 받고 진행한다"가 성립하지 않았다.
  //   목록은 즉시, 추천은 뒤늦게 채워 넣는다.
  app.get("/api/mywork/routines", authMiddleware, asyncRoute(async (_req, res) => {
    try {
      res.json(await routineSuggestions());
    } catch {
      res.json([]); // 추천을 못 만들어도 화면은 살아 있어야 한다
    }
  }));

  // 가이드 목록 — 화면이 단계를 그릴 때 쓴다(템플릿은 결정적이라 캐시해도 안전).
  app.get("/api/mywork/guides", authMiddleware, (_req, res) => {
    res.json(listGuides());
  });

  app.get("/api/mywork/guide/:key", authMiddleware, (req, res) => {
    const g = getGuide(String(req.params.key));
    if (!g) { res.status(404).json({ error: "그런 가이드가 없습니다" }); return; }
    res.json(g);
  });

  // AI 제안을 내 업무로 담기 — 여기서 처음 tasks에 들어간다.
  app.post("/api/mywork/adopt", authMiddleware, (req, res) => {
    const b = req.body as { text?: string; ref?: string; origin?: MyWorkItem["origin"]; dueAt?: number; recur?: TaskItem["recur"] };
    const text = String(b.text ?? "").trim();
    if (!text) { res.status(400).json({ error: "업무 내용이 필요합니다" }); return; }
    const actor = (req as Request & { user?: GijoUser }).user?.displayName ?? "담당자";
    const origin = b.origin === "ai" || b.origin === "routine" ? b.origin : "me";
    // ⚠ AI 제안·자주 하는 업무를 담을 때 기한이 없으면 **오늘로 잡는다**(2026-07-31 실사고).
    //   기한 없는 일은 '나중에'로 분류되는데, "오늘 하세요"라고 올라온 일을 담자마자
    //   오늘 목록에서 사라졌다 — 담당자 입장에선 그냥 잃어버린 것이다.
    //   직접 적은 일은 담당자가 '기한 없음'을 고를 수 있으므로 그대로 존중한다.
    const dueAt = b.dueAt ?? (origin === "me" ? undefined : Date.now());
    const t = createTask({
      text,
      ref: b.ref,
      origin,
      dueAt,
      recur: b.recur,
    });
    // 직접 적은 일은 다음 추천의 학습 신호가 된다 — 자주 적을수록 '자주 하는 업무'로 올라온다.
    // (질문 문장은 recordRoutineFeedback이 스스로 걸러 낸다.)
    if (origin === "me") recordRoutineFeedback(text);
    recordAudit({
      kind: "config", actor, action: "내 업무에 담기", target: t.id,
      detail: `${text}${t.guideKey ? ` · 가이드 ${t.guideKey}` : " · 가이드 없음"}`, result: "ok",
    });
    res.json(t);
  });

  // 가이드 한 단계 완료/취소.
  app.post("/api/mywork/:id/step", authMiddleware, (req, res) => {
    const step = Number((req.body as { step?: number }).step);
    if (!Number.isInteger(step) || step < 0) { res.status(400).json({ error: "단계 번호가 올바르지 않습니다" }); return; }
    const t = setGuideStepDone(String(req.params.id), step, (req.body as { done?: boolean }).done !== false);
    if (!t) { res.status(404).json({ error: "그런 업무가 없습니다" }); return; }
    res.json(t);
  });

  // 한 업무의 가이드 + 진행 상태를 함께 — 화면이 오른쪽 판을 그릴 때 한 번에 받는다.
  app.get("/api/mywork/:id/guide", authMiddleware, (req, res) => {
    const t = getTask(String(req.params.id));
    if (!t) { res.status(404).json({ error: "그런 업무가 없습니다" }); return; }
    const guide: WorkGuide | null = getGuide(t.guideKey);
    res.json({ task: t, guide, doneSteps: t.guideDone ?? [] });
  });
}
