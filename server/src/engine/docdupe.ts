// engine/docdupe.ts — 중복 문서 후보 찾기(표시만). [2026-08-07 사용자 승인 "전부 진행" —
// 147상황에 "중복된 문서 있어?"가 있는데 도구가 없어 모델이 근처 도구를 골라 답하던 미비]
//
// 원칙: **표시만 한다.** 지우는 결정은 사람이 결재판에서 한다(오탐 패턴과 같은 계약).
// v1 판별: 제목(문서 id) 정규화 대조 — 실사용에서 중복은 대부분 「같은 매뉴얼을 이름만 조금
// 다르게 두 번 올린 것」이다(v2·(1)·사본·날짜만 다름). 내용(임베딩) 대조는 비용이 커서
// 제목 후보가 실제로 잡히기 시작하면 그때 넓힌다 — 억지 후보가 없는 것보다 나쁘다.
import { db } from "../db";

export interface DupeGroup {
  key: string;                       // 정규화된 제목(무엇으로 묶였나)
  docs: { documentId: string; ingestedAt: string; chunks: number; category: string | null }[];
}

/** 제목 정규화 — 판박이 변형(버전·날짜·사본 표기·확장자)을 걷어 같은 뿌리인지 본다. */
export function 제목뿌리(documentId: string): string {
  return String(documentId ?? "")
    .toLowerCase()
    .replace(/\.(pdf|docx?|hwpx?|md|txt|xlsx?)$/i, "")
    .replace(/[(\[]\s*\d+\s*[)\]]/g, "")                  // (1)·[2] — 브라우저 중복 다운로드 표기
    .replace(/[-_\s]*(v|ver|version)\s*\.?\d+(\.\d+)*/gi, "") // v1.2·ver2
    .replace(/[-_\s]*(사본|복사본|최종|final|copy|백업)\s*\d*/gi, "")
    .replace(/20\d{2}[-._]?\d{1,2}[-._]?\d{1,2}/g, "")     // 날짜(2026-08-07·20260807)
    .replace(/[\s\-_.]+/g, "");
}

/** 중복 후보 묶음 — 같은 뿌리 제목이 2건 이상인 것만. 읽기 전용(아무것도 안 지운다). */
export function findDuplicateDocs(): DupeGroup[] {
  const rows = db.prepare(
    // 승인 문답(origin=approved-qa, 2026-09-03)은 제목이 「승인문답:<id>」라 뿌리가 안 겹치지만, 원천에서 뺀다.
    // 침해사고 사례 문서(origin=incident-case)도 뺀다 — 제목이 「incident-case:<id>」라 뿌리가 전부 같아 **전부가 중복 후보**로 보인다(결정 ①).
    "SELECT documentId, ingestedAt, chunks, category FROM memory_documents WHERE COALESCE(origin,'') <> 'approved-qa' AND COALESCE(origin,'') <> 'incident-case' ORDER BY ingestedAt DESC"
  ).all() as { documentId: string; ingestedAt: string; chunks: number; category: string | null }[];
  const 묶음 = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = 제목뿌리(r.documentId);
    if (k.length < 4) continue; // 뿌리가 너무 짧으면 우연히 겹친다(예: "메모") — 묶지 않는다
    if (!묶음.has(k)) 묶음.set(k, []);
    묶음.get(k)!.push(r);
  }
  return [...묶음.entries()]
    .filter(([, docs]) => docs.length >= 2)
    .map(([key, docs]) => ({ key, docs }))
    .sort((a, b) => b.docs.length - a.docs.length);
}

/** 대화창 답변 — 없으면 없다고 말한다(0건 재작성 금지 원칙과 같은 계열). */
export function duplicateDocsText(): string {
  const groups = findDuplicateDocs();
  if (!groups.length) return "제목이 겹치는 문서가 검색되지 않았습니다 — 같은 자료를 이름만 바꿔 두 번 올린 흔적이 없습니다.";
  const lines: string[] = [
    `제목이 겹치는 문서 ${groups.length}묶음 — 같은 자료를 두 번 올렸는지 확인해 보세요.`,
    "⚠ 표시만 합니다 — 지우지 않았습니다. 어느 쪽이 최신·완전본인지는 사람이 판단합니다.",
    "",
  ];
  for (const g of groups.slice(0, 8)) {
    lines.push(`- 비슷한 제목 ${g.docs.length}건:`);
    for (const d of g.docs) {
      lines.push(`    · ${d.documentId} [${d.category ?? "일반"}] ${String(d.ingestedAt).slice(0, 10)} · 조각 ${d.chunks}개`);
    }
  }
  if (groups.length > 8) lines.push(`… 외 ${groups.length - 8}묶음`);
  lines.push("", '지우려면: "문서 ○○ 지워줘" — 결재판에서 승인 후 지워집니다.');
  return lines.join("\n");
}
