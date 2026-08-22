// engine/uploadreceipt.ts — **내가 넣은 모든 파일의 영수증.**
//
// ■ 왜 생겼나 (2026-08-22 사장님 「사용자가 넣는 파일 내문서에서 다 확인 가능해야 해. 취약점파일도」)
//   반입 갈래 중 **넷이 아무 흔적도 안 남겼다**(설계관 실측):
//     · 자동 취약점(Nessus CSV·XML·JSON·HTML) — 자산·findings로는 가는데 **원본도 문서행도 없다**
//     · SBOM — 검수 결과만 남고 **우리가 검수한 그 파일**이 없다(라이선스 분쟁 때 못 낸다)
//     · 사용자 지정 vulnreport 중 Nessus HTML 갈래
//     · ★ **유형 결정 카드를 무시하면 감사 기록조차 없다** — 파일을 올렸는데 아무 데도 없다
//   즉 담당자가 **「내가 뭘 올렸더라?」에 답할 수 없었다.**
//
// ■ 왜 memory_documents에 안 얹나
//   「내 문서」 목록이 뜨는 조건은 메타 행이 아니라 **LanceDB 조각 ≥1**이다.
//   취약점·SBOM은 **일부러 지식에 안 넣으므로**(수천 줄 표가 다른 질문의 근거를 밀어낸다)
//   조각이 0이고, 메타 행을 만들어도 목록에 영영 안 뜬다. 그걸 뜨게 하려고 목록 함수를 고치면
//   「AI 지식」 화면과 저장소 숫자에 조각 0 문서가 섞인다 — 잣대를 두 벌 만드는 셈이다.
//
// ⚠ **원본 파일을 여기 담지 않는다.** 파일은 디스크에 있고 이 표는 「사건 기록」이다.
// ⚠ PK가 uuid인 이유는 db.ts의 마이그레이션 주석에 적어 두었다(같은 파일을 두 번 올리면 두 줄).
import { randomUUID } from "crypto";
import { db } from "../db";

export type 반입갈래 =
  | "document" | "guideline" | "vulnreport" | "securitylog" | "opsreport"
  | "sbom" | "asset" | "log" | "unknown";

export interface 영수증 {
  id: string;
  filename: string;
  uploadedBy?: string;
  uploadedAt: string;
  kind: 반입갈래;
  routedTo: string;
  /** 갈래를 누가 정했나 — `auto`(제품이 판별) / `user`(사람이 골랐다).
   *  ★ 나중에 「이 문서를 사내규정으로 분류한 것은 누구인가」를 물을 수 있어야 한다. */
  decidedBy?: "auto" | "user";
  category?: string;
  originalSaved: boolean;
  mdSaved: boolean;
  ingested: boolean;
  bytes?: number;
  detail?: string;
  note?: string;
}

const 넣기 = db.prepare(
  `INSERT INTO upload_receipts
     (id,filename,uploadedBy,uploadedAt,kind,routedTo,decidedBy,category,originalSaved,mdSaved,ingested,bytes,detail,note)
   VALUES
     (@id,@filename,@uploadedBy,@uploadedAt,@kind,@routedTo,@decidedBy,@category,@originalSaved,@mdSaved,@ingested,@bytes,@detail,@note)`
);
const 목록읽기 = db.prepare(`SELECT * FROM upload_receipts ORDER BY uploadedAt DESC LIMIT ?`);
const 총량읽기 = db.prepare(
  `SELECT COUNT(*) AS n, COALESCE(SUM(bytes),0) AS bytes,
          COALESCE(SUM(CASE WHEN originalSaved=1 THEN bytes ELSE 0 END),0) AS 보관bytes
     FROM upload_receipts`
);

/** 영수증 한 장을 남긴다.
 *
 *  ⚠ **던지지 않는다.** 영수증을 못 남겼다고 반입 자체가 실패하면 안 된다 —
 *    기록은 부가 가치이지 전제가 아니다. 못 남기면 서버 로그에만 남기고 지나간다.
 *    (이 저장소의 「가드가 본체를 죽이면 안 된다」 원칙.)
 */
export function 영수증남기기(입력: Omit<영수증, "id" | "uploadedAt"> & { uploadedAt?: string }): string | null {
  try {
    const id = randomUUID();
    넣기.run({
      id,
      filename: String(입력.filename ?? "").slice(0, 300),
      uploadedBy: 입력.uploadedBy ?? null,
      uploadedAt: 입력.uploadedAt ?? new Date().toISOString(),
      kind: 입력.kind,
      routedTo: 입력.routedTo,
      decidedBy: 입력.decidedBy ?? null,
      category: 입력.category ?? null,
      originalSaved: 입력.originalSaved ? 1 : 0,
      mdSaved: 입력.mdSaved ? 1 : 0,
      ingested: 입력.ingested ? 1 : 0,
      bytes: 입력.bytes ?? null,
      detail: 입력.detail ? String(입력.detail).slice(0, 500) : null,
      note: 입력.note ? String(입력.note).slice(0, 500) : null,
    });
    return id;
  } catch (e) {
    console.warn(`[upload-receipt] 영수증 저장 실패(반입은 계속): ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

function 줄로(r: Record<string, unknown>): 영수증 {
  return {
    id: String(r.id),
    filename: String(r.filename),
    uploadedBy: (r.uploadedBy as string) ?? undefined,
    uploadedAt: String(r.uploadedAt),
    kind: String(r.kind) as 반입갈래,
    routedTo: String(r.routedTo),
    decidedBy: (r.decidedBy as "auto" | "user") ?? undefined,
    category: (r.category as string) ?? undefined,
    originalSaved: Number(r.originalSaved) === 1,
    mdSaved: Number(r.mdSaved) === 1,
    ingested: Number(r.ingested) === 1,
    bytes: r.bytes == null ? undefined : Number(r.bytes),
    detail: (r.detail as string) ?? undefined,
    note: (r.note as string) ?? undefined,
  };
}

export function 영수증목록(상한 = 300): 영수증[] {
  return (목록읽기.all(상한) as Record<string, unknown>[]).map(줄로);
}

/** 보관 총량 — **상한을 지금 정하지 않는 대신** 실제로 얼마나 쌓이는지 세어 둔다.
 *  근거 없는 숫자로 상한을 박는 것보다, 커졌을 때 이 값으로 정하는 편이 낫다(설계관 권고). */
export function 보관총량(): { 건수: number; 전체바이트: number; 원본보관바이트: number } {
  const r = 총량읽기.get() as Record<string, unknown>;
  return {
    건수: Number(r.n ?? 0),
    전체바이트: Number(r.bytes ?? 0),
    원본보관바이트: Number(r.보관bytes ?? 0),
  };
}

/** 사람이 읽는 갈래 이름 — 화면·대화가 **이 한 곳**을 쓴다(TYPE_LABEL 사본 3벌 함정을 만들지 않는다). */
export const 갈래이름: Record<반입갈래, string> = {
  document: "문서",
  guideline: "지침·가이드",
  vulnreport: "취약점 리포트",
  securitylog: "보안 로그",
  opsreport: "운영 리포트",
  sbom: "부품표(SBOM)",
  asset: "자산 목록",
  log: "로그",
  unknown: "미정",
};
