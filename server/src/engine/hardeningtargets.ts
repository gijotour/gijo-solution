// engine/hardeningtargets.ts — 원격 SSH 정기점검 확장.
//
// (1) 점검 대상(장비) 레지스트리: local(서버 자신) 또는 ssh(원격 방화벽·리눅스 어플라이언스).
// (2) 스케줄: 대상×기준(kisa/cis)을 intervalHours 마다 자동 점검.
// (3) 이력: 매 점검의 준수율·취약 수를 남겨 추세(개선/악화)를 본다.
// (4) 스케줄러: 서버가 주기적으로 만기된 스케줄을 찾아 실제 점검을 돌린다(감사로그·악화 알림 포함).
//
// 보안: SSH 자격증명은 온프렘 로컬 DB에 저장(키 인증 권장). 점검 명령은 고정 진단 명령뿐이라
// 원격에서도 읽기 전용이다. 응답은 대상 label만 노출하고 secret은 API로 절대 돌려주지 않는다.

import type { Express, Request } from "express";
import { randomUUID } from "crypto";
import { db } from "../db";
import { authMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import type { GijoUser } from "../auth/users";
import { recordAudit } from "./audit";
import {
  runHardeningScan,
  targetRunner,
  probeTarget,
  scanSummaryText,
  isStandard,
  type HardeningTarget,
  type StandardId,
  type RunFn,
} from "./hardeningscan";

type Source = "manual" | "scheduled" | "chatbot";

// ── 대상 레지스트리 ─────────────────────────────────────────────────────────
interface TargetRow {
  id: string; label: string; host: string; port: number;
  username: string | null; authMethod: string; secret: string | null; createdAt: number;
}
const rowToTarget = (r: TargetRow): HardeningTarget => ({
  id: r.id, label: r.label, host: r.host, port: r.port,
  username: r.username ?? undefined, authMethod: r.authMethod as HardeningTarget["authMethod"], secret: r.secret ?? undefined,
});
// secret을 뺀 안전한 공개 표현(호스트·포트·인증방식만).
const publicTarget = (t: HardeningTarget) => ({
  id: t.id, label: t.label, host: t.host, port: t.port, username: t.username ?? null,
  authMethod: t.authMethod, hasSecret: Boolean(t.secret),
});

export function listTargets(): HardeningTarget[] {
  return (db.prepare("SELECT * FROM hardening_targets ORDER BY createdAt").all() as TargetRow[]).map(rowToTarget);
}
export function getTarget(id: string): HardeningTarget | undefined {
  const r = db.prepare("SELECT * FROM hardening_targets WHERE id = ?").get(id) as TargetRow | undefined;
  return r ? rowToTarget(r) : undefined;
}
export function createTarget(t: Omit<HardeningTarget, "id">): HardeningTarget {
  const id = `tgt-${randomUUID().slice(0, 8)}`;
  db.prepare(
    `INSERT INTO hardening_targets (id, label, host, port, username, authMethod, secret, createdAt)
     VALUES (@id, @label, @host, @port, @username, @authMethod, @secret, @createdAt)`
  ).run({
    id, label: t.label, host: t.host, port: t.port || 22, username: t.username ?? null,
    authMethod: t.authMethod, secret: t.secret ?? null, createdAt: Date.now(),
  });
  return getTarget(id)!;
}
export function deleteTarget(id: string): void {
  db.prepare("DELETE FROM hardening_targets WHERE id = ?").run(id);
  db.prepare("DELETE FROM hardening_schedules WHERE targetId = ?").run(id);
}

// ── 이력 ─────────────────────────────────────────────────────────────────────
export interface RunRow {
  id: string; targetId: string; targetLabel: string; standard: string; at: number;
  rate: number; pass: number; fail: number; warn: number; na: number; source: string; summary: string | null;
}
export function listRuns(targetId?: string, limit = 50): RunRow[] {
  const lim = Math.min(Math.max(limit, 1), 500);
  if (targetId) return db.prepare("SELECT * FROM hardening_runs WHERE targetId = ? ORDER BY at DESC LIMIT ?").all(targetId, lim) as RunRow[];
  return db.prepare("SELECT * FROM hardening_runs ORDER BY at DESC LIMIT ?").all(lim) as RunRow[];
}
function lastRunFail(targetId: string, standard: string): number | null {
  const r = db.prepare("SELECT fail FROM hardening_runs WHERE targetId = ? AND standard = ? ORDER BY at DESC LIMIT 1").get(targetId, standard) as { fail: number } | undefined;
  return r ? r.fail : null;
}

// 한 대상에 대해 실제 점검을 돌리고 이력·감사·악화 알림을 남긴다. 반환은 리포트.
// run: 테스트에서 실 셸 대신 결정적 러너를 주입할 때 쓴다(미지정 시 대상에 맞는 실제 러너).
export async function runScanForTarget(target: HardeningTarget, standard: StandardId, source: Source, actor = "system", run?: RunFn) {
  const prevFail = lastRunFail(target.id, standard); // 알림 판단용(이력 저장 전 값)
  const report = await runHardeningScan({ standard, target: target.label, run: run ?? targetRunner(target) });
  const s = report.summary;
  db.prepare(
    `INSERT INTO hardening_runs (id, targetId, targetLabel, standard, at, rate, pass, fail, warn, na, source, summary)
     VALUES (@id, @targetId, @targetLabel, @standard, @at, @rate, @pass, @fail, @warn, @na, @source, @summary)`
  ).run({
    id: randomUUID(), targetId: target.id, targetLabel: target.label, standard, at: Date.now(),
    rate: s.rate, pass: s.pass, fail: s.fail, warn: s.warn, na: s.na, source, summary: scanSummaryText(report).slice(0, 3000),
  });
  recordAudit({
    kind: "cli", actor,
    action: `하드닝 정기점검 (${standard.toUpperCase()}·${source})`,
    target: target.label,
    detail: `준수율 ${s.rate}% · 취약 ${s.fail} · 확인필요 ${s.warn}`,
    result: "ok",
  });
  // 악화 알림 — 직전 대비 취약 건수가 늘면 별도 감사 항목으로 눈에 띄게 남긴다.
  if (prevFail !== null && s.fail > prevFail) {
    recordAudit({
      kind: "config", actor: "scheduler",
      action: `⚠ 하드닝 준수율 악화 감지 (${standard.toUpperCase()})`,
      target: target.label,
      detail: `취약 ${prevFail} → ${s.fail}건 (준수율 ${s.rate}%)`,
      result: "error",
    });
  }
  return report;
}

// ── 스케줄 ────────────────────────────────────────────────────────────────────
export interface ScheduleRow {
  id: string; targetId: string; standard: string; intervalHours: number; enabled: number;
  lastRunAt: number | null; nextRunAt: number; lastRate: number | null; lastFail: number | null; createdAt: number;
}
export function listSchedules(): (ScheduleRow & { targetLabel: string })[] {
  const rows = db.prepare("SELECT * FROM hardening_schedules ORDER BY createdAt").all() as ScheduleRow[];
  return rows.map((r) => ({ ...r, targetLabel: getTarget(r.targetId)?.label ?? "(삭제된 대상)" }));
}
export function createSchedule(targetId: string, standard: StandardId, intervalHours: number): ScheduleRow {
  const id = `sch-${randomUUID().slice(0, 8)}`;
  const now = Date.now();
  db.prepare(
    `INSERT INTO hardening_schedules (id, targetId, standard, intervalHours, enabled, lastRunAt, nextRunAt, lastRate, lastFail, createdAt)
     VALUES (@id, @targetId, @standard, @intervalHours, 1, NULL, @nextRunAt, NULL, NULL, @createdAt)`
  ).run({ id, targetId, standard, intervalHours, nextRunAt: now, createdAt: now }); // nextRunAt=now → 첫 틱에 즉시 1회
  return db.prepare("SELECT * FROM hardening_schedules WHERE id = ?").get(id) as ScheduleRow;
}
export function setScheduleEnabled(id: string, enabled: boolean): void {
  db.prepare("UPDATE hardening_schedules SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, id);
}
export function deleteSchedule(id: string): void {
  db.prepare("DELETE FROM hardening_schedules WHERE id = ?").run(id);
}

// 만기된(enabled·nextRunAt<=now) 스케줄을 실행한다. 반환은 실행한 건수(테스트/관측용).
// runnerFor: 테스트에서 결정적 러너를 주입(미지정 시 대상별 실제 러너).
export async function runDueSchedules(now = Date.now(), runnerFor?: (t: HardeningTarget) => RunFn): Promise<number> {
  const due = db.prepare("SELECT * FROM hardening_schedules WHERE enabled = 1 AND nextRunAt <= ?").all(now) as ScheduleRow[];
  let ran = 0;
  for (const sch of due) {
    const target = getTarget(sch.targetId);
    const next = now + Math.max(1, sch.intervalHours) * 3600_000;
    if (!target) { db.prepare("UPDATE hardening_schedules SET nextRunAt = ? WHERE id = ?").run(next, sch.id); continue; }
    if (!isStandard(sch.standard)) { db.prepare("UPDATE hardening_schedules SET nextRunAt = ? WHERE id = ?").run(next, sch.id); continue; }
    try {
      const report = await runScanForTarget(target, sch.standard, "scheduled", "scheduler", runnerFor ? runnerFor(target) : undefined);
      db.prepare("UPDATE hardening_schedules SET lastRunAt = ?, nextRunAt = ?, lastRate = ?, lastFail = ? WHERE id = ?")
        .run(now, next, report.summary.rate, report.summary.fail, sch.id);
      ran++;
    } catch (e) {
      // 점검 실패(원격 접속 불가 등) — 감사에 남기고 다음 주기로 미룬다(하드루프 방지).
      recordAudit({ kind: "cli", actor: "scheduler", action: `하드닝 정기점검 실패 (${sch.standard})`, target: target.label, detail: (e as Error).message.slice(0, 200), result: "error" });
      db.prepare("UPDATE hardening_schedules SET lastRunAt = ?, nextRunAt = ? WHERE id = ?").run(now, next, sch.id);
    }
  }
  return ran;
}

// ── 스케줄러 루프 ──────────────────────────────────────────────────────────────
let timer: ReturnType<typeof setInterval> | null = null;
const TICK_MS = Number(process.env.GIJO_HARDENING_TICK_MS) || 60_000; // 1분마다 만기 확인
export function startHardeningScheduler(): void {
  if (timer) return;
  timer = setInterval(() => { runDueSchedules().catch((e) => console.error("[hardening-sched] 오류:", e instanceof Error ? e.message : e)); }, TICK_MS);
  if (typeof timer.unref === "function") timer.unref();
  console.log(`[hardening-sched] 정기점검 스케줄러 시작 (틱 ${Math.round(TICK_MS / 1000)}초)`);
}
export function stopHardeningScheduler(): void {
  if (timer) { clearInterval(timer); timer = null; }
}

// 테스트 격리용.
export function resetHardeningForTests(): void {
  db.prepare("DELETE FROM hardening_runs").run();
  db.prepare("DELETE FROM hardening_schedules").run();
  db.prepare("DELETE FROM hardening_targets").run();
}

// ── 라우트 ────────────────────────────────────────────────────────────────────
export function registerHardeningTargetRoutes(app: Express): void {
  const actorOf = (req: Request) => (req as Request & { user?: GijoUser }).user?.username ?? "unknown";

  // 대상 목록·등록·삭제
  app.get("/api/hardening/targets", authMiddleware, (_req, res) => {
    res.json({ targets: listTargets().map(publicTarget) });
  });
  app.post("/api/hardening/targets", authMiddleware, asyncRoute(async (req, res) => {
    const b = req.body ?? {};
    const label = String(b.label ?? "").trim();
    const host = String(b.host ?? "").trim();
    const authMethod = String(b.authMethod ?? "").trim();
    if (!label || !host) { res.status(400).json({ error: "label·host가 필요합니다" }); return; }
    if (!["local", "key", "password"].includes(authMethod)) { res.status(400).json({ error: "authMethod는 local·key·password 중 하나" }); return; }
    const t = createTarget({
      label, host, port: Number(b.port) || 22,
      username: b.username ? String(b.username).trim() : undefined,
      authMethod: authMethod as HardeningTarget["authMethod"],
      secret: b.secret ? String(b.secret) : undefined,
    });
    recordAudit({ kind: "config", actor: actorOf(req), action: "하드닝 점검 대상 등록", target: t.label, detail: `${t.host}:${t.port} (${t.authMethod})`, result: "ok" });
    res.json({ target: publicTarget(t) });
  }));
  app.delete("/api/hardening/targets/:id", authMiddleware, (req, res) => {
    const t = getTarget(req.params.id);
    deleteTarget(req.params.id);
    if (t) recordAudit({ kind: "config", actor: actorOf(req), action: "하드닝 점검 대상 삭제", target: t.label, result: "ok" });
    res.json({ ok: true });
  });

  // 대상 접속 확인
  app.post("/api/hardening/targets/:id/probe", authMiddleware, asyncRoute(async (req, res) => {
    const t = getTarget(req.params.id);
    if (!t) { res.status(404).json({ error: "대상을 찾을 수 없습니다" }); return; }
    res.json(await probeTarget(t));
  }));

  // 대상 점검 실행(수동)
  app.post("/api/hardening/targets/:id/scan", authMiddleware, asyncRoute(async (req, res) => {
    const t = getTarget(req.params.id);
    if (!t) { res.status(404).json({ error: "대상을 찾을 수 없습니다" }); return; }
    const standard = String(req.body?.standard ?? "kisa");
    if (!isStandard(standard)) { res.status(400).json({ error: "standard는 kisa 또는 cis" }); return; }
    const report = await runScanForTarget(t, standard, "manual", actorOf(req));
    res.json({ report, summary: scanSummaryText(report) });
  }));

  // 스케줄 목록·등록·토글·삭제
  app.get("/api/hardening/schedules", authMiddleware, (_req, res) => {
    res.json({ schedules: listSchedules() });
  });
  app.post("/api/hardening/schedules", authMiddleware, asyncRoute(async (req, res) => {
    const targetId = String(req.body?.targetId ?? "");
    const standard = String(req.body?.standard ?? "kisa");
    const intervalHours = Math.max(1, Math.round(Number(req.body?.intervalHours) || 24));
    if (!getTarget(targetId)) { res.status(400).json({ error: "유효한 targetId가 필요합니다" }); return; }
    if (!isStandard(standard)) { res.status(400).json({ error: "standard는 kisa 또는 cis" }); return; }
    const sch = createSchedule(targetId, standard, intervalHours);
    recordAudit({ kind: "config", actor: actorOf(req), action: "하드닝 정기점검 스케줄 등록", target: getTarget(targetId)!.label, detail: `${standard.toUpperCase()} · ${intervalHours}시간마다`, result: "ok" });
    res.json({ schedule: sch });
  }));
  app.patch("/api/hardening/schedules/:id", authMiddleware, (req, res) => {
    if (typeof req.body?.enabled === "boolean") setScheduleEnabled(req.params.id, req.body.enabled);
    res.json({ ok: true });
  });
  app.delete("/api/hardening/schedules/:id", authMiddleware, (req, res) => {
    deleteSchedule(req.params.id);
    res.json({ ok: true });
  });

  // 점검 이력(추세)
  app.get("/api/hardening/runs", authMiddleware, (req, res) => {
    const targetId = typeof req.query.targetId === "string" ? req.query.targetId : undefined;
    res.json({ runs: listRuns(targetId, Number(req.query.limit) || 50) });
  });
}
