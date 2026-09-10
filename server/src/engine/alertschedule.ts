// engine/alertschedule.ts — 정기 알림: 담당자가 화면을 안 봐도 놓치지 않게 한다.
// (계획서 후-1 "GA 잔여 P0" 중 알림 스케줄 몫)
//
// 왜 GA 항목인가: 이 제품의 첫 번째 업무 시나리오는 "사람이 부족할 때"다. 그런데 지금까지는
// **담당자가 화면을 열어야만** 기한 임박도, 시스템 이상도 알 수 있었다 — 바쁘면 못 본다.
// 정기 리포트(reportschedule)는 문서를 만들어 두는 것이지 알려 주는 것이 아니다.
//
// 설계 원칙:
//   1) 보낼 게 없으면 안 보낸다 — 매일 "이상 없음" 메일이 오면 사람은 그 메일을 안 읽게 된다.
//      (조용한 실패보다 나쁜 것이 '늑대가 나타났다'다.)
//   2) 메일이 안 되면 감사 로그에 남긴다 — 발송 실패를 조용히 삼키지 않는다.
//   3) 내용은 이미 있는 것을 쓴다(오늘 할 일·자가 진단) — 알림용 별도 계산을 만들지 않는다.
//      계산이 둘이면 화면과 메일의 숫자가 어긋나고, 그러면 둘 다 못 믿는다.
import type { Express, Request } from "express";
import { db, migrate } from "../db";
import { authMiddleware, adminMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import { sendMail, getSmtpConfig } from "./email";
import { recordAudit } from "./audit";
import { systemHealth } from "./observability";
import type { GijoUser } from "../auth/users";

migrate(
  "alert-schedules-2026-07-29",
  `CREATE TABLE IF NOT EXISTS alert_schedules (
     id TEXT PRIMARY KEY,
     kind TEXT NOT NULL,          -- daily_brief | sla_due | system_health
     hourLocal INTEGER NOT NULL,  -- 보낼 시각(0~23, 서버 로컬)
     recipients TEXT NOT NULL,    -- 콤마 구분 메일 주소
     enabled INTEGER NOT NULL,
     lastRunAt INTEGER,
     lastResult TEXT,             -- sent | skipped(보낼 것 없음) | error
     lastError TEXT,
     createdAt INTEGER NOT NULL
   )`
);

export type AlertKind = "daily_brief" | "sla_due" | "system_health";
export const ALERT_KIND_LABEL: Record<AlertKind, string> = {
  daily_brief: "오늘 할 일 브리핑",
  sla_due: "조치 기한 임박",
  system_health: "시스템 이상",
};

export interface AlertSchedule {
  id: string;
  kind: AlertKind;
  hourLocal: number;
  recipients: string;
  enabled: number;
  lastRunAt: number | null;
  lastResult: string | null;
  lastError: string | null;
  createdAt: number;
}

export function listAlertSchedules(): AlertSchedule[] {
  return db.prepare("SELECT * FROM alert_schedules ORDER BY createdAt").all() as AlertSchedule[];
}

export function createAlertSchedule(kind: AlertKind, hourLocal: number, recipients: string[]): AlertSchedule {
  if (!(kind in ALERT_KIND_LABEL)) throw new Error(`알 수 없는 알림 종류: ${kind}`);
  if (!Number.isInteger(hourLocal) || hourLocal < 0 || hourLocal > 23) throw new Error("시각은 0~23 사이 정수여야 합니다");
  const to = recipients.map((r) => r.trim()).filter(Boolean);
  if (to.length === 0) throw new Error("받는 사람이 최소 한 명 필요합니다");
  const id = `alert-${kind}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`; // 같은 ms에 두 개 만들어도 겹치지 않게
  db.prepare(
    "INSERT INTO alert_schedules (id, kind, hourLocal, recipients, enabled, lastRunAt, lastResult, lastError, createdAt) VALUES (?,?,?,?,1,NULL,NULL,NULL,?)"
  ).run(id, kind, hourLocal, to.join(","), Date.now());
  return db.prepare("SELECT * FROM alert_schedules WHERE id = ?").get(id) as AlertSchedule;
}

export function setAlertEnabled(id: string, enabled: boolean): void {
  db.prepare("UPDATE alert_schedules SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, id);
}
export function deleteAlertSchedule(id: string): void {
  db.prepare("DELETE FROM alert_schedules WHERE id = ?").run(id);
}

/**
 * 알림 본문 만들기. **보낼 것이 없으면 null** — 빈 알림을 보내지 않는다.
 * 내용은 제품이 이미 쓰는 계산을 그대로 쓴다(화면과 메일의 숫자가 어긋나면 둘 다 못 믿는다).
 */
export async function buildAlertBody(kind: AlertKind): Promise<{ subject: string; text: string } | null> {
  if (kind === "system_health") {
    const h = await systemHealth();
    // 정상일 땐 보내지 않는다 — 매일 "이상 없음"이 오면 진짜 경고도 안 읽게 된다.
    // unknown(못 잰 항목)도 보내지 않는다: statfs 미지원 같은 환경에서는 매일 "점검 필요"가
    // 가서 같은 늑대소년이 된다(검토 지적 2026-07-29). 못 잰 것은 화면·챗봇에서 보면 된다.
    if (h.level === "ok" || h.level === "unknown") return null;
    const { systemHealthText } = await import("./observability.js");
    return { subject: `[GIJO AS] 시스템 점검 필요 — ${h.headline}`, text: await systemHealthText() };
  }

  if (kind === "sla_due") {
    const { listTasks } = await import("./tasks.js");
    const now = Date.now();
    const soon = now + 3 * 86400000; // 사흘 안
    const due = listTasks().filter((t) => !t.done && t.dueAt != null && t.dueAt <= soon);
    if (due.length === 0) return null;
    const overdue = due.filter((t) => (t.dueAt ?? 0) < now);
    const lines = due
      .sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0))
      .slice(0, 20)
      .map((t) => {
        const d = Math.ceil(((t.dueAt ?? 0) - now) / 86400000);
        return `  · [${t.priority}] ${t.text} — ${d < 0 ? `기한 초과 D+${-d}` : d === 0 ? "오늘 마감" : `D-${d}`}`;
      });
    return {
      subject: `[GIJO AS] 조치 기한 임박 ${due.length}건${overdue.length ? ` (초과 ${overdue.length}건)` : ""}`,
      text: [`사흘 안에 기한이 닿는 조치 ${due.length}건입니다.`, "", ...lines, "", "자세한 내용은 GIJO AS에서 확인하세요."].join("\n"),
    };
  }

  // daily_brief — 오늘 할 일. **챗봇이 쓰는 today 도구를 그대로 부른다.**
  // 계산을 따로 만들면 화면·챗봇·메일의 숫자가 어긋나고, 어긋나면 셋 다 못 믿게 된다.
  const { listAgentTools } = await import("./agenttools.js");
  const tool = listAgentTools().find((t) => t.name === "today");
  const body = tool ? String(await tool.run({})) : "";
  if (!body.trim() || /없습니다|없음/.test(body.slice(0, 40))) return null; // 할 일이 없으면 안 보낸다
  return { subject: "[GIJO AS] 오늘 할 일", text: body };
}

/** 지금 시각에 보내야 하는 스케줄을 실행한다. 같은 시각·같은 날 중복 발송은 막는다. */
export async function runDueAlerts(now = new Date()): Promise<{ ran: number; sent: number; skipped: number }> {
  const out = { ran: 0, sent: 0, skipped: 0 };
  const hour = now.getHours();
  const dayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
  for (const s of listAlertSchedules()) {
    if (!s.enabled || s.hourLocal !== hour) continue;
    // 이미 오늘 이 시각에 돌았으면 건너뛴다(틱이 1분마다 도므로 없으면 60번 보낸다).
    if (s.lastRunAt) {
      const last = new Date(s.lastRunAt);
      if (`${last.getFullYear()}-${last.getMonth()}-${last.getDate()}` === dayKey && last.getHours() === hour) continue;
    }
    out.ran++;
    let result = "sent";
    let error: string | null = null;
    try {
      const body = await buildAlertBody(s.kind as AlertKind);
      if (!body) {
        result = "skipped"; // 보낼 것이 없다 — 빈 알림을 보내지 않는 것이 설계다
        out.skipped++;
      } else {
        await sendMail({ to: s.recipients.split(","), subject: body.subject, text: body.text });
        out.sent++;
      }
    } catch (e) {
      result = "error";
      error = e instanceof Error ? e.message : String(e);
      // 발송 실패를 조용히 삼키지 않는다 — 알림이 안 온 이유를 담당자가 알 수 있어야 한다.
      recordAudit({
        kind: "config", actor: "시스템(정기 알림)", action: "정기 알림 발송 실패",
        target: ALERT_KIND_LABEL[s.kind as AlertKind], detail: error, result: "error",
      });
    }
    db.prepare("UPDATE alert_schedules SET lastRunAt = ?, lastResult = ?, lastError = ? WHERE id = ?")
      .run(Date.now(), result, error, s.id);
  }
  return out;
}

export function alertScheduleText(): string {
  const rows = listAlertSchedules();
  if (rows.length === 0) {
    // ★ 안내는 **실제로 되는 길**만 적는다(2026-08-01 실측에서 고침).
    //   전엔 "설정 > 서버·AI에서 … 알림을 등록하면"이라고 했는데, 그 화면에 등록하는 자리가
    //   **없었다.** 담당자가 가서 찾다가 못 찾는다 — 없는 길을 안내하는 것은 침묵보다 나쁘다.
    //   등록은 대화창에서 한다(alert_schedule_add 도구 → 결재판).
    //   그리고 **메일이 안 켜져 있으면 그것부터** 말한다. 알림을 등록해도 안 가기 때문이다.
    const 메일 = getSmtpConfig();
    const 준비 = 메일
      ? "메일 발송은 켜져 있습니다."
      : "⚠ 먼저 **메일 발송(SMTP)** 을 켜야 합니다 — 설정 > 서버·AI. 안 켜면 알림을 걸어도 나가지 않습니다.";
    return [
      "등록된 정기 알림이 없습니다.",
      준비,
      "",
      '등록은 여기서 말로 하시면 됩니다 — 예: "매일 아침 9시에 기한 임박 알림을 hong@example.com 으로 보내줘"',
      "받을 수 있는 것: ① 오늘 할 일 브리핑 ② 조치 기한 임박(사흘 안) ③ 시스템 이상(백업 누락 등)",
      "보낼 것이 없는 날에는 보내지 않습니다 — 매일 오는 '이상 없음' 메일은 결국 아무도 읽지 않기 때문입니다.",
    ].join("\n");
  }
  const fmt = (t: number | null) => (t ? new Date(t).toLocaleString("ko-KR") : "실행 이력 없음");
  const resultLabel: Record<string, string> = { sent: "발송", skipped: "보낼 것 없어 건너뜀", error: "실패" };
  return [
    `정기 알림 ${rows.length}건`,
    ...rows.map((s) => `  · ${ALERT_KIND_LABEL[s.kind as AlertKind]} — 매일 ${s.hourLocal}시 · ${s.enabled ? "가동" : "중지"} · 받는 사람 ${s.recipients.split(",").length}명 · 최근 ${fmt(s.lastRunAt)}${s.lastResult ? ` (${resultLabel[s.lastResult] ?? s.lastResult})` : ""}${s.lastError ? ` — ${s.lastError}` : ""}`),
  ].join("\n");
}

// ── 스케줄러 루프(정기 리포트와 같은 관례) ─────────────────────────────────
let timer: ReturnType<typeof setInterval> | null = null;
const TICK_MS = Number(process.env.GIJO_ALERT_TICK_MS) || 60_000;
export function startAlertScheduler(): void {
  if (timer) return;
  timer = setInterval(() => {
    runDueAlerts().catch((e) => console.error("[alert-sched] 오류:", e instanceof Error ? e.message : e));
  }, TICK_MS);
  if (typeof timer.unref === "function") timer.unref();
  console.log(`[alert-sched] 정기 알림 스케줄러 시작 (틱 ${Math.round(TICK_MS / 1000)}초)`);
}
export function stopAlertScheduler(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
export function resetAlertsForTests(): void {
  db.exec("DELETE FROM alert_schedules");
}

export function registerAlertScheduleRoutes(app: Express): void {
  app.get("/api/alert-schedules", authMiddleware, (_req, res) => {
    res.json({ entries: listAlertSchedules(), kinds: ALERT_KIND_LABEL, summary: alertScheduleText() });
  });
  app.post("/api/alert-schedules", authMiddleware, adminMiddleware, (req, res) => {
    const b = req.body as { kind?: AlertKind; hourLocal?: number; recipients?: string[] };
    try {
      const s = createAlertSchedule(b.kind as AlertKind, Number(b.hourLocal), b.recipients ?? []);
      recordAudit({
        kind: "config", actor: (req as Request & { user?: GijoUser }).user?.displayName ?? null,
        action: "정기 알림 등록", target: ALERT_KIND_LABEL[s.kind as AlertKind], detail: `매일 ${s.hourLocal}시`, result: "ok",
      });
      res.json(s);
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });
  app.post("/api/alert-schedules/:id/enabled", authMiddleware, adminMiddleware, (req, res) => {
    const 켬 = (req.body as { enabled?: boolean })?.enabled !== false;
    setAlertEnabled(String(req.params.id), 켬);
    // 「알림이 왜 안 왔지」의 답이 감사에 있어야 한다(2026-08-19 D4).
    const sch = listAlertSchedules().find((x) => x.id === String(req.params.id));
    recordAudit({ kind: "config", actor: (req as { user?: { displayName?: string } }).user?.displayName ?? null, action: 켬 ? "정기 알림 가동" : "정기 알림 중지", target: sch ? `${sch.kind} ${sch.hourLocal}시` : String(req.params.id), result: "ok" });
    res.json({ ok: true });
  });
  app.delete("/api/alert-schedules/:id", authMiddleware, adminMiddleware, (req, res) => {
    // ⚠ 지우기 전에 읽는다 — detail의 지워진 값이 손으로 되살릴 유일한 근거다(2026-08-19 D4).
    const sch = listAlertSchedules().find((x) => x.id === String(req.params.id));
    deleteAlertSchedule(String(req.params.id));
    recordAudit({ kind: "config", actor: (req as { user?: { displayName?: string } }).user?.displayName ?? null, action: "정기 알림 삭제", target: sch ? `${sch.kind} ${sch.hourLocal}시` : String(req.params.id), detail: sch ? `수신 ${sch.recipients} · ${sch.enabled ? "가동" : "중지"} 상태였음` : "이미 없던 id", result: "ok" });
    res.json({ ok: true });
  });
  // 지금 한 번 보내 보기 — 등록해 두고 "오나 안 오나" 몰라 불안한 상태를 없앤다.
  app.post("/api/alert-schedules/test", authMiddleware, adminMiddleware, asyncRoute(async (req, res) => {
    const kind = String((req.body as { kind?: string })?.kind ?? "") as AlertKind;
    const to = ((req.body as { recipients?: string[] })?.recipients ?? []).map((r) => r.trim()).filter(Boolean);
    if (!(kind in ALERT_KIND_LABEL) || to.length === 0) {
      res.status(400).json({ error: "kind와 recipients가 필요합니다" });
      return;
    }
    const body = await buildAlertBody(kind);
    if (!body) {
      res.json({ sent: false, reason: "지금은 보낼 내용이 없습니다(정상). 실제 알림도 이럴 땐 보내지 않습니다." });
      return;
    }
    await sendMail({ to, subject: `[시험] ${body.subject}`, text: body.text });
    res.json({ sent: true, subject: body.subject });
  }));
}
