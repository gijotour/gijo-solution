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
const 부품읽기 = db.prepare(`SELECT * FROM sbom_review_components WHERE reviewId=? ORDER BY name`);
const 지우기 = db.prepare(`DELETE FROM sbom_reviews WHERE id=?`);

/** 한 번에 담는다 — 부품 수천 개라 낱개 INSERT는 느리다. */
const 통째로넣기 = db.transaction((행: Record<string, unknown>, 부품들: Record<string, unknown>[]) => {
  넣기.run(행);
  for (const c of 부품들) 부품넣기.run(c);
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

export function 검수목록(상한 = 100): 검수요약[] {
  return (목록읽기.all(상한) as Record<string, unknown>[]).map(줄로);
}

export function 검수상세(id: string): { 요약: 검수요약; 부품: 검수부품[]; 면책: string } | null {
  const r = 하나읽기.get(id) as Record<string, unknown> | undefined;
  if (!r) return null;
  const 부품 = (부품읽기.all(id) as Record<string, unknown>[]).map((c) => {
    // ⚠ 판정을 **다시 계산해서** 문장을 붙인다 — 등급은 저장돼 있지만 「받게 되는 요구」·「근거」는
    //   licenserisk가 만드는 말이라 여기 복사해 두지 않는다(규칙이 바뀌면 저장본이 낡는다).
    const p = 등급판정(String(c.license ?? ""));
    return {
      name: String(c.name), version: String(c.version ?? ""),
      license: String(c.license ?? ""),
      licenseFrom: JSON.parse(String(c.licenseFrom || "[]")),
      tier: String(c.tier) as 라이선스등급,
      needsCheck: Number(c.needsCheck) === 1,
      받게되는요구: p.받게되는요구,
      근거: p.근거,
      purl: (c.purl as string) ?? undefined,
      supplier: (c.supplier as string) ?? undefined,
    };
  });
  return { 요약: 줄로(r), 부품, 면책: 면책문구 };
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
