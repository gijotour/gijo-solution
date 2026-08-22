// engine/sbomreview.ts — **납품받을 제품의 SBOM을 검수하고 그 이력을 남긴다.**
//
// ■ 왜 (2026-08-22 사장님 지시 · 계획서 중-7 확장)
//   우리가 PyMuPDF(AGPL)에 걸릴 뻔한 문제를 고객사도 겪는다. 「타사 제품 SBOM을 우리 제품이
//   직접 점검하게 하고 메인 메뉴로 빼자」 — 결과에 **실제로 받게 되는 요구**가 나와야 한다.
//
// ■ 이 파일이 하는 것 / 안 하는 것
//   · 한다: 읽기(sbomimport) → 판정(licenserisk) → **이력 남기기** → 조회.
//   · 안 한다: 라이선스 규칙(licenserisk 한 곳) · 파싱 규칙(sbomimport 한 곳).
//     ⚠ 여기에 등급을 다시 매기거나 필드를 다시 읽는 코드를 쓰지 말 것 — 잣대가 두 벌이 된다.

import type { Express } from "express";
import { randomUUID } from "crypto";
import { db } from "../db";
import { authMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import { sbom읽기, type 반입부품 } from "./sbomimport";
import { 등급판정, 등급요약, 면책문구, type 라이선스등급 } from "./licenserisk";
import { recordAudit } from "./audit";

export interface 검수요약 {
  id: string;
  name: string;
  vendor?: string;
  assetId?: string;
  format: string;
  formatVersion?: string;
  componentCount: number;
  /** 등급별 개수 — 화면 KPI가 쓰는 **단 하나의 숫자**. */
  summary: Record<라이선스등급, number>;
  notes: string[];
  reviewedBy?: string;
  reviewedAt: string;
}

export interface 검수부품 {
  name: string;
  version: string;
  license: string;
  licenseFrom: string[];
  tier: 라이선스등급;
  needsCheck: boolean;
  받게되는요구: string;
  근거: string;
  purl?: string;
  supplier?: string;
}

const 넣기 = db.prepare(
  `INSERT INTO sbom_reviews (id,name,vendor,assetId,format,formatVersion,componentCount,summary,notes,reviewedBy,reviewedAt)
   VALUES (@id,@name,@vendor,@assetId,@format,@formatVersion,@componentCount,@summary,@notes,@reviewedBy,@reviewedAt)`
);
const 부품넣기 = db.prepare(
  `INSERT INTO sbom_review_components (reviewId,name,version,license,licenseFrom,tier,needsCheck,purl,supplier)
   VALUES (@reviewId,@name,@version,@license,@licenseFrom,@tier,@needsCheck,@purl,@supplier)`
);
const 목록읽기 = db.prepare(`SELECT * FROM sbom_reviews ORDER BY reviewedAt DESC LIMIT ?`);
const 하나읽기 = db.prepare(`SELECT * FROM sbom_reviews WHERE id=?`);
// ⚠ rowid를 함께 읽는다 — 자가치유가 **그 한 줄만** 고치기 위해서다(위 등급고치기 주석 참고).
const 부품읽기 = db.prepare(`SELECT rowid AS _rowid, * FROM sbom_review_components WHERE reviewId=? ORDER BY name`);
const 지우기 = db.prepare(`DELETE FROM sbom_reviews WHERE id=?`);
// 판정 규칙이 바뀌면 저장본이 낡는다 — 다시 볼 때 **제자리로 돌려놓기** 위한 것(아래 검수상세 참고).
// ⚠ **`version=''`는 NULL 행에 안 맞는다**(2026-08-22 검토관 [중]). 넣을 때는 `c.판 || null`이라
//   판이 없는 부품이 **NULL**로 들어가는데, 읽을 때는 `String(c.version ?? "")`로 **빈 문자열**이
//   된다. 그대로 WHERE에 넘기면 SQLite는 한 행도 안 고치고 **오류도 안 낸다** — 「고쳤다」가
//   조용히 거짓이 된다(run().changes를 보지 않으면 영영 모른다).
//   → `IS NOT DISTINCT FROM`에 해당하는 SQLite 표현(`IS`)을 쓴다. NULL끼리도 같다고 본다.
//   ⚠ 그리고 **rowid로 한 줄만** 고친다 — 같은 이름·판이 두 줄이면(유일 제약이 없다)
//     이름·판으로 고치는 UPDATE가 **두 줄을 함께 덮어** 한 줄이 남의 등급으로 오염되고,
//     다음 조회에서 또 어긋남이 검출돼 수렴하지 않고 진동한다.
const 등급고치기 = db.prepare(`UPDATE sbom_review_components SET tier=@tier, needsCheck=@needsCheck WHERE rowid=@rowid`);
const 요약고치기 = db.prepare(`UPDATE sbom_reviews SET summary=@summary WHERE id=@id`);

/** 한 번에 담는다 — 부품 수천 개라 낱개 INSERT는 느리다. */
const 통째로넣기 = db.transaction((행: Record<string, unknown>, 부품들: Record<string, unknown>[]) => {
  넣기.run(행);
  for (const c of 부품들) 부품넣기.run(c);
});

/** 저장된 등급을 **지금 규칙으로 다시 매긴 값**으로 되돌린다.
 *  ⚠ 읽기 중에 쓰지만 **수렴 연산**이다 — 어긋난 것이 있을 때만 돌고, 두 번 돌려도 같은 값이 된다. */
const 낡은등급고치기 = db.transaction((id: string, 고칠것: Record<string, unknown>[], 요약: string) => {
  // ★ **몇 줄을 고쳤는지 센다.** 안 세면 0행 UPDATE가 조용히 성공으로 지나간다 —
  //   이 함수가 처음 나갔을 때 실제로 그랬다(WHERE의 version이 NULL과 안 맞았다).
  let 고쳐진수 = 0;
  for (const c of 고칠것) 고쳐진수 += 등급고치기.run(c).changes;
  const 옛요약 = String((하나읽기.get(id) as Record<string, unknown> | undefined)?.summary ?? "{}");
  요약고치기.run({ id, summary: 요약 });
  // ★ **감사 기록에 남긴다**(2026-08-22 검토관 [낮음]). 검수할 때 「소스공개요구 N건」을 감사에
  //   박아 뒀는데, 조회만으로 그 숫자가 조용히 바뀌면 **납품 심사에 낼 근거가 흔들린다** —
  //   감사 로그의 N과 지금 보이는 N이 다른데 「누가 언제 왜」를 말할 수 없게 된다.
  //   판정 규칙이 바뀐 것은 정당한 이유이므로 숨길 것이 아니라 **적어 둘 것**이다.
  if (옛요약 !== 요약) {
    recordAudit({
      kind: "config",
      action: "sbom-review-retier",
      detail: `타사 SBOM 검수 등급 재산정(판정 규칙 변경 반영): ${id} · ${옛요약} → ${요약}`,
    });
  }
  if (고쳐진수 !== 고칠것.length) {
    // 던지지 않는다 — 화면은 이미 **다시 판정한 값**을 쓰므로 사람에게 틀린 것이 보이지는 않는다.
    // 다만 저장본이 낡은 채 남았다는 사실은 알려야 한다(다음 조회에서 또 고치려 든다).
    console.warn(`[sbom-review] 등급 되돌리기가 ${고칠것.length}줄 중 ${고쳐진수}줄만 고쳤습니다 (검수 ${id}).`);
  }
});

function 줄로(r: Record<string, unknown>): 검수요약 {
  return {
    id: String(r.id),
    name: String(r.name),
    vendor: (r.vendor as string) ?? undefined,
    assetId: (r.assetId as string) ?? undefined,
    format: String(r.format),
    formatVersion: (r.formatVersion as string) ?? undefined,
    componentCount: Number(r.componentCount ?? 0),
    summary: JSON.parse(String(r.summary || "{}")),
    notes: JSON.parse(String(r.notes || "[]")),
    reviewedBy: (r.reviewedBy as string) ?? undefined,
    reviewedAt: String(r.reviewedAt),
  };
}

/**
 * SBOM 파일 하나를 검수해 이력으로 남긴다.
 *
 * ⚠ **지식 저장소(RAG)에 넣지 않는다.** 수천 줄 JSON을 조각내 넣으면 다른 질문의 근거를
 *   밀어낸다(스키마 551조각으로 실제로 겪었다). SBOM은 읽을 글이 아니라 **점검할 자료**다.
 */
export function sbom검수(옵션: {
  파일이름: string;
  내용: string;
  공급사?: string;
  assetId?: string;
  검수자?: string;
}): { ok: true; 결과: 검수요약; 면책: string } | { ok: false; 사유: string; 알림: string[] } {
  const r = sbom읽기(옵션.내용);
  if (r.형식 === "알수없음" || !r.부품.length) {
    return {
      ok: false,
      사유: r.형식 === "알수없음"
        ? "SBOM 파일로 읽지 못했습니다."
        : "부품을 한 개도 못 읽었습니다 — 빈 부품표일 수 있습니다.",
      알림: r.알림,
    };
  }

  const 판정들 = r.부품.map((c) => 등급판정(c.라이선스));
  const 요약 = 등급요약(판정들);
  const id = randomUUID();
  const 이제 = new Date().toISOString();
  // 이름은 문서가 말하는 대상을 우선 — 없으면 파일 이름. 사람이 목록에서 알아볼 수 있어야 한다.
  const 이름 = (r.대상 && r.대상.trim()) || 옵션.파일이름;

  통째로넣기(
    {
      id, name: 이름, vendor: 옵션.공급사 ?? null, assetId: 옵션.assetId ?? null,
      format: r.형식, formatVersion: r.형식판 ?? null,
      componentCount: r.부품.length,
      summary: JSON.stringify(요약.등급별),
      notes: JSON.stringify(r.알림),
      reviewedBy: 옵션.검수자 ?? null, reviewedAt: 이제,
    },
    r.부품.map((c: 반입부품, i: number) => ({
      reviewId: id, name: c.이름, version: c.판 || null,
      // ⚠ **원문 그대로 저장한다** — 자르면 뒤에 붙은 AGPL이 날아가 판정이 조용히 뒤집힌다.
      //   화면에서 줄여 보이는 것은 표시 문제이고, 저장은 근거다.
      license: c.라이선스 || null,
      licenseFrom: JSON.stringify(c.읽은자리),
      tier: 판정들[i].등급, needsCheck: 판정들[i].확인필요 ? 1 : 0,
      purl: c.purl ?? null, supplier: c.공급사 ?? null,
    }))
  );

  // 남의 회사 부품표를 들여온 일이다 — **감사 기록에 남긴다.**
  recordAudit({
    kind: "config",
    action: "sbom-review",
    detail: `타사 SBOM 검수: ${이름} (${r.형식} · 부품 ${r.부품.length}개 · ` +
      `소스공개요구 ${(요약.등급별.전체소스공개 ?? 0) + (요약.등급별.서비스도공개 ?? 0)}건)`,
    actor: 옵션.검수자,
  });

  return { ok: true, 결과: 줄로(하나읽기.get(id) as Record<string, unknown>), 면책: 면책문구 };
}

/** 저장된 요약을 **지금 규칙으로 다시 센다.**
 *
 *  ★ 왜 목록에서도 하나(2026-08-22 검토관 [중]) — 상세만 재판정하면 「한 화면이 두 말」이
 *    **「화면과 대화가 두 말」**로 옮겨갈 뿐이다. 목록·대화 카드·요약문은 저장된 summary를
 *    읽으므로, 상세를 한 번도 안 연 검수본은 영영 낡은 숫자를 보인다.
 *    담당자는 목록에서 초록을 보고 상세를 안 열 수도 있다 — 그러면 낡은 판정이 결론이 된다.
 *  ⚠ 부품 줄을 다시 읽어야 하므로 목록이 길면 값이 든다. 그래서 **어긋난 것만** 고쳐 쓰고,
 *    한 번 고치면 다음부터는 저장본이 맞아 다시 안 돈다(수렴한다). */
function 요약다시세기(r: 검수요약): 검수요약 {
  const 줄들 = 부품읽기.all(r.id) as Record<string, unknown>[];
  if (!줄들.length) return r;
  const 판정들 = 줄들.map((c) => 등급판정(String(c.license ?? "")));
  const 새요약 = 등급요약(판정들).등급별;
  const 같나 = (Object.keys(새요약) as 라이선스등급[]).every((k) => (r.summary[k] ?? 0) === (새요약[k] ?? 0));
  if (같나) return r;
  const 고칠것 = 줄들
    .map((c, i) => ({ c, p: 판정들[i] }))
    .filter(({ c, p }) => String(c.tier) !== p.등급 || (Number(c.needsCheck) === 1) !== p.확인필요)
    .map(({ c, p }) => ({ rowid: Number(c._rowid), tier: p.등급, needsCheck: p.확인필요 ? 1 : 0 }));
  try {
    낡은등급고치기(r.id, 고칠것, JSON.stringify(새요약));
  } catch {
    // 못 고쳐도 **보여 주는 값은 새 판정**이다 — 화면이 틀리지는 않는다.
  }
  return { ...r, summary: 새요약 };
}

export function 검수목록(상한 = 100): 검수요약[] {
  return (목록읽기.all(상한) as Record<string, unknown>[]).map(줄로).map(요약다시세기);
}

export function 검수상세(id: string): { 요약: 검수요약; 부품: 검수부품[]; 면책: string } | null {
  const r = 하나읽기.get(id) as Record<string, unknown> | undefined;
  if (!r) return null;
  const 줄들 = 부품읽기.all(id) as Record<string, unknown>[];
  // ★ **등급도 다시 계산한 것을 쓴다**(2026-08-22 수리 — 알려진 한계였던 것을 닫는다).
  //   그전엔 「받게 되는 요구」·「근거」만 다시 계산하고 **등급은 저장본을 그대로 보여 줬다.**
  //   그래서 판정 규칙을 고치면 한 화면 안에서 **배지와 문장이 서로 다른 말**을 했다 —
  //   배지는 🟢 고지만인데 설명은 「전체 소스 공개를 요구받습니다」가 되는 식이다.
  //   규칙은 실제로 바뀐다: 이 파일이 사는 동안에만 쉼표 가르기·HPND·OFL 세 번 바뀌었고,
  //   그때마다 이미 검수해 둔 이력이 조용히 낡았다. 담당자는 낡은 배지를 보고 판단한다.
  const 판정들 = 줄들.map((c) => 등급판정(String(c.license ?? "")));
  const 부품 = 줄들.map((c, i) => ({
    name: String(c.name), version: String(c.version ?? ""),
    license: String(c.license ?? ""),
    licenseFrom: JSON.parse(String(c.licenseFrom || "[]")),
    tier: 판정들[i].등급,
    needsCheck: 판정들[i].확인필요,
    받게되는요구: 판정들[i].받게되는요구,
    근거: 판정들[i].근거,
    purl: (c.purl as string) ?? undefined,
    supplier: (c.supplier as string) ?? undefined,
  }));

  // 저장본이 낡았으면 **제자리로 돌려놓는다.** 목록 화면과 KPI는 저장된 summary를 쓰므로
  // 여기서 고쳐 두지 않으면 상세를 열 때만 맞고 목록은 계속 틀린 숫자를 보인다.
  const 고칠것 = 줄들
    .map((c, i) => ({ c, p: 판정들[i] }))
    .filter(({ c, p }) => String(c.tier) !== p.등급 || (Number(c.needsCheck) === 1) !== p.확인필요)
    .map(({ c, p }) => ({ rowid: Number(c._rowid), tier: p.등급, needsCheck: p.확인필요 ? 1 : 0 }));
  let 요약줄 = 줄로(r);
  if (고칠것.length) {
    const 새요약 = 등급요약(판정들).등급별;
    try {
      낡은등급고치기(id, 고칠것, JSON.stringify(새요약));
      요약줄 = { ...요약줄, summary: 새요약 };
    } catch {
      // 고쳐 두지 못해도 **보여 주는 값은 이미 새 판정**이다 — 화면이 틀리지는 않는다.
      요약줄 = { ...요약줄, summary: 새요약 };
    }
  }
  return { 요약: 요약줄, 부품, 면책: 면책문구 };
}

export function 검수삭제(id: string, actor?: string): boolean {
  const 있나 = 하나읽기.get(id) as Record<string, unknown> | undefined;
  if (!있나) return false;
  지우기.run(id);   // 부품은 ON DELETE CASCADE
  recordAudit({ kind: "config", action: "sbom-review-delete", detail: `타사 SBOM 검수 삭제: ${String(있나.name)}`, actor });
  return true;
}

/** 대화창이 쓰는 한 문단 — **숫자만 주고 끝내지 않는다**(이 저장소 규칙). */
export function 검수요약문(id?: string): string {
  const 목록 = 검수목록(5);
  if (!목록.length) {
    return "아직 검수한 타사 SBOM이 없습니다 — 대화창의 ＋로 SBOM 파일(SPDX·CycloneDX JSON)을 올리면 점검합니다.";
  }
  const 대상 = id ? 목록.find((x) => x.id === id) ?? 목록[0] : 목록[0];
  const s = 대상.summary;
  const 무거움 = (s.서비스도공개 ?? 0) + (s.전체소스공개 ?? 0);
  const 줄: string[] = [
    `**${대상.name}** — ${대상.format} · 부품 ${대상.componentCount}개 (검수 ${대상.reviewedAt.slice(0, 10)})`,
    "",
  ];
  if (무거움) {
    줄.push(`🔴 **소스 공개를 요구받을 수 있는 부품 ${무거움}개**` +
      (s.서비스도공개 ? ` — 그중 ${s.서비스도공개}개는 **네트워크로 서비스만 해도** 의무가 생깁니다` : ""));
  } else {
    줄.push("✅ 소스 공개를 요구받는 부품은 없습니다.");
  }
  if (s.판정불가) 줄.push(`❓ 라이선스를 알 수 없는 부품 ${s.판정불가}개 — **공급사에 확인이 필요합니다**(「없음」이 아닙니다).`);
  if (s.고친파일공개) 줄.push(`🟡 고친 파일만 공개하면 되는 부품 ${s.고친파일공개}개`);
  if (s.고지만) 줄.push(`🟢 고지만 하면 되는 부품 ${s.고지만}개`);
  if (대상.notes.length) {
    줄.push("", "⚠ 못 읽은 것:");
    for (const n of 대상.notes.slice(0, 3)) 줄.push(`- ${n}`);
  }
  줄.push("", "**공급망 점검** 화면에서 부품별로 무엇을 요구받는지 볼 수 있습니다.", "", 면책문구);
  return 줄.join("\n");
}

// ── 화면·대화창이 부르는 자리 ────────────────────────────────────────────────
//
// ⚠ **업로드 창구를 여기 만들지 않는다.** 파일 인입은 콘솔 ＋ 한 곳이라는 것이 제품 결정이고
//   (2026-07-27), 그쪽에 「📦 타사 SBOM」 유형을 더해 두었다. 여기는 **조회·삭제만** 한다.
//   그래야 basename 접기·등급 게이트·감사 기록·반입 칩이 공짜로 따라온다.
export function registerSbomReviewRoutes(app: Express): void {
  app.get("/api/sbom-review/list", authMiddleware, (req, res) => {
    const 상한 = Math.min(Number((req.query.limit as string) ?? 100) || 100, 500);
    res.json({ items: 검수목록(상한), 면책: 면책문구 });
  });

  app.get("/api/sbom-review/:id", authMiddleware, (req, res) => {
    const r = 검수상세(String(req.params.id));
    if (!r) { res.status(404).json({ error: "그 검수 기록이 없습니다." }); return; }
    res.json(r);
  });

  app.post("/api/sbom-review/:id/delete", authMiddleware, (req, res) => {
    const u = (req as { user?: { displayName?: string; username?: string } }).user;
    const ok = 검수삭제(String(req.params.id), u?.displayName ?? u?.username);
    if (!ok) { res.status(404).json({ error: "그 검수 기록이 없습니다." }); return; }
    res.json({ ok: true });
  });

  // 공급사·연결 자산은 사람이 나중에 채운다(파일에는 없을 수 있다).
  app.post("/api/sbom-review/:id/meta", authMiddleware, asyncRoute(async (req, res) => {
    const { vendor, assetId } = (req.body ?? {}) as { vendor?: string; assetId?: string };
    const 있나 = 검수상세(String(req.params.id));
    if (!있나) { res.status(404).json({ error: "그 검수 기록이 없습니다." }); return; }
    db.prepare(`UPDATE sbom_reviews SET vendor=COALESCE(?,vendor), assetId=COALESCE(?,assetId) WHERE id=?`)
      .run(vendor ?? null, assetId ?? null, String(req.params.id));
    res.json({ ok: true });
  }));
}
