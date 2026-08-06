// engine/actioncheck.ts — 행동 대조: "지금 하려는 행동이 규정에 맞나?"를 근거와 함께 판정한다.
// (계획서 전-2, 2026-07-29 — 시장 조사에서 확인된 교차 공백: 사후 인증 자동화는 있어도
//  "행동 실시간 대조"는 국내외에서 못 찾았다.)
//
// 설계 원칙 — 이 프로젝트의 확립 원칙을 그대로 잇는다.
//   1) 검색은 결정적, LLM의 재량은 최소 — 모델에게는 "제시된 사내 근거로 판정 하나(허용/조건부/
//      금지/부족)와 이유 두어 문장"만 시킨다(responseSchema). 최종 답의 구조·인용·면책은
//      코드가 조립한다 — 7B에게 형식을 맡기면 흔들린다(반복 실측).
//   2) 근거 없으면 판정하지 않는다 — 조치 검증의 NA 계약과 같다. "모른다"가 오답보다 안전하다.
//   3) 판정의 근거는 **사내규정 조각(원문 인용 가능)** 만이다. 법제처 검색은 제목·링크만 오므로
//      판단 근거가 될 수 없다 — "관련 법령(원문 확인)" 안내로만 붙인다.
//   4) 면책 상시 부착(LEGAL_DISCLAIMER) — 법률 자문이 아니다.
import { db } from "../db";
import { chat } from "./llm";
import { queryMemoryScored, listDocuments, RAG_RELEVANCE_MAX_DISTANCE } from "./memory";
import { getLawConfig, searchLaw, LEGAL_DISCLAIMER, LawHit } from "./lawinfo";
import { recordWork } from "./worklog";

// 판정 자체의 면책 — 로폼 대법원 판결(2026) 함의: "구체적 사안에 대한 법률적 판단"으로 읽히면
// 위법 소지가 있다. 이 기능은 **사내 규정 문서와의 대조**이고 법령은 원문 링크 안내까지만이다.
// (조사 2026-07-29: 국내 리걸테크 면책 관행 — "일반 정보 제공 목적, 법률 자문·해석 아님")
const ACTION_DISCLAIMER = "※ 이 판정은 올려 둔 사내 규정 문서와의 대조 결과이며, 법령에 대한 법률적 판단·자문이 아닙니다.";

// "~해도 되나"류 허락·적법성 질문만 좁게 잡는다 — "가능해?"만으로는 기능 질문("원격 스캔 가능해?")
// 까지 삼키므로 넣지 않는다. 실행 지시(점검해줘)·조회(알려줘)는 각자의 길로 가야 한다.
// 동사를 목록으로 들면 반드시 빠진다(실측: "넣어도 돼"가 새 나감) — 한국어 허락 구문의
// 꼴(동사+아/어/여도 + 되/돼/괜찮)로 일반화한다.
//
// [2026-07-29 평가 게이트(중-3) 첫 실행이 잡은 구멍] "갖다줘도 돼?" "보내도 돼?"가 판정 경로를
// 지나쳐 일반 조언으로 답했다. 국어의 어미 -아/-어/-여는 말할 때 앞 음절과 줄어든다(주+어도=줘도,
// 보내+어도=보내도, 바꾸+어도=바꿔도). 줄어든 꼴은 '아도/어도/여도'로 끝나지 않아 위 일반화가
// 통째로 비껴간다 — 축약형을 함께 적는다. 명사+보조사 '도'(이것도·나도)는 일부러 제외한다:
// 그쪽까지 삼키면 "이것도 돼?" 같은 평범한 물음이 판정 불가(NA) 답으로 튄다.
// [2026-08-03 실전 147상황이 잡은 더 큰 구멍] "클라우드에 백업 올려도 되나?"가 판정을 안 타고
// **Tenable 벤더 매뉴얼**을 물어와 "지원하지 않습니다"라고 답했다 — 우리 사내 규정이 아니라
// 남의 제품 설명이 판정처럼 나간 것이다. 제품 차별 기능(○/△/×)이 통째로 비껴갔다.
//
// 낱말 하나가 아니라 **한 갈래가 통째로** 빠져 있었다. 「이-어간」 동사(올리다·내리다·돌리다·
// 알리다·옮기다·맡기다·남기다…)는 -어도가 **려도/겨도**로 줄어드는데 그 꼴이 목록에 없었다.
// 보안 업무 동사 24개로 재 보니 **9개(37.5%)를 놓치고 있었다**(tools 없이 actioncheck.test.ts가 잰다).
//
// ⚠ 이 목록은 **짐작이 아니라 측정으로** 채운다. 담당자가 실제로 쓸 동사를 시험에 나열해 두고,
//   놓치는 것이 생기면 시험이 먼저 깨진다. 손으로 늘리는 방식은 반드시 또 샌다.
// ⚠ 명사와 겹치는 꼴은 넣지 않는다 — 매도(賣渡)·채도(彩度)·태도 같은 말이 "매도 돼?"로 걸리면
//   평범한 물음이 판정 불가(NA)로 튄다.
/**
 * 발췌를 **읽을 수 있을 때만** 보여 준다. 못 읽으면 문서 이름만 준다(빈 문자열 반환).
 *
 * 왜 필요한가(2026-08-03 실측): 참고 자료 발췌가
 *   `"ted onaTenableSecurityCenterwiththehostnameExample1toaTenableSecurityCenterwith…"`
 *   처럼 나갔다. PDF에서 글자를 뽑을 때 **띄어쓰기가 사라진** 덩어리다.
 *   담당자는 이걸 읽을 수 없고, 읽을 수 없는 근거는 근거가 아니다 —
 *   화면만 채우고 "무슨 소린지 모르겠다"는 인상만 남긴다.
 *
 * ⚠ 판정 자체는 건드리지 않는다. **보여 주는 글자만** 거른다.
 * ⚠ 한글 문서는 원래 띄어쓰기가 적을 수 있어 라틴 문자 덩어리일 때만 본다.
 */
export function 읽을수있는발췌(raw: string, 길이 = 90): string {
  const t = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  const 잘린 = t.slice(0, 길이);
  // 라틴 문자가 거의 없으면(한글 문서) 그대로 보여 준다.
  const 라틴 = (잘린.match(/[A-Za-z]/g) ?? []).length;
  if (라틴 < 잘린.length * 0.5) return 잘린;
  // 라틴 문서인데 **가장 긴 낱말이 너무 길면** 띄어쓰기가 뭉개진 것이다.
  const 최장 = Math.max(0, ...잘린.split(/\s+/).map((w) => w.length));
  return 최장 > 24 ? "" : 잘린;
}

export const ACTION_CHECK_RE =
  // ⚠ 동사 앞 **공백을 허용**한다 — 없으면 "목록 줘도 되나"가 안 걸린다(2026-08-03 실측).
  /[가-힣]{1,8}\s?(아도|어도|여도|해도|줘도|봐도|와도|가도|내도|써도|켜도|둬도|놔도|돼도|져도|쳐도|워도|꿔도|눠도|펴도|려도|겨도|꺼도|춰도|셔도|혀도|둔다면)\s*(돼|되나|될까|되는지|괜찮|문제\s*없)|[가-힣]+(려는데|려고\s*하는데)\s*(돼|되나|괜찮|문제)|허용\s*(되나|되는지|돼|될까)|위반(이야|인가|인지|되나|아닌가)|규정(에|상)\s*(맞|어긋|위배|문제)/;

interface Verdict {
  verdict: "allow" | "conditional" | "deny" | "insufficient";
  reason: string;
}

const VERDICT_SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["allow", "conditional", "deny", "insufficient"] },
    reason: { type: "string" },
  },
  required: ["verdict", "reason"],
} as const;

// ── 판정 이력 (해자 슬라이스 1, 2026-08-06 설계문서 승인) ─────────────────────
// 판정문이 세션 대화록에만 남아 쌓이지도 재사용되지도 않던 것을 전용 테이블로.
// 원칙: 판정 캐싱·자동 재사용 ✗ (규정이 바뀌면 답도 바뀌어야 한다) — **병기만** 한다.
db.exec(`CREATE TABLE IF NOT EXISTS action_check_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  askedAt TEXT NOT NULL,
  question TEXT NOT NULL,
  normQuestion TEXT NOT NULL,
  verdict TEXT NOT NULL,
  basisRefs TEXT NOT NULL,      -- 근거 문서 id들(정렬·쉼표) — 같은 사안 판별의 절반
  verdictText TEXT,             -- 모델 소견(그때 뭐라 했나)
  qa INTEGER NOT NULL DEFAULT 0 -- 게이트/QA 호출 — 저장은 하되 표시·집계에서 제외
)`);
const insertHistoryStmt = db.prepare(
  `INSERT INTO action_check_history (askedAt, question, normQuestion, verdict, basisRefs, verdictText, qa)
   VALUES (@askedAt, @question, @normQuestion, @verdict, @basisRefs, @verdictText, @qa)`
);
const prevVerdictStmt = db.prepare(
  `SELECT askedAt, verdict, basisRefs FROM action_check_history
    WHERE normQuestion = ? AND basisRefs = ? AND qa = 0 ORDER BY id DESC LIMIT 1`
);

// 같은 사안 판별은 결정적으로 — 정규화 후 완전 일치만(임베딩 유사도는 1차 제외, 법무 리스크).
export function normalizeActionQuestion(q: string): string {
  return q.replace(/[\s?.!~‥…]/g, "").toLowerCase();
}

const VERDICT_SYMBOL: Record<Verdict["verdict"], string> = { allow: "○", conditional: "△", deny: "×", insufficient: "보류" };

export interface ActionCheckHistoryRow {
  askedAt: string; question: string; normQuestion: string; verdict: Verdict["verdict"]; basisRefs: string; verdictText: string | null;
}

/** 대화창 조회용 — qa 행 제외(게이트 오염 배제 계약). */
export function listActionCheckHistory(limit = 30): ActionCheckHistoryRow[] {
  return db.prepare(
    `SELECT askedAt, question, normQuestion, verdict, basisRefs, verdictText
       FROM action_check_history WHERE qa = 0 ORDER BY id DESC LIMIT ?`
  ).all(Math.max(1, Math.min(200, limit))) as ActionCheckHistoryRow[];
}

const VERDICT_LABEL: Record<Verdict["verdict"], string> = {
  allow: "○ 허용 — 사내 근거상 가능",
  conditional: "△ 조건부 — 사내 근거상 조건·절차가 붙는다",
  deny: "× 금지 — 사내 근거상 하면 안 된다",
  insufficient: "판정 보류 — 근거가 부족하다",
};

function parseVerdict(raw: string): Verdict | null {
  try {
    const i = raw.indexOf("{");
    const j = raw.lastIndexOf("}");
    if (i < 0 || j <= i) return null;
    const p = JSON.parse(raw.slice(i, j + 1)) as Partial<Verdict>;
    if (p.verdict && ["allow", "conditional", "deny", "insufficient"].includes(p.verdict) && typeof p.reason === "string") {
      return { verdict: p.verdict, reason: p.reason.trim() };
    }
  } catch { /* 형식 불가 → 아래 폴백 */ }
  return null;
}

/** 법령 검색어 — 말끝(해도 돼 등)과 조사를 걷어 짧게 만든다. 법제처 검색은 짧은 명사구에 강하다. */
function lawQueryOf(question: string): string {
  return question
    .replace(ACTION_CHECK_RE, " ")
    .replace(/[?!.]/g, " ")
    .replace(/\b(그리고|그런데|혹시|지금|우리|사내|저희)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
}

export interface ActionCheckResult {
  output: string;
  sources: string[]; // 근거 배지용 문서 id
}

export async function runActionCheck(question: string, qa?: boolean): Promise<ActionCheckResult> {
  // ── 1) 사내규정 근거 (결정적 검색 — 컴플라이언스 화면 부스트로 규정 문서 우선) ──
  const scored = await queryMemoryScored(question, 5, undefined, "compliance.html").catch(() => []);
  const passed = scored.filter((c) => c.lexicalHit || c.distance <= RAG_RELEVANCE_MAX_DISTANCE);

  // ⚠ 판정 자격은 **사내규정 카테고리 문서**만이다(2026-07-29 실측 사고: 벤더 매뉴얼(Tenable
  //   가이드)을 근거로 "외부 공유 ○ 허용"이 나왔다 — 장비 사용법이 회사의 허락일 수 없다).
  //   규정이 아닌 문서는 '참고'로만 보여주고 판정 근거에서 뺀다. 조사 근거: 판정 전 결정적
  //   자격 게이트가 소형모델 환경의 핵심 안전장치(SURE-RAG·PolicyGuard 계열 공통).
  const categoryOf = new Map<string, string | null>();
  try {
    for (const d of await listDocuments()) categoryOf.set(d.documentId, d.category ?? null);
  } catch { /* 목록 실패 시 아래에서 전부 '참고'로 강등 — 자격 없이는 판정하지 않는다 */ }
  const relevant = passed.filter((c) => c.documentId && categoryOf.get(c.documentId) === "사내규정");
  const references = passed.filter((c) => !relevant.includes(c));
  const docs = [...new Set(relevant.map((c) => c.documentId).filter(Boolean))] as string[];

  // ── 2) 법령 포인터 (켜져 있을 때만 — 판단 근거가 아니라 원문 안내) ──
  let lawHits: LawHit[] = [];
  let lawNote = "";
  if (getLawConfig().enabled) {
    const q = lawQueryOf(question);
    if (q.length >= 2) {
      lawHits = await searchLaw(q, "law", 3).catch(() => []);
      if (lawHits.length === 0) lawNote = "관련 법령: 검색 결과 없음";
    }
  } else {
    lawNote = "관련 법령: 조회 꺼짐(폐쇄망 모드) — 설정 > 연동에서 법제처 인증키를 넣으면 함께 확인합니다";
  }

  // ── 3) 규정 근거가 하나도 없으면 판정하지 않는다 (NA 계약) ──
  if (relevant.length === 0) {
    const lines = [
      "판단 불가 — 이 행동을 판정할 **사내 규정 문서** 근거를 찾지 못했습니다.",
      "",
      "지금 말할 수 있는 것: 규정(업무영역 '사내규정') 문서에서 이 주제가 검색되지 않았습니다. 없다는 뜻이 아니라 **못 찾았다**는 뜻입니다.",
      "다음 중 하나로 이어가세요:",
      "  · 해당 규정·지침 문서가 있다면 아래 대화 콘솔의 ＋로 올리기 — 올린 즉시 이 질문에 근거로 답합니다",
      "  · 규정 담당자·법무에 직접 확인",
    ];
    if (references.length) {
      lines.push("", "참고 자료(규정 문서가 아니라 **판정 근거로 쓰지 않았습니다**):",
        ...references.slice(0, 3).map((c) => {
          const 이름 = c.documentId ?? "문서";
          const 발췌 = 읽을수있는발췌(c.text);
          return 발췌 ? `  · ${이름} — "${발췌}…"` : `  · ${이름}`;
        }));
    }
    if (lawHits.length) {
      lines.push("", "관련 법령(원문 확인):", ...lawHits.map((h) => `  · ${h.title}${h.meta ? ` — ${h.meta}` : ""}\n    ${h.link}`));
    } else if (lawNote) {
      lines.push("", lawNote);
    }
    lines.push("", ACTION_DISCLAIMER, LEGAL_DISCLAIMER);
    return { output: lines.join("\n"), sources: [] };
  }

  // ── 4) 판정 — 제시된 사내 근거로만. 형식은 코드가, 판단 한 조각만 모델이 ──
  const evidence = relevant
    .map((c, i) => `[근거 ${i + 1}] (${c.documentId ?? "문서"}) ${c.text.replace(/\s+/g, " ").slice(0, 500)}`)
    .join("\n");
  const raw = await chat({
    agentId: "analysis",
    message:
      `보안담당자가 하려는 행동: "${question}"\n\n` +
      `아래 사내 규정 근거만 보고 판정하라. 근거에 없는 내용을 지어내지 마라.\n` +
      `- 근거가 허용을 말하면 allow, 조건·절차를 붙이면 conditional, 금지하거나 최소 기준(예: 최소 보관 기간)을 어기게 되면 deny.\n` +
      `- 근거가 이 행동과 직접 관련이 없거나 애매하면 insufficient.\n` +
      `- reason은 **반드시 한국어로만** 2~3문장, 어느 근거 몇 번을 봤는지 말하라. 영어 금지.\n` +
      // ⚠ 예문을 넣지 않는다(2026-07-29 실측 2회): 7B가 "내용은 베끼지 말라"는 지시를 무시하고
      //   예문 문장을 판정 이유로 그대로 복창했다 — 예문은 교정이 아니라 오염원이었다.
      //   소견이 영어로 나오면 아래 사후 가드가 정직하게 바꾼다. 품질 개선은 프롬프트가 아니라
      //   승인된 실사용 골드 예시(few-shot 동적 주입, agentloop 선례)로 다음 단계에서 한다.
      `\n${evidence}`,
    responseSchema: VERDICT_SCHEMA,
    maxTokens: 250,
    trusted: true,
  }).catch(() => "");
  // 모델이 형식을 못 지키면 판정을 지어내지 않고 보류로 — 근거는 그대로 보여준다(정직 폴백).
  const v = parseVerdict(raw) ?? { verdict: "insufficient" as const, reason: "자동 판정을 하지 못했습니다 — 아래 사내 근거를 직접 보고 판단해 주세요." };
  // 이유가 영어로 나오면(7B 실측) 판정은 유지하되 이유는 정직하게 바꾼다 — 못 읽는 설명은 없느니만 못하다.
  if (!/[가-힣]/.test(v.reason)) v.reason = "판정 이유를 우리말로 정리하지 못했습니다 — 아래 사내 근거를 직접 보고 판단해 주세요.";

  const lines = [
    `【행동 대조】 ${VERDICT_LABEL[v.verdict]}`,
    "",
    // "모델 소견" 라벨 — 아래 '사내 근거'는 코드가 원문에서 그대로 오려 붙인 것이지만,
    // 이 줄은 모델의 해석이다. 인용 불충실(조사: 최대 57%)이 남는 자리라 둘을 구분해 보여준다.
    `모델 소견: ${v.reason}`,
    "",
    "사내 근거(원문 발췌 — 코드가 그대로 오림):",
    ...relevant.slice(0, 3).map((c, i) => `  [${i + 1}] ${c.documentId ?? "문서"} — "${c.text.replace(/\s+/g, " ").slice(0, 120)}…"`),
  ];
  if (references.length) {
    lines.push("", "참고 자료(규정 문서가 아니라 판정 근거로 쓰지 않았습니다):",
      ...references.slice(0, 2).map((c) => `  · ${c.documentId ?? "문서"}`));
  }
  if (lawHits.length) {
    lines.push("", "관련 법령(원문 확인):", ...lawHits.map((h) => `  · ${h.title}${h.meta ? ` — ${h.meta}` : ""}\n    ${h.link}`));
  } else if (lawNote) {
    lines.push("", lawNote);
  }
  // ── 지난 판정 병기 (해자 슬라이스 1) — 같은 사안(정규화 완전 일치 + 같은 근거 집합)만.
  //    판정은 이미 위에서 새로 했다 — 이 줄은 참고이지 캐시가 아니다. qa 호출은 병기 생략
  //    (게이트 출력이 이력 유무에 따라 흔들리면 안 된다).
  const normQ = normalizeActionQuestion(question);
  const basisKey = [...docs].sort().join(",");
  if (!qa) {
    const prev = prevVerdictStmt.get(normQ, basisKey) as { askedAt: string; verdict: Verdict["verdict"] } | undefined;
    if (prev) {
      const 뒤집힘 = prev.verdict !== v.verdict;
      lines.push(
        "",
        `${뒤집힘 ? "⚠ " : ""}※ 지난 판정: ${prev.askedAt.slice(0, 10)} ${VERDICT_SYMBOL[prev.verdict]}` +
          `${뒤집힘 ? ` → 이번 ${VERDICT_SYMBOL[v.verdict]} — 판정이 바뀌었습니다. 규정이 바뀌었거나 상황이 다른 것입니다(근거 원문을 확인하세요).` : " — 이번 판정과 같습니다."}`
      );
    }
  }
  lines.push("", ACTION_DISCLAIMER, LEGAL_DISCLAIMER);
  // 판정 이력 저장 — qa 호출도 저장은 한다(표시·집계만 제외). NA는 판정이 아니라 저장 안 함.
  try {
    insertHistoryStmt.run({
      askedAt: new Date().toISOString(), question: question.slice(0, 500), normQuestion: normQ,
      verdict: v.verdict, basisRefs: basisKey, verdictText: v.reason.slice(0, 500), qa: qa ? 1 : 0,
    });
  } catch (e) {
    console.warn(`[actioncheck] 판정 이력 저장 실패: ${e instanceof Error ? e.message : String(e)}`);
  }
  // 근거를 찾아 판정까지 한 경우만 작업 원장에 남긴다(중-2) — 판단 불가(NA)는 일한 게 아니다.
  recordWork({ kind: "action_checked", detail: question.slice(0, 60), source: "chat", qa });
  return { output: lines.join("\n"), sources: docs };
}
