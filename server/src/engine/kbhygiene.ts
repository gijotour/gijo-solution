// engine/kbhygiene.ts — 지식베이스 위생 점검. RAG 지식베이스(memory)의 상충·중복·오래된 문서를
// 주기적으로 "찾아서 담당자에게 보여준다". 삭제는 절대 자동으로 하지 않는다 — 사람이 리포트를
// 보고 기존 삭제 경로(결재 원칙)로 판단한다.
//
// 왜: 지식베이스는 답변 품질을 실제로 결정하는 "데이터"다. 상충·중복 문서가 쌓이면 검색이 엉뚱한
// 쪽을 근거로 답한다(2026-07-23 실측: 유지보수 절차 질문이 예전 FOCS 매뉴얼과 경합). 정기 점검으로
// 위생을 유지하되, "오래됨=삭제"는 금물이다(옛 규정도 유효할 수 있음) — 신선도는 검토 플래그만.

import type { Express } from "express";
import { authMiddleware } from "../auth/auth";
import { listDocuments, getChunksForDocuments, queryMemoryScored, RAG_RELEVANCE_MAX_DISTANCE, type MemoryDocument } from "./memory";
import { 제품이쌓은문서, 개인문서 } from "./docorigin";
import { db } from "../db";

export type HygieneType = "duplicate" | "version_conflict" | "stale" | "demo_overlap";
export interface HygieneFinding {
  type: HygieneType;
  severity: "high" | "medium" | "low";
  documents: string[]; // 관련 문서 id
  reason: string;
  suggestion: string; // 권고(담당자 판단용) — 자동 실행 아님
}
export interface HygieneReport {
  scannedAt: string;
  /** **점검한** 문서 수(모집단). 화면·대화창이 "문서 N건"이라 말할 때의 N이다. */
  totalDocs: number;
  /** 지식 저장소 전체 문서 수(제외분 포함) — totalDocs의 뜻이 조용히 바뀌지 않게 함께 낸다. */
  storeDocs: number;
  /** 점검에서 뺀 문서 수 = storeDocs - totalDocs(승인 문답·침해사고 사례·개인 문서). */
  excludedDocs: number;
  findings: HygieneFinding[];
  clean: boolean;
}

const STALE_DAYS = Number(process.env.GIJO_KB_STALE_DAYS ?? 180);

// 파일명에서 버전·중복 표지를 걷어내 "같은 문서 계열"을 묶는 기준 이름을 만든다.
// "MF2_차단로그_v2.txt", "MF2_차단로그 (1).txt", "MF2_차단로그_최종.txt" → "mf2_차단로그"
export function normalizeBaseName(name: string): string {
  return (name ?? "")
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "") // 확장자
    .replace(/[_\-\s]*v\d+(\.\d+)*$/i, "") // _v2, -v1.2
    .replace(/[_\-\s]*버전\s*\d+/g, "")
    .replace(/\s*\(\d+\)\s*$/g, "") // (1) (2)
    .replace(/[_\-\s]*(최종|final|사본|copy|복사본|수정본?|개정)\s*$/gi, "")
    .replace(/[_\-\s]*\d{6,8}\s*$/g, "") // 뒤에 붙은 날짜 20260723
    .replace(/[\s_\-]+/g, "")
    .trim();
}

// 콘텐츠 지문 — 앞부분 청크 텍스트를 정규화해 완전/근접 중복을 잡는다. 동일 문서는 동일 지문.
function fingerprint(chunks: { text: string }[]): string {
  const joined = chunks.slice(0, 3).map((c) => c.text).join(" ").replace(/\s+/g, " ").trim().toLowerCase();
  return joined.slice(0, 600);
}

export async function scanKbHygiene(): Promise<HygieneReport> {
  const 전체 = await listDocuments();
  // ★ 모집단 — 제품이 스스로 쌓은 문서(승인 문답·침해사고 사례)는 점검하지 않는다(2026-09-04).
  //   왜: 그 문서들은 AI 지식 화면·문서 허브 목록에 **애초에 안 뜬다**(docorigin 잣대). 위생 점검이
  //   「중복이니 지우세요」라고 말해도 담당자가 누를 자리가 없다 — 못 고치는 지적만 쌓인다.
  //   게다가 제목이 「승인문답:<id>」·「incident-case:<id>」라 뿌리가 전부 같아 **전부가 버전충돌**로
  //   잡힌다. 실측(운영 LanceDB 읽기 전용, 2026-09-04): 문서 3,919건 중 **3,798건**이 이 부류라 점검 대상은 121건이다.
  // ★ 개인 문서(documentId가 "personal:"로 시작)도 같은 이유로 뺀다(2026-09-04). AI 지식 화면이
  //   이미 빼는데(memory.html loadDocuments) 여기만 남아, 위생 점검이 「personal:9f3c-…가 중복입니다」라고
  //   말해도 그 줄을 누를 자리가 없었다. 게다가 이 점검은 **보는 사람을 모른다**(주기 실행·도구
  //   호출에 viewer가 없다) — 남의 개인 메모가 아무에게나 가는 옆문까지 된다.
  const docs = 전체.filter((d) => !제품이쌓은문서(d.origin) && !개인문서(d.documentId));
  const findings: HygieneFinding[] = [];

  // ★ 조각은 **한 번에** 떠 온다(2026-09-04 실측 수리). 예전에는 문서마다 getDocumentChunks를 불렀는데
  //   documentId에 스칼라 인덱스가 없어 한 번이 조각 전수 스캔(운영 실측 172ms/건)이라, 3,919문서를 돌면
  //   **676초**다 — 그동안 지식 위생 점검이 대화창을 10분 넘게 붙잡았다(대화창 경로는 매번 새로 점검한다).
  //   지금은 IN-목록 한 번(운영 실측 0.43초)이다.
  //   ⚠ 이 안에서 다시 문서별 조회를 부르지 말 것 — 되돌아가면 곱셈이 되살아난다.
  let 조각 = new Map<string, { chunkIndex: number; text: string }[]>();
  try {
    조각 = await getChunksForDocuments(docs.map((d) => d.documentId));
  } catch {
    /* 저장소를 못 열면 지문 없이 진행 — 이름 기반 규칙(버전충돌·신선도)은 그대로 돈다 */
  }

  // 각 문서의 지문 수집(청크 앞부분).
  const fp = new Map<string, string>();
  for (const d of docs) fp.set(d.documentId, fingerprint(조각.get(d.documentId) ?? []));

  // ① 완전/근접 중복 — 같은 지문끼리 묶는다(2개 이상).
  const byFp = new Map<string, string[]>();
  for (const d of docs) {
    const f = fp.get(d.documentId) ?? "";
    if (f.length < 40) continue; // 너무 짧은 지문은 오탐 위험 — 제외
    byFp.set(f, [...(byFp.get(f) ?? []), d.documentId]);
  }
  const dupSet = new Set<string>();
  for (const ids of byFp.values()) {
    if (ids.length < 2) continue;
    ids.forEach((id) => dupSet.add(id));
    findings.push({
      type: "duplicate",
      severity: "high",
      documents: ids,
      reason: `내용이 사실상 동일한 문서 ${ids.length}건 — 같은 자료가 중복 인입됐습니다.`,
      suggestion: "가장 최신본 1개만 남기고 나머지는 삭제 검토(중복은 검색 노이즈).",
    });
  }

  // ② 버전 충돌 — 기준 이름은 같은데 내용은 다른(중복 아닌) 문서 묶음.
  const byBase = new Map<string, MemoryDocument[]>();
  for (const d of docs) {
    const base = normalizeBaseName(d.documentId);
    if (base.length < 3) continue;
    byBase.set(base, [...(byBase.get(base) ?? []), d]);
  }
  for (const group of byBase.values()) {
    if (group.length < 2) continue;
    // 이미 완전중복으로 잡힌 그룹은 건너뛴다(같은 지적 반복 방지).
    const ids = group.map((d) => d.documentId);
    if (ids.every((id) => dupSet.has(id))) continue;
    findings.push({
      type: "version_conflict",
      severity: "medium",
      documents: ids,
      reason: `이름은 같은 계열인데 내용이 다른 문서 ${ids.length}건 — 버전 충돌 가능성(옛 절차 vs 새 절차).`,
      suggestion: "어느 쪽이 최신·정본인지 담당자가 확인해 하나로 정리(자동 삭제 금지).",
    });
  }

  // ④ 데모·샘플 문서가 실제 문서와 같은 주제를 다루는 경우.
  //
  // 왜 필요한가(2026-07-26 실측): "샘플_방화벽_정책_점검_절차.txt"(데모 2조각)가 검색 1위를 차지해,
  // 실제 지식 문서(보안장비 유지보수절차의 월간 7항목 — 자원·HA·시그니처·백업·로그)를 밀어냈다.
  // 답변은 데모 내용만으로 만들어졌고, 위 세 규칙(중복·버전충돌·신선도)은 이름도 내용도 달라
  // 하나도 잡지 못했다. 이름이 달라도 **같은 질문에 함께 걸리면** 경합이다.
  //
  // 판정 방법: 데모 문서의 본문으로 지식베이스를 검색해, 데모가 아닌 문서가 관련 범위 안에
  // 함께 나오면 "주제가 겹친다"고 본다. 추측이 아니라 실제 검색 결과로 판단한다.
  const isDemoName = (id: string) => /^(샘플|데모|sample|demo|test)[_\-\s]/i.test(id) || /(샘플|데모)\.(txt|md|pdf)$/i.test(id);
  for (const d of docs.filter((x) => isDemoName(x.documentId))) {
    try {
      // 조각은 위에서 한 번에 떠 왔다 — 여기서 문서별로 다시 부르면 곱셈이 되살아난다.
      const probe = (조각.get(d.documentId)?.[0]?.text ?? "").replace(/\s+/g, " ").slice(0, 300);
      if (probe.length < 30) continue;
      const hits = await queryMemoryScored(probe, 5);
      const rivals = [...new Set(
        hits
          .filter((h) => h.distance <= RAG_RELEVANCE_MAX_DISTANCE)
          .map((h) => h.documentId)
          .filter((id) => id && id !== d.documentId && !isDemoName(id))
      )];
      if (!rivals.length) continue;
      findings.push({
        type: "demo_overlap",
        severity: "medium",
        documents: [d.documentId, ...rivals.slice(0, 3)],
        reason:
          `데모·샘플 문서 "${d.documentId}"가 실제 문서(${rivals.slice(0, 3).join(", ")})와 같은 주제를 다룹니다 — ` +
          `같은 질문에 둘 다 걸려, 데모 내용이 실제 자료를 밀어내고 답변에 쓰일 수 있습니다.`,
        suggestion: "실사용 전환 시 데모 문서를 삭제 검토. 남겨두려면 답변이 어느 쪽을 근거로 쓰는지 확인하세요(자동 삭제 금지).",
      });
    } catch {
      /* 임베딩 미기동 등 — 이 항목만 건너뛴다 */
    }
  }

  // ③ 신선도 — 오래된 문서는 "삭제"가 아니라 "검토" 플래그만.
  const cutoff = Date.now() - STALE_DAYS * 86400_000;
  const stale = docs.filter((d) => d.ingestedAt && new Date(d.ingestedAt).getTime() < cutoff);
  if (stale.length) {
    findings.push({
      type: "stale",
      severity: "low",
      documents: stale.map((d) => d.documentId),
      reason: `${STALE_DAYS}일 이상 갱신되지 않은 문서 ${stale.length}건 — 아직 유효한지 검토 권장.`,
      suggestion: "유효하면 그대로 두고(삭제하지 말 것), 낡았으면 최신본으로 교체.",
    });
  }

  const report: HygieneReport = {
    scannedAt: new Date().toISOString(),
    totalDocs: docs.length,
    storeDocs: 전체.length,
    excludedDocs: 전체.length - docs.length,
    findings,
    clean: findings.length === 0,
  };
  // 최근 리포트 영속(화면·스케줄 표시용).
  try {
    db.prepare("INSERT INTO app_state (key, value) VALUES ('kbHygieneReport', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(report));
  } catch { /* 저장 실패는 비치명적 */ }
  return report;
}

export function lastKbHygieneReport(): HygieneReport | null {
  try {
    const raw = (db.prepare("SELECT value FROM app_state WHERE key='kbHygieneReport'").get() as { value: string } | undefined)?.value;
    return raw ? (JSON.parse(raw) as HygieneReport) : null;
  } catch {
    return null;
  }
}

/**
 * 「마지막 점검 N시간 전(YYYY-MM-DD HH:mm)」 — 리포트는 저장된 것을 그대로 돌려주므로(라우트),
 * **언제 잰 값인지**를 같이 말하지 않으면 오늘 센 숫자로 읽힌다(today.ts 「마지막 점검 N일 전」과 같은 결).
 * ⚠ 여기 값은 scannedAt 하나에서 나온다 — 화면은 같은 필드로 제 문구를 만든다(값은 한 곳, 표기만 둘).
 */
export function 점검시각문구(scannedAt: string): string {
  const t = new Date(scannedAt ?? "").getTime();
  if (!Number.isFinite(t)) return "마지막 점검 시각 미상";
  const 시간 = Math.floor((Date.now() - t) / 3600_000);
  const 경과 = 시간 < 1 ? "방금 전" : 시간 < 48 ? `${시간}시간 전` : `${Math.floor(시간 / 24)}일 전`;
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `마지막 점검 ${경과}(${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())})`;
}

/** 「점검 대상 N건(제외 M건 — 승인 문답·사례 문서·개인 문서)」 — 숫자가 무엇을 센 것인지 함께 말한다. */
function 모집단문구(r: HygieneReport): string {
  const 제외 = Number(r.excludedDocs ?? 0);
  // ⚠ 제외 사유를 적을 때 개인 문서를 빠뜨리면 숫자와 설명이 어긋난다 — 「무엇을 뺐나」가 곧 이 숫자의 뜻이다.
  return `문서 ${r.totalDocs}건 점검` + (제외 > 0 ? ` · 제외 ${제외}건(승인 문답·사례 문서·개인 문서 — 이 목록에 없어 여기서 지울 수 없는 것)` : "");
}

// 챗봇/화면이 그대로 쓸 요약.
export function formatKbHygiene(r: HygieneReport): string {
  const 꼬리 = `\n${점검시각문구(r.scannedAt)} · ${모집단문구(r)}`;
  if (r.clean) return `🧹 지식베이스 점검 — 상충·중복 없음 ✓${꼬리}`;
  const L: string[] = [`🧹 지식베이스 점검 — 정리 필요 ${r.findings.length}건${꼬리}`];
  const label = { duplicate: "완전중복", version_conflict: "버전충돌", stale: "신선도검토", demo_overlap: "데모경합" } as const;
  for (const f of r.findings) {
    L.push(`\n[${label[f.type]}] ${f.reason}`);
    L.push(`  대상: ${f.documents.slice(0, 5).join(", ")}${f.documents.length > 5 ? ` 외 ${f.documents.length - 5}건` : ""}`);
    L.push(`  → ${f.suggestion}`);
  }
  L.push("\n※ 삭제는 자동으로 하지 않습니다 — AI 지식 화면에서 확인 후 지우세요.");
  return L.join("\n");
}

const HYGIENE_INTERVAL_MS = 7 * 24 * 3600_000;
let hygieneTimer: NodeJS.Timeout | null = null;
let firstHygieneTimer: NodeJS.Timeout | null = null;

/** 마지막 점검이 주기(7일)를 넘겼는가 — 리포트가 아예 없으면 true. 기동 직후 1회 실행을 이걸로 정한다. */
export function kbHygieneOverdue(): boolean {
  const last = lastKbHygieneReport();
  const t = new Date(last?.scannedAt ?? "").getTime();
  if (!Number.isFinite(t)) return true;
  return Date.now() - t >= HYGIENE_INTERVAL_MS;
}

export function startKbHygieneScheduler(): void {
  if (hygieneTimer) return;
  const tick = () => { scanKbHygiene().catch((e) => console.warn(`[kb-hygiene] 점검 실패: ${e instanceof Error ? e.message : String(e)}`)); };

  // ⚠ [2026-09-04] setInterval만 걸면 **첫 점검이 기동 7일 뒤**다. 운영 서버는 배포·모델 재시작으로
  //   그보다 자주 재시작되므로, 재시작이 잦으면 점검이 **영영 한 번도 안 돈다**(백업이 엿새 동안
  //   0개였던 2026-07-29 사고와 같은 모양 — 그래서 backup.ts와 같은 꼴로 맞춘다).
  //   재시작마다 점검 폭풍이 나지 않는 이유는 "마지막 리포트가 주기를 넘겼을 때만" 돌기 때문이다.
  //   지연을 두는 이유: 기동 직후엔 임베딩(8081)이 아직 예열 중이라 데모경합 규칙이 조용히 건너뛰어진다.
  const firstDelay = Number(process.env.GIJO_KB_HYGIENE_FIRST_DELAY_MS ?? 180_000);
  firstHygieneTimer = setTimeout(() => {
    if (kbHygieneOverdue()) {
      console.log("[kb-hygiene] 마지막 점검이 주기를 넘겨 기동 직후 1회 실행합니다");
      tick();
    }
  }, firstDelay);
  if (firstHygieneTimer.unref) firstHygieneTimer.unref();

  hygieneTimer = setInterval(tick, HYGIENE_INTERVAL_MS);
  if (hygieneTimer.unref) hygieneTimer.unref();
  console.log("[kb-hygiene] 지식베이스 위생 점검 스케줄러 시작 (주 1회 + 밀렸으면 기동 직후 1회, 삭제 없이 리포트만)");
}
export function stopKbHygieneScheduler(): void {
  if (hygieneTimer) { clearInterval(hygieneTimer); hygieneTimer = null; }
  // 기동 지연 안에 종료·재배포가 겹치면 종료 중에 점검이 뜬다 — 함께 정리한다(backup.ts와 같은 이유).
  if (firstHygieneTimer) { clearTimeout(firstHygieneTimer); firstHygieneTimer = null; }
}

export function registerKbHygieneRoutes(app: Express): void {
  // 최근 리포트(없으면 즉석 점검).
  app.get("/api/kb-hygiene", authMiddleware, async (_req, res) => {
    const last = lastKbHygieneReport();
    res.json(last ?? (await scanKbHygiene()));
  });
  // 지금 다시 점검.
  app.post("/api/kb-hygiene/scan", authMiddleware, async (_req, res) => {
    res.json(await scanKbHygiene());
  });
}
