// engine/usage.ts — API 이용료 · 토큰 사용량 관리 대시보드 (6.1.2절)
// 로컬 LLM은 자체 호스팅이라 과금이 없지만, 외부 유료 서비스(CTI 피드 등) 호출은 비용이 발생한다.
// 요청 단위로 로깅해 서비스별 호출 수 · 예상 비용을 집계한다.

import type { Express, Request, Response, NextFunction } from "express";
import { authMiddleware } from "../auth/auth";

export interface UsageEvent {
  service: string;
  route: string;
  timestamp: number;
  costEstimate: number;
}

const events: UsageEvent[] = [];

// 서비스별 호출당 예상 비용(USD). 실제 벤더 계약 단가로 교체 필요 — 현재는 자리표시자.
const SERVICE_UNIT_COST: Record<string, number> = {
  cti: 0.05,
};

function inferService(routePath: string): string | null {
  if (routePath.startsWith("/api/cti")) return "cti";
  return null;
}

export function usageLoggingMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const service = inferService(req.path);
  if (service) {
    events.push({ service, route: req.path, timestamp: Date.now(), costEstimate: SERVICE_UNIT_COST[service] ?? 0 });
  }
  next();
}

export interface UsageSummary {
  service: string;
  callCount: number;
  estimatedCost: number;
}

export function summarizeUsage(sinceMs?: number): UsageSummary[] {
  const relevant = sinceMs ? events.filter((e) => e.timestamp >= sinceMs) : events;
  const bySvc = new Map<string, UsageSummary>();
  for (const e of relevant) {
    const entry = bySvc.get(e.service) ?? { service: e.service, callCount: 0, estimatedCost: 0 };
    entry.callCount += 1;
    entry.estimatedCost += e.costEstimate;
    bySvc.set(e.service, entry);
  }
  return [...bySvc.values()];
}

// 테스트 전용: events는 모듈 싱글턴이라 createApp()을 새로 호출해도 초기화되지 않는다.
export function resetUsageForTests(): void {
  events.length = 0;
}

export function registerUsageRoutes(app: Express): void {
  app.get("/api/usage/summary", authMiddleware, (req, res) => {
    const sinceMs = req.query.sinceMs ? Number(req.query.sinceMs) : undefined;
    res.json(summarizeUsage(sinceMs));
  });
}
