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

export interface DataCardKpi { label: string; value: string; color?: "ok" | "warn" | "bad" | "muted" }
export interface DataCard {
  title: string;
  kpis: DataCardKpi[];
  table: {
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
