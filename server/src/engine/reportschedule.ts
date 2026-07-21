// engine/reportschedule.ts — 정기 리포트(주간/분기) 자동 생성 스케줄.
//
// hardeningtargets.ts의 원격 정기점검 스케줄러와 같은 패턴(등록→틱마다 만기 확인→자동 실행→이력)을
// 리포트 생성에 그대로 적용한다. 실제 생성은 report.ts의 generateReport()를 그대로 호출 — 별도
// 생성 로직을 두지 않는다(수동 "+ 리포트 생성"과 결과물이 동일해야 함).

import type { Express, Request } from "express";
import { randomUUID } from "crypto";
import * as path from "path";
import { db, migrate } from "../db";
import { authMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import type { GijoUser } from "../auth/users";
import { recordAudit } from "./audit";
import { generateReport, type ReportRequest, type ReportResult } from "./report";
import { getAsset } from "./assets";

migrate(
  "report-schedules-2026-07-21",
  `CREATE TABLE IF NOT EXISTS report_schedules (
     id TEXT PRIMARY KEY,
     type TEXT NOT NULL,           -- weekly | quarterly
     assetIds TEXT,                -- JSON 배열, NULL=전체 자산
     format TEXT NOT NULL,         -- docx | pdf | both
     audience TEXT NOT NULL,       -- internal | official
     dayOfWeek INTEGER,            -- 0(일)~6(토), weekly만 사용
     hour INTEGER NOT NULL,
     minute INTEGER NOT NULL,
     enabled INTEGER NOT NULL DEFAULT 1,
     lastRunAt INTEGER,
     nextRunAt INTEGER NOT NULL,
     lastResult TEXT,              -- success | fail
     lastError TEXT,
     lastReportBase TEXT,          -- 마지막 생성 리포트 base 파일명(이력 화면 링크용)
     createdAt INTEGER NOT NULL
   );
   CREATE TABLE IF NOT EXISTS report_schedule_runs (
     id TEXT PRIMARY KEY,
     scheduleId TEXT NOT NULL,
     at INTEGER NOT NULL,
     source TEXT NOT NULL,         -- scheduled | manual
     result TEXT NOT NULL,         -- success | fail
     detail TEXT
   );
   CREATE INDEX IF NOT EXISTS idx_report_sched_next ON report_schedules(nextRunAt);
   CREATE INDEX IF NOT EXISTS idx_report_sched_runs_sched ON report_schedule_runs(scheduleId, at);`
);

// quarterly는 2026-07-21 이전에 등록된 스케줄과의 하위호환을 위해 계속 유효한 값으로 둔다
// (신규 등록 화면은 ondemand/daily/weekly/monthly 4가지만 노출 — 사용자 요청 2026-07-21).
export type ScheduleType = "ondemand" | "daily" | "weekly" | "monthly" | "quarterly";
export type ScheduleFormat = "docx" | "pdf" | "both";
export type ScheduleAudience = "internal" | "official";

export const SCHEDULE_TYPE_LABEL: Record<ScheduleType, string> = {
  ondemand: "요청", daily: "일일", weekly: "주간", monthly: "매월", quarterly: "분기",
};

export interface ReportSchedule {
  id: string;
  type: ScheduleType;
  assetIds: string[] | null; // null = 전체 자산
  format: ScheduleFormat;
  audience: ScheduleAudience;
  dayOfWeek: number | null;
  hour: number;
  minute: number;
  enabled: boolean;
  lastRunAt: number | null;
  nextRunAt: number;
  lastResult: "success" | "fail" | null;
  lastError: string | null;
  lastReportBase: string | null;
  createdAt: number;
}

interface ScheduleRow {
  id: string; type: string; assetIds: string | null; format: string; audience: string;
  dayOfWeek: number | null; hour: number; minute: number; enabled: number;
  lastRunAt: number | null; nextRunAt: number; lastResult: string | null; lastError: string | null;
  lastReportBase: string | null; createdAt: number;
}

export interface ScheduleRunEntry {
  id: string; scheduleId: string; at: number; source: "scheduled" | "manual"; result: "success" | "fail"; detail: string | null;
}

function rowToSchedule(r: ScheduleRow): ReportSchedule {
  return {
    id: r.id,
    type: r.type as ScheduleType,
    assetIds: r.assetIds ? (JSON.parse(r.assetIds) as string[]) : null,
    format: r.format as ScheduleFormat,
    audience: r.audience as ScheduleAudience,
    dayOfWeek: r.dayOfWeek,
    hour: r.hour,
    minute: r.minute,
    enabled: r.enabled === 1,
    lastRunAt: r.lastRunAt,
    nextRunAt: r.nextRunAt,
    lastResult: r.lastResult as "success" | "fail" | null,
    lastError: r.lastError,
    lastReportBase: r.lastReportBase,
    createdAt: r.createdAt,
  };
}

// ── 다음 실행 시각 계산 ────────────────────────────────────────────────────
// ondemand: 자동 실행 없음(항상 먼 미래 — "지금 실행"으로만 생성하는 저장된 설정). daily: 매일 지정 시각.
// weekly: 지정한 요일·시각의 다음 발생. monthly: 매월 1일의 다음 영업일(주말이면 월요일로 밀림), 지정 시각.
// quarterly: 분기 시작월(1/4/7/10) 1일의 다음 영업일, 지정 시각(하위호환 — 신규 등록 화면엔 없음).
const NEVER_AUTO_RUN = new Date(9999, 0, 1).getTime();
export function isAutoScheduled(type: ScheduleType): boolean {
  return type !== "ondemand";
}

function businessDayAdjust(d: Date): Date {
  const day = d.getDay();
  if (day === 6) d.setDate(d.getDate() + 2); // 토 → 월
  else if (day === 0) d.setDate(d.getDate() + 1); // 일 → 월
  return d;
}

function nextDaily(hour: number, minute: number, from: Date): number {
  const d = new Date(from);
  d.setHours(hour, minute, 0, 0);
  if (d.getTime() <= from.getTime()) d.setDate(d.getDate() + 1);
  return d.getTime();
}

function nextWeekly(dayOfWeek: number, hour: number, minute: number, from: Date): number {
  const d = new Date(from);
  d.setSeconds(0, 0);
  const diff = (dayOfWeek - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + diff);
  d.setHours(hour, minute, 0, 0);
  if (d.getTime() <= from.getTime()) d.setDate(d.getDate() + 7);
  return d.getTime();
}

function nextMonthly(hour: number, minute: number, from: Date): number {
  const y = from.getFullYear();
  const m = from.getMonth();
  for (const [yy, mm] of [[y, m], [y, m + 1]]) {
    const cand = businessDayAdjust(new Date(yy, mm, 1, hour, minute, 0, 0));
    if (cand.getTime() > from.getTime()) return cand.getTime();
  }
  return businessDayAdjust(new Date(y, m + 2, 1, hour, minute, 0, 0)).getTime();
}

function nextQuarterly(hour: number, minute: number, from: Date): number {
  const y = from.getFullYear();
  const candidates = [0, 3, 6, 9].map((m) => businessDayAdjust(new Date(y, m, 1, hour, minute, 0, 0)));
  const next = candidates.find((d) => d.getTime() > from.getTime());
  if (next) return next.getTime();
  return businessDayAdjust(new Date(y + 1, 0, 1, hour, minute, 0, 0)).getTime();
}

export function computeNextRun(type: ScheduleType, dayOfWeek: number | null, hour: number, minute: number, from = new Date()): number {
  switch (type) {
    case "ondemand": return NEVER_AUTO_RUN;
    case "daily": return nextDaily(hour, minute, from);
    case "weekly": return nextWeekly(dayOfWeek ?? 1, hour, minute, from);
    case "monthly": return nextMonthly(hour, minute, from);
    case "quarterly": return nextQuarterly(hour, minute, from);
  }
}

// ── CRUD ────────────────────────────────────────────────────────────────────
export function listSchedules(): ReportSchedule[] {
  return (db.prepare("SELECT * FROM report_schedules ORDER BY createdAt").all() as ScheduleRow[]).map(rowToSchedule);
}
export function getSchedule(id: string): ReportSchedule | undefined {
  const r = db.prepare("SELECT * FROM report_schedules WHERE id = ?").get(id) as ScheduleRow | undefined;
  return r ? rowToSchedule(r) : undefined;
}

export interface CreateScheduleInput {
  type: ScheduleType;
  assetIds?: string[] | null;
  format: ScheduleFormat;
  audience: ScheduleAudience;
  dayOfWeek?: number | null; // weekly만
  hour: number;
  minute: number;
}

export function createSchedule(input: CreateScheduleInput): ReportSchedule {
  const id = `rsch-${randomUUID().slice(0, 8)}`;
  const now = Date.now();
  const nextRunAt = computeNextRun(input.type, input.dayOfWeek ?? null, input.hour, input.minute, new Date(now));
  db.prepare(
    `INSERT INTO report_schedules (id, type, assetIds, format, audience, dayOfWeek, hour, minute, enabled, lastRunAt, nextRunAt, lastResult, lastError, lastReportBase, createdAt)
     VALUES (@id, @type, @assetIds, @format, @audience, @dayOfWeek, @hour, @minute, 1, NULL, @nextRunAt, NULL, NULL, NULL, @createdAt)`
  ).run({
    id,
    type: input.type,
    assetIds: input.assetIds?.length ? JSON.stringify(input.assetIds) : null,
    format: input.format,
    audience: input.audience,
    dayOfWeek: input.type === "weekly" ? (input.dayOfWeek ?? 1) : null,
    hour: input.hour,
    minute: input.minute,
    nextRunAt,
    createdAt: now,
  });
  return getSchedule(id)!;
}

export interface UpdateScheduleInput {
  type?: ScheduleType;
  assetIds?: string[] | null;
  format?: ScheduleFormat;
  audience?: ScheduleAudience;
  dayOfWeek?: number | null;
  hour?: number;
  minute?: number;
}

export function updateSchedule(id: string, patch: UpdateScheduleInput): ReportSchedule | undefined {
  const cur = getSchedule(id);
  if (!cur) return undefined;
  const merged: CreateScheduleInput = {
    type: patch.type ?? cur.type,
    assetIds: patch.assetIds !== undefined ? patch.assetIds : cur.assetIds,
    format: patch.format ?? cur.format,
    audience: patch.audience ?? cur.audience,
    dayOfWeek: patch.dayOfWeek !== undefined ? patch.dayOfWeek : cur.dayOfWeek,
    hour: patch.hour ?? cur.hour,
    minute: patch.minute ?? cur.minute,
  };
  const nextRunAt = computeNextRun(merged.type, merged.dayOfWeek ?? null, merged.hour, merged.minute, new Date());
  db.prepare(
    `UPDATE report_schedules SET type=@type, assetIds=@assetIds, format=@format, audience=@audience, dayOfWeek=@dayOfWeek, hour=@hour, minute=@minute, nextRunAt=@nextRunAt WHERE id=@id`
  ).run({
    id,
    type: merged.type,
    assetIds: merged.assetIds?.length ? JSON.stringify(merged.assetIds) : null,
    format: merged.format,
    audience: merged.audience,
    dayOfWeek: merged.type === "weekly" ? (merged.dayOfWeek ?? 1) : null,
    hour: merged.hour,
    minute: merged.minute,
    nextRunAt,
  });
  return getSchedule(id);
}

export function setScheduleEnabled(id: string, enabled: boolean): void {
  db.prepare("UPDATE report_schedules SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, id);
}
export function deleteSchedule(id: string): void {
  db.prepare("DELETE FROM report_schedules WHERE id = ?").run(id);
  db.prepare("DELETE FROM report_schedule_runs WHERE scheduleId = ?").run(id);
}

export function listScheduleRuns(scheduleId?: string, limit = 50): ScheduleRunEntry[] {
  const lim = Math.min(Math.max(limit, 1), 500);
  if (scheduleId) {
    return db.prepare("SELECT * FROM report_schedule_runs WHERE scheduleId = ? ORDER BY at DESC LIMIT ?").all(scheduleId, lim) as ScheduleRunEntry[];
  }
  return db.prepare("SELECT * FROM report_schedule_runs ORDER BY at DESC LIMIT ?").all(lim) as ScheduleRunEntry[];
}

// ── 실행 ────────────────────────────────────────────────────────────────────
// 스케줄 설정대로 리포트를 실제로 한 번 생성한다(report.ts의 generateReport 재사용).
// source: "scheduled"(틱 자동 실행) | "manual"(담당자가 "지금 실행" 요청) — manual은 다음 정기 실행 시각을 건드리지 않는다.
// generate: 테스트에서 실패 경로를 결정적으로 재현하려고 주입(미지정 시 실제 generateReport).
export async function runScheduleNow(
  id: string,
  source: "scheduled" | "manual" = "manual",
  generate: (req: ReportRequest) => Promise<ReportResult> = generateReport
): Promise<ReportSchedule | undefined> {
  const sch = getSchedule(id);
  if (!sch) return undefined;
  const req: ReportRequest = {
    type: sch.type,
    assetIds: sch.assetIds ?? undefined,
    format: sch.format,
    audience: sch.audience,
  };
  const now = Date.now();
  try {
    const result = await generate(req);
    const base = path.basename(result.filePath, path.extname(result.filePath));
    db.prepare(
      `UPDATE report_schedules SET lastRunAt=@now, lastResult='success', lastError=NULL, lastReportBase=@base${source === "scheduled" ? ", nextRunAt=@nextRunAt" : ""} WHERE id=@id`
    ).run(
      source === "scheduled"
        ? { now, base, nextRunAt: computeNextRun(sch.type, sch.dayOfWeek, sch.hour, sch.minute, new Date(now)), id }
        : { now, base, id }
    );
    db.prepare(`INSERT INTO report_schedule_runs (id, scheduleId, at, source, result, detail) VALUES (?, ?, ?, ?, 'success', ?)`).run(
      randomUUID(), id, now, source, `${SCHEDULE_TYPE_LABEL[sch.type]} 리포트 자동 생성 완료`
    );
    recordAudit({
      kind: "config", actor: source === "manual" ? "system" : "scheduler",
      action: `정기 리포트 자동 생성 (${SCHEDULE_TYPE_LABEL[sch.type]}·${source})`,
      target: sch.assetIds?.length ? `자산 ${sch.assetIds.length}건` : "전체 자산",
      detail: `${result.filePath}`, result: "ok",
    });
  } catch (e) {
    const message = (e as Error).message.slice(0, 500);
    db.prepare(
      `UPDATE report_schedules SET lastRunAt=@now, lastResult='fail', lastError=@message${source === "scheduled" ? ", nextRunAt=@nextRunAt" : ""} WHERE id=@id`
    ).run(
      source === "scheduled"
        ? { now, message, nextRunAt: computeNextRun(sch.type, sch.dayOfWeek, sch.hour, sch.minute, new Date(now)), id }
        : { now, message, id }
    );
    db.prepare(`INSERT INTO report_schedule_runs (id, scheduleId, at, source, result, detail) VALUES (?, ?, ?, ?, 'fail', ?)`).run(
      randomUUID(), id, now, source, message
    );
    recordAudit({
      kind: "config", actor: source === "manual" ? "system" : "scheduler",
      action: `정기 리포트 자동 생성 실패 (${SCHEDULE_TYPE_LABEL[sch.type]}·${source})`,
      target: sch.assetIds?.length ? `자산 ${sch.assetIds.length}건` : "전체 자산",
      detail: message, result: "error",
    });
  }
  return getSchedule(id);
}

// 만기된(enabled·nextRunAt<=now) 스케줄을 모두 자동 실행한다. 반환은 실행 건수.
export async function runDueSchedules(
  now = Date.now(),
  generate: (req: ReportRequest) => Promise<ReportResult> = generateReport
): Promise<number> {
  const due = db.prepare("SELECT * FROM report_schedules WHERE enabled = 1 AND nextRunAt <= ?").all(now) as ScheduleRow[];
  let ran = 0;
  for (const row of due) {
    await runScheduleNow(row.id, "scheduled", generate);
    ran++;
  }
  return ran;
}

// ── 챗봇용 요약 텍스트 ────────────────────────────────────────────────────────
const dowLabel = ["일", "월", "화", "수", "목", "금", "토"];
function fmt(ms: number): string {
  // dayPeriod를 명시하지 않으면 Node 버전에 따라 오전/오후 대신 영어 AM/PM이 나온다(실측:
  // 운영 Node 20은 AM/PM, Node 24는 오전/오후 — ICU/CLDR 버전 차이). 명시해서 버전 무관하게 고정.
  return new Date(ms).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", dayPeriod: "short" });
}
function cadenceText(s: ReportSchedule): string {
  const hm = `${String(s.hour).padStart(2, "0")}:${String(s.minute).padStart(2, "0")}`;
  switch (s.type) {
    case "ondemand": return "자동 실행 없음(필요할 때 직접 실행)";
    case "daily": return `매일 ${hm}`;
    case "weekly": return `매주 ${dowLabel[s.dayOfWeek ?? 1]} ${hm}`;
    case "monthly": return `매월 1일(영업일) ${hm}`;
    case "quarterly": return `분기 첫 영업일 ${hm}`;
  }
}
export function scheduleSummaryText(schedules: ReportSchedule[] = listSchedules()): string {
  if (!schedules.length) return "등록된 정기 리포트 스케줄이 없습니다.";
  const lines = schedules.map((s) => {
    const scope = s.assetIds?.length ? `자산 ${s.assetIds.length}건` : "전체 자산";
    const status = s.enabled ? "켜짐" : "꺼짐(일시중지)";
    const last = s.lastRunAt ? `최근 ${fmt(s.lastRunAt)} ${s.lastResult === "success" ? "성공" : `실패(${s.lastError ?? ""})`}` : "실행 이력 없음";
    const nextRun = s.enabled && isAutoScheduled(s.type) ? fmt(s.nextRunAt) : "-";
    return `- ${SCHEDULE_TYPE_LABEL[s.type]} 리포트 · ${scope} · ${cadenceText(s)} · ${status} · 다음 실행 ${nextRun} · ${last}`;
  });
  return `정기 리포트 스케줄 ${schedules.length}건:\n${lines.join("\n")}`;
}

// ── 스케줄러 루프 ──────────────────────────────────────────────────────────────
let timer: ReturnType<typeof setInterval> | null = null;
const TICK_MS = Number(process.env.GIJO_REPORT_SCHED_TICK_MS) || 60_000;
export function startReportScheduler(): void {
  if (timer) return;
  timer = setInterval(() => {
    runDueSchedules().catch((e) => console.error("[report-sched] 오류:", e instanceof Error ? e.message : e));
  }, TICK_MS);
  if (typeof timer.unref === "function") timer.unref();
  console.log(`[report-sched] 정기 리포트 스케줄러 시작 (틱 ${Math.round(TICK_MS / 1000)}초)`);
}
export function stopReportScheduler(): void {
  if (timer) { clearInterval(timer); timer = null; }
}

export function resetReportSchedulesForTests(): void {
  db.prepare("DELETE FROM report_schedule_runs").run();
  db.prepare("DELETE FROM report_schedules").run();
}

// ── 라우트 ────────────────────────────────────────────────────────────────────
const VALID_TYPES: ScheduleType[] = ["ondemand", "daily", "weekly", "monthly", "quarterly"];
function validateInput(b: Record<string, unknown>): { input?: CreateScheduleInput; error?: string } {
  const type = String(b.type ?? "");
  if (!(VALID_TYPES as string[]).includes(type)) return { error: `type은 ${VALID_TYPES.join("·")} 중 하나` };
  const format = String(b.format ?? "both");
  if (!["docx", "pdf", "both"].includes(format)) return { error: "format은 docx·pdf·both 중 하나" };
  const audience = String(b.audience ?? "official");
  if (!["internal", "official"].includes(audience)) return { error: "audience는 internal 또는 official" };
  const hour = Number(b.hour);
  const minute = Number(b.minute);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return { error: "hour는 0~23" };
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return { error: "minute는 0~59" };
  let dayOfWeek: number | null = null;
  if (type === "weekly") {
    dayOfWeek = Number(b.dayOfWeek);
    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) return { error: "weekly는 dayOfWeek(0~6)가 필요합니다" };
  }
  let assetIds: string[] | null = null;
  if (Array.isArray(b.assetIds) && b.assetIds.length) {
    assetIds = b.assetIds.map((x) => String(x));
    const missing = assetIds.find((id) => !getAsset(id));
    if (missing) return { error: `존재하지 않는 자산 id: ${missing}` };
  }
  return { input: { type: type as ScheduleType, format: format as ScheduleFormat, audience: audience as ScheduleAudience, dayOfWeek, hour, minute, assetIds } };
}

export function registerReportScheduleRoutes(app: Express): void {
  const actorOf = (req: Request) => (req as Request & { user?: GijoUser }).user?.username ?? "unknown";
  const label = (s: ReportSchedule) => `${SCHEDULE_TYPE_LABEL[s.type]} 리포트${s.assetIds?.length ? ` (자산 ${s.assetIds.length}건)` : ""}`;

  app.get("/api/report/schedules", authMiddleware, (_req, res) => {
    res.json({ schedules: listSchedules() });
  });

  app.post("/api/report/schedules", authMiddleware, asyncRoute(async (req, res) => {
    const { input, error } = validateInput(req.body ?? {});
    if (!input) { res.status(400).json({ error }); return; }
    const sch = createSchedule(input);
    recordAudit({ kind: "config", actor: actorOf(req), action: "정기 리포트 스케줄 등록", target: label(sch), detail: `다음 실행 ${new Date(sch.nextRunAt).toLocaleString("ko-KR")}`, result: "ok" });
    res.json({ schedule: sch });
  }));

  app.patch("/api/report/schedules/:id", authMiddleware, asyncRoute(async (req, res) => {
    const cur = getSchedule(req.params.id);
    if (!cur) { res.status(404).json({ error: "스케줄을 찾을 수 없습니다" }); return; }
    const b = req.body ?? {};
    if (typeof b.enabled === "boolean") setScheduleEnabled(req.params.id, b.enabled);
    const hasFieldPatch = ["type", "assetIds", "format", "audience", "dayOfWeek", "hour", "minute"].some((k) => k in b);
    if (hasFieldPatch) {
      const merged = { ...b };
      if (merged.type === undefined) merged.type = cur.type;
      if (merged.format === undefined) merged.format = cur.format;
      if (merged.audience === undefined) merged.audience = cur.audience;
      if (merged.hour === undefined) merged.hour = cur.hour;
      if (merged.minute === undefined) merged.minute = cur.minute;
      if (merged.dayOfWeek === undefined) merged.dayOfWeek = cur.dayOfWeek;
      const { input, error } = validateInput(merged);
      if (!input) { res.status(400).json({ error }); return; }
      updateSchedule(req.params.id, input);
    }
    recordAudit({ kind: "config", actor: actorOf(req), action: "정기 리포트 스케줄 수정", target: label(cur), result: "ok" });
    res.json({ schedule: getSchedule(req.params.id) });
  }));

  app.delete("/api/report/schedules/:id", authMiddleware, (req, res) => {
    const cur = getSchedule(req.params.id);
    deleteSchedule(req.params.id);
    if (cur) recordAudit({ kind: "config", actor: actorOf(req), action: "정기 리포트 스케줄 삭제", target: label(cur), result: "ok" });
    res.json({ ok: true });
  });

  // 담당자가 화면에서 "지금 실행"을 눌렀을 때 — 다음 정기 실행 시각은 그대로 두고 1회만 생성.
  app.post("/api/report/schedules/:id/run", authMiddleware, asyncRoute(async (req, res) => {
    const cur = getSchedule(req.params.id);
    if (!cur) { res.status(404).json({ error: "스케줄을 찾을 수 없습니다" }); return; }
    const sch = await runScheduleNow(req.params.id, "manual");
    res.json({ schedule: sch });
  }));

  app.get("/api/report/schedules/runs", authMiddleware, (req, res) => {
    const scheduleId = typeof req.query.scheduleId === "string" ? req.query.scheduleId : undefined;
    res.json({ runs: listScheduleRuns(scheduleId, Number(req.query.limit) || 50) });
  });
}
