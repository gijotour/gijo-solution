// engine/observability.ts — 자가 진단: "이 시스템 지금 괜찮은가"를 한 화면으로 답한다.
// (계획서 후-1 "GA 판정·잔여 P0 해소 — 백업·관측성" 중 관측성 몫)
//
// 왜 GA 항목인가: 온프렘 제품은 우리가 못 본다. 고객사 담당자가 스스로 "지금 이상 있나"를
// 판단할 수 있어야 하고, 이상이 있을 때 **무엇을 하면 되는지**까지 알아야 한다.
// /api/health는 "서버가 떠 있나"만 답한다 — 모델이 죽었는지, 백업이 3주째 안 돌았는지,
// 지식베이스가 비었는지는 아무도 모른다. 실제로 그런 사고가 이 프로젝트에 있었다:
//   · 지식베이스가 통째로 비어 있는데 아무도 몰랐다(2026-07-19 — AI-BOM 정의를 뒤집어 답함)
//   · 임베딩 서버가 512토큰 초과 입력에 500을 내며 조용히 인입 실패(2026-07-24)
//   · WSL2 GPU 유휴 정지로 모델이 멈춤(2026-07-27)
// 전부 "화면은 멀쩡한데 속이 죽어 있는" 종류다. 그래서 판정은 초록/노랑/빨강이 아니라
// **무엇이 왜 문제고 무엇을 하면 되는지**를 한국어 문장으로 낸다.
//
// 정직 규칙: 못 재는 항목은 null로 두고 "확인 불가"라고 적는다 — 모르는 것을 정상으로 세지 않는다.
import type { Express } from "express";
import fs from "fs";
import path from "path";
import { db } from "../db";
import { authMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import { verifyBackupSnapshot } from "./backup";

export type CheckLevel = "ok" | "warn" | "fail" | "unknown";

export interface HealthCheck {
  id: string;
  label: string;
  level: CheckLevel;
  detail: string; // 지금 상태를 사람 말로
  action?: string; // 문제일 때 무엇을 하면 되는지 — 이게 없으면 경고는 불안만 준다
}

const startedAt = Date.now();

function fileSize(p: string): number | null {
  try { return fs.statSync(p).size; } catch { return null; }
}
function mb(n: number): string { return `${Math.round((n / 1048576) * 10) / 10}MB`; }
function ago(t: number): string {
  const h = (Date.now() - t) / 3600000;
  if (h < 1) return `${Math.round(h * 60)}분 전`;
  if (h < 48) return `${Math.round(h)}시간 전`;
  return `${Math.round(h / 24)}일 전`;
}

/** ① 백업 — 최근 스냅샷이 언제 만들어졌나. 재해복구 시점이 없으면 GA가 아니다. */
function checkBackup(): HealthCheck {
  const dir = process.env.GIJO_BACKUP_DIR ?? path.join("data", "backups");
  let snaps: { f: string; at: number }[] = [];
  try {
    snaps = fs.readdirSync(dir)
      .filter((f) => f.endsWith(".sqlite"))
      .map((f) => ({ f, at: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.at - a.at);
  } catch {
    return {
      id: "backup", label: "백업", level: "fail",
      detail: "백업 폴더가 없습니다 — 지금 장애가 나면 되돌릴 시점이 없습니다.",
      action: "설정 > 관리자에서 백업을 한 번 실행하거나, 자동 백업(GIJO_AUTO_BACKUP)이 꺼져 있는지 확인하세요.",
    };
  }
  if (snaps.length === 0) {
    return {
      id: "backup", label: "백업", level: "fail",
      detail: "백업 스냅샷이 하나도 없습니다.",
      action: "설정 > 관리자에서 백업을 지금 한 번 실행하세요.",
    };
  }
  const latest = snaps[0];
  const hours = (Date.now() - latest.at) / 3600000;
  // 자동 백업은 하루 1회다 — 48시간이 넘으면 스케줄러가 안 도는 것으로 본다.
  let level: CheckLevel = hours > 72 ? "fail" : hours > 48 ? "warn" : "ok";
  let detail = `최근 백업 ${ago(latest.at)} (보관 ${snaps.length}개)`;
  let action = level === "ok" ? undefined
    : "자동 백업이 멈췄을 수 있습니다 — 서버 재시작 후에도 갱신되지 않으면 디스크 여유와 GIJO_AUTO_BACKUP 설정을 확인하세요.";

  // ⚠ 여기까지는 "파일이 있고 최근인가"만 봤다. 그것만으로는 **복구된다는 보장이 없다** —
  //   0바이트여도, 중간에 잘려도, 계정 표가 비어도 통과했다(2026-07-30 발견).
  //   재해가 난 뒤에 처음 알게 되는 종류의 결함이라, 최신 스냅샷을 실제로 열어 확인한다.
  //   (읽기 전용 열기 + 표 몇 개 COUNT — 자가 진단 한 번에 수십 ms 수준)
  try {
    const v = verifyBackupSnapshot(latest.f);
    if (!v.ok) {
      // 파일이 최근이어도 복구가 안 되면 백업이 없는 것과 같다 — 최소 warn, 손상이면 fail.
      const 손상 = v.integrity !== "ok" || v.sizeBytes === 0 || v.tables.users === 0 || v.tables.users == null;
      level = 손상 ? "fail" : level === "ok" ? "warn" : level;
      detail += ` · ⚠ 복원 점검 실패: ${v.problems[0]}`;
      action = 손상
        ? "이 스냅샷으로는 복구할 수 없습니다. 설정 > 관리자에서 백업을 지금 한 번 실행해 새 스냅샷을 만들고, 디스크 여유를 확인하세요."
        : (v.problems.find((p) => p.includes("지식베이스"))
            ? "백업에 지식베이스(.lancedb) 짝 폴더가 빠졌습니다 — 백업을 다시 실행하세요(복원 시 지식 검색이 빈 상태가 됩니다)."
            : action ?? "설정 > 관리자 > 백업 검증에서 자세한 사유를 확인하세요.");
    } else {
      detail += ` · 복원 점검 통과(자산 ${v.tables.assets ?? "?"}건·계정 ${v.tables.users ?? "?"}건, 지식베이스 동반)`;
    }
  } catch {
    // 검증 자체를 못 했으면 정상으로 세지 않는다(정직 규칙) — 모른다고 적는다.
    detail += " · 복원 점검을 수행하지 못했습니다";
    if (level === "ok") level = "warn";
    action = action ?? "설정 > 관리자 > 백업 검증을 직접 실행해 사유를 확인하세요.";
  }

  return { id: "backup", label: "백업", level, detail, ...(action ? { action } : {}) };
}

/** ② 지식베이스 — 비어 있으면 답변이 통째로 근거를 잃는다(2026-07-19 실사고). */
function checkKnowledge(): HealthCheck {
  const row = db.prepare("SELECT COUNT(*) AS n FROM memory_documents").get() as { n: number } | undefined;
  const n = row?.n ?? 0;
  if (n === 0) {
    return {
      id: "knowledge", label: "지식베이스", level: "fail",
      detail: "등록된 문서가 0건입니다 — AI가 사내 근거 없이 답하게 됩니다.",
      action: "기억·학습 화면에서 문서를 올리거나, 서버를 재시작해 기본 지식 번들이 적용되게 하세요.",
    };
  }
  return { id: "knowledge", label: "지식베이스", level: n < 5 ? "warn" : "ok", detail: `문서 ${n}건` };
}

/** ③ 데이터베이스 — 크기와 스키마 이력. 마이그레이션이 0이면 초기화가 덜 된 것이다. */
function checkDatabase(): HealthCheck {
  const dbPath = process.env.GIJO_DB_PATH ?? path.join("data", "gijo-as.sqlite");
  const size = fileSize(dbPath);
  const mig = (db.prepare("SELECT COUNT(*) AS n FROM schema_migrations").get() as { n: number } | undefined)?.n ?? 0;
  if (size == null) {
    return { id: "database", label: "데이터베이스", level: "unknown", detail: "파일 크기를 확인하지 못했습니다(경로 설정 확인 필요)" };
  }
  return { id: "database", label: "데이터베이스", level: mig > 0 ? "ok" : "warn", detail: `${mb(size)} · 스키마 이력 ${mig}건` };
}

/** ④ 최근 오류 — 감사 로그의 error/blocked. 조용한 고장을 드러낸다. */
function checkRecentErrors(): HealthCheck {
  const since = Date.now() - 24 * 3600000;
  const rows = db.prepare("SELECT result, COUNT(*) AS n FROM audit_log WHERE at >= ? GROUP BY result").all(since) as { result: string; n: number }[];
  const err = rows.find((r) => r.result === "error")?.n ?? 0;
  const blocked = rows.find((r) => r.result === "blocked")?.n ?? 0;
  if (err === 0) {
    return { id: "errors", label: "최근 24시간 오류", level: "ok", detail: blocked ? `오류 0건 (차단 ${blocked}건 — 차단은 정상 동작입니다)` : "오류 0건" };
  }
  return {
    id: "errors", label: "최근 24시간 오류", level: err > 10 ? "fail" : "warn",
    detail: `오류 ${err}건${blocked ? ` · 차단 ${blocked}건` : ""}`,
    action: "설정 > 기록 보기에서 작업 기록을 열어 어떤 작업이 실패했는지 확인하세요.",
  };
}

/** ⑤ 디스크 — 백업·모델·리포트가 쌓이는 곳이라 여유가 없으면 조용히 실패한다. */
function checkDisk(): HealthCheck {
  try {
    // Node 18+의 statfs. 없으면 unknown으로 정직하게 둔다(플랫폼에 따라 미지원).
    const sf = (fs as unknown as { statfsSync?: (p: string) => { bsize: number; blocks: number; bavail: number } }).statfsSync;
    if (!sf) return { id: "disk", label: "디스크", level: "unknown", detail: "이 환경에서는 확인할 수 없습니다" };
    const s = sf(process.cwd());
    const freeGb = (s.bsize * s.bavail) / 1073741824;
    const totalGb = (s.bsize * s.blocks) / 1073741824;
    const pct = Math.round((freeGb / totalGb) * 100);
    const level: CheckLevel = freeGb < 5 ? "fail" : freeGb < 20 ? "warn" : "ok";
    return {
      id: "disk", label: "디스크", level,
      detail: `여유 ${Math.round(freeGb)}GB / 전체 ${Math.round(totalGb)}GB (${pct}%)`,
      ...(level === "ok" ? {} : { action: "오래된 백업·리포트를 정리하거나(설정 > 관리자) 안 쓰는 모델을 지우세요." }),
    };
  } catch {
    return { id: "disk", label: "디스크", level: "unknown", detail: "확인 실패" };
  }
}

export interface SystemHealth {
  at: number;
  uptimeSec: number;
  memoryMb: number;
  level: CheckLevel; // 전체 판정 — 가장 나쁜 항목을 따른다
  headline: string; // 사람이 읽는 한 줄 결론
  checks: HealthCheck[];
}

const WORST: CheckLevel[] = ["fail", "warn", "unknown", "ok"];

export function systemHealth(): SystemHealth {
  const checks = [checkBackup(), checkKnowledge(), checkDatabase(), checkRecentErrors(), checkDisk()];
  // 전체 판정은 가장 나쁜 항목을 따른다 — 평균을 내면 문제 하나가 정상 넷에 묻힌다.
  const level = WORST.find((l) => checks.some((c) => c.level === l)) ?? "ok";
  const bad = checks.filter((c) => c.level === "fail" || c.level === "warn");
  const headline =
    level === "ok"
      ? "지금은 이상 없습니다."
      : level === "unknown"
        ? "일부 항목을 확인하지 못했습니다 — 아래에서 무엇인지 보세요."
        : `${bad.length}가지를 봐야 합니다: ${bad.map((c) => c.label).join(" · ")}`;
  return {
    at: Date.now(),
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    memoryMb: Math.round(process.memoryUsage().rss / 1048576),
    level,
    headline,
    checks,
  };
}

const LEVEL_MARK: Record<CheckLevel, string> = { ok: "✅", warn: "⚠", fail: "❌", unknown: "❔" };

/** 챗봇·보고용 한국어 요약. 문제일 때 무엇을 하면 되는지까지 함께 낸다. */
export function systemHealthText(): string {
  const h = systemHealth();
  const up = h.uptimeSec < 3600 ? `${Math.round(h.uptimeSec / 60)}분` : `${Math.round(h.uptimeSec / 3600)}시간`;
  const lines = [
    `시스템 자가 진단 — ${h.headline}`,
    `(가동 ${up} · 메모리 ${h.memoryMb}MB)`,
    "",
    ...h.checks.map((c) => `  ${LEVEL_MARK[c.level]} ${c.label}: ${c.detail}${c.action ? `\n      → ${c.action}` : ""}`),
  ];
  return lines.join("\n");
}

export function registerObservabilityRoutes(app: Express): void {
  app.get("/api/system-health", authMiddleware, asyncRoute(async (_req, res) => {
    res.json(systemHealth());
  }));
}
