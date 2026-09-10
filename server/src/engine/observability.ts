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
import { 말투현황줄 } from "./tonewatch";
import fs from "fs";
import path from "path";
import { db, isDbEncrypted } from "../db";
import { authMiddleware, adminMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import { verifyBackupSnapshot } from "./backup";
import { auditRetentionDays } from "./audit";
import { dbCryptStatus } from "./dbcrypt";
import { getSiemConfig, getSiemStats } from "./siem";
// ★ 「지금 두뇌가 답하나」는 **주인 파일 하나**에서 받는다 — 여기서 새로 재지 않는다.
//   (2026-09-10 고객 QA 인스턴스: 다른 기계의 두뇌를 나눠 쓰는 설치에서 진단만 빨강이었다. 아래 두 함수 머리말 참고.)
import { getLocalEngineStatus, 외부채팅응답확인 } from "./localengine";
import { 임베딩응답확인 } from "./embedding";
// 느린 답이 어느 경로로 갔는지를 **사람이 읽는 이름**으로 — 이름의 출처는 에이전트 등록부 하나다(llm.ts와 같다).
import { getAgentById } from "./agents";
// 그 이름이 담당자에게 내보내도 되는 글자인지 재는 자 — 말투 규범의 단일 출처(tone.ts) 그대로 쓴다.
import { 말투위반 } from "./tone";

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
  // 승인 문답(origin=approved-qa)은 문서 수에서 뺀다 — 승인 300건이 「문서 300건」으로 읽히면 이 점검의 뜻이 어긋난다.
  const row = db.prepare("SELECT COUNT(*) AS n FROM memory_documents WHERE COALESCE(origin,'') <> 'approved-qa'").get() as { n: number } | undefined;
  const n = row?.n ?? 0;
  if (n === 0) {
    return {
      id: "knowledge", label: "지식베이스", level: "fail",
      detail: "등록된 문서가 0건입니다 — AI가 사내 근거 없이 답하게 됩니다.",
      action: "AI 지식 화면에서 문서를 올리거나, 서버를 재시작해 기본 지식 번들이 적용되게 하세요.",
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
  // 감사 로그는 지우지 않으면 무한히 쌓인다(실측 2026-07-30: 하루 점검만으로 138건).
  // 디스크가 차면 백업도 DB도 못 쓴다 — 그전에 눈에 보여야 한다.
  let auditNote = "";
  let auditLevel: CheckLevel = "ok";
  try {
    const n = (db.prepare("SELECT COUNT(*) AS n FROM audit_log").get() as { n: number } | undefined)?.n ?? 0;
    const days = auditRetentionDays();
    auditNote = ` · 작업 기록 ${n.toLocaleString("ko-KR")}건(보관 ${days > 0 ? `${days}일` : "무제한"})`;
    // 50만 건이 넘으면 조회가 느려지고 DB가 커진다 — 보관 기간을 줄일 때가 됐다는 신호.
    if (n > 500_000) auditLevel = "warn";
  } catch {
    /* 표가 없으면 넘어간다 */
  }
  let level: CheckLevel = mig > 0 ? auditLevel : "warn";
  // 저장 암호화 상태 — 켰다고 믿는데 꺼져 있는 것이 최악이라 자가 진단에 상시 표시한다.
  const enc = isDbEncrypted() ? "저장 암호화 켬" : "저장 암호화 끔";
  let action: string | undefined =
    auditLevel === "warn"
      ? "작업 기록이 많이 쌓였습니다 — 보관 기간(GIJO_AUDIT_RETENTION_DAYS, 기본 1095일)을 줄이면 오래된 것부터 자동 정리됩니다."
      : undefined;

  // ⚠ 암호화를 켰는데 **평문 사본이 남아 있으면 암호화가 무의미하다** — 훔치는 쪽은 잠긴 파일
  //   대신 옆의 .bak을 가져가면 그만이다. 운영 전환 직후 실측에서 10개가 남아 있었다(2026-07-30).
  //   담당자가 알아서 눈치채길 기대하지 않고 여기서 세어 알린다.
  // ⚠ 정적 import로 부른다 — require()는 ESM에서 조용히 던지고 catch가 삼켜 검사가 아예
  //   안 돈다(오늘 cloudegress에서 같은 실수를 하고 시험이 잡았다, 2026-07-30).
  let plaintextNote = "";
  try {
    const p = dbCryptStatus().plaintextCopies;
    if (p.count > 0) {
      plaintextNote = ` · ⚠ 평문 사본 ${p.count}개(${p.totalMb}MB)`;
      level = "warn";
      action =
        `암호화를 켰지만 **평문 DB 사본이 ${p.count}개** 남아 있습니다(${p.files.slice(0, 3).join(", ")}${p.count > 3 ? " 외" : ""}). ` +
        "파일을 가져가려는 쪽은 잠긴 DB 대신 이 사본을 가져갑니다 — 내용을 확인한 뒤 지우세요. " +
        "자동 백업본은 보관 주기(기본 7개)가 지나면 암호화된 것으로 교체됩니다.";
    }
  } catch {
    /* 조회 실패는 판단하지 않는다(정직 규칙) */
  }

  return {
    id: "database", label: "데이터베이스", level,
    detail: `${mb(size)} · 스키마 이력 ${mig}건 · ${enc}${plaintextNote}${auditNote}`,
    ...(action ? { action } : {}),
  };
}

/**
 * SIEM 전달 — 켜 놓고 안 나가는 것이 최악이다.
 * 예전에는 UDP뿐이라 실패를 알 방법 자체가 없었다(2026-07-31 확장). 이제 세어서 보여준다.
 * ⚠ 꺼져 있으면 항목을 만들지 않는다 — 안 쓰는 기능이 늘 회색으로 떠 있으면 아무도 안 본다.
 */
function checkSiem(): HealthCheck | null {
  let cfg: ReturnType<typeof getSiemConfig>;
  try {
    cfg = getSiemConfig();
  } catch {
    return null;
  }
  if (!cfg.enabled) return null;
  const s = getSiemStats();
  const 수단 = { udp: "UDP", tcp: "TCP", tls: "TLS", hec: "Splunk HEC" }[cfg.transport] ?? cfg.transport;
  const base = `${cfg.host}:${cfg.port} (${수단}·${cfg.format}) · 보냄 ${s.sent.toLocaleString("ko-KR")}건`;

  // 유실은 가장 나쁘다 — 큐가 넘쳐 버린 이벤트는 영영 SIEM에 안 간다.
  if (s.dropped > 0) {
    return {
      id: "siem", label: "SIEM 전달", level: "fail",
      detail: `${base} · ⚠ 유실 ${s.dropped.toLocaleString("ko-KR")}건 · 대기 ${s.queued}건${s.lastError ? ` · ${s.lastError}` : ""}`,
      action: "SIEM이 오래 받지 못해 이벤트가 버려졌습니다 — 수집 서버 상태와 주소·포트를 확인하세요. 연결이 되살아나면 대기 중인 것부터 다시 나갑니다.",
    };
  }
  if (s.queued > 0 || (s.failed > 0 && (!s.lastSuccessAt || (s.lastFailureAt ?? 0) > s.lastSuccessAt))) {
    return {
      id: "siem", label: "SIEM 전달", level: "warn",
      detail: `${base} · 실패 ${s.failed}건 · 대기 ${s.queued}건${s.lastError ? ` · ${s.lastError}` : ""}`,
      action: "지금 SIEM에 닿지 못하고 있습니다 — 수집 서버가 살아 있는지, 방화벽이 그 포트를 여는지 확인하세요.",
    };
  }
  return {
    id: "siem", label: "SIEM 전달", level: "ok",
    // ⚠ UDP는 "보냈다"가 "도착했다"가 아니다 — 정직하게 적는다.
    detail: base + (s.deliveryConfirmed ? " · 전달 확인됨" : " · ⚠ UDP는 도착 여부를 확인할 수 없습니다"),
    ...(s.deliveryConfirmed ? {} : { action: "도착까지 확인하려면 TCP·TLS·Splunk HEC로 바꾸세요(설정 > 연동 > SIEM)." }),
  };
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

/**
 * 채팅 모델 — 이 제품에서 **가장 자주 죽는 것**이다.
 *
 * ⚠ 안 떠 있는 것 자체는 고장이 아니다. 필요할 때 올리는 구조(VRAM 예산·LRU 스왑)라
 *   유휴 시간에는 비어 있는 것이 정상이다. 그래서 **안 떠 있음 = warn**이지 fail이 아니다.
 *   진짜 고장은 **떠 있는데 준비가 안 된 것**(ready=false) — 실측된 WSL2 GPU 유휴 정지가
 *   이 모양이었다. 프로세스는 살아 있는데 응답을 못 한다.
 */
async function checkModel(): Promise<HealthCheck> {
  try {
    const st = getLocalEngineStatus();
    const 상주 = st.loaded ?? [];
    const 멈춘것 = 상주.filter((m) => !m.ready);
    if (멈춘것.length) {
      return {
        id: "model", label: "AI 모델", level: "fail",
        detail: `떠 있으나 응답 준비가 안 된 모델 ${멈춘것.length}개 (${멈춘것.map((m) => m.modelId).join(", ")})`,
        action: "설정 > 서버·AI에서 모델을 껐다 켜세요. 반복되면 GPU 유휴 정지일 수 있습니다(실측 사례).",
      };
    }
    if (상주.length === 0) {
      // ★ 내 프로세스가 없다고 두뇌가 없는 것은 아니다 — 그 자리에서 도는 두뇌를 한 번 찔러 본다.
      //   (2026-09-10 고객 QA 인스턴스 실측: 다른 기계의 두뇌를 나눠 쓰는데 여기가 노랑을 냈다.)
      const 외부 = await 외부채팅응답확인();
      if (외부.alive) {
        return {
          id: "model", label: "AI 모델", level: "ok",
          detail: `외부 기동 모델이 응답합니다${외부.modelId ? ` · ${외부.modelId}` : ""} — 이 기계가 아니라 나눠 쓰는 두뇌입니다`,
        };
      }
      return {
        id: "model", label: "AI 모델", level: "warn",
        detail: "지금 상주 중인 채팅 모델이 없습니다(필요할 때 올라옵니다)",
        action: "대화창에 무엇이든 물어보면 올라옵니다. 그래도 답이 없으면 설정 > 서버·AI에서 확인하세요.",
      };
    }
    return { id: "model", label: "AI 모델", level: "ok", detail: `상주 ${상주.length}개 · ${상주.map((m) => m.modelId).join(", ")}` };
  } catch {
    // ⚠ 못 재면 **모른다**고 한다 — 정상으로 세면 죽어 있어도 초록으로 보인다.
    return { id: "model", label: "AI 모델", level: "unknown", detail: "모델 상태를 확인하지 못했습니다" };
  }
}

/**
 * 임베딩 서버 — 죽으면 **문서 인입과 검색이 조용히 실패**한다.
 * ⚠ 실사고(2026-07-24): 512토큰 넘는 한글 입력에 500을 내며 인입이 통째로 실패했는데
 *   화면은 멀쩡했다. 채팅 모델과 달리 이건 **항상 떠 있어야** 하므로 없으면 fail이다.
 */
async function checkEmbedding(): Promise<HealthCheck> {
  try {
    const e = getLocalEngineStatus().embedding;
    if (!e || !e.running) {
      // ★ 「내 프로세스가 있나」가 아니라 **「지금 답하나」**를 묻는다 — 2026-09-10 고객 QA 인스턴스는
      //   다른 기계의 임베딩을 주소로 나눠 썼고, 문서 검색이 멀쩡한데 여기가 빨강을 냈다.
      if (await 임베딩응답확인()) {
        return {
          id: "embedding", label: "문서 검색 엔진(임베딩)", level: "ok",
          detail: "외부 기동 임베딩 서버가 응답합니다 — 이 기계가 아니라 나눠 쓰는 두뇌입니다",
        };
      }
      return {
        id: "embedding", label: "문서 검색 엔진(임베딩)", level: "fail",
        detail: "임베딩 서버가 떠 있지 않습니다 — 문서 올리기와 지식 검색이 동작하지 않습니다",
        action: "서버를 재시작하세요. 계속 안 뜨면 models/ 아래 임베딩 모델 파일을 확인하세요.",
      };
    }
    return { id: "embedding", label: "문서 검색 엔진(임베딩)", level: "ok", detail: `가동 중 · ${e.modelId ?? "모델 미상"} (포트 ${e.port})` };
  } catch {
    return { id: "embedding", label: "문서 검색 엔진(임베딩)", level: "unknown", detail: "확인하지 못했습니다" };
  }
}

// ── 느린 답 원장 ─────────────────────────────────────────────────────────────
// 왜(2026-08-07): 147상황에서 "이번 주 예정된 점검"이 30초, "KISA 대응 현황"이 31초 —
// **매번 사후에 수동으로 추적**해야 어떤 질문이 왜 느렸는지 알 수 있었다. 온프렘에선
// 우리가 그 자리에 없다. 담당자를 기다리게 한 질문을 제품이 스스로 적어 둔다.
//
// ⚠ **원장과 자가 진단은 보는 것이 다르다**(2026-09-10에 갈렸다 — 예전 머리말은 둘을 같은 것으로 적었다).
//   · 원장(이 표)에는 질문 원문이 그대로 남는다 — 무엇이 왜 느렸는지 찾는 열쇠라 지우면 못 찾는다.
//     대신 **admin만** 꺼내 본다(GET /api/slow-answers · tools/slow-report.mjs).
//   · 자가 진단(checkSlowAnswers)은 **몇 건 · 얼마나 · 어느 경로**만 답한다. 질문 본문은 안 싣는다.
//     까닭은 checkSlowAnswers 머리말에 적어 뒀다.
db.exec(`CREATE TABLE IF NOT EXISTS slow_answers (
  at INTEGER NOT NULL,
  question TEXT NOT NULL,   -- 담당자가 친 문장(앞 200자) — 느린 이유를 찾는 열쇠다
  ms INTEGER NOT NULL,
  agentId TEXT              -- 어느 경로가 받았나(있으면)
)`);

/** 이보다 오래 걸리면 "담당자를 기다리게 했다"로 적는다. 리포트 전환(30초)보다 훨씬 앞이다. */
export const SLOW_ANSWER_MS = 8000;

const insertSlow = db.prepare("INSERT INTO slow_answers (at, question, ms, agentId) VALUES (?, ?, ?, ?)");
const pruneSlow = db.prepare("DELETE FROM slow_answers WHERE at < ?");

/**
 * 대화창 답변의 소요 시간을 받아, 느린 것만 남긴다.
 * ⚠ qa(평가 게이트·QA 전수조사) 호출은 **적지 않는다** — 측정 도구가 원장을 도배하면
 *   실사용자의 느린 답이 묻힌다(작업원장이 테스트 흔적을 배제하는 것과 같은 잣대).
 */
export function recordAnswerTiming(question: string, ms: number, qa: boolean, agentId?: string | null): void {
  if (qa || ms < SLOW_ANSWER_MS) return;
  try {
    insertSlow.run(Date.now(), String(question ?? "").slice(0, 200), Math.round(ms), agentId ?? null);
    pruneSlow.run(Date.now() - 14 * 24 * 3600000); // 14일이면 경향을 보기에 충분하다
  } catch { /* 원장 기록 실패가 답 전달을 막으면 안 된다 */ }
}

/** 느린 답이 일어난 시각 — 날짜는 24시간 창이라 필요 없다. */
const 느린시각 = (at: number) => new Date(at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });

/**
 * 어느 경로가 받았나 — **등록부의 사람 이름 하나**만 쓴다(llm.ts와 같은 출처).
 * ⚠ 등록부에 없는 id는 **그대로 내보내지 않는다** — 그것이 곧 내부 키다.
 *
 * ⚠⚠ 표시 이름은 **조직이 자유롭게 바꾼다**("우리 팀" 로스터 — agents.ts:setAgentName).
 *   거기 걸린 자물쇠는 길이 30자뿐이라, 누가 팀원을 `vuln:10.0.0.99`나 `✅점검반`으로 바꾸면
 *   질문 본문을 걷어낸 이 줄이 **다시 「내용에 따라 갈리는 빨강」**이 된다(검토관 적발, 2026-09-10).
 *   그래서 내보내기 전에 말투 규범으로 한 번 재고, 걸리면 **우리가 지은 기본 이름**으로 돌아간다.
 *   ⚠ 지우지 않는다 — 어느 경로가 받았는지는 그대로 남는다(정보를 버리는 게 아니라 글자만 바꾼다).
 *   ⚠ 규범을 지키는 이름은 **그대로 쓴다** — 조직이 지은 이름을 함부로 덮으면 그것도 거짓말이다.
 *   ⚠ 이 자물쇠는 **이 줄에만** 걸려 있다. 커스텀 이름을 답에 싣는 다른 자리(팀 현황·데이터 카드 등)는
 *     그대로다 — 뿌리에서 막으려면 setAgentName이 규범을 재야 하고, 그건 관리자 화면 동작이 바뀌는 일이라
 *     따로 결정할 몫이다(인계에 적어 둔다).
 */
const 느린경로 = (agentId: string | null): string => {
  if (!agentId) return "경로 미상";
  const a = getAgentById(agentId);
  if (!a) return "경로 미상";
  return 말투위반(a.name).length ? a.defaultName : a.name;
};

/**
 * 느린 답 항목 — **질문 본문은 싣지 않는다**(2026-09-10).
 *
 * 예전에는 느린 질문을 그대로 옮겨 적었다. 그래서 두 가지가 터졌다.
 *   ① 화면·하네스가 질문에 붙이는 **내부 표식 줄**(`#범위 vuln:10.0.0.12` · `#셸 pro`)이 답에 실려
 *      말투 감시 「내부 식별자」에 걸렸다 — 실전 답 대조 시험이 빨강이 되어 배포 게이트가 막혔다.
 *      ⚠ 전날 재료에서는 우연히 안 걸렸다. **답의 내용에 따라 갈리는 빨강**이라 문구를 다듬어서 될 일이 아니다.
 *   ② 거기에 **남이 친 질문 본문**이 되비치면 「상태를 말하는 자리」가 「남의 대화를 보여 주는 자리」가
 *      된다(사내 민감한 물음일 수 있다).
 *      ⚠ 처음엔 이 까닭을 「자가 진단은 관리자가 보는 자리라서」로 적었는데 **틀렸다**(검토관 적발, 2026-09-10).
 *        자가 진단은 관리자 전용이 아니다 — GET /api/system-health는 authMiddleware고,
 *        `system_health` 도구에도 requiredRole이 없어 **로그인한 담당자 누구나** 부른다.
 *        그래서 「본문을 안 싣는 것」이 여기서는 **유일한 방어선**이다(권한으로 못 막는다).
 * 그래서 **언제 · 얼마나 · 어느 경로**만 싣는다. 질문 본문은 원장(slow_answers)에 그대로 남는다 —
 * 지우는 게 아니라 **답에서만 걷어낸다**. 원장을 꺼내 보는 쪽은 admin으로 닫았다(아래 라우트 참조).
 * 짝 시험: server/test/slowanswers.test.ts.
 */
function checkSlowAnswers(): HealthCheck {
  const since = Date.now() - 24 * 3600000;
  const rows = db.prepare("SELECT at, ms, agentId FROM slow_answers WHERE at >= ? ORDER BY ms DESC LIMIT 3").all(since) as { at: number; ms: number; agentId: string | null }[];
  const n = (db.prepare("SELECT COUNT(*) AS n FROM slow_answers WHERE at >= ?").get(since) as { n: number }).n;
  if (n === 0) return { id: "slow", label: "최근 24시간 느린 답", level: "ok", detail: `${SLOW_ANSWER_MS / 1000}초 넘게 걸린 답 없음` };
  const 예 = rows.map((r) => `${느린시각(r.at)} ${Math.round(r.ms / 1000)}초(${느린경로(r.agentId)})`).join(" · ");
  return {
    id: "slow", label: "최근 24시간 느린 답",
    // 느린 답은 장애가 아니라 **경향**이다 — 몇 건 쌓여야 노랑을 든다.
    level: n >= 5 ? "warn" : "ok",
    detail: `${SLOW_ANSWER_MS / 1000}초 초과 ${n}건 — 오래 걸린 순서로 ${예}`,
    // ⚠ 여기서 「어떤 질문이었는지」를 되돌려 주지 않는다 — 위 머리말의 까닭 그대로다.
    action: n >= 5 ? "질문 내용은 자가 진단에 싣지 않습니다(다른 담당자의 물음일 수 있습니다). 같은 질문이 반복해서 느리면 그 문장을 그대로 지원 창구에 알려주세요 — 즉답 경로로 만들 수 있습니다." : undefined,
  };
}

export async function systemHealth(): Promise<SystemHealth> {
  // 가장 자주 죽는 것부터 본다 — 모델·임베딩이 앞이다.
  // ⚠ 앞의 둘은 **밖을 찔러 본다**(각 상한 1.5초) — 그래서 이 함수가 async다. 대신 「지금 답하나」를 정직하게 답한다.
  //   배경 캐시로 동기를 유지하는 길은 버렸다: 첫 호출이 캐시가 비어 거짓 빨강을 내고, 「지금」을 묻는 항목이 과거를 말하게 된다.
  const checks = [await checkModel(), await checkEmbedding(), checkBackup(), checkKnowledge(), checkDatabase(), checkRecentErrors(), checkSlowAnswers(), checkDisk(), checkSiem()].filter((c): c is HealthCheck => c !== null);
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

const LEVEL_MARK: Record<CheckLevel, string> = { ok: "✓", warn: "⚠", fail: "✗", unknown: "❔" };

/** 챗봇·보고용 한국어 요약. 문제일 때 무엇을 하면 되는지까지 함께 낸다. */
export async function systemHealthText(): Promise<string> {
  const h = await systemHealth();
  const up = h.uptimeSec < 3600 ? `${Math.round(h.uptimeSec / 60)}분` : `${Math.round(h.uptimeSec / 3600)}시간`;
  const lines = [
    `시스템 자가 진단 — ${h.headline}`,
    `(가동 ${up} · 메모리 ${h.memoryMb}MB)`,
    "",
    ...h.checks.map((c) => `  ${LEVEL_MARK[c.level]} ${c.label}: ${c.detail}${c.action ? `\n      → ${c.action}` : ""}`),
  ];
  // 말투 규범 감시 — **막지 않는 감시**라 진단 항목(ok/fail)이 아니라 참고 줄로 붙인다.
  //   판정에 넣으면 "이상 있음"으로 읽혀 진짜 장애와 섞인다.
  const 말투 = 말투현황줄();
  if (말투) lines.push("", `  · ${말투}`);
  return lines.join("\n");
}

export function registerObservabilityRoutes(app: Express): void {
  app.get("/api/system-health", authMiddleware, asyncRoute(async (_req, res) => {
    res.json(await systemHealth());
  }));

  // 느린 답 원장 — **반복 등장 질문**이 다음 즉답화(강제 라우팅) 후보다. 같은 질문을 띄어쓰기만
  // 다르게 쳐도 한 묶음으로 센다. 자가 진단(상위 3건)보다 넓게, 14일 전체를 묶어서 본다.
  //
  // ★ **admin만**(2026-09-10 검토관 적발 — 앞 수리가 좁은 자리만 막았다).
  //   이 창구가 내주는 것은 **남이 친 질문 원문**(각 200자·14일치 전부)이다. 자가 진단 답에서는
  //   본문을 걷어냈는데 정문은 authMiddleware라 **로그인한 아무 담당자나 묶음으로 받아 갔다** —
  //   좁은 문을 닫고 넓은 문을 열어 둔 꼴이었다.
  //   같은 성질의 원장(답변 지적 — 남의 질문 원문과 사유가 실린다)은 이미 2026-09-07에
  //   `GET /api/answer-feedback` · `answer_feedback_status` 둘 다 admin으로 닫았다. **자물쇠를 맞춘다.**
  //   ⚠ 읽는 쪽은 `tools/slow-report.mjs` 하나뿐이고 admin 계정(GIJO_ADMIN_USER)으로 로그인한다 —
  //     제품 화면 소비자는 없다(client/src 전수 확인 2026-09-10). 담당자 계정으로 그 도구를 돌리면
  //     이제 403이 난다: 그때는 도구가 아니라 **계정을 admin으로** 쓰는 것이 맞다.
  app.get("/api/slow-answers", authMiddleware, adminMiddleware, asyncRoute(async (_req, res) => {
    const rows = db.prepare("SELECT question, ms, at, agentId FROM slow_answers ORDER BY at DESC").all() as
      { question: string; ms: number; at: number; agentId: string | null }[];
    const 묶음 = new Map<string, { question: string; count: number; maxMs: number; lastAt: number }>();
    for (const r of rows) {
      const k = r.question.toLowerCase().replace(/\s+/g, "");
      const g = 묶음.get(k) ?? { question: r.question, count: 0, maxMs: 0, lastAt: 0 };
      g.count++; g.maxMs = Math.max(g.maxMs, r.ms); g.lastAt = Math.max(g.lastAt, r.at);
      묶음.set(k, g);
    }
    res.json({ thresholdMs: SLOW_ANSWER_MS, total: rows.length, groups: [...묶음.values()].sort((a, b) => b.count - a.count || b.maxMs - a.maxMs) });
  }));
}
