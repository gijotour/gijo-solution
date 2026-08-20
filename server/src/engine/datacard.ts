// engine/datacard.ts — 대화 안 「데이터 카드」(승인 시안 mockups/대화_데이터카드, 2026-08-19).
//
// ■ 왜: 사장님 「대화창 안에 데이터를(팝업 내용을) 나오게 가능할까?」 — 화면 전체 임베드는
//   기각(외부 사례 22패턴 중 0건 — 대화 안엔 데이터, 전체는 패널)하고, 화면급 데이터(KPI+표)를
//   **서버가 결정적으로** 계산해 카드로 내려준다. LLM은 트리거만 거치고 숫자에 손대지 않는다
//   (picklist.ts findingListAnswer와 같은 원칙 — 모델이 채우는 자유 필드가 없다).
// ■ 계약: DispatchResult.dataCard → 클라 chatparts.js dataCard()가 그린다(지휘소·위젯 공용).
//   표는 서버가 10줄로 잘라 shown에, totalCount는 상한 없이 진짜 총계(잘못 자르면 숫자가 거짓말).
// ■ 부수 이득: 검증 판의 「등록 장비」 계산이 클라(grouppanels.js)와 서버(workflow.ts) 두 곳에
//   따로 있어 어긋날 수 있었다(사장님 실화면 0 vs 29) — 이 함수가 서버 한 곳 계산을 하나 더
//   만드는 대신, 여기서만 세 값을 같은 원천(hardeningtargets)에서 함께 읽어 틈을 안 늘린다.

import { listTargets, listSchedules, listRuns } from "./hardeningtargets";
import { todayLocal } from "../util/date";
import { listAssets, getAsset } from "./assets";
import { authMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import { 자산위험등급, isRealVulnerability } from "./agenttools/handlers";
import { listFindingReviews, findingKey } from "./approvals";

export interface DataCardKpi { label: string; value: string; color?: "ok" | "warn" | "bad" | "muted" }
export interface DataCard {
  title: string;
  kpis: DataCardKpi[];
  // 표는 **선택**이다(2026-08-19 2차) — 우선순위 카드는 목록이 이미 두 벌 있어(본문 텍스트=
  // 시험 계약·체크칸=조치용) 표까지 넣으면 같은 목록이 세 벌이 된다. KPI만 싣는다.
  table?: {
    cols: { key: string; label: string; align?: "num" }[];
    shown: Record<string, string>[]; // 서버가 이미 자른 것 — 클라는 자르지 않는다
    totalCount: number;              // 상한 없이 센 진짜 총계
  };
  screen?: { page: string; label: string }; // 🗔 화면으로 열기(도킹/팝업 기존 배관)
  pickKey?: string;                          // 행 클릭 → 📌 선택 시 label로 쓸 컬럼
}

const 표상한 = 10; // 대화 카드는 보는 자리 — 더 파고들면 🗔로 화면(시안 §⑤, picklist MAX_PICK 20의 절반)

/** 「검증/하드닝/보안설정 점검 현황」류 물음인가 — 결정적 트리거(LLM 이전). */
export function isHardeningStatusAsk(text: string): boolean {
  const t = String(text || "").replace(/\s+/g, "");
  if (!/(현황|상태|어때|보여줘|알려줘)/.test(t)) return false;
  // 스케줄·일정 물음은 기존 hardening_schedule_list 영토 — 여기서 삼키면 그 도구가 죽는다
  //   (2026-08-19 전체 게이트 실측: routingfixes ⑦ 「하드닝 점검 스케줄 알려줘」가 카드에 채였다).
  return /(검증|하드닝|보안설정점검|정기점검|설정점검)/.test(t) && !/취약점|스캔결과|스케줄|일정/.test(t);
}

/** 검증(하드닝) 현황 — KPI 4개 + 대상 표. 숫자는 전부 DB에서 직접(결정적). */
export function hardeningStatusAnswer(): { output: string; dataCard: DataCard } {
  const targets = listTargets();
  const schedules = listSchedules();
  const runs = listRuns(undefined, 500);

  // ⚠ 지워진 대상의 옛 이력은 안 센다 — 운영 실측(2026-08-19)에서 「등록 장비 0 ·
  //   평균 준수율 48%」가 나란히 나왔다. 이력(hardening_runs)은 대상을 지워도 남는데,
  //   평균에 섞이면 카드가 없는 장비의 성적을 말하는 셈이다(0 vs 29와 같은 부류).
  const 현존 = new Set(targets.map((t) => t.id));
  const 대상별최근 = new Map<string, { rate: number; at: number }>();
  for (const r of runs) {
    if (!현존.has(r.targetId)) continue;
    const cur = 대상별최근.get(r.targetId);
    if (!cur || r.at > cur.at) 대상별최근.set(r.targetId, { rate: r.rate, at: r.at });
  }
  const 활성 = schedules.filter((s) => s.enabled === 1);
  const 실패 = schedules.filter((s) => s.lastResult === "fail");
  const 준수율들 = [...대상별최근.values()].map((x) => x.rate);
  const 평균 = 준수율들.length ? Math.round(준수율들.reduce((a, b) => a + b, 0) / 준수율들.length) : null;

  const rows = targets.map((t) => {
    const sch = schedules.find((s) => s.targetId === t.id);
    const 최근 = 대상별최근.get(t.id);
    const 상태 = sch?.lastResult === "fail" ? "✕ 점검 실패"
      : !최근 ? "미점검"
      : sch && sch.enabled === 1 ? "정상" : "수동만";
    return {
      장비: t.label,
      기준: (sch?.standard ?? t.standard ?? "kisa").toUpperCase(),
      준수율: 최근 ? String(최근.rate) : "—",
      최근점검: 최근 ? new Date(최근.at).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" }) : "—",
      상태,
      _급함: sch?.lastResult === "fail" ? 0 : !최근 ? 1 : 2, // 실패·미점검 먼저
    };
  }).sort((a, b) => a._급함 - b._급함);
  const shown = rows.slice(0, 표상한).map(({ _급함, ...r }) => r as Record<string, string>);

  const dataCard: DataCard = {
    title: "검증 — 보안설정 점검 현황",
    kpis: [
      { label: "등록 장비", value: String(targets.length), color: targets.length ? undefined : "muted" },
      { label: "활성 스케줄", value: String(활성.length), color: 활성.length ? "ok" : "muted" },
      { label: "평균 준수율", value: 평균 == null ? "—" : 평균 + "%", color: 평균 == null ? "muted" : 평균 >= 80 ? "ok" : 평균 >= 60 ? "warn" : "bad" },
      { label: "점검 실패", value: String(실패.length), color: 실패.length ? "bad" : "ok" },
    ],
    table: {
      cols: [
        { key: "장비", label: "장비" }, { key: "기준", label: "기준" },
        { key: "준수율", label: "준수율%", align: "num" }, { key: "최근점검", label: "최근" }, { key: "상태", label: "상태" },
      ],
      shown, totalCount: rows.length,
    },
    screen: { page: "verify.html", label: "검증" },
    pickKey: "장비",
  };
  // 카드 못 그리는 옛 클라를 위한 글 답 — 같은 숫자를 말로(두 곳이지만 같은 계산의 출력 두 형식).
  const output = [
    `검증(보안설정 점검) 현황 — 등록 장비 ${targets.length} · 활성 스케줄 ${활성.length}` +
      ` · 평균 준수율 ${평균 == null ? "측정 전" : 평균 + "%"} · 점검 실패 ${실패.length}건`,
    rows.length ? `대상 ${rows.length}곳 중 급한 순 ${Math.min(표상한, rows.length)}곳을 카드로 보였습니다 — 전체는 검증 화면에서.` : "등록된 점검 대상이 없습니다 — 검증 화면에서 「+ 대상 등록」으로 시작하세요.",
  ].join("\n");
  return { output, dataCard };
}

// ── 자산 현황 카드 (2차, 시안 로드맵 ③) ─────────────────────────────────────

/** 「자산 현황/상태」 물음인가 — 결정적 트리거.
 *  ⚠ 「목록·리스트」는 **안 받는다** — 그 말은 기존 list_assets 도구 영토다(등급·최근·검색
 *    같은 조건 갈래가 거기 있다). 여기서 삼키면 「고위험 자산 목록」이 카드에 채여 죽는다.
 *  ⚠ 「취약점」이 붙으면 안 받는다 — isFindingListAsk(우선순위) 영토.
 *  ⚠ 「이/그/선택한 자산」은 안 받는다(검토관 심각4) — 이 분기는 선택 치환보다 앞이라
 *    여기서 잡으면 📌로 고른 한 대를 물었는데 전 자산 카드가 나간다. 대명사 경로에 넘긴다. */
export function isAssetStatusAsk(text: string): boolean {
  const t = String(text || "").replace(/\s+/g, "");
  if (!/(현황|상태|어때)/.test(t)) return false;
  if (!/자산/.test(t)) return false;
  if (/(이|그|저|해당|선택한?|고른)자산/.test(t)) return false;
  return !/취약점|스캔|목록|리스트|최근|등록|추가|삭제|검증|하드닝|점검/.test(t);
}

/** 검토대장에서 오탐·조치완료로 **판정이 끝난** 건의 키 집합 — 미조치 수에서 뺀다. */
function 판정끝난키(): Set<string> {
  const s = new Set<string>();
  const 오늘 = todayLocal();
  for (const r of listFindingReviews()) {
    // 위험수용(accepted)은 기한 안일 때만 판정 끝 — 기한이 지나면 재검토로 부상한다(2026-08-20).
    if (r.status === "rejected" || r.status === "approved" ||
        (r.status === "accepted" && !!r.acceptUntil && r.acceptUntil >= 오늘)) s.add(`${r.assetId}::${r.findingKey}`);
  }
  return s;
}

/** 자산 현황 — KPI 4개 + 위험 순 자산 표. 숫자는 전부 등록부(assets)에서 직접(결정적).
 *  @param 걸린범위 🗂 지금 범위(자산 id) — 걸려 있으면 그 자산으로 좁힌다(검토관 심각4:
 *    findings 경로에서 이미 고친 「범위가 걸렸는데 전체가 왔다」의 재발 방지). */
export function assetStatusAnswer(걸린범위?: string | null): { output: string; dataCard: DataCard } {
  const 전체 = listAssets();
  const 범위자산 = 걸린범위 ? 전체.find((a) => a.id === 걸린범위) ?? getAsset(걸린범위) : null;
  const all = 범위자산 ? [범위자산] : 전체;
  const 범위이름 = 범위자산 ? (범위자산.displayName || 범위자산.name) + " (🗂 지금 범위)" : null;
  // ⚠ 스캔 실패·조사 정보는 취약점이 아니고(소스 감시), **고쳐진 것(fixed)·판정 끝난 것
  //   (오탐·조치완료)도 「미조치」가 아니다**(검토관 심각3 — 이 카드만 fixed를 세서 우선순위
  //   카드·KPI와 숫자가 어긋났다. 라벨이 미조치인데 고친 것을 세면 담당자가 그 수로 보고를 쓴다).
  const 판정끝 = 판정끝난키();
  const 진짜 = (a: (typeof all)[number]) =>
    a.findings.filter((f) => isRealVulnerability(f) && f.state !== "fixed" && !판정끝.has(`${a.id}::${findingKey(a.id, f)}`));
  const 미조치총 = all.reduce((n, a) => n + 진짜(a).length, 0);
  // 등급도 같은 목록으로 — raw findings로 재면 고쳐진 심각 건이 자산을 계속 「고위험」으로 만든다.
  const 고위험 = all.filter((a) => 자산위험등급({ findings: 진짜(a) }) === "high");
  // ⚠ 담당 미지정은 null이 아니라 **"-"로 저장**된다(assets.ts registerAsset 기본값 — 시험이 잡음)
  const 담당있음 = (o?: string | null) => !!o && o !== "-";
  const 담당없음 = all.filter((a) => !담당있음(a.owner));

  const 센다 = (a: (typeof all)[number], s: string) => 진짜(a).filter((f) => f.severity === s).length;
  const rows = [...all]
    .sort((a, b) => 센다(b, "critical") - 센다(a, "critical") || 센다(b, "high") - 센다(a, "high") || 진짜(b).length - 진짜(a).length)
    .map((a) => ({
      자산: a.displayName || a.name,
      유형: a.assetType || "—",
      심각: String(센다(a, "critical") + 센다(a, "high")),
      미조치: String(진짜(a).length),
      담당: 담당있음(a.owner) ? String(a.owner) : "미지정",
    }));
  const shown = rows.slice(0, 표상한);

  const dataCard: DataCard = {
    title: (범위이름 ? `${범위이름} — ` : "") + "자산 — 등록 현황",
    kpis: [
      { label: "등록 자산", value: String(all.length), color: all.length ? undefined : "muted" },
      { label: "고위험 자산", value: String(고위험.length), color: 고위험.length ? "bad" : "ok" },
      { label: "미조치 취약점", value: String(미조치총), color: 미조치총 ? "warn" : "ok" },
      { label: "담당 미지정", value: String(담당없음.length), color: 담당없음.length ? "warn" : "ok" },
    ],
    table: {
      cols: [
        { key: "자산", label: "자산" }, { key: "유형", label: "유형" },
        { key: "심각", label: "심각(치명·높음)", align: "num" }, { key: "미조치", label: "미조치", align: "num" },
        { key: "담당", label: "담당" },
      ],
      shown, totalCount: rows.length,
    },
    screen: { page: "inventory.html", label: "자산" },
    pickKey: "자산",
  };
  const output = [
    (범위이름 ? `${범위이름} — ` : "") +
      `자산 현황 — 등록 ${all.length}개 · 고위험 ${고위험.length}개 · 미조치 취약점 ${미조치총}건 · 담당 미지정 ${담당없음.length}개`,
    rows.length
      ? `위험한 순으로 ${Math.min(표상한, rows.length)}개를 카드로 보였습니다 — 전체는 자산 화면에서.`
      : "등록된 자산이 없습니다 — 아직 등록 전이라는 뜻입니다. 자산 화면에서 추가하거나 스캐너 결과를 올리면 자동으로 채워집니다.",
  ].join("\n");
  return { output, dataCard };
}

// ── 발견·수집(통합 관제) 현황 카드 (2026-08-19 사장님 「카드형은 대화창에」) ──────────────
// 사장님이 본 발견·수집 팝업의 내용(P0/P1/P2·소스별·우선순위 목록)이 정확히 카드감인데
// 카드가 없어 팝업으로만 봐야 했다 — 5단계 중 ①의 현황 카드를 채운다(②④⓪은 이미 있음).

/** 「발견·수집/통합 관제 현황」 물음인가 — 기존 영토(검증·자산·취약점·스케줄) 제외. */
export function isOpsStatusAsk(text: string): boolean {
  const t = String(text || "").replace(/\s+/g, "");
  if (!/(현황|상태|어때|보여줘|알려줘)/.test(t)) return false;
  if (!/(발견수집|발견·수집|통합관제|관제)/.test(t)) return false;
  return !/취약점|스캔결과|검증|하드닝|자산|스케줄|일정/.test(t);
}

/** 통합 관제 현황 — KPI 4 + 우선순위 상위 표(전부 analysis_events 원천 직접). */
export async function opsStatusAnswer(): Promise<{ output: string; dataCard: DataCard }> {
  const { listAnalysisEvents } = await import("./analysishub.js");
  const 전부 = listAnalysisEvents();
  const 열림 = 전부.filter((e) => {
    const st = (e as { status?: string }).status;
    return st !== "done" && st !== "ignored";
  });
  const p0 = 열림.filter((e) => e.priority === "P0");
  const p1 = 열림.filter((e) => e.priority === "P1");
  const 오늘 = Date.now() - 24 * 3600000;
  const 신규 = 전부.filter((e) => (e as { at?: number }).at != null && (e as { at: number }).at >= 오늘);
  const 순서 = { P0: 0, P1: 1, P2: 2 } as Record<string, number>;
  const rows = [...열림]
    .sort((a, b) => (순서[a.priority] ?? 9) - (순서[b.priority] ?? 9) || ((b as { at?: number }).at ?? 0) - ((a as { at?: number }).at ?? 0))
    .map((e) => ({
      우선: e.priority,
      제목: e.title,
      대상: e.entity || "—",
      소스: e.source === "vuln" ? "취약점" : e.source === "log" ? "보안로그" : e.source === "product" ? "운영" : String(e.source),
    }));
  const shown = rows.slice(0, 표상한);
  const dataCard: DataCard = {
    title: "발견·수집 — 통합 관제 현황",
    kpis: [
      { label: "열린 이벤트", value: String(열림.length), color: 열림.length ? undefined : "ok" },
      { label: "P0(긴급)", value: String(p0.length), color: p0.length ? "bad" : "ok" },
      { label: "P1", value: String(p1.length), color: p1.length ? "warn" : "ok" },
      { label: "오늘 신규", value: String(신규.length), color: 신규.length ? "warn" : "muted" },
    ],
    table: {
      cols: [
        { key: "우선", label: "우선" }, { key: "제목", label: "이벤트" },
        { key: "대상", label: "대상" }, { key: "소스", label: "소스" },
      ],
      shown, totalCount: rows.length,
    },
    screen: { page: "discover.html", label: "발견·수집" },
    pickKey: "제목",
  };
  const output = [
    `발견·수집(통합 관제) 현황 — 열린 이벤트 ${열림.length} · P0 ${p0.length} · P1 ${p1.length} · 오늘 신규 ${신규.length}`,
    rows.length
      ? `급한 순으로 ${Math.min(표상한, rows.length)}건을 카드로 보였습니다 — 전체는 발견·수집 화면에서.`
      : "열린 이벤트가 없습니다 — 스캐너 결과·보안로그를 올리면 여기에 쌓입니다.",
  ].join("\n");
  return { output, dataCard };
}

// ── 화면 이름 → 현황 카드 (2026-08-19 사장님 실측 — 「자산고르기」라고 쳤더니 LLM이 일반
//    지식 개념 설명을 늘어놨다. 화면 이름을 친 사람이 원하는 것은 그 화면의 **데이터**다.) ──
const 화면이름카드: Record<string, "asset" | "ops" | "hardening" | "finding"> = {
  "자산고르기": "asset", "자산": "asset", "자산현황": "asset",
  "발견수집": "ops", "발견·수집": "ops", "관제": "ops", "통합관제": "ops",
  "검증": "hardening", "하드닝": "hardening",
  "우선순위": "finding", "취약점": "finding", "미조치": "finding",
};

/** 짧은 입력이 화면 이름이면 어느 카드인지 — 아니면 null(다음 분기로). */
export function screenNameCard(text: string): "asset" | "ops" | "hardening" | "finding" | null {
  const t = String(text || "").replace(/[\s?!.]/g, "");
  if (!t || t.length > 8) return null; // 문장이면 기존 분기들이 맡는다 — 낱말·이름만
  return 화면이름카드[t] ?? null;
}

/** 카드 못 그리는 에디션(라이트)용 글 답 — max 인계(60acc4e5): output이 「카드로 보였습니다
 *  /○○ 화면에서」를 전제하는데 라이트는 chatparts 미배선·그 화면이 없다. 표 요약을 글로 접어
 *  넣고 화면 안내 문구를 뺀다 — 같은 숫자, 다른 형식(거짓 안내 금지). */
export function 카드없는글로(answer: { output: string; dataCard: DataCard }): string {
  const dc = answer.dataCard;
  const 머리 = answer.output.split("\n")[0]; // 숫자 요약 줄은 그대로(카드 전제 아님)
  const rows = dc.table?.shown ?? [];
  if (!rows.length) return 머리;
  const cols = dc.table!.cols;
  const 줄들 = rows.map((r) => "- " + cols.map((c) => `${c.label} ${r[c.key] ?? "—"}`).join(" · "));
  const 남음 = (dc.table!.totalCount || 0) - rows.length;
  return [머리, "", ...줄들, ...(남음 > 0 ? [`(외 ${남음}건)`] : [])].join("\n");
}

// ── 화면 열기 → 현황 카드 (2026-08-20 사장님 지시 — 「메뉴를 누르면 대화창에 상위 카드가
//    보여야 돼」, 사진3 흐름) ─────────────────────────────────────────────────
// 메뉴·팔레트로 화면을 열면 셸(app.html open)이 이 라우트를 불러, 그 화면의 현황 카드를
// 대화창에 자동으로 띄운다. 지시가 아니라 **조회**다 — 대화 기록에 가짜 사용자 발화를 남기지
// 않으려고 dispatch를 거치지 않는다. 카드가 없는 화면은 none — 지어내지 않는다.
type 화면카드종류 = "asset" | "ops" | "hardening" | "finding" | "sessions" | "fix" | "report" | "products" | "records" | "threat" | "aiteam" | "supervision" | "mydocs";
const 화면파일카드: Record<string, 화면카드종류> = {
  "assets.html": "asset",
  "discover.html": "ops", "analysis.html": "ops", "loganalysis.html": "ops",
  "verify.html": "hardening", "hardening.html": "hardening",
  "triage.html": "finding", "vulnscan.html": "finding",
  // ── 전 메뉴 확장(2026-08-20 사장님 「나머지는 카드 다 만들어서 대화창에」).
  //    예외(창 유지)는 office·docbox·문서작성·설정뿐 — 맵에 안 넣는 것이 곧 예외 선언이다.
  "sessions.html": "sessions",
  "fix.html": "fix", "approvals.html": "fix", "maintenance.html": "fix",
  "reporting.html": "report", "report.html": "report", "kpi.html": "report",
  "products.html": "products",
  "records.html": "records", "audit.html": "records",
  "threat.html": "threat",
  "aihub.html": "aiteam", "agent.html": "aiteam",
  "supervision.html": "supervision", // AI 팀 감독(2026-08-20 ② — 사장님 「에이전트 감독도 필요」)
  "mydocs.html": "mydocs", // 내 문서(2026-08-20 LLM 위키 — 개인 문서·정리본·공유)
};

// 카드 없이 남는 메뉴 화면 — 「맵에 없음」이 암묵 예외였던 것을 이유와 함께 명시(검토관 5.41
// 중11: 예외가 암묵이면 실수로 빠진 화면과 구분이 안 된다). 새 메뉴 화면은 맵이나 여기
// 둘 중 하나에 반드시 들어가야 한다 — wiringcontract 「메뉴=맵∪예외」가 지킨다.
export const 카드예외: Record<string, string> = {
  "office.html": "(창) 상시 관제 모니터 — 동시 보기가 목적",
  "docbox.html": "(창) 문서함 — 옆에 두고 읽는 창",
  "settings.html": "설정 — 조작 화면이라 현황 카드가 성립 안 함",
  "dashboard.html": "대시보드 자체가 요약판 — 카드의 카드는 중복",
  "lawlookup.html": "결과가 대화 답으로 오는 화면 — 화면 현황이 없음",
  "intro.html": "제품 소개(읽기 전용)",
  "handover.html": "인수인계 위저드 — 행위 화면(현황은 작업내역 카드가 담당)",
};

export function registerScreenCardRoute(app: import("express").Express): void {
  app.get("/api/screen-card", authMiddleware, asyncRoute(async (req, res) => {
    const page = String(req.query.page || "").split("?")[0];
    const kind = 화면파일카드[page];
    if (!kind) { res.json({ none: true }); return; }
    const scope = String(req.query.scope || "").trim() || null; // 🗂 걸린 범위(자산 id) 반영
    const { nextChipsFor } = await import("./nextguide.js");
    if (kind === "finding") {
      const { findingListAnswer } = await import("./picklist.js");
      // picklist(체크칸)는 싣지 않는다 — 자동 카드에 조작 목록까지 뜨면 대화가 도배된다.
      const { output, dataCard } = findingListAnswer("우선순위", scope);
      res.json({ output, dataCard: dataCard ?? null, nextChips: nextChipsFor("분기:우선순위") });
      return;
    }
    const 답 = kind === "asset" ? assetStatusAnswer(scope)
      : kind === "ops" ? await opsStatusAnswer()
      : kind === "hardening" ? hardeningStatusAnswer()
      : kind === "mydocs" ? mydocsStatusAnswer(String((req as import("express").Request & { user?: { id?: string; username?: string } }).user?.id ?? (req as import("express").Request & { user?: { username?: string } }).user?.username ?? "unknown"))
      : kind === "supervision" ? supervisionStatusAnswer()
      : kind === "sessions" ? sessionsStatusAnswer()
      : kind === "fix" ? fixStatusAnswer()
      : kind === "report" ? await reportStatusAnswer()
      : kind === "products" ? productsStatusAnswer()
      : kind === "records" ? recordsStatusAnswer()
      : kind === "threat" ? threatStatusAnswer()
      : aiteamStatusAnswer();
    const 분기 = kind === "asset" ? "분기:자산현황" : kind === "ops" ? "분기:관제현황" : kind === "hardening" ? "분기:검증현황"
      : kind === "fix" ? "분기:내업무" : kind === "report" ? "분기:내업무" : "분기:내업무";
    // 🗂 범위가 걸렸는데 이 카드가 범위를 모르는 종류면 제목에 밝힌다(검토관 5.41 중10 —
    //   범위를 걸어 둔 사람이 전체 숫자를 자기 자산 것으로 읽는 사고 방지). 감추지 않고 말한다.
    // 자산 범위가 **성립하는데 미적용인** 카드에만 붙인다 — mydocs(개인)·supervision·aiteam은
    // 애초에 자산 축이 없어 「미적용」 표기가 오히려 잘못된 기대를 만든다(검토관 백로그 하7).
    const 자산축없음 = kind === "mydocs" || kind === "supervision" || kind === "aiteam";
    if (scope && kind !== "asset" && !자산축없음 && 답.dataCard) { // finding은 위에서 이미 반환됨
      답.dataCard.title += " (전체 기준 — 🗂 범위 미적용)";
    }
    res.json({ output: 답.output, dataCard: 답.dataCard, nextChips: nextChipsFor(분기) });
  }));
}


// AI 팀 감독 카드(2026-08-20 ② 사장님 승인 — 「에이전트 감독도 필요할 것 같은데」).
// KPI는 구글 SRE 골든 시그널에서(지연·트래픽·오류 + 무호출=놀고 있는 팀원). 숫자 원천은
// llm_activity_daily 하나(도입일부터 축적) — chat_logs로 세지 않는다(학습수집 스위치에
// 좌우되어 거짓 0이 된다 — 검토관 중7).
export function supervisionStatusAnswer(): { output: string; dataCard: DataCard } {
  const { listAgents } = require("./agents") as typeof import("./agents");
  const { chatCallsByAgent, activityDaily } = require("./llmactivity") as typeof import("./llmactivity");
  const 팀 = listAgents();
  const 호출 = chatCallsByAgent(1);
  const 오늘 = todayLocal();
  const 오늘지표 = new Map(activityDaily(1).filter((d) => d.day === 오늘 && d.kind === "chat").map((d) => [d.agent, d]));
  const 행 = 팀.map((a) => {
    const d = 오늘지표.get(a.id);
    const 평균 = d && d.calls ? `${(d.latencyMsSum / d.calls / 1000).toFixed(1)}s` : "-";
    return { a: `[${(a as { abbr?: string }).abbr || "-"}] ${a.name}`, n: String(호출[a.id] || 0), r: 평균, e: String(d?.errors || 0) };
  });
  const 총호출 = 팀.reduce((s, a) => s + (호출[a.id] || 0), 0);
  const 총오류 = 행.reduce((s, r) => s + Number(r.e), 0);
  const 무호출 = 팀.filter((a) => !(호출[a.id] > 0)).length;
  const 지연있음 = [...오늘지표.values()].some((d) => d.calls > 0);
  const dataCard: DataCard = {
    title: "AI 팀 감독 — 오늘",
    kpis: [
      { label: "오늘 호출", value: String(총호출) },
      { label: "평균 응답", value: 지연있음 ? `${((행.reduce((s, r) => s + (r.r === "-" ? 0 : parseFloat(r.r)), 0)) / Math.max(1, 행.filter((r) => r.r !== "-").length)).toFixed(1)}s` : "-" },
      { label: "오류", value: String(총오류), color: 총오류 ? "warn" : "ok" },
      { label: "무호출 팀원", value: String(무호출), color: 무호출 === 팀.length ? "muted" : undefined },
    ],
    screen: { page: "supervision.html", label: "AI 팀 감독" },
    pickKey: "a",
    table: {
      cols: [{ key: "a", label: "팀원" }, { key: "n", label: "호출" }, { key: "r", label: "평균 응답" }, { key: "e", label: "오류" }],
      shown: 행,
      totalCount: 행.length,
    },
  };
  return { output: `AI 팀 감독 — 오늘 호출 ${총호출}건 · 오류 ${총오류}건 · 무호출 팀원 ${무호출}명. 지표는 감독 도입일(2026-08-20)부터 쌓입니다 — 7일·30일 추이는 🗔 화면에서 봅니다.`, dataCard };
}

// 내 문서 카드(2026-08-20 LLM 위키 — 사장님 「나만의 문서 데이터 관리」). 이 카드만 **사람마다
// 다르다**(userId 필수) — 개인 문서는 격리가 전부라, 호출자 것만 센다(personaldocs와 같은 원칙).
export function mydocsStatusAnswer(userId: string): { output: string; dataCard: DataCard } {
  const { listPersonalDocs } = require("./personaldocs") as typeof import("./personaldocs");
  const 목록 = listPersonalDocs(userId);
  // (「정리본」 칸은 두지 않는다 — 그 이름을 붙이는 생산자가 표준 제품에 없다. 생산자 없는
  //  값은 영원한 0으로 화면이 거짓말을 한다 — 검토관 중6, 「그 값을 누가 넣는가」 계열.)
  const AI포함 = 목록.filter((d) => d.ragOptIn).length;
  const 공유 = 목록.filter((d) => d.shared).length;
  const 오늘 = 목록.filter((d) => Date.now() - d.updatedAt < 86400000).length;
  const 최근 = 목록.slice(0, 8);
  const dataCard: DataCard = {
    title: "내 문서 — 개인 메모",
    kpis: [
      { label: "내 문서", value: String(목록.length), color: 목록.length ? undefined : "muted" },
      { label: "오늘 쓴 것", value: String(오늘) },
      { label: "AI 포함", value: String(AI포함) },
      { label: "회사 공유", value: String(공유), color: 공유 ? "warn" : undefined }, // 공유=노출이라 눈에 띄게
    ],
    screen: { page: "mydocs.html", label: "내 문서" },
    pickKey: "t",
    table: 목록.length ? {
      cols: [{ key: "t", label: "제목" }, { key: "d", label: "수정" }, { key: "s", label: "범위" }],
      shown: 최근.map((d) => ({
        t: String(d.title).slice(0, 60),
        d: new Date(d.updatedAt).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" }),
        s: d.shared ? "🏢 공유" : "👤 개인",
      })),
      totalCount: 목록.length,
    } : undefined,
  };
  return {
    output: 목록.length
      ? `내 문서 — ${목록.length}건(AI 포함 ${AI포함} · 회사 공유 ${공유}). 개인 문서는 내 질문에만 근거로 나옵니다 — 공유한 것만 팀 전체가 봅니다.`
      : "내 문서가 아직 없습니다 — 🗔 화면에서 ✍ Smart MD로 쓰거나 .md 파일을 가져오세요. 개인 문서는 나만 봅니다.",
    dataCard,
  };
}

// ── 전 메뉴 카드 7종(2026-08-20 사장님 확정) — 숫자는 전부 DB 직접 계산, 표는 급한 순 상한 ──
export function sessionsStatusAnswer(): { output: string; dataCard: DataCard } {
  const { listSessionsFiltered } = require("./worksessions") as typeof import("./worksessions");
  // QA·시스템 세션 제외 — 화면(sessions.html 기본 보기)과 같은 모집단이어야 숫자가 맞는다
  // (검토관 9번: 등록부 123건 중 121이 QA였던 전례 — 섞어 세면 카드가 화면과 어긋난다).
  const 세션응답 = listSessionsFiltered(200, { origin: "user", includeQa: false });
  const 목록 = 세션응답.items;
  // 최근 200건 창 안에서 센 값이다 — 창이 가득 찼으면 「+」로 상한임을 밝힌다(검토관 8번:
  // totalCount 계약은 진짜 총계인데 잘린 length를 총계처럼 적으면 지어낸 값이 된다).
  const 세션표기 = 세션응답.counts.all >= 200 ? `${목록.length}+` : String(목록.length);
  const 최근 = 목록.slice().sort((a, b) => ((b as { updatedAt?: number }).updatedAt || 0) - ((a as { updatedAt?: number }).updatedAt || 0)).slice(0, 8);
  const dataCard: DataCard = {
    title: "작업 내역 — 대화 세션",
    kpis: [
      { label: "저장된 세션", value: 세션표기 },
      { label: "오늘 갱신", value: String(목록.filter((x) => Date.now() - ((x as { updatedAt?: number }).updatedAt || 0) < 86400000).length), color: "ok" },
    ],
    screen: { page: "sessions.html", label: "작업 내역" },
    pickKey: "t",
    table: {
      cols: [{ key: "t", label: "제목" }, { key: "d", label: "갱신" }],
      shown: 최근.map((x) => ({ t: String((x as { title?: string }).title || "(제목 없음)").slice(0, 60), d: new Date((x as { updatedAt?: number }).updatedAt || 0).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) })),
      totalCount: 목록.length,
    },
  };
  return { output: `작업 내역 — 저장된 세션 ${세션표기}건(QA·시스템 세션 제외). 최근 것부터 카드로 보였습니다 — 이어서 보려면 행을 고르거나 🗔로 여세요.`, dataCard };
}

export function fixStatusAnswer(): { output: string; dataCard: DataCard } {
  const { listFindingReviews } = require("./approvals") as typeof import("./approvals");
  const { listMaintenanceItems } = require("./maintenance") as typeof import("./maintenance");
  const rv = listFindingReviews();
  // 스캔 실패·조사 정보(info)는 취약점이 아니다 — 이걸 안 걸러 미조치 602건(실제 3건)이
  // 뜬 실사고의 재발 방지(workflow.ts:94와 같은 규칙). finding이 없으면 못 판단하니 남긴다.
  const 대기 = rv.filter((r) => (r.finding ? isRealVulnerability(r.finding) : true) && String(r.status) === "pending");
  const mt = listMaintenanceItems();
  const today = todayLocal();
  // < today — 오늘 예정 건은 「지연」이 아니다(검토관 하: <=로 세면 아침에 열 때마다
  //   오늘 할 일이 빨간 「지연」으로 시작한다). 모집단은 화면(maintenance)과 동일하게
  //   「완료(approved) 아님」 전부 — scheduled만 세면 승인 대기(reported)인 기한 지난 건이
  //   화면에선 지연, 카드에선 아님으로 갈라진다(검토관 백로그 하8).
  const 지연 = mt.filter((m) => String((m as { status?: string }).status) !== "approved" && String((m as { scheduleDate?: string }).scheduleDate || "") !== "" && String((m as { scheduleDate?: string }).scheduleDate) < today).length;
  const 예정 = mt.filter((m) => String((m as { status?: string }).status) === "scheduled").length;
  const dataCard: DataCard = {
    title: "조치 — 승인·점검 현황",
    kpis: [
      { label: "검토 대기", value: String(대기.length), color: 대기.length ? "warn" : "ok" },
      { label: "정기점검 예정", value: String(예정) },
      { label: "점검 지연", value: String(지연), color: 지연 ? "bad" : "ok" },
    ],
    screen: { page: "fix.html", label: "조치" },
    pickKey: "t",
    table: 대기.length ? {
      cols: [{ key: "t", label: "항목" }, { key: "a", label: "자산" }],
      shown: 대기.slice(0, 8).map((r) => ({ t: String(r.finding?.finding_type || r.findingKey || "").slice(0, 50), a: String(r.assetName || "") })),
      totalCount: 대기.length,
    } : undefined,
  };
  return { output: `조치 현황 — 검토 대기 ${대기.length}건 · 정기점검 예정 ${예정}건(지연 ${지연}건).`, dataCard };
}

export async function reportStatusAnswer(): Promise<{ output: string; dataCard: DataCard }> {
  const rp = require("./report") as typeof import("./report");
  const 이력 = await rp.listReportHistory(50);
  // listSchedules는 report.ts가 아니라 reportschedule.ts에 있다 — 옵셔널 체크로 감싸면
  // 영원히 0이 나오는데 예외도 안 난다(검토관 1번: 생산자 없는 값을 실측처럼 보임).
  const { listSchedules } = require("./reportschedule") as typeof import("./reportschedule");
  const 스케줄 = listSchedules();
  const dataCard: DataCard = {
    title: "보고 — 리포트 현황",
    kpis: [
      { label: "만든 리포트", value: 이력.length >= 50 ? `${이력.length}+` : String(이력.length) },
      { label: "정기 스케줄", value: String(스케줄.length), color: 스케줄.length ? "ok" : "muted" },
    ],
    screen: { page: "reporting.html", label: "보고" },
    pickKey: "t",
    table: 이력.length ? {
      cols: [{ key: "t", label: "리포트" }, { key: "d", label: "생성" }],
      shown: 이력.slice(0, 6).map((h) => ({ t: String((h as { title?: string; base?: string }).title || (h as { base?: string }).base || "리포트").slice(0, 50), d: new Date((h as { createdAt?: number }).createdAt || 0).toLocaleDateString("ko-KR") })),
      totalCount: 이력.length,
    } : undefined,
  };
  return { output: `보고 현황 — 만든 리포트 ${이력.length >= 50 ? `${이력.length}+` : 이력.length}건 · 정기 스케줄 ${스케줄.length}건.`, dataCard };
}

export function productsStatusAnswer(): { output: string; dataCard: DataCard } {
  const { listProducts } = require("./securityproducts") as typeof import("./securityproducts");
  const 목록 = listProducts();
  const 종류 = new Set(목록.map((p) => (p as { category?: string }).category || "기타")).size;
  const dataCard: DataCard = {
    title: "보안제품 — 등록 현황",
    kpis: [
      { label: "등록 제품", value: String(목록.length), color: 목록.length ? "ok" : "muted" },
      { label: "종류", value: String(종류) },
    ],
    screen: { page: "products.html", label: "보안제품" },
    pickKey: "n",
    table: 목록.length ? {
      cols: [{ key: "n", label: "제품" }, { key: "c", label: "종류" }, { key: "v", label: "제조사" }],
      shown: 목록.slice(0, 8).map((p) => ({ n: String((p as { name?: string }).name || ""), c: String((p as { category?: string }).category || ""), v: String((p as { vendor?: string }).vendor || "") })),
      totalCount: 목록.length,
    } : undefined,
  };
  return { output: 목록.length ? `보안제품 — 등록 ${목록.length}개(${종류}종류).` : "보안제품 — 아직 등록된 제품이 없습니다. 대화창에서 \"방화벽 ○○ 등록해줘\"로 등록합니다(승인 후 반영).", dataCard };
}

export function recordsStatusAnswer(): { output: string; dataCard: DataCard } {
  const { listAudit } = require("./audit") as typeof import("./audit");
  const 최근 = listAudit({ limit: 500 });
  const 하루 = 최근.filter((e) => Date.now() - e.at < 86400000);
  const 차단 = 하루.filter((e) => e.result === "blocked").length;
  const dataCard: DataCard = {
    title: "기록 — 작업 감사(24시간)",
    kpis: [
      { label: "오늘 기록", value: 최근.length >= 500 ? `${하루.length}+` : String(하루.length) },
      { label: "차단", value: String(차단), color: 차단 ? "warn" : "ok" },
    ],
    screen: { page: "records.html", label: "기록" },
    pickKey: "a",
    table: 하루.length ? {
      cols: [{ key: "k", label: "종류" }, { key: "a", label: "행위" }, { key: "w", label: "행위자" }],
      shown: 하루.slice(0, 8).map((e) => ({ k: String(e.kind), a: String(e.action || "").slice(0, 50), w: String(e.actor || "-") })),
      totalCount: 하루.length,
    } : undefined,
  };
  return { output: `작업 기록 — 24시간 ${최근.length >= 500 ? `${하루.length}+` : 하루.length}건(차단 ${차단}건). 누가 언제 무엇을 했는지 그대로 남습니다.`, dataCard };
}

export function threatStatusAnswer(): { output: string; dataCard: DataCard } {
  const { listFeeds } = require("./cti") as typeof import("./cti");
  const 피드 = listFeeds();
  // listFeeds는 시드 벤더(키 없음)와 지원 예정(planned)까지 항상 돌려준다 — 전체 수를
  // 「구독」이라 부르면 키를 하나도 안 넣은 새 설치에서 거짓 초록이 뜬다(검토관 3번,
  // 2026-08-19 「키만 있고 어댑터 없는데 연결됨」 정직 스윕과 같은 부류). 수집 중=connected+collects.
  const 수집중 = 피드.filter((f) => f.connected && f.collects);
  const 상태 = (f: (typeof 피드)[number]) => (f.planned ? "지원 예정" : f.connected && f.collects ? "수집 중" : f.connected ? "키만 등록" : "키 없음");
  const dataCard: DataCard = {
    title: "위협 인텔 — CTI 피드",
    kpis: [
      { label: "수집 중", value: String(수집중.length), color: 수집중.length ? "ok" : "muted" },
      { label: "등록 벤더", value: String(피드.filter((f) => !f.planned).length) },
    ],
    screen: { page: "threat.html", label: "위협" },
    pickKey: "n",
    table: 피드.length ? {
      cols: [{ key: "n", label: "피드" }, { key: "s", label: "상태" }],
      shown: 피드.slice(0, 6).map((f) => ({ n: String(f.name || ""), s: 상태(f) })),
      totalCount: 피드.length,
    } : undefined,
  };
  return { output: 수집중.length ? `위협 인텔 — 수집 중인 피드 ${수집중.length}개(등록 벤더 ${피드.filter((f) => !f.planned).length}개). 우리 자산과의 매칭은 "새로 올라온 위협 중 우리 자산에 해당하는 게 있어?"로 물으면 근거와 함께 답합니다.` : "위협 인텔 — 아직 수집 중인 피드가 없습니다. 설정 → 위협 피드에서 벤더 API 키를 등록하면 수집이 시작됩니다.", dataCard };
}

export function aiteamStatusAnswer(): { output: string; dataCard: DataCard } {
  const { getTeamComposition } = require("./teamview") as typeof import("./teamview");
  const { listAgents } = require("./agents") as typeof import("./agents");
  const c = getTeamComposition();
  const agents = listAgents();
  const 일하는중 = agents.filter((a) => a.status === "working").length;
  const dataCard: DataCard = {
    title: "AI 팀 — 구성 현황",
    kpis: [
      { label: "팀원", value: String(agents.length) },
      { label: "작업 중", value: String(일하는중), color: 일하는중 ? "ok" : "muted" },
      { label: "어댑터", value: `${c.adapters?.adopted ?? 0}/${c.adapters?.registered ?? 0}`, color: (c.adapters?.adopted ?? 0) ? "ok" : "muted" },
    ],
    screen: { page: "aihub.html?panel=team", label: "AI 팀" },
    pickKey: "n",
    table: {
      cols: [{ key: "ab", label: "약자" }, { key: "n", label: "이름" }, { key: "r", label: "역할" }],
      shown: agents.map((a) => ({ ab: String(a.abbr || ""), n: String(a.name || a.defaultName), r: String(a.role || "").slice(0, 40) })),
      totalCount: agents.length,
    },
  };
  return { output: `AI 팀 — 팀원 ${agents.length}명 · 작업 중 ${일하는중}명 · 어댑터 채택 ${c.adapters?.adopted ?? 0}/${c.adapters?.registered ?? 0}${(c.adapters?.adopted ?? 0) === 0 ? "(준비 중)" : ""}.`, dataCard };
}
