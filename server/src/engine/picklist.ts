// engine/picklist.ts — 답에 나온 취약점 목록을 **골라서 조치**할 수 있게 만든다.
// (2026-07-31 사용자 질문 "미조치 취약점에 리스트를 보고 선택도 가능한거지?")
//
// ■ 왜 필요한가
//   지금은 "Critical 전부 정요한한테" 같은 **조건**으로만 다건 처리가 된다. 조건은 담당자가
//   머릿속 범위를 말로 옮긴 것이라 실제 대상과 어긋날 수 있다 — 눌러 보기 전엔 뭐가 걸리는지 모른다.
//   눈으로 보고 고른 것은 어긋나지 않는다.
//
// ■ 설계에서 지킨 것
//   ① **보이는 것만 고를 수 있다.** 답 본문에 실제로 나온 건만 체크칸을 만든다.
//      화면에 없는 걸 고르게 하면 "내가 뭘 고른 거지"가 된다.
//   ② **신원은 findingKey(sha1 16자).** LLM이 지어낼 수 없는 값이라 오조작이 원천 차단된다.
//   ③ **골라도 바로 실행되지 않는다.** 고른 뒤에도 결재판(승인)을 거친다 — 쓰기는 전부 사람 승인.

import { prioritizedReviews } from "./approvals";
import { listAssets } from "./assets";

export interface PickItem {
  id: string; // "assetId::findingKey" — 조치할 때 그대로 돌려보낸다
  label: string; // 담당자가 읽는 한 줄
  severity: string;
  assignee?: string;
  dueDate?: string;
}

export interface PickList {
  /** finding=취약점 · task=내 업무(할 일). 고른 뒤 할 수 있는 일이 서로 다르다. */
  kind: "finding" | "task";
  items: PickItem[];
  /** 고른 뒤 누를 수 있는 조치들. 화면이 이 목록으로 버튼을 그린다. */
  actions: { key: string; label: string; needs?: "assignee" | "dueDate" }[];
}

/** 취약점 목록을 답으로 낸 도구들 — 이 중 하나라도 돌았을 때만 체크칸을 붙인다. */
const LIST_TOOLS = new Set(["finding_status", "today", "briefing", "scan_status", "threats"]);

const MAX_PICK = 20; // 스무 개가 넘으면 고르는 것보다 조건이 낫다

/** 고른 뒤 누를 수 있는 조치. 화면이 이 목록으로 버튼을 그린다. */
const PICK_ACTIONS: PickList["actions"] = [
  { key: "assign", label: "담당자 배정", needs: "assignee" },
  { key: "due", label: "기한 정하기", needs: "dueDate" },
  { key: "done", label: "조치완료로" },
  { key: "false", label: "오탐으로" },
];

type Review = ReturnType<typeof prioritizedReviews>[number];

function toPickItem(r: Review): PickItem {
  return {
    id: `${r.assetId}::${r.findingKey}`,
    label: `[${r.finding.severity}] ${r.finding.finding_type} @ ${r.assetName}`,
    severity: r.finding.severity,
    ...(r.assignee ? { assignee: r.assignee } : {}),
    ...(r.dueDate ? { dueDate: r.dueDate } : {}),
  };
}

/**
 * 답 본문에 실제로 등장한 취약점만 골라 체크 목록을 만든다.
 *
 * @param output    담당자가 화면에서 읽는 답 본문
 * @param toolNames 이번 답을 만들며 실행된 도구 이름들
 */
export function buildFindingPicks(output: string, toolNames: string[]): PickList | null {
  if (!toolNames.some((n) => LIST_TOOLS.has(n))) return null;
  const text = String(output ?? "");
  if (!text.trim()) return null;

  const items: PickItem[] = [];
  for (const r of prioritizedReviews(200)) {
    if (items.length >= MAX_PICK) break;
    // 자산(아이디든 이름이든)과 취약점 유형이 **둘 다** 본문에 있어야 한다.
    // 자산만 보고 넣으면 같은 자산의 다른 취약점까지 딸려 들어와, 화면에 없는 것이 체크칸에 나타난다.
    if (!text.includes(r.assetId) && !text.includes(r.assetName)) continue;
    if (!text.includes(r.finding.finding_type)) continue;
    items.push(toPickItem(r));
  }
  if (items.length === 0) return null;
  return { kind: "finding", items, actions: PICK_ACTIONS };
}

// ── "미조치 취약점 뭐 있어?" — 결정적 목록 ──────────────────────────────
// 사용자가 콕 집어 물은 질문이다("미조치 취약점에 리스트를 보고 선택도 가능한거지?").
// LLM 루프에 맡기면 모델이 목록 도구를 고를 때만 체크칸이 생긴다 — 어떤 날은 되고 어떤 날은
// 안 되는 기능은 없는 것만 못하다. 이 질문만은 규칙으로 답해 **항상** 고를 수 있게 한다.
// (지식베이스 정리·공격경로·Shadow AI도 같은 이유로 결정적 경로다)
//
// ⚠ 좁게 잡는다. "가장 급한 취약점에 담당자 배정해줘"는 **시키는 말**이라 여기서 가로채면
//   잘 되던 배정 기능이 죽는다 — 아래 금지어로 막고 시험이 지킨다.
const LIST_ASK_RE = /(취약점|미조치|조치\s*안|미해결)/;
const LIST_VERB_RE = /(목록|리스트|보여|뭐\s*있|무엇이?\s*있|어떤\s*게?\s*있|현황|남았)/;
const LIST_BLOCK_RE = /(배정|기한|처리해|조치해|오탐|완료로|잡아|스캔|보고서|리포트|방법|어떻게|절차)/;

export function isFindingListAsk(text: string): boolean {
  const t = String(text ?? "");
  if (LIST_BLOCK_RE.test(t)) return false;
  return LIST_ASK_RE.test(t) && LIST_VERB_RE.test(t);
}

/**
 * 물음에 **대상이 적혀 있으면** 그 자산으로 좁힌다.
 *
 * ★ 왜(2026-08-03 실측): 잃었던 취약점 4,833건을 되살리자 「웹서버 취약점만 보여줘」와
 *   「sample-web01 취약점만 보여줘」가 **4,827건 전부**를 쏟았다. 이 함수가 대상을 아예
 *   안 봤기 때문인데, 데이터가 17건일 때는 아무도 몰랐다 — 적은 데이터가 결함을 가렸다.
 *
 * ⚠ 대상을 못 찾으면 **전체를 쏟지 않는다.** 못 찾았다고 말한다(runListAssets와 같은 원칙).
 */
function 대상자산고르기(text: string): { ids: string[] | null; 이름: string | null; 못찾음: string | null } {
  const t = String(text ?? "").trim();
  // "…만 보여줘"처럼 **좁히겠다는 말**이 있을 때만 대상을 찾는다. 없으면 전체가 맞다.
  const 좁힘 = /(만|의|에서|중에?)\s*(취약점|미조치|목록|리스트|보여|뭐\s*있)/.test(t) || /취약점만/.test(t);
  if (!좁힘) return { ids: null, 이름: null, 못찾음: null };
  // 물음에서 대상이 될 만한 낱말을 뽑는다. 조사·공용어는 뺀다.
  //   ⚠ **양방향으로 본다.** 물음이 자산 이름을 통째로 담은 경우("sample-web01 취약점만")와,
  //     자산 이름이 물음의 낱말을 담은 경우("웹서버" ⊂ "샘플-웹서버 (10.0.0.100)") 둘 다다.
  //     한쪽만 보면 담당자가 줄여 부르는 이름을 영영 못 찾는다(2026-08-03 실측).
  const 흔한말 = /^(취약점|미조치|목록|리스트|보여|보여줘|현황|뭐|있어|있나|알려|알려줘|전체|모든|우리|지금|좀|해줘|줘)$/;
  const 낱말들 = t
    .replace(/[?!.,]/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/(만|의|에서|중에?|은|는|이|가|을|를)$/, "").trim())
    .filter((w) => w.length >= 2 && !흔한말.test(w));
  const 자산들 = listAssets();
  const 걸린것 = 자산들.filter((a) => {
    const 후보 = [a.displayName || "", a.name, a.id.replace(/^vuln:/, ""), a.assetType, a.service ?? ""].filter(Boolean);
    return 후보.some(
      (s) =>
        (s.length >= 3 && t.toLowerCase().includes(s.toLowerCase())) ||
        낱말들.some((w) => s.toLowerCase().includes(w.toLowerCase()))
    );
  });
  if (걸린것.length > 0) {
    return { ids: 걸린것.map((a) => a.id), 이름: 걸린것.map((a) => a.displayName || a.name).join(", "), 못찾음: null };
  }
  // 좁히겠다고 했는데 등록부에 없는 이름이다 — 전체를 주면 담당자는 그게 답인 줄 안다.
  const 낱말 = t.replace(/(취약점|미조치|목록|리스트|보여\s*줘?|뭐\s*있어?|만|의|에서|중에?|\?|줘)/g, "").trim();
  return { ids: null, 이름: null, 못찾음: 낱말 || null };
}

/**
 * 규칙으로 만든 취약점 목록 답 + 그 자리에서 고를 수 있는 체크칸.
 *
 * @param 걸린범위 🗂 지금 범위(자산 id). 담당자가 화면에서 명시적으로 건 것이라 **늘 좁힌다**.
 *
 * ⚠ 이 경로는 **agentloop를 안 탄다**(결정적 답). 그래서 도구 인자에 범위를 입히는 장치가
 *   여기까지 안 온다 — 2026-08-18 실측: 범위가 `10.10.20.11`인데 「미조치 취약점 몇 건이야?」에
 *   **전체 3,008건**이 왔다. 화면엔 「대화창 지시가 이 자산 기준으로 갑니다」라고 적혀 있는데.
 *   빠른 길일수록 이런 것이 새기 쉽다 — 갈래마다 챙겨야 한다.
 * ⚠ **문장 속 대상이 먼저다.** 「범위는 A인데 B 취약점은?」이면 B가 이긴다 —
 *   화면 상태가 사람 말을 조용히 덮으면 안 된다.
 */
export function findingListAnswer(text = "", 걸린범위?: string | null): { output: string; picklist: PickList | null; dataCard?: import("./datacard").DataCard } {
  const 문장범위 = 대상자산고르기(text);
  const 범위 =
    문장범위.ids || 문장범위.못찾음 || !걸린범위
      ? 문장범위
      : {
          ids: [걸린범위],
          // ⚠ **이름을 반드시 채운다.** 좁혔는데 머리줄에 안 적으면 담당자는 그 수를
          //   전체로 읽는다 — 「3건뿐이네」 하고 넘어간다. 등록부에서 실제 이름을 찾는다.
          이름: (listAssets().find((a) => a.id === 걸린범위)?.displayName
            ?? listAssets().find((a) => a.id === 걸린범위)?.name
            ?? 걸린범위.replace(/^vuln:/, "")) + " (🗂 지금 범위)",
          못찾음: null as string | null,
        };
  if (범위.못찾음) {
    return {
      output:
        `등록된 자산 중 "${범위.못찾음}"에 해당하는 것을 찾지 못해 취약점을 좁히지 못했습니다.\n` +
        `자산 이름으로 다시 말씀해 주시거나, "자산 목록"으로 어떤 이름이 있는지 보세요. ` +
        `전체를 보시려면 "미조치 취약점 뭐 있어?"라고 하시면 됩니다.`,
      picklist: null,
    };
  }
  // ⚠ 상한을 걸고 그 수를 "총 N건"이라 말하면 거짓이 된다(실측: 상한 200에 걸려 늘 "200건"이었다).
  //   담당자는 그 수를 보고 일의 크기를 가늠하므로, 총계는 상한 없이 센다.
  const rows = prioritizedReviews(100000, 범위.ids ?? undefined);
  if (rows.length === 0) {
    return {
      output: 범위.이름
        ? `${범위.이름}에는 지금 조치할 취약점이 없습니다. (오탐 판정·조치완료 제외)`
        : "지금 조치할 취약점이 없습니다. 새 점검 결과가 들어오면 여기에 뜹니다.",
      picklist: null,
    };
  }
  const 미배정 = rows.filter((r) => !r.assignee).length;
  const 초과 = rows.filter((r) => r.overdue).length;
  const 보여줄 = rows.slice(0, MAX_PICK);
  const lines = 보여줄.map((r) => {
    const who = r.assignee ? `담당 ${r.assignee}` : "담당 미배정";
    const due = r.dueDate ? `기한 ${r.dueDate}` : "기한 없음";
    return `- **[${r.finding.severity}]** ${r.finding.finding_type} @ ${r.assetName} — ${who} · ${due}`;
  });
  // 좁혔으면 **무엇으로 좁혔는지 머리줄에 적는다** — 안 적으면 전체인 줄 안다.
  const 머리 =
    (범위.이름 ? `${범위.이름} — ` : "") +
    `조치할 취약점 **${rows.length}건** — 담당자 미배정 ${미배정}건 · 기한 초과 ${초과}건`;
  const 꼬리 = rows.length > 보여줄.length ? `\n\n(급한 순으로 ${보여줄.length}건만 보여드립니다)` : "";
  const output = `${머리}\n\n${lines.join("\n")}${꼬리}`;
  // 데이터 카드(2차, 2026-08-19) — **KPI만, 표는 없다.** 목록은 이미 두 벌이다:
  // 본문 텍스트(위 lines — picklist.test가 계약으로 잡음)와 체크칸(조치용).
  // 표까지 넣으면 같은 목록이 세 벌 — 「같은 것을 여러 곳에 적으면 어긋난다」가 화면에 생긴다.
  const 심각 = rows.filter((r) => r.finding.severity === "critical").length;
  const dataCard: import("./datacard").DataCard = {
    title: (범위.이름 ? `${범위.이름} — ` : "") + "우선순위 — 조치할 취약점",
    kpis: [
      { label: "조치할 취약점", value: String(rows.length) },
      { label: "매우 심각", value: String(심각), color: 심각 ? "bad" : "ok" },
      { label: "담당 미배정", value: String(미배정), color: 미배정 ? "warn" : "ok" },
      { label: "기한 초과", value: String(초과), color: 초과 ? "bad" : "ok" },
    ],
    screen: { page: "triage.html", label: "우선순위" },
  };
  // 체크칸은 **방금 그린 그 줄들**에서 직접 만든다. 글자 대조로 되찾으면 같은 자산에 같은 유형이
  // 둘 있을 때 화면에 없는 것이 딸려 들어온다(글자만으로는 둘을 구별할 수 없다).
  return { output, picklist: { kind: "finding", items: 보여줄.map(toPickItem), actions: PICK_ACTIONS }, dataCard };
}

// ── "내 업무 / 오늘 남은 일" — 규칙으로 목록 + 골라서 처리 ────────────────
// (2026-07-31 사용자 지시: "내업무와 대시보드 오늘 남은 일이 챗봇에서 잘 뜨고 내용이 나오는지,
//  챗봇에서 선택하고 일할 수 있는지 확인하고 수정")
//
// 왜 규칙인가: 실측해 보니 "내 업무 보여줘"가 **화면 설명**으로 떨어졌다("항목을 클릭하면
// 해당 작업 화면으로 이동합니다…"). 담당자는 자기 할 일을 물었는데 사용법을 들었다.
// 내 업무는 tasks 테이블에 그대로 있는 데이터다 — 모델에게 물을 이유가 없다.

const WORK_ASK_RE = /(내\s*업무|내\s*할\s*일|오늘\s*할\s*일|오늘\s*남은|남은\s*일|할\s*일|업무\s*목록|해야\s*할)/;
// 이미 다른 결정적 경로가 맡은 말은 비켜 준다(취약점 목록·설정 안내).
// ★ "화면·메뉴·하는 곳"도 비켜 준다 — 화면 **설명**을 물었는데 할 일 목록을 쏟던 것을 막는다.
//   실측(2026-08-01 챗봇 전수): "여기 내 업무 화면은 뭐 하는 곳이야?"에 남은 일 4건이 나왔다.
//   답 자체는 멀쩡해서 어떤 검사에도 안 걸린다 — 물은 것과 다른 답이라는 게 문제다.
const WORK_BLOCK_RE = /(취약점|자산|보고서|리포트|설정|계정|인증|열쇠|백업|어떻게|방법|화면|메뉴|페이지|하는\s*곳)/;

// ★ **하라는 말은 비켜 준다**(2026-08-01, 콘솔 이관). "할 일 추가: ○○" · "○○ 완료"는
//   목록을 보여 달라는 게 아니라 **시키는 말**이다. 여기서 가로채면 담기·완료 도구가
//   영영 안 불리고, 모델이 "완료했습니다"라고 지어낸다(실측으로 확인함).
//   대화창에서 업무를 끝내는 것이 이 제품의 핵심이라 이 갈림이 중요하다.
// ⚠ **받아 줄 도구가 있는 말만** 넣는다(검토 지적 2026-08-01). 할 일을 지우는 도구는 없는데
//   지워|삭제|없애 가 들어 있어, 목록도 안 나오고 도구도 없이 7B 재량으로 떨어졌다 —
//   막으려던 바로 그 함정이다. (지우기는 "완료"로 대신한다.)
const WORK_DO_RE = /(추가|담아|적어|넣어|등록|완료|끝냈|끝났|다\s*했|처리했)/;

export function isMyWorkAsk(text: string): boolean {
  const t = String(text ?? "");
  if (WORK_BLOCK_RE.test(t)) return false;
  if (WORK_DO_RE.test(t)) return false; // 시키는 말 → 도구(add_task·complete_task)로
  return WORK_ASK_RE.test(t);
}

/** 내 업무 한 줄 — 화면(mywork.html)과 같은 말로 적는다. */
interface WorkLike {
  id: string;
  text: string;
  done: boolean;
  overdue: boolean;
  dueAt?: number;
  priority?: string;
  why?: string;
  guideTotal?: number;
  guideDoneCount?: number;
}

const 날짜 = (ms?: number) => (ms ? new Date(ms).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" }) : null);

export function myWorkAnswer(p: { today: WorkLike[]; week: WorkLike[]; later: WorkLike[]; counts?: { overdue?: number; doneToday?: number } }): {
  output: string;
  picklist: PickList | null;
} {
  const 오늘 = (p.today ?? []).filter((t) => !t.done);
  const 이번주 = (p.week ?? []).filter((t) => !t.done);
  const 나중 = (p.later ?? []).filter((t) => !t.done);
  const 전부 = [...오늘, ...이번주, ...나중];
  if (전부.length === 0) {
    return { output: "지금 남은 일이 없습니다. 새로 할 일이 생기면 여기에 뜹니다.", picklist: null };
  }
  const 지남 = 전부.filter((t) => t.overdue).length;
  const 줄 = (t: WorkLike) => {
    const 기한 = t.overdue ? "⚠ 기한 지남" : 날짜(t.dueAt) ? `~${날짜(t.dueAt)}` : "기한 없음";
    const 가이드 = t.guideTotal ? ` · 순서 ${t.guideDoneCount ?? 0}/${t.guideTotal}` : "";
    return `- **${t.text}** — ${기한}${가이드}${t.why ? ` · ${t.why}` : ""}`;
  };
  const 절 = (제목: string, xs: WorkLike[]) => (xs.length ? `\n\n**${제목}** (${xs.length})\n${xs.map(줄).join("\n")}` : "");
  const 머리 = `남은 일 **${전부.length}건**${지남 ? ` — 그중 기한 지남 ${지남}건` : ""}${p.counts?.doneToday ? ` · 오늘 끝낸 일 ${p.counts.doneToday}건` : ""}`;

  // ★ 「지금 이거」 — 담당자가 **고르지 않아도 되게** 하나를 집어 맨 앞에 둔다
  //   (2026-08-01 시안 승인 · 「내 업무」 화면을 없애고 대화창에서 하는 첫 조각).
  //   손대던 것이 있으면 그것부터 — 하던 일을 잃지 않는 게 먼저다(옛 화면의 규칙 그대로).
  //   ⚠ 순서는 여기서 **규칙으로** 정한다. 모델이 고르면 담당자가 근거를 못 되짚는다.
  const 진행중 = 오늘.filter((t) => (t.guideDoneCount ?? 0) > 0 && (t.guideDoneCount ?? 0) < (t.guideTotal ?? 0));
  const 지금 = 진행중[0] ?? 오늘[0] ?? 이번주[0] ?? null;
  const 지금줄 = 지금
    ? `\n\n**▶ 지금 이거** — ${지금.text}` +
      (지금.overdue ? " ⚠ 기한 지남" : "") +
      (지금.guideTotal ? ` · 순서 ${지금.guideDoneCount ?? 0}/${지금.guideTotal}` : "") +
      `\n  "${지금.text} 어떻게 해?"라고 물으면 순서를 알려드립니다 · 끝냈으면 "${지금.text} 완료"`
    : "";

  const output = 머리 + 지금줄 + 절("오늘", 오늘) + 절("이번 주", 이번주) + 절("나중에", 나중);

  // 체크칸은 방금 그린 그 줄들에서 직접 만든다(글자 대조로 되찾지 않는다).
  const items: PickItem[] = 전부.slice(0, MAX_PICK).map((t) => ({
    id: t.id,
    label: t.text,
    severity: t.overdue ? "overdue" : String(t.priority ?? "P3"),
    ...(t.dueAt ? { dueDate: new Date(t.dueAt).toISOString().slice(0, 10) } : {}),
  }));
  return {
    output,
    picklist: {
      kind: "task",
      items,
      // ⚠ 할 일에 "오탐 처리"는 뜻이 없다 — 취약점 조치를 그대로 베끼지 않는다.
      //   기한 바꾸기도 넣으려다 뺐다: 지금 tasks에 기한을 고치는 길이 없다.
      //   **안 되는 버튼을 내걸면 그게 더 나쁘다** — 누르면 "화면에서 하세요"라는 답만 돌아온다.
      actions: [{ key: "done", label: "끝냄으로" }],
    },
  };
}

// ── 고른 것을 조치로 잇기 ───────────────────────────────────────────────
// 대화창이 체크한 건들을 **표식**으로 실어 보낸다. 서버는 그 표식을 규칙으로 읽는다 —
// LLM에게 "이 중 3번, 5번을 처리해"라고 시키지 않는다. 7B가 번호를 하나 잘못 읽으면
// 엉뚱한 취약점이 오탐 처리된다(모델에 프롬프트를 더해 고칠 문제가 아니라 코드로 막을 문제다).
export const PICK_MARK = "#고른건";
const ACTION_MARK = "#조치";
const VALUE_MARK = "#값";
const KIND_MARK = "#종류";
/**
 * **화면에서 보고 있던 목록**(2026-08-18 배관). `#고른건`과 다르다:
 *   · `#고른건` = 사람이 **체크한** 것. 그 자체가 대상이다.
 *   · `#보는목록` = 사람이 **보고 있던** 것. 평소엔 아무 일도 하지 않고, 조건이 뜻을 잃었을 때
 *     (「이것들 전부 배정해줘」) **그때만** 대상이 된다.
 *
 * ⚠ 「보고 있던 것」을 늘 대상으로 삼지 않는 이유: 그러면 화면이 사람 말을 조용히 덮는다.
 *   "critical 전부 배정"이라고 했는데 화면에 medium만 떠 있다고 medium이 바뀌면 사고다.
 */
export const VIEW_MARK = "#보는목록";

export interface PickCommand {
  ids: string[];
  action: "assign" | "due" | "done" | "false";
  value: string;
  /** 무엇을 고른 것인가 — 취약점과 할 일은 "끝냄"의 뜻이 다르다. 없으면 취약점(기존 동작). */
  kind: "finding" | "task";
}

function markLine(text: string, mark: string): string {
  for (const raw of String(text ?? "").split("\n")) {
    const line = raw.trim();
    if (line.startsWith(mark + " ")) return line.slice(mark.length + 1).trim();
  }
  return "";
}

/** 대화창이 보낸 "고른 것 조치" 지시를 읽는다. 표식이 없거나 망가졌으면 null(평소대로 처리). */
export function parsePickCommand(text: string): PickCommand | null {
  const idsRaw = markLine(text, PICK_MARK);
  if (!idsRaw) return null;
  const ids = idsRaw.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) return null;
  const action = markLine(text, ACTION_MARK);
  if (action !== "assign" && action !== "due" && action !== "done" && action !== "false") return null;
  const value = markLine(text, VALUE_MARK);
  // 담당자·기한은 값이 있어야 뜻이 통한다. 값 없이 넘어오면 처리하지 않는다 —
  // 빈 값으로 결재판을 만들면 "담당 (없음)으로 배정"이라는 뜻 모를 승인이 뜬다.
  if ((action === "assign" || action === "due") && !value) return null;
  const kind = markLine(text, KIND_MARK) === "task" ? "task" : "finding";
  // 할 일에 할 수 있는 건 "끝냄" 하나다(담당자 배정·오탐·기한은 뜻이 없거나 길이 없다).
  // 화면은 그것만 보내지만, 표식은 밖에서 오는 값이라 여기서도 막는다.
  if (kind === "task" && action !== "done") return null;
  return { ids, action, value, kind };
}

/**
 * 기록·표시에 쓸 사람 말만 남긴다.
 * ⚠ 표식은 기계용이다. 그대로 저장하면 작업 내역과 이어보기에 sha1 해시가 줄줄이 남아
 *   담당자가 자기 대화를 못 알아본다(2026-07-31 실화면에서 발견).
 */
export function stripPickMarks(text: string): string {
  // ⚠ **새 표식을 만들면 반드시 여기 넣는다.** 안 넣으면 그 글자가 작업 내역·이어보기에
  //   그대로 저장되어 담당자가 자기 대화에서 기계용 글자를 본다.
  //   2026-08-18 실측: `#범위`를 빠뜨려 접힌 줄이 「자산 몇 개야? #범위 asset:vuln:10.10.20.11」로
  //   저장됐다. 2026-07-31에 sha1 해시로 같은 사고를 겪고 이 함수를 만들었는데 또 샜다 —
  //   목록을 손으로 관리하는 한 반복된다. 그래서 **모든 표식 상수를 한 배열**로 모으고
  //   `picklistmarks.test.ts`가 「선언된 표식이 전부 이 목록에 있는가」를 감시한다.
  const marks: readonly string[] = ALL_MARKS;
  const kept = String(text ?? "")
    .split("\n")
    .filter((raw) => {
      const line = raw.trim();
      return !marks.some((m) => line.startsWith(m + " "));
    });
  return kept.join("\n").trim();
}

/**
 * 지시문에 실린 「보고 있던 목록」을 읽는다. 없으면 빈 문자열(평소대로).
 *
 * ⚠ 상한 50건, 그리고 넘치면 **잘라 내지 않고 아예 안 쓴다**. 이유:
 *   잘린 절반을 「보고 있던 것」이라 부르며 대상으로 삼는 게 제일 나쁘다 —
 *   담당자는 전부 바뀐 줄 알고, 실제로는 앞의 50건만 바뀐다.
 *   넘치면 조건을 말해 달라는 안내로 간다 — 수백 건 일괄 처리는 조건으로 하는 편이 옳다.
 *
 * ⚠ 정정(2026-08-18 검토): 전에 여기 「긴 값이 결재판에 들어가면 승인 버튼이 밀려나 관문이
 *   망가진다」고 적었는데 **확인 안 하고 쓴 말이었다.** 결재판 입력칸은 `.cs-apin{flex:1}`
 *   한 줄짜리라(console.js:206) 값이 길어도 세로가 안 늘어난다. 버튼은 안 밀린다.
 *   다만 **사람이 검증할 수 없는 값을 보여 주며 확인을 받는** 문제는 남는다 —
 *   담당자가 실제로 읽을 수 있는 건 결재판 「실행되면」 줄의 라벨 몇 개뿐이다.
 */
export const VIEW_MAX = 50;
export function parseViewIds(text: string): string {
  const raw = markLine(text, VIEW_MARK);
  if (!raw) return "";
  const ids = raw.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0 || ids.length > VIEW_MAX) return "";
  return ids.join(",");
}

/**
 * **「보는목록」 표식만** 떼어 낸다(2026-08-18 검토 지적). 다른 표식(#고른건·#조치·#값·#종류)은 남긴다.
 *
 * ⚠ 왜 따로 필요한가 — 검토관이 찾은 실결함:
 *   `#고른건`은 dispatcher가 곧바로 결재판으로 빠져나가(parsePickCommand) LLM을 안 탄다.
 *   그런데 `#보는목록`은 **그 화면에서 보내는 모든 말**에 붙고 빠져나가는 자리가 없어,
 *   글자를 보고 판단하는 관문들을 **전부 오염시킨다**:
 *     · isTooVague — "?" 뒤에 표식 1,300자가 붙어 「두 글자 이하」가 거짓이 된다 → 되묻기가 안 뜬다
 *     · 한낱말되묻기 — 정규식이 `^취약점$`라 "취약점\n#보는목록 …"이면 안 맞는다 → 34초 헤매던 길로
 *   그래서 **판단하기 전에** 떼어 내고, 값은 따로 들고 간다.
 */
export function stripViewMark(text: string): string {
  return String(text ?? "")
    .split("\n")
    .filter((raw) => !raw.trim().startsWith(VIEW_MARK + " "))
    .join("\n")
    .trim();
}

// ── 🗂 지금 범위(승인 시안 mockups/자산_0단계, 2026-08-18) ────────────────────────
//
// ⚠ `#보는목록`과 **다르다.** 보는목록은 「지금 화면에 떠 있는 것들」이라 조건이 뜻을 잃었을
//   때만 쓴다. 범위는 담당자가 **명시적으로 건 것**이고 화면을 옮겨도 남는다 —
//   그러니 늘 대상을 좁힌다.
// ⚠ 이 표식이 서버까지 오지 않으면 화면엔 「이 자산 범위」라 적혀 있는데 대화창은 전 자산을
//   답한다. 「안내한 말과 코드가 어긋난다」의 전형이다(2026-08-18 검토관이 착수 전에 잡았다).
export const SCOPE_MARK = "#범위";

/**
 * 🚀 어떤 셸에서 물었나 — 지금은 `pro` 하나뿐(2026-08-19).
 *
 * ⚠ 왜 표식인가: 「○○은 사이드바 ② 우선순위 안에 있습니다」 같은 **길찾기 안내**가
 *   프로에서는 틀린 말이 된다(프로엔 사이드바가 없다). 서버가 그걸 알려면 신호가 와야 하는데,
 *   `sendInstruction` 인자를 늘리면 **라이트까지 걸린 공용 통로 다섯 파일**이 흔들린다.
 *   `#범위`·`#보는목록`이 이미 쓰는 표식 관례를 그대로 따르면 새 통로가 안 생긴다.
 * ⚠ `ALL_MARKS`에 넣는 순간 `stripPickMarks`가 **기록·표시에서 자동으로 떼어 준다** —
 *   안 넣으면 담당자 작업 내역에 「#셸 pro」가 그대로 남는다(2026-08-18에 `#범위`로 겪었다).
 */
export const SHELL_MARK = "#셸";

/** 지시문에 실린 셸 종류를 읽는다. 없거나 모르는 값이면 null(표준으로 본다). */
export function parseShellMark(text: string): "pro" | null {
  return markLine(text, SHELL_MARK).trim() === "pro" ? "pro" : null;
}

/** 「셸」 표식만 떼어 낸다. */
export function stripShellMark(text: string): string {
  return String(text ?? "")
    .split("\n")
    .filter((raw) => !raw.trim().startsWith(SHELL_MARK + " "))
    .join("\n")
    .trim();
}

/**
 * **대화창이 지시에 실어 보내는 기계용 표식 전부.**
 *
 * ⚠ 새 표식을 만들면 여기 넣는다. 여기 없으면 그 글자가 작업 내역·이어보기에 **그대로 저장**되어
 *   담당자가 자기 대화에서 기계 글자를 본다(2026-07-31 sha1 해시 · 2026-08-18 `#범위` — 두 번 겪었다).
 *   손으로 관리하는 목록은 반복해 새므로 `picklistmarks.test.ts`가 「선언된 표식이 전부 여기 있나」를 센다.
 * ⚠ 선언 순서에 주의 — 이 배열은 모듈 로드 때 평가되므로 **모든 표식 상수 뒤**에 와야 한다.
 */
export const ALL_MARKS = [PICK_MARK, ACTION_MARK, VALUE_MARK, KIND_MARK, VIEW_MARK, SCOPE_MARK, SHELL_MARK] as const;

export interface ScopeMark {
  kind: string;   // 지금은 "asset" 하나. 나중에 "team"·"tag"가 붙을 자리라 종류를 실어 둔다.
  id: string;
}

/** 대화창이 실은 범위 표식을 읽는다. 없거나 망가졌으면 null(평소대로 전체). */
export function parseScopeMark(text: string): ScopeMark | null {
  const raw = markLine(text, SCOPE_MARK);
  if (!raw) return null;
  const i = raw.indexOf(":");
  if (i <= 0) return null;
  const kind = raw.slice(0, i).trim();
  const id = raw.slice(i + 1).trim();
  // 종류·id에 공백이나 쉼표가 섞이면 화면이 잘못 만든 것이다 — 조용히 무시한다(전체로 돈다).
  if (!kind || !id || /[,\s]/.test(kind) || /[,\s]/.test(id) || id.length > 200) return null;
  return { kind, id };
}

/** 「범위」 표식만 떼어 낸다. 다른 표식은 남긴다(stripViewMark와 같은 이유). */
export function stripScopeMark(text: string): string {
  return String(text ?? "")
    .split("\n")
    .filter((raw) => !raw.trim().startsWith(SCOPE_MARK + " "))
    .join("\n")
    .trim();
}

/** 고른 조치를 bulk_update 인자로 바꾼다. */
export function pickToolArgs(cmd: PickCommand): Record<string, string> {
  const args: Record<string, string> = { ids: cmd.ids.join(",") };
  if (cmd.action === "assign") args.assignee = cmd.value;
  else if (cmd.action === "due") args.dueDate = cmd.value;
  else if (cmd.action === "done") args.status = "조치완료";
  else args.status = "오탐";
  return args;
}
