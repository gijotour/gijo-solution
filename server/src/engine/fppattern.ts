// engine/fppattern.ts — 오탐 족보 일반화(해자 슬라이스 3, 2026-08-06 시안 승인).
//
// 실태: 오탐 판정(finding_approvals)은 **동일 자산 + 동일 finding 키**일 때만 자동 인식된다.
//   같은 취약점이 옆 서버에서 또 나오면 담당자가 처음부터 다시 판정한다 — 조직이 쌓은 판단이
//   자산 경계를 못 넘는다. 여기서는 그 판단을 **패턴으로 모아 보여 준다.**
//
// ★★ 절대 제약(설계문서 명시 · 시안에도 화면 문구로 박힘): **자동 제외 금지.**
//   오탐을 잘못 일반화하면 **진짜 취약점을 숨기는** 최악의 실패가 된다. 이 파일은
//   **읽기만** 한다 — 어떤 finding의 상태도 바꾸지 않고, 일괄 처리 경로도 만들지 않는다.
//   업계 컨센서스도 같다(경보의 절반 가까이가 오탐이지만 완전 자동 억제가 아니라 사람 검토 병행).
//
// 패턴의 정의: 같은 **취약점 유형 이름**으로 2회 이상 오탐 판정된 것.
//   1회는 우연일 수 있다(PortSwigger의 New/Recurrent 구분과 같은 취지).
import { db } from "../db";

export interface FpPattern {
  type: string;          // 취약점 유형 이름(패턴 이름)
  count: number;         // 오탐 판정 횟수
  assets: number;        // 걸린 자산 수
  lastAt: string | null; // 마지막 판정일
  lastBy: string | null; // 마지막 판정자
  reasons: string[];     // 판정 사유(note) 표본 — 왜 오탐이라 봤나
  conflict: { assetId: string; at: string | null; by: string | null }[]; // ⚠ 같은 유형인데 진짜로 판정된 이력
}

interface Row {
  assetId: string; status: string; rejectReason: string | null; reviewedAt: string | null;
  reviewedBy: string | null; note: string | null; snapshot: string | null;
}

const 유형 = (r: Row): string => {
  try {
    const s = r.snapshot ? (JSON.parse(r.snapshot) as { finding_type?: string }) : null;
    return (s?.finding_type ?? "").trim();
  } catch { return ""; }
};

// 묶음 열쇠 — 대소문자·겹공백 차이로 같은 오탐이 딴 패턴으로 갈리지 않게(스캐너별 표기 차이가 흔하다).
const 열쇠 = (t: string): string => t.toLowerCase().replace(/\s+/g, " ");

/**
 * 오탐이 잦은 패턴을 센다. **읽기 전용** — 아무 상태도 바꾸지 않는다.
 * @param minCount 몇 번 이상이어야 「패턴」으로 볼지(기본 2 — 1회는 우연)
 */
export function listFpPatterns(minCount = 2, limit = 10): FpPattern[] {
  const rows = db.prepare(
    `SELECT assetId, status, rejectReason, reviewedAt, reviewedBy, note, snapshot FROM finding_approvals`
  ).all() as Row[];

  const 오탐 = new Map<string, Row[]>();
  const 진짜 = new Map<string, Row[]>();
  const 표기 = new Map<string, string>(); // 열쇠 → 처음 본 원문 표기(사람에게는 원문으로 보인다)
  for (const r of rows) {
    const 원문 = 유형(r);
    if (!원문) continue;
    const t = 열쇠(원문);
    if (!표기.has(t)) 표기.set(t, 원문);
    // 오탐(false_positive)만 센다 — 보상통제(compensating_control)는 "위험은 있지만 다른 걸로 막았다"라
    // 뜻이 다르다. 둘을 섞으면 "오탐이 잦은 패턴"이 거짓이 된다(반려 사유를 나눠 둔 이유 그대로).
    if (r.status === "rejected" && r.rejectReason === "false_positive") {
      if (!오탐.has(t)) 오탐.set(t, []);
      오탐.get(t)!.push(r);
    } else if (["approved", "in_progress", "verifying"].includes(r.status)) {
      // 같은 유형인데 **진짜로 인정된** 이력 — 일반화가 위험하다는 증거다.
      // ⚠ approved만 봤다가 검토관이 잡았다(2026-08-07): 옆 자산에서 **지금 조치 중**(in_progress·
      //   verifying)인 것도 진짜로 인정된 것이다 — 이걸 빼면 ⚠ 없이 "오탐 3건"만 보이고,
      //   담당자가 일반화해 열려 있는 진짜 건을 반려한다. 이 기능이 막겠다던 바로 그 실패다.
      if (!진짜.has(t)) 진짜.set(t, []);
      진짜.get(t)!.push(r);
    }
  }

  const out: FpPattern[] = [];
  for (const [type, list] of 오탐) {
    if (list.length < minCount) continue;
    const 정렬 = list.slice().sort((a, b) => String(b.reviewedAt ?? "").localeCompare(String(a.reviewedAt ?? "")));
    out.push({
      type: 표기.get(type) ?? type,
      count: list.length,
      assets: new Set(list.map((r) => r.assetId)).size,
      lastAt: 정렬[0]?.reviewedAt ?? null,
      lastBy: 정렬[0]?.reviewedBy ?? null,
      reasons: [...new Set(list.map((r) => (r.note ?? "").trim()).filter(Boolean))].slice(0, 2),
      conflict: (진짜.get(type) ?? []).slice(0, 3).map((r) => ({ assetId: r.assetId, at: r.reviewedAt, by: r.reviewedBy })),
    });
  }
  return out.sort((a, b) => b.count - a.count).slice(0, Math.max(1, Math.min(50, limit)));
}
