// engine/docledger — **반입 대장(sqlite) ↔ 지식 저장소(LanceDB) 잣대 한 곳.** (계획서 전-4 · 2026-09-07)
//
// ■ 왜 이 파일이 생겼나
//   같은 문서를 세는 자리가 이미 셋이다 — `memory_documents`(반입 대장) · LanceDB 조각 집계 ·
//   observability/teamview의 SQLite COUNT. 셋이 **세는 대상이 달라서** 숫자가 다른 것이지
//   하나가 새는 것이 아니다. 그런데 그 사실이 어디에도 안 적혀 있어 사람이 매번 손으로 찾았고,
//   2026-09-07에 `tools/docs-drift.mjs`가 처음으로 그 대조를 코드로 적었다.
//   ★ 그 정의를 **여기로 옮겼다**(복사가 아니다). 제품(서버)과 도구(win 호스트)가 같은 잣대를
//     쓰려면 정의가 한 벌이어야 한다 — 두 벌이 되는 순간 「같은 것을 여러 곳에 적으면
//     어긋난다」가 이 자리에서 재발한다. 도구는 이제 `server/dist/engine/docledger.js`를 부른다.
//
// ■ ⚠ 이 파일은 **import가 0개**다 — 순수 함수만 둔다
//   engine/ 아래 파일이 `./db`나 lancedb를 끌면, win 호스트에서 도는 `tools/docs-drift.mjs`가
//   dist를 import하는 순간 **SQLite·LanceDB가 열린다**(도구는 win, DB는 WSL 운영본이다).
//   짝 시험이 이 파일에 import 줄이 없는지 소스로 감시한다 — 셋째 벌도 여기서 걸린다.
//
// ■ 낱말
//   · 대장(ledger) = `memory_documents` 한 줄. **반입하던 그때** 적어 둔 조각 수가 들어 있다.
//   · 저장소(store) = LanceDB `documents`에 지금 실제로 남아 있는 조각.
//   · 유령 = 대장에는 줄이 있는데 저장소에 조각이 0개 → **AI가 근거로 못 쓴다**(반입됐다고 적혀만 있다).
//   · 반쪽 유령 = 이름은 양쪽에 있는데 **판이 다르다**(조각 수 불일치). 저장소가 적으면 벡터가
//     날아간 것이고, 많으면 옛 판 조각이 남아 **AI가 두 판을 섞어 읽는다.**

/**
 * 문서 한 편의 대장↔저장소 상태.
 *   ok      — 같다(대장에 적힌 조각 수 = 저장소 조각 수)
 *   missing — 저장소에 조각이 **하나도 없다**(유령). AI가 근거로 못 쓴다.
 *   short   — 저장소가 **적다**(벡터가 부분적으로 날아갔다)
 *   extra   — 저장소가 **많다**(옛 판 조각이 남아 두 판이 섞인다)
 *   unknown — 대장이 조각 수를 **안 적어** 견줄 수가 없다(모르는 것을 어긋남이라 하지 않는다)
 */
export type DocState = "ok" | "missing" | "short" | "extra" | "unknown";

/**
 * 조각 수 두 개를 견줘 상태를 낸다. **판정은 여기 한 곳** — 손으로 `a !== b`를 적지 말 것.
 *
 * ⚠ 차례가 뜻이다:
 *   ① 저장소가 0이면 대장이 뭐라 적혔든 **missing**이다(AI가 못 읽는 것이 제일 큰 사실).
 *   ② 대장이 조각 수를 안 적었으면 **unknown**이다 — 0으로 치면 멀쩡한 문서가 전부 어긋남이 된다.
 *   ③ 그다음에야 같음·적음·많음을 가른다.
 */
export function 조각상태(저장조각: number | null | undefined, 대장조각: number | null | undefined): DocState {
  const 저장 = Number(저장조각);
  const 대장 = Number(대장조각);
  if (!Number.isFinite(저장) || 저장 <= 0) return "missing";
  if (!Number.isFinite(대장) || 대장 <= 0) return "unknown";
  if (저장 === 대장) return "ok";
  return 저장 < 대장 ? "short" : "extra";
}

/**
 * 「AI가 근거로 못 쓰는 문서인가」 — 조각이 하나도 없는 줄.
 * ⚠ short·extra는 **여기 안 든다**. 판이 다를 뿐 읽히기는 읽힌다 — 못 읽는 것과 섞으면
 *   「지식 N건」이 이번엔 반대 방향으로 틀린다(줄여서 틀리는 것도 틀린 것이다).
 */
export function 조각없음(state: DocState | null | undefined): boolean {
  return state === "missing";
}

/**
 * 「대장에 적힌 그대로 저장소에 들어가 있는가」 — 기동 자가치유가 **건너뛰어도 되는** 조건.
 * ⚠ ok가 아닌 것은 전부 다시 넣는다(missing이면 되살리고, short/extra면 판을 맞춘다).
 *   `!조각없음()`으로 좁히면 **반쪽 유령이 영영 안 낫는다**(이름은 있으니 건너뛴다).
 */
export function 대장과같음(state: DocState | null | undefined): boolean {
  return state === "ok";
}

/**
 * 「이름은 있는데 판이 다른가」 — 반쪽 유령(저장소가 적으면 일부 사라짐, 많으면 옛 판이 섞임).
 * ⚠ 이 술어가 없어서 소비자(handlers)에 `docState === "short" || docState === "extra"`가
 *   **손으로** 적혀 있었다(2026-09-07 검토관 적발). 상태를 하나 더 만들면 그 줄만 조용히 빠진다 —
 *   갈래를 늘릴 일이 생기면 **여기만** 고치면 되도록 술어로 낸다.
 */
export function 판이어긋남(state: DocState | null | undefined): boolean {
  return state === "short" || state === "extra";
}

/**
 * 「대장과 견줄 수 있는 줄인가」 — 모집단을 정직하게 세는 자리에서 쓴다.
 * unknown(대장이 조각 수를 안 적음)은 **견준 적이 없다**. 「N건을 다 봤다」에 넣으면
 * 보지도 않은 것을 봤다고 말하는 셈이라, 0건 보고의 모집단이 부풀려진다.
 */
export function 견줄수있음(state: DocState | null | undefined): boolean {
  return state === "ok" || state === "missing" || state === "short" || state === "extra";
}

/** 사람에게 보여 줄 꼬리표. ok면 빈 문자열 — 정상인 줄에 아무것도 안 붙인다. */
export function 상태꼬리(state: DocState | null | undefined, 대장조각?: number | null): string {
  switch (state) {
    case "missing":
      return `조각 없음${Number.isFinite(Number(대장조각)) && Number(대장조각) > 0 ? `(대장 ${Number(대장조각)}개)` : ""}`;
    case "short":
      return "조각 일부 사라짐";
    case "extra":
      return "옛 판 조각 남음";
    default:
      return "";
  }
}

/** 파일 경로에서 이름만(목록에는 knowledge/… 처럼 하위 폴더가 붙어 오는데 저장소 id는 이름뿐이다). */
const 이름만 = (p: unknown): string => String(p ?? "").replace(/^.*[/\\]/, "");

export interface 대장줄 {
  documentId: string;
  chunks?: number | null;
  origin?: string | null;
}

export interface 잣대대조결과 {
  대장수: number;
  저장수: number;
  유령: { 이름: string; 조각: number }[];
  대장밖: string[];
  조각어긋남: { 이름: string; 대장: number; 저장: number }[];
  조각미기재: string[];
}

/**
 * 반입 대장 ↔ 지식 저장소 대조.
 * @param 대장 `SELECT documentId, origin, chunks FROM memory_documents`
 * @param 저장조각 문서 id → 저장소에 남아 있는 조각 수
 *
 * ⚠⚠ **이름만 맞으면 초록**이던 자리를 닫는다 (2026-09-07 실측).
 *   옛 판은 이름 집합 두 개만 견줘서 「유령(이름이 통째로 없다)」만 봤다. 그런데 운영에는
 *   **반쪽 유령**이 있었다 — 이름은 양쪽에 있는데 **판이 다른** 문서다:
 *     · CrowdStrike…  대장 101 / 저장소 99
 *     · Tenable IE…   대장 4 / 저장소 2
 *     · model-intake-policy… 대장 1 / 저장소 2
 * ⚠ 갈래 판정은 위 `조각상태` 하나로 한다 — 여기서 다시 `!==`를 적으면 잣대가 두 벌이 된다.
 */
export function 잣대대조(대장: 대장줄[] | null | undefined, 저장조각: Record<string, number> | null | undefined): 잣대대조결과 {
  const 저장 = 저장조각 ?? {};
  const 저장이름 = new Set(Object.keys(저장));
  const 대장이름 = new Set((대장 ?? []).map((r) => String(r.documentId)));

  const 유령: { 이름: string; 조각: number }[] = [];
  const 조각어긋남: { 이름: string; 대장: number; 저장: number }[] = [];
  const 조각미기재: string[] = [];

  for (const r of 대장 ?? []) {
    const 이름 = String(r.documentId);
    // 저장소에 이름이 없다 = 조각 0. 그 둘은 같은 말이다(조각 수는 행을 센 값이라 0이면 이름도 없다).
    const 저장수 = 저장이름.has(이름) ? Number(저장[이름]) || 0 : 0;
    const 적힌수 = Number(r.chunks);
    switch (조각상태(저장수, 적힌수)) {
      case "missing":
        유령.push({ 이름, 조각: Number.isFinite(적힌수) ? 적힌수 : 0 });
        break;
      case "unknown":
        조각미기재.push(이름);
        break;
      case "short":
      case "extra":
        조각어긋남.push({ 이름, 대장: 적힌수, 저장: 저장수 });
        break;
      default:
        break; // ok — 할 말이 없다
    }
  }

  // 대장밖 = 저장소에는 조각이 있는데 대장에 줄이 없다 → 지운 대장/직접 넣은 벡터.
  const 대장밖 = [...저장이름].filter((n) => !대장이름.has(n)).sort();

  // 차이가 큰 것부터 — 사람이 위에서 몇 줄만 봐도 심한 것을 먼저 만난다.
  조각어긋남.sort((a, b) =>
    Math.abs(b.대장 - b.저장) - Math.abs(a.대장 - a.저장) || a.이름.localeCompare(b.이름));
  조각미기재.sort();

  return { 대장수: 대장이름.size, 저장수: 저장이름.size, 유령, 대장밖, 조각어긋남, 조각미기재 };
}

/**
 * 목록(docs-manifest.json)에 없는데 저장소에 있는 문서를 갈래별로 가른다.
 * ⚠ built-in만 이름을 다 적는다 — 승인 문답이 3,700편이라 전부 찍으면 그 안에서 아무것도 안 보인다.
 *   나머지는 **출처별 건수**로 말한다(감춘 것과 요약한 것은 다르다 — 셈은 그대로 보인다).
 */
export function 매니페스트밖(
  저장조각: Record<string, number> | null | undefined,
  문서들: string[] | null | undefined,
  대장: 대장줄[] | null | undefined,
): { 총: number; builtin: string[]; 갈래별: Record<string, number> } {
  const 목록이름 = new Set((문서들 ?? []).map(이름만));
  const 출처 = new Map((대장 ?? []).map((r) => [String(r.documentId), String(r.origin ?? "") || "(출처 없음)"]));
  const 밖 = Object.keys(저장조각 ?? {}).filter((n) => !목록이름.has(n)).sort();
  const builtin = 밖.filter((n) => 출처.get(n) === "builtin");
  const 갈래별: Record<string, number> = {};
  for (const n of 밖) {
    const k = 출처.get(n) ?? "(대장에 없음)";
    if (k === "builtin") continue;
    갈래별[k] = (갈래별[k] ?? 0) + 1;
  }
  return { 총: 밖.length, builtin, 갈래별 };
}
