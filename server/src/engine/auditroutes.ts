// engine/auditroutes.ts — 감사 로그의 **Express 라우트만**. 저장·조회 본체는 audit.ts.
//
// ★ 왜 갈랐나 (2026-08-27, 의존 수리 화살 #3)
//   audit.ts는 바닥 층이다 — 59개 모듈이 recordAudit를 부른다. 그런데 라우트가 같은
//   파일에 살면서 authMiddleware(auth/auth.ts)를 물었고, auth는 다시 recordAudit를
//   물어서 **바닥 3자 순환**(auth ⇄ users ⇄ audit)의 한 변이 됐다. 라우트(높은 층
//   물건)를 이 파일로 올리면 audit.ts는 잎이 되고 그 변이 사라진다.
//   같은 병(「라우트가 데이터 모듈에 얹혀 산다」)이 users.ts에도 있다 — 화살 #8(보통).
import type { Express, Request } from "express";
import { authMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import {
  listAudit, auditSummary, auditRetentionDays, recordAudit,
  type AuditKind, type AuditResult,
} from "./audit";
import type { GijoUser } from "../auth/users";

export function registerAuditRoutes(app: Express): void {
  app.get(
    "/api/audit",
    authMiddleware,
    asyncRoute(async (req, res) => {
      const kind = req.query.kind as AuditKind | undefined;
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      // 보관 기간을 함께 준다 — "이 화면에 언제까지의 기록이 남는가"는 담당자가 알아야 할 정보다
      // (감사 대응 때 "3년 전 것은 왜 없나"를 화면에서 바로 답할 수 있게).
      const days = auditRetentionDays();
      res.json({
        entries: listAudit({ kind, limit }),
        summary: auditSummary(),
        retention: { days, unlimited: !(days > 0) },
      });
    })
  );
  // 클라이언트가 남기는 기록 — CLI 실행/차단(담당자 PC 터미널)과 화면 메모.
  // kind는 클라이언트가 정당하게 남길 수 있는 계열(cli·block·config)로 제한한다 — auth·write처럼
  // 서버가 권위 있게 남기는 종류는 여기서 못 만든다(위조 방지). actor는 서버가 토큰에서 채운다.
  const CLIENT_KINDS = new Set(["cli", "block", "config"]);
  app.post("/api/audit", authMiddleware, (req, res) => {
    const user = (req as Request & { user?: GijoUser }).user;
    const { kind, action, target, detail, result } = req.body as {
      kind?: string; action?: string; target?: string; detail?: string; result?: AuditResult;
    };
    if (!action || !action.trim()) {
      res.status(400).json({ error: "action이 필요합니다" });
      return;
    }
    const k = (kind && CLIENT_KINDS.has(kind) ? kind : "config") as AuditKind;
    const r: AuditResult = result === "blocked" || result === "error" ? result : "ok";
    // ⚠ actor는 displayName이다 — username으로 바꾸면 auditactor 소스 감시에 걸린다(반증 검토 확인).
    recordAudit({ kind: k, actor: user?.displayName ?? null, action: action.trim(), target, detail, result: r });
    res.json({ ok: true });
  });
}
