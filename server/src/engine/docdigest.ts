// engine/docdigest.ts — 문서 반입 소식: 올라온 문서를 ① 대장으로 알리고 ② 세 줄로 요약하고
// ③ 우리 지식(온톨로지)과의 접점까지 잇는다. [2026-08-06 사용자 승인 "추천으로 전부 진행" —
// 계획서 1차 목표(3소스 분석)의 소스 확장 + 후-6(축적 자산) 소속]
//
// 왜: CrowdStrike 위협 보고서 같은 PDF를 올려도 **올린 순간의 카드가 전부**였다 — 그 뒤로는
// 무엇이 들어왔는지, 무슨 내용인지, 우리와 무슨 상관인지 아무도 모른다(2026-08-06 사용자 지적).
//
// 원칙:
// - 접점(온톨로지 대조)은 **결정적**이다 — LLM이 꺼져 있어도 나온다.
// - 요약만 LLM이고, 실패하면 실패했다고 기록한다(없는 요약을 지어내지 않는다).
// - 요약은 "자체 요약" 표기와 함께 보인다 — 7B 숫자 오독 전례(2026-08-03) 때문에 원문 대체가 아니다.
import { db } from "../db";
import { chat } from "./llm";
import { listTriples } from "./ontology";

db.exec(`CREATE TABLE IF NOT EXISTS doc_digests (
  documentId TEXT PRIMARY KEY,
  summary TEXT,            -- 세 줄 요약(줄바꿈 구분). NULL이면 아직/실패
  keywords TEXT,           -- 쉼표 구분 핵심어
  matches TEXT,            -- 온톨로지 접점(줄바꿈 구분, 결정적)
  model TEXT,              -- 요약에 쓴 모델 표기(정직성)
  failedReason TEXT,       -- 요약 실패 사유(실패도 기록 — 조용한 공백 금지)
  madeAt TEXT NOT NULL
)`);

const upsert = db.prepare(`INSERT INTO doc_digests (documentId, summary, keywords, matches, model, failedReason, madeAt)
  VALUES (@documentId, @summary, @keywords, @matches, @model, @failedReason, @madeAt)
  ON CONFLICT(documentId) DO UPDATE SET summary=excluded.summary, keywords=excluded.keywords,
    matches=excluded.matches, model=excluded.model, failedReason=excluded.failedReason, madeAt=excluded.madeAt`);

/** 온톨로지 표제어와 문서 본문을 결정적으로 대조 — "보고서의 ○○ ↔ 우리 지식의 △△" 접점.
 *
 *  처음엔 expandOntology를 재사용했는데 **운영 실측(2026-08-06)에서 오탐이 났다**:
 *  CrowdStrike 보고서에 "Logs"·"Environment" 같은 일반 영단어가 있다는 이유로 남의 장비
 *  매뉴얼 트리플(sc-logs.txt 저장 파일 따위)이 접점으로 붙었다. 잘못된 접점은 없느니만 못하다.
 *  그래서 시드 자격을 강화한다 — 한글 포함, 숫자 포함(CVE-… ·T1566), 4자 이상 전부 대문자
 *  약어만 표제어로 친다. 일반 영단어(Logs·Dependency)는 어느 문서에나 있어 표식이 못 된다. */
function 표제어자격(w: string): boolean {
  if (w.length < 3 || w.length > 60) return false;
  if (/[가-힣]/.test(w)) return true;
  if (/\d/.test(w)) return true;
  if (w.length >= 4 && w === w.toUpperCase() && /^[A-Z][A-Z-]+$/.test(w)) return true;
  return false;
}

export function ontologyMatchesFor(text: string, limit = 5): string[] {
  const lowered = text.toLowerCase();
  const all = listTriples();
  const seen = new Set<string>();
  const 접점: string[] = [];
  for (const t of all) {
    for (const w of [t.subject, t.object]) {
      if (접점.length >= limit) return 접점;
      const term = String(w ?? "").trim();
      if (seen.has(term) || !표제어자격(term)) continue;
      if (!lowered.includes(term.toLowerCase())) continue;
      seen.add(term);
      접점.push(`${t.subject} —[${t.predicate}]→ ${t.object}`);
      break; // 같은 트리플을 subject·object로 두 번 싣지 않는다
    }
  }
  return 접점;
}

/** 7B 응답을 세 줄 요약으로 정리 — 코드로 고친다(프롬프트로 7B 행동 교정 금지 원칙).
 *  실측(2026-08-06 운영): 지시문을 복창한 서두("…요약을 작성해주세요") + 742자 한 덩어리가 왔다. */
export function 요약정리(out: string): { summary: string | null; keywords: string | null } {
  const 줄들 = out.split("\n").map((l) => l.trim()).filter(Boolean);
  const kwLine = 줄들.find((l) => /^핵심어\s*[:：]/.test(l));
  const keywords = kwLine ? kwLine.replace(/^핵심어\s*[:：]\s*/, "").trim() || null : null;
  let body = 줄들.filter((l) => !/^핵심어\s*[:：]/.test(l)).join(" ");
  // 지시 복창 서두 제거 — "…요약을 작성해주세요/해줘" 류 문장은 내용이 아니다
  body = body.replace(/^[^.!?]*요약[^.!?]*(작성|해\s*주|해줘)[^.!?]*[.!?]\s*/, "").trim();
  // "…(요약)하면 다음과 같습니다:" 같은 이끎말은 문장 **가운데**에도 온다(검토관 2026-08-07:
  // 줄들을 공백으로 합친 뒤라 콜론이 문장 끝이 아니게 되고, 아래 꼬리 필터를 빠져나갔다).
  // 이끎말은 내용이 아니다 — 콜론까지 통째로 걷어낸다.
  body = body.replace(/[^.!?]*(요약|정리)[^.!?]{0,12}다음과 같[^:：.!?]*[:：]\s*/g, "").replace(/[^.!?]*다음과 같습니다\s*[:：]\s*/g, "");
  // 문장 단위로 최대 3개, 한 문장 120자 상한(넘치면 말줄임 — 원문 대체가 아니라 소식이다)
  // ⚠ 목록 번호를 문장 끝으로 착각하지 않는다(2026-08-07 실측): 7B가 "1. …"처럼 답하면
  //   「1.」에서 잘려 끝맺지 못한 줄이 나갔다. 숫자 뒤 마침표는 번호다 — 표식으로 바꿔 두되,
  //   ⚠ 날짜("2026. 8. 7.")는 건드리지 않는다: 번호 뒤에 **숫자가 아닌 내용**이 올 때만 번호다.
  const 안전 = body.replace(/(^|\s)(\d{1,2})\.\s+(?=[^\d\s])/g, "$1$2§ ");
  const 문장들 = 안전
    .split(/(?<=[.!?])\s+|(?<=다\.)\s*/)
    // 목록 항목("1§ 방화벽… 2§ 피싱…")은 한 덩어리로 남는다 — 항목 경계에서 갈라 각각 한 줄로.
    .flatMap((s) => s.split(/\s+(?=\d{1,2}§\s)/))
    .map((s) => s.replace(/^\d{1,2}§\s*/, "").trim())
    // 끝맺지 못한 꼬리("…다음과 같습니다:")는 요약이 아니다 — 버린다.
    .filter((s) => s.length >= 8 && !/[:：]$/.test(s));
  if (!문장들.length) return { summary: null, keywords };
  const summary = 문장들.slice(0, 3).map((s) => (s.length > 120 ? `${s.slice(0, 117)}…` : s)).join("\n");
  return { summary, keywords };
}

/** 반입 직후 백그라운드로 요약·접점을 만든다 — 실패해도 인입은 이미 성공, 여기서 죽지 않는다. */
export async function makeDigest(documentId: string, raw: string, category?: string): Promise<void> {
  const matches = ontologyMatchesFor(raw);
  let summary: string | null = null;
  let keywords: string | null = null;
  let failedReason: string | null = null;
  try {
    const 본문 = raw.slice(0, 5000);
    const out = await chat({
      agentId: "report",
      message:
        `다음 문서를 딱 세 줄로 요약해줘(각 줄 60자 이내, 줄마다 줄바꿈). 마지막 줄 뒤에 "핵심어: " 로 시작하는 핵심 단어 5개를 쉼표로 적어줘. ` +
        `문서에 없는 숫자·사실을 지어내지 마세요. 분류: ${category ?? "미상"}.\n\n${본문}`,
      trusted: true, // 내부 조립 프롬프트(gateway 자기차단 함정 — 보안 어휘가 규칙에 걸린다)
      noLearn: true, // 자동 요약이 학습 이력을 오염시키지 않게
    });
    const 정리 = 요약정리(out);
    summary = 정리.summary;
    keywords = 정리.keywords;
    if (!summary) failedReason = "모델 응답에서 요약을 못 뽑음";
  } catch (err) {
    failedReason = err instanceof Error ? err.message.slice(0, 200) : String(err);
  }
  upsert.run({
    documentId, summary, keywords,
    matches: matches.length ? matches.join("\n") : null,
    model: summary ? "로컬 모델 자체 요약" : null,
    failedReason, madeAt: new Date().toISOString(),
  });

  // 반입 소식 2차(2026-08-06) — 요약이 끝나면 **스스로 한 줄 알린다.** 물어봐야만 아는 것은
  // 알림이 아니다(CrowdStrike 실측: 요약이 30초 뒤에 나와 올린 사람이 그걸 볼 방법이 없었다).
  // ⚠ 새 통로를 만들지 않는다 — 대화창 하단 협업 독이 이미 실시간으로 흐른다.
  //   리포트로도 만들지 않는다(요약은 대장에 있고, 리포트 목록을 어지럽히면 그게 잡음이다).
  // ⚠ 문서마다 1줄이면 폴더째 반입(30건 스트레스 실측 2026-08-07)에서 협업 독이 30줄로
  //   도배된다 — 60초 창에 합류해 한 줄로 말한다(단건이면 예전 문구 그대로).
  알림합류(documentId, !!summary, matches.length, failedReason);
}

// ── 반입 알림 묶음 ───────────────────────────────────────────────────────────
const 알림창MS = 60_000;
let 알림묶음: { 성공: number; 실패: number; 접점: number; 첫문서: string; 첫실패사유: string | null } | null = null;
let 알림타이머: ReturnType<typeof setTimeout> | null = null;

/** 묶음 상태를 한 줄로 — 순수 함수(시험이 이것을 대조한다). */
export function 반입알림문구(m: { 성공: number; 실패: number; 접점: number; 첫문서: string; 첫실패사유: string | null }): string {
  const 전체 = m.성공 + m.실패;
  if (전체 === 1) {
    return m.성공
      ? `새 문서 「${m.첫문서}」 요약 완료${m.접점 ? ` · 우리 지식과 접점 ${m.접점}건` : ""} — "새 문서 뭐 들어왔어?"로 볼 수 있습니다.`
      : `새 문서 「${m.첫문서}」 들어옴 — 요약은 만들지 못했습니다(${(m.첫실패사유 ?? "사유 미상").slice(0, 40)}).`;
  }
  const 실패쪽 = m.실패 ? ` · 요약 실패 ${m.실패}건` : "";
  const 접점쪽 = m.접점 ? ` · 우리 지식과 접점 ${m.접점}건` : "";
  return `새 문서 ${전체}건 요약 완료${실패쪽}${접점쪽} — "새 문서 뭐 들어왔어?"로 볼 수 있습니다.`;
}

/** 열려 있는 창을 지금 닫아 흘려보낸다(시험도 이것을 쓴다 — 실타이머 60초를 기다리지 않게). */
export async function 알림창닫기(): Promise<void> {
  if (알림타이머) { clearTimeout(알림타이머); 알림타이머 = null; }
  const m = 알림묶음;
  알림묶음 = null;
  if (!m) return;
  try {
    const { emitCollaboration } = await import("./collaboration.js");
    // 줄 맨 앞 아이콘 금지(말투 규범 — 그 자리는 상태 표식 자리다). 협업 독도 같은 잣대로 본다.
    emitCollaboration({ from: "analyze", to: "orchestrator", message: 반입알림문구(m) });
  } catch { /* 알림 실패가 소식 저장을 되돌리지 않는다 */ }
}

function 알림합류(documentId: string, 성공: boolean, 접점수: number, failedReason: string | null): void {
  if (!알림묶음) 알림묶음 = { 성공: 0, 실패: 0, 접점: 0, 첫문서: documentId, 첫실패사유: null };
  if (성공) 알림묶음.성공++; else { 알림묶음.실패++; 알림묶음.첫실패사유 ??= failedReason; }
  알림묶음.접점 += 접점수;
  if (알림타이머) return; // 창이 이미 열려 있다 — 닫힐 때 한 줄로 나간다
  알림타이머 = setTimeout(() => { void 알림창닫기(); }, 알림창MS);
  알림타이머.unref?.(); // 시험·종료 시 프로세스를 붙잡지 않는다
}

export interface RecentDoc {
  documentId: string;
  category: string | null;
  uploadedBy: string | null;
  ingestedAt: string;
  summary: string | null;
  keywords: string | null;
  matches: string | null;
  failedReason: string | null;
}

/** 최근 N일 반입 대장 — memory_documents(메타)와 doc_digests(소식)를 합쳐 본다. */
export function listRecentDocs(days = 7): RecentDoc[] {
  const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
  return db.prepare(
    // ⚠ 개인 문서(personal:*)는 반입 소식에서 원천 제외 — 이 목록은 전 담당자에게 뿌려진다
    //   (검토관 2026-08-20 상4). makeDigest 쪽도 안 만들지만, 옛 데이터·다른 인입 경로 대비
    //   여기서도 거른다(벨트와 멜빵).
    `SELECT m.documentId, m.category, m.uploadedBy, m.ingestedAt,
            d.summary, d.keywords, d.matches, d.failedReason
       FROM memory_documents m LEFT JOIN doc_digests d ON d.documentId = m.documentId
      WHERE m.ingestedAt >= ? AND m.documentId NOT LIKE 'personal:%' ORDER BY m.ingestedAt DESC`
  ).all(cutoff) as RecentDoc[];
}

/** 대화창 답변 본문 — 없으면 없다고 말한다(0건 재작성 금지 원칙과 같은 계열). */
export function recentDocumentsText(days = 7): string {
  const rows = listRecentDocs(days);
  if (!rows.length) return `최근 ${days}일 사이 새로 들어온 문서가 없습니다.`;
  const byCat = new Map<string, number>();
  for (const r of rows) byCat.set(r.category ?? "일반", (byCat.get(r.category ?? "일반") ?? 0) + 1);
  const 머리 = `최근 ${days}일 새 문서 ${rows.length}건 — ${[...byCat].map(([c, n]) => `${c} ${n}`).join(" · ")}`;
  const lines = rows.slice(0, 10).map((r) => {
    const when = r.ingestedAt.slice(5, 10).replace("-", "/");
    const who = r.uploadedBy ? ` · ${r.uploadedBy}` : "";
    let 소식 = "";
    if (r.summary) 소식 = `\n   ${r.summary.split("\n").join("\n   ")}\n   (로컬 모델 자체 요약 — 원문 확인은 지식 화면에서)`;
    else if (r.failedReason) 소식 = `\n   요약 없음(${r.failedReason.slice(0, 60)})`;
    // 줄 맨 앞 아이콘 금지(말투 규범 — 그 자리는 상태 표식 자리다. 🔗도 사전 밖 기호다).
    if (r.matches) 소식 += `\n   우리 지식과의 접점: ${r.matches.split("\n").slice(0, 2).join(" / ")}`;
    return `- ${r.documentId} [${r.category ?? "일반"}] ${when}${who}${소식}`;
  });
  const tail = rows.length > 10 ? `\n(외 ${rows.length - 10}건 — 지식 화면에서 전체 목록)` : "";
  return `${머리}\n${lines.join("\n")}${tail}`;
}
