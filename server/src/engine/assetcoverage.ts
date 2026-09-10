// 자산 커버리지 — "우리가 자산에 대해 모르는 것"을 세는 곳.
//
// 화면(inventory.html)과 챗봇(agenttools: asset_coverage)이 같은 계산을 본다.
// 두 곳에서 따로 세면 반드시 어긋나고, 어긋나면 담당자는 둘 다 믿지 않게 된다.
// 값이 아니라 타입만 가져온다 — assets.ts가 이 파일을 쓰므로 값 임포트는 순환이 된다.
import type { Asset } from "./assets";
// 스캔 실패 판정은 한 곳만 쓴다 — 결손(무엇을 모르는가)과 취약점(무엇이 뚫렸나)은 다른 축이다.
import { isRealVulnerability } from "./agenttools";

export type GapKind = "owner" | "service" | "sbom" | "unscanned";

export interface AssetGap {
  kind: GapKind;
  severity: "high" | "mid";
  title: string;
  why: string; // 왜 이게 문제인가 — 숫자만 주면 담당자는 판단할 수 없다
  fixLabel: string;
  assetIds: string[];
}

export interface AssetCoverage {
  total: number;
  complete: number; // 결손 하나도 없는 자산 수
  gaps: AssetGap[];
  ranked: RankedAsset[]; // 손이 필요한 순서
}

export interface RankedAsset {
  id: string;
  name: string;
  gaps: GapKind[];
  openFindings: number;
  maxSeverity: string;
  kev: boolean;
  why: string; // 왜 지금 문제인가 — 한 줄
  score: number;
}

const SEVERITY_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };

// 반입 파일명이 담당부서로 저장되던 버그(fc13fe2 이전)의 잔재.
// 코드는 고쳤지만 이미 저장된 값은 남아 있다. "부서명처럼 생겼으나 파일명"인 값을
// 담당부서 있음으로 세면 커버리지가 거짓말을 한다 — 없음으로 취급한다.
const FILENAME_LIKE = /\.(csv|json|xml|html|nessus|txt|xlsx?)$/i;

export function isOwnerMissing(owner: string | null | undefined): boolean {
  const o = (owner ?? "").trim();
  return o === "" || FILENAME_LIKE.test(o);
}

function openFindingsOf(a: Asset) {
  // ⚠ 스캔 실패는 취약점이 아니다 — 결손(무엇을 모르는가)은 커버리지의 다른 항목이 챙긴다.
  return (a.findings || []).filter((f) => f.state !== "fixed" && isRealVulnerability(f));
}

// SBOM(구성요소 목록)·AI-BOM은 소프트웨어·AI 자산에만 의미가 있다. 취약점 스캐너로 들여온 IP
// 호스트나 인프라 호스트(방화벽·DB·네트워크 장비)는 구성요소 SBOM 대상이 아니다 — 이걸 "SBOM 없음"
// 으로 세면 커버리지가 거짓 결손을 만든다(실측 2026-07-19: 방화벽까지 SBOM 결손으로 집계).
// assets.isAiAsset과 목적은 같으나 순환 임포트 회피를 위해 여기서 자체 판별한다.
const NON_SOFTWARE_TYPES = new Set(["infra-host"]);
/**
 * SBOM 결손을 세는 **단 하나의 잣대**다(2026-09-01 내보냄).
 *
 * ⚠ 밖으로 낸 이유: 대화창이 「SBOM 없는 자산 알려줘」에 **AI 자산만 세는 도구**로 답해
 *   IT·일반 소프트웨어 자산이 통째로 빠졌다(검토관 [상]). 화면(sbom.html)은 또 전체 자산을
 *   세고 있어 **같은 물음에 잣대가 세 벌**이었다. 세는 곳이 늘 때마다 여기를 쓴다 —
 *   각자 세면 화면과 대화창이 다른 숫자를 말한다.
 */
export function sbomApplies(a: Asset): boolean {
  if (a.id.startsWith("vuln:")) return false; // 스캐너가 들여온 IP 호스트
  return !NON_SOFTWARE_TYPES.has(a.assetType);
}

export function gapsOf(a: Asset): GapKind[] {
  const gaps: GapKind[] = [];
  if (isOwnerMissing(a.owner)) gaps.push("owner");
  if (!a.service || !a.service.trim()) gaps.push("service");
  if (sbomApplies(a) && !a.sbomGeneratedAt) gaps.push("sbom");
  if (!a.lastScannedAt) gaps.push("unscanned");
  return gaps;
}

// 우선순위 = 취약점 심각도 × 정보 결손 × 담당자 부재.
// 취약점이 많은데 연락할 사람을 모르는 자산이 가장 위다.
function scoreOf(a: Asset, gaps: GapKind[]): number {
  const open = openFindingsOf(a);
  const maxRank = open.length ? Math.max(...open.map((f) => SEVERITY_RANK[f.severity] ?? 0)) : 0;
  let s = maxRank * 100 + Math.min(open.length, 50);
  if (open.some((f) => f.kev)) s += 400;
  if (gaps.includes("owner")) s += 60; // 사고 시 연락 불가 — 결손 중 가장 무겁다
  if (gaps.includes("service")) s += 25;
  if (gaps.includes("sbom")) s += 20;
  if (gaps.includes("unscanned")) s += 30;
  return s;
}

function whyOf(a: Asset, gaps: GapKind[]): string {
  const open = openFindingsOf(a);
  if (open.length && gaps.includes("owner")) return `취약점 ${open.length}건인데 연락할 담당자를 모름`;
  if (open.some((f) => f.kev)) return "실제 악용 중인 취약점(KEV) 보유";
  if (open.length && gaps.includes("service")) return `취약점 ${open.length}건, 영향 서비스 불명`;
  if (gaps.includes("unscanned")) return "한 번도 점검하지 않음 — 위험을 알 수 없음";
  if (gaps.includes("owner")) return "담당부서 미지정";
  if (gaps.includes("sbom")) return "구성요소 미파악 — 신규 취약점 영향 판단 불가";
  if (open.length) return `취약점 ${open.length}건`;
  return "";
}

const GAP_META: Record<GapKind, { severity: "high" | "mid"; title: (n: number) => string; why: string; fixLabel: string }> = {
  owner: {
    severity: "high",
    title: (n) => `담당부서를 알 수 없는 자산 ${n}건`,
    // ⚠ 2026-09-10 예행 결함 6 — 뒤 두 절(스캐너로 들여온…·출처 파일명…)은 예전엔 고정
    //   문자열이었다. 업무 데이터 0에서 시작한 새 인스턴스(키트 1개)에는 거짓이 되는 문장이라
    //   지웠다 — 데이터에 실제로 있을 때만 computeAssetCoverage가 ownerGapDetail()로 덧붙인다.
    why: "사고가 났을 때 연락할 대상이 없습니다.",
    fixLabel: "담당부서 지정",
  },
  unscanned: {
    severity: "high",
    title: (n) => `한 번도 점검하지 않은 자산 ${n}건`,
    why: "점검 이력이 없으면 취약점이 없는 것이 아니라 모르는 것입니다.",
    fixLabel: "점검 대상에 추가",
  },
  service: {
    severity: "mid",
    title: (n) => `연결된 서비스가 없는 자산 ${n}건`,
    why: "어느 업무 서비스에 쓰이는지 모르면 장애·침해 시 영향 범위를 계산할 수 없습니다.",
    fixLabel: "서비스 연결",
  },
  sbom: {
    severity: "mid",
    title: (n) => `SBOM이 없는 자산 ${n}건`,
    why: "구성요소를 모르면 신규 취약점이 공개됐을 때 우리가 영향을 받는지 판단할 수 없습니다.",
    fixLabel: "SBOM 생성",
  },
};

const GAP_ORDER: GapKind[] = ["owner", "unscanned", "service", "sbom"];

/**
 * 담당부서 결손의 **왜**를 데이터로 가른다(2026-09-10 예행 결함 6, 검토관용 export).
 * 빈칸 부류(owner.trim() === "")와 파일명 부류(FILENAME_LIKE, 43행 상수 재사용)를 각각
 * 실제로 있을 때만 문장으로 덧붙인다 — 둘 다 없으면(있을 수 없다, isOwnerMissing이 이 둘만
 * 결손으로 치므로) 빈 문자열.
 * ⚠ 정규식을 베끼지 않는다 — 시험이 이 함수를 직접 불러 대조한다(계약 한 곳).
 */
export function ownerGapDetail(owners: (string | null | undefined)[]): string {
  const trimmed = owners.map((o) => (o ?? "").trim());
  const parts: string[] = [];
  if (trimmed.some((o) => o === "")) parts.push("스캐너로 들여온 자산은 담당부서가 비어 있습니다.");
  if (trimmed.some((o) => FILENAME_LIKE.test(o))) parts.push("예전 반입분에는 출처 파일명이 담당부서로 잘못 저장돼 있습니다.");
  return parts.length ? " " + parts.join(" ") : "";
}

export function computeAssetCoverage(assets: Asset[]): AssetCoverage {
  const perAsset = assets.map((a) => ({ a, gaps: gapsOf(a) }));

  const gaps: AssetGap[] = [];
  for (const kind of GAP_ORDER) {
    const matched = perAsset.filter((p) => p.gaps.includes(kind));
    const ids = matched.map((p) => p.a.id);
    if (!ids.length) continue;
    const meta = GAP_META[kind];
    const why = kind === "owner" ? meta.why + ownerGapDetail(matched.map((p) => p.a.owner)) : meta.why;
    gaps.push({ kind, severity: meta.severity, title: meta.title(ids.length), why, fixLabel: meta.fixLabel, assetIds: ids });
  }

  const ranked: RankedAsset[] = perAsset
    .map(({ a, gaps: g }) => {
      const open = openFindingsOf(a);
      const maxRank = open.length ? Math.max(...open.map((f) => SEVERITY_RANK[f.severity] ?? 0)) : 0;
      const sevName = Object.keys(SEVERITY_RANK).find((k) => SEVERITY_RANK[k] === maxRank) ?? "info";
      return {
        id: a.id,
        name: a.name,
        gaps: g,
        openFindings: open.length,
        maxSeverity: open.length ? sevName : "none",
        kev: open.some((f) => f.kev),
        why: whyOf(a, g),
        score: scoreOf(a, g),
      };
    })
    .sort((x, y) => y.score - x.score || x.id.localeCompare(y.id));

  return {
    total: assets.length,
    complete: perAsset.filter((p) => p.gaps.length === 0).length,
    gaps,
    ranked,
  };
}

// 챗봇 답변용 요약 — 표가 아니라 문장으로.
export function coverageSummaryText(cov: AssetCoverage): string {
  if (cov.total === 0) return "등록된 자산이 없습니다.";
  const lines: string[] = [`자산 ${cov.total}건 중 정보가 완비된 것은 ${cov.complete}건입니다.`];
  if (cov.gaps.length === 0) return lines[0] + " 결손이 없습니다.";
  for (const g of cov.gaps) {
    const head = g.severity === "high" ? "🔴" : "🟠";
    lines.push(`${head} ${g.title} — ${g.why}`);
  }
  const top = cov.ranked.filter((r) => r.why).slice(0, 3);
  if (top.length) {
    lines.push("", "먼저 볼 자산:");
    // ⚠ 이름으로 부른다 — `vuln:10.10.20.11`은 담당자가 읽을 글자가 아니다(2026-08-03 말투 규범).
    // ⚠ 이름으로 부른다 — `vuln:10.10.20.11`은 담당자가 읽을 글자가 아니다(2026-08-03 말투 규범).
    //   여기 ranked에 이미 name이 있어 따로 조회할 필요가 없다(순환 참조도 안 만든다).
    for (const r of top) lines.push(`· ${r.name || r.id.replace(/^(vuln|asset):/, "")} — ${r.why}`);
  }
  return lines.join("\n");
}
