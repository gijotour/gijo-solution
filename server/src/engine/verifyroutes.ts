// engine/verifyroutes.ts — 조치 검증 API
//
// approvals 흐름(미검토→진행중→**검증**→완료)의 '검증' 칸을 실제로 실행하는 경로다.
// 판정은 verifyengine, 권한은 verifyaccess, 접속은 hardeningscan(공유) — 여기서는 잇기만 한다.
//
// ⚠ 보안 경계는 여기다(2026-07-26): 화면에서 버튼을 숨기는 것으로는 부족하다 — API를 직접
//   부르면 그만이다. 그래서 **모든 실행 경로에서 canVerifyAsset을 먼저 통과**시키고,
//   허용뿐 아니라 **거부도 감사에 남긴다**(누가 권한 없는 자산에 시도했는지가 보안 정보다).

import type { Express, Request } from "express";
import { authMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import type { GijoUser } from "../auth/users";
import { recordAudit } from "./audit";
import { getAsset } from "./assets";
import { updateFindingReview } from "./approvals";
import { canVerifyAsset } from "./verifyaccess";
import { buildVerifyItems, runVerifyItems, summarize, type VerifyOutcome } from "./verifyengine";
import { getTarget, listTargets } from "./hardeningtargets";
import { targetRunner, type RunFn, type HardeningTarget } from "./hardeningscan";

const actorOf = (req: Request): GijoUser | undefined => (req as Request & { user?: GijoUser }).user;

/**
 * 자산에 대응하는 접속 대상 찾기 — 자산 이름·경로에 들어 있는 호스트로 매칭한다.
 * 못 찾으면 null: "대상이 등록되지 않았습니다"라고 정직하게 답하고 실행하지 않는다
 * (아무 대상에나 붙여 점검하면 엉뚱한 장비를 검사하게 된다).
 */
export function resolveTargetForAsset(assetId: string): HardeningTarget | null {
  const asset = getAsset(assetId);
  if (!asset) return null;
  const hay = `${asset.name} ${asset.path}`.toLowerCase();
  const hit = listTargets().find((t) => {
    const h = (t.host || "").toLowerCase();
    const l = (t.label || "").toLowerCase();
    return (h && h !== "local" && hay.includes(h)) || (l && hay.includes(l));
  });
  return hit ?? null;
}

export function registerVerifyRoutes(app: Express): void {
  // 이 자산을 검증할 수 있는가 — 화면이 버튼 상태를 정하는 데 쓴다(권한의 최종 판단은 실행 API가 한다).
  app.get("/api/verify/can/:assetId", authMiddleware, (req, res) => {
    const d = canVerifyAsset(actorOf(req), String(req.params.assetId), req.query.key ? String(req.query.key) : undefined);
    const target = resolveTargetForAsset(String(req.params.assetId));
    res.json({ ...d, hasTarget: Boolean(target), targetLabel: target?.label ?? null });
  });

  // 조치 검증 실행 — 자산 단위(선택적으로 finding 1건만).
  app.post(
    "/api/verify/run",
    authMiddleware,
    asyncRoute(async (req, res) => {
      const user = actorOf(req);
      const assetId = String((req.body as { assetId?: string })?.assetId ?? "");
      const onlyKey = (req.body as { findingKey?: string })?.findingKey;
      const targetId = (req.body as { targetId?: string })?.targetId;

      if (!assetId) {
        res.status(400).json({ error: "assetId가 필요합니다" });
        return;
      }

      // ── 보안 경계 ────────────────────────────────────────────────
      const decision = canVerifyAsset(user, assetId, onlyKey);
      if (!decision.allowed) {
        // 거부도 남긴다 — 권한 없는 시도 자체가 봐야 할 신호다.
        recordAudit({
          kind: "config",
          actor: user?.displayName ?? null,
          action: "조치 검증 거부",
          target: assetId,
          detail: decision.reason.split("\n")[0],
          result: "failure",
        });
        res.status(403).json({ error: decision.reason });
        return;
      }

      const asset = getAsset(assetId)!;
      const target = targetId ? getTarget(targetId) : resolveTargetForAsset(assetId);
      if (!target) {
        // 접속 대상이 없으면 "검증했는데 이상 없음"처럼 보이면 안 된다 — 실행 자체를 거절한다.
        res.status(400).json({
          error:
            `이 자산(${asset.name})에 연결된 점검 대상이 등록돼 있지 않습니다.\n` +
            `→ 점검 콘솔 › 원격 정기점검에서 대상(호스트·계정)을 먼저 등록해 주세요.`,
        });
        return;
      }

      const all = buildVerifyItems(assetId, asset.findings);
      const items = onlyKey ? all.filter((i) => i.findingKey === onlyKey) : all;
      if (!items.length) {
        res.json({ assetId, target: target.label, results: [], summary: summarize([]), note: "검증할 미해결 취약점이 없습니다." });
        return;
      }

      const run: RunFn = targetRunner(target);
      const results: VerifyOutcome[] = await runVerifyItems(items, run);
      const sum = summarize(results);

      // 조치가 확인된 건은 검증 요청 시각을 남겨 approvals 흐름에 반영한다.
      // ⚠ 자동으로 '완료(approved)'까지 올리지는 않는다 — 확인은 사람이 한다.
      //   기계 판정만으로 상태를 끝내면 오판 하나가 조용히 완료로 굳는다.
      for (const r of results.filter((x) => x.status === "PASS")) {
        try {
          updateFindingReview(assetId, r.findingKey, { status: "verifying" }, user?.displayName ?? "조치 검증");
        } catch { /* 상태 전이 불가(이미 완료 등)면 건너뛴다 */ }
      }

      recordAudit({
        kind: "write",
        actor: user?.displayName ?? null,
        action: "조치 검증 실행",
        target: `${asset.name} (${target.label})`,
        detail: `대상 ${sum.total}건 — 조치확인 ${sum.fixed} · 미조치 ${sum.still} · 수동확인 ${sum.manual}`,
      });

      res.json({ assetId, assetName: asset.name, target: target.label, results, summary: sum });
    })
  );
}
