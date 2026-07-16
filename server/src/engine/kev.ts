// engine/kev.ts — CISA "알려진 악용 취약점(Known Exploited Vulnerabilities, KEV)" 목록.
//
// EPSS가 "악용될 확률"이라면 KEV는 "실제로 악용된 것이 확인됨"이다 — 훨씬 강한 신호다.
// CISA가 공개하는 정부 피드(무료)를 받아 로컬에 캐시(data/kev.json)한다. 우리 취약점 데이터는
// 절대 밖으로 나가지 않는다 — 공개 목록을 내려받아 로컬에서 CVE만 대조할 뿐이다(데이터 주권).
// 오프라인/온프레미스 대비: 캐시가 있으면 그걸로 시작하고, 부팅 시 백그라운드로 갱신을 시도한다.

import type { Express } from "express";
import * as fs from "fs";
import * as path from "path";
import { authMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";

const KEV_URL =
  process.env.GIJO_KEV_URL ?? "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json";
const CACHE_PATH = process.env.GIJO_KEV_CACHE ?? path.join("data", "kev.json");

let kevSet = new Set<string>();
let fetchedAt = 0;
let source: "cache" | "cisa" | "none" = "none";

interface KevCacheFile {
  fetchedAt: number;
  cves: string[];
}

function loadFromCache(): void {
  try {
    const j = JSON.parse(fs.readFileSync(CACHE_PATH, "utf-8")) as KevCacheFile;
    if (Array.isArray(j.cves)) {
      kevSet = new Set(j.cves);
      fetchedAt = j.fetchedAt ?? 0;
      source = "cache";
    }
  } catch {
    /* 캐시 없음 — refreshKev()가 채운다 */
  }
}

// CISA 피드를 받아 캐시를 갱신한다. 실패하면(오프라인 등) 기존 캐시를 그대로 유지한다.
export async function refreshKev(): Promise<{ count: number; fetchedAt: number; source: string }> {
  const res = await fetch(KEV_URL).catch(() => null);
  if (res && res.ok) {
    const data = (await res.json()) as { vulnerabilities?: { cveID?: string }[] };
    const cves = (data.vulnerabilities ?? []).map((v) => (v.cveID ?? "").toUpperCase().trim()).filter(Boolean);
    if (cves.length > 0) {
      kevSet = new Set(cves);
      fetchedAt = Date.now();
      source = "cisa";
      try {
        fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
        fs.writeFileSync(CACHE_PATH, JSON.stringify({ fetchedAt, cves: [...kevSet] } satisfies KevCacheFile));
      } catch {
        /* 캐시 쓰기 실패는 치명적이지 않다 */
      }
    }
  }
  return kevStatus();
}

export function isKevCve(cve: string): boolean {
  return kevSet.has(cve.toUpperCase().trim());
}

// CVE 목록 중 KEV에 등재된 것만 돌려준다.
export function kevMatches(cves: string[]): string[] {
  return cves.filter((c) => isKevCve(c));
}

export function kevStatus(): { count: number; fetchedAt: number; source: string } {
  return { count: kevSet.size, fetchedAt, source };
}

export function resetKevForTests(cves: string[] = []): void {
  kevSet = new Set(cves.map((c) => c.toUpperCase().trim()));
  fetchedAt = cves.length ? Date.now() : 0;
  source = cves.length ? "cisa" : "none";
}

// 모듈 로드 시 캐시를 즉시 읽어 isKevCve가 바로 동작하게 한다(부팅 refresh는 index.ts에서).
loadFromCache();

export function registerKevRoutes(app: Express): void {
  app.get("/api/kev/status", authMiddleware, (_req, res) => res.json(kevStatus()));
  app.post(
    "/api/kev/refresh",
    authMiddleware,
    asyncRoute(async (_req, res) => res.json(await refreshKev()))
  );
}
