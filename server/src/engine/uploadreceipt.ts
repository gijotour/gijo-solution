// engine/uploadreceipt.ts — **반입 영수증**(내가 넣은 것 + 내가 볼 수 있는 것).
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
  /** 사람이 읽는 이름. ⚠ **가르는 데 쓰지 않는다** — 동명이인·개명에서 어긋난다. */
  uploadedBy?: string;
  /** ★ 바뀌지 않는 사용자 id — 「내 것인가」는 **이것으로만** 가른다(2026-08-22 검토관 [높음]).
   *  옛 줄에는 없다(NULL) — 그때는 「남의 것」으로 다뤄 등급 검사를 지나야 보이게 한다. */
  uploadedById?: string;
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
     (id,filename,uploadedBy,uploadedById,uploadedAt,kind,routedTo,decidedBy,category,originalSaved,mdSaved,ingested,bytes,detail,note)
   VALUES
     (@id,@filename,@uploadedBy,@uploadedById,@uploadedAt,@kind,@routedTo,@decidedBy,@category,@originalSaved,@mdSaved,@ingested,@bytes,@detail,@note)`
);
/** ⚠ **LIMIT를 여기 걸지 않는다.** 거르기(소유자·등급)가 끝난 **뒤에** 잘라야 한다 —
 *  먼저 300줄을 잘라 놓고 거르면 「내 것 5줄」이 남의 것 295줄에 밀려 안 보인다.
 *  표가 아주 커지면 이 전수 조회가 부담이 되는데, 그때는 SQL에 소유자 조건을 내리는 것이
 *  정답이다(등급은 SQL로 못 푼다 — memory_documents를 봐야 한다). 지금은 보관총량도
 *  이미 전수를 세므로 같은 비용이다. */
const 목록읽기 = db.prepare(`SELECT * FROM upload_receipts ORDER BY uploadedAt DESC`);
const 총량읽기 = db.prepare(
  `SELECT COUNT(*) AS n, COALESCE(SUM(bytes),0) AS bytes,
          COALESCE(SUM(CASE WHEN originalSaved=1 THEN bytes ELSE 0 END),0) AS 보관bytes
     FROM upload_receipts`
);
/** ⚠ `routedTo='decision'` 조건이 이 문의 안전장치다 — 확정된 기록은 절대 안 지운다.
 *  올린 이 조건은 「모르면(NULL) 통과」가 아니라 **넘겼을 때만 검사**하도록 썼다. */
const 되묻기지우기 = db.prepare(
  `DELETE FROM upload_receipts
    WHERE id = ? AND routedTo = 'decision'
      AND (? IS NULL OR uploadedById = ?)`
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
      uploadedById: 입력.uploadedById ? String(입력.uploadedById) : null,
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
    uploadedById: (r.uploadedById as string) ?? undefined,
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

/** 되묻는 중이던 영수증 한 장을 **지운다** — 답이 와서 확정 줄이 새로 생길 때.
 *
 *  ★ 왜 필요한가 (2026-08-22 검토관 [중]): 유형을 되물으면 영수증 A(「되묻는 중」)가 남고,
 *    사람이 답하면 클라가 **같은 파일을 다시 올려** 영수증 B가 또 생겼다. 반입 탭에 같은
 *    파일이 두 줄이고, A는 처리가 끝난 뒤에도 영영 「되묻는 중」이라 담당자는 미처리 파일이
 *    있는 줄 안다. **사람의 행위는 한 번**이므로 줄도 하나여야 한다.
 *
 *  ⚠ 파일명으로 짝을 찾지 않는다 — 클라가 **그 영수증의 id를 그대로 돌려준다.**
 *    이름으로 맞추면 같은 이름의 다른 파일을 지운다(basename 키잉 사고와 같은 부류).
 *  ⚠ 안전장치: **되묻는 중(routedTo='decision')인 줄만** 지운다. 확정된 기록은 무슨 일이
 *    있어도 안 지운다 — 감사 기록이 조용히 사라지면 이 표의 존재 이유가 없어진다.
 *  ⚠ 남의 영수증을 지우지 못하게 올린 이도 함께 본다.
 */
export function 되묻기영수증지우기(id: string, uploadedById?: string): boolean {
  try {
    const r = 되묻기지우기.run(
      String(id),
      uploadedById == null ? null : String(uploadedById),
      uploadedById == null ? null : String(uploadedById)
    );
    return r.changes > 0;
  } catch (e) {
    console.warn(`[upload-receipt] 되묻기 줄 정리 실패(반입은 계속): ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

/** 「이 사람이 이 영수증을 볼 수 있나」를 판정하는 잣대.
 *
 *  ★ 왜 함수로 받나 — 이 파일이 `memory.ts`(등급 잣대가 사는 곳)를 import하면 **순환**이 된다
 *    (memory ← autoupload ← uploadreceipt). 그래서 **부르는 쪽이 잣대를 넘긴다.**
 *    잣대 자체는 여전히 `열람불가공용` 한 곳이다 — 사본을 만들지 않는다.
 */
export type 볼수있나 = (r: 영수증) => boolean;

/** 반입 영수증 목록 — **거르고 나서 자른다.**
 *
 *  ⚠ 2026-08-22 게시 전 검토관 [높음] 수리. 그전엔 필터가 아예 없어 **남의 기밀 파일명**이
 *    누구에게나 보였다. 순서도 중요하다: 먼저 300줄을 자르고 거르면 내 것이 밀려 사라진다.
 *
 *  @returns 목록(상한까지) · **거른 뒤의** 총건수·바이트. 화면이 「몇 건」이라 말할 때
 *           쓰는 숫자가 목록 길이가 아니라 이 값이어야 한다(상한에 걸리면 거짓말이 된다).
 */
export function 영수증목록(
  상한 = 300,
  볼수있나?: 볼수있나
): { 목록: 영수증[]; 건수: number; 전체바이트: number; 원본보관바이트: number } {
  const 전부 = (목록읽기.all() as Record<string, unknown>[]).map(줄로);
  const 보이는 = 볼수있나 ? 전부.filter(볼수있나) : 전부;
  let 전체바이트 = 0;
  let 원본보관바이트 = 0;
  for (const r of 보이는) {
    전체바이트 += r.bytes ?? 0;
    if (r.originalSaved) 원본보관바이트 += r.bytes ?? 0;
  }
  return { 목록: 보이는.slice(0, 상한), 건수: 보이는.length, 전체바이트, 원본보관바이트 };
}

/** 보관 총량 — **거르지 않은 전체**다. 운영·용량 판단용이지 **화면에 쓰지 않는다**
 *  (화면은 위 `영수증목록`이 돌려주는 「거른 뒤의 건수」를 쓴다 — 안 그러면 못 보는 것까지 센다). */
export function 보관총량(): { 건수: number; 전체바이트: number; 원본보관바이트: number } {
  const r = 총량읽기.get() as Record<string, unknown>;
  return {
    건수: Number(r.n ?? 0),
    전체바이트: Number(r.bytes ?? 0),
    원본보관바이트: Number(r.보관bytes ?? 0),
  };
}

/** 사람이 읽는 갈래 이름 — 화면·대화가 **이 한 곳**을 쓴다(TYPE_LABEL 사본 3벌 함정을 만들지 않는다).
 *
 *  ★ 2026-08-22 검토관 [중] 수리 — `asset`·`log` 두 이름이 **한 행 안에서 스스로 모순**이었다.
 *    · `asset`은 자산 목록이 아니라 **제품 매뉴얼**이다(autoupload.ts:91 「제품 매뉴얼(User Guide 등)」,
 *      라우팅도 `product-manual`). 그런데 이름이 「자산 목록」이라
 *      「갈래=자산 목록 · 어디로=보안제품 등록부」라는 앞뒤 안 맞는 줄이 나왔다.
 *    · `log`는 로그 **원본**이 아니라 **로그 읽는 법 매뉴얼**이다(원본은 `securitylog`).
 *      「로그」와 「보안 로그」가 나란히 있으면 어느 쪽이 원본인지 알 길이 없다.
 *    ⚠ 결정 카드의 이름(console.js:1784 「🛡 보안제품 자산」)과 완전히 같지는 않다 —
 *      사람이 **고른 것**은 그 이름이고, **된 것**은 매뉴얼이다. 영수증은 「무엇이 됐나」를 적는다.
 */
export const 갈래이름: Record<반입갈래, string> = {
  document: "문서",
  guideline: "지침·가이드",
  vulnreport: "취약점 리포트",
  securitylog: "보안 로그(원본)",
  opsreport: "운영 리포트",
  sbom: "부품표(SBOM)",
  asset: "보안제품 매뉴얼",
  log: "로그 매뉴얼",
  unknown: "미정",
};
