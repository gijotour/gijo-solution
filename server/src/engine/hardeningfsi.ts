// engine/hardeningfsi.ts — 하드닝 점검 항목 ↔ 전자금융기반시설 취약점 평가기준 **대응표**.
//
// ■ 무엇 (사장님 물음 「실제 우리 자산에 점검도 가능할까」의 첫 걸음)
//   금융권 담당자는 우리 항목 번호(U-01·PC-04·N-33…)로 말하지 않는다. 「서버 부문의 관리자
//   원격 접속 제한이 양호냐」고 묻는다. 그 말로도 결과가 읽히게 **이름표를 잇는 표 한 장**을
//   둔다. 점검을 새로 만들지 않는다 — 재는 일은 종전대로 hardeningscan.ts가 한다.
//
// ■ 정직 (이 파일에서 가장 중요한 부분)
//   · 대응표는 **우리가 만든 것**이고 금융보안원 공식 자료가 아니다.
//   · 평가기준의 **항목 번호를 적지 않는다** — 해마다 개정되고 공개 글마다 어긋난다
//     (knowledge/GIJO_지식_금융_취약점_평가기준.md 2·13절). 미확인은 안 적는다.
//   · **표에 없음 = 미대응**이다. 「평가기준에 없다」가 아니라 「우리가 아직 못 지었다」로 읽는다.
//   · 결과 문장은 「대응된 항목만」 센 값임을 매번 함께 말한다 — 안 그러면 「평가기준을 다
//     봤다」로 읽히고, 그것이 이 기능이 만들 수 있는 가장 나쁜 거짓이다.
//
// ■ 잣대 한 곳
//   세는 것은 fsiCoverage 하나, 문장은 fsiCoverageLine 하나다. 리포트(formatHardeningReport)와
//   축약 답(scanSummaryText)이 **같은 함수**를 부른다 — 두 곳에서 따로 세면 곧 다른 수를 말한다.
import 자료 from "./hardening-fsi-map.json";
import type { ScanReport, ScanStatus, StandardId } from "./hardeningscan";

/** 대응 정도 — same: 국내 CCE 계열(U·PC·N)이라 같은 것을 본다 · partial: CIS라 일부만 덮는다. */
export type FsiDegree = "same" | "partial";

export interface FsiMapEntry {
  /** 하드닝 점검 항목 id — hardeningscan.ts의 CheckItem.id와 **같아야** 한다(시험이 지킨다). */
  id: string;
  standard: StandardId;
  /** 평가기준 부문 코드 — FSI_SECTORS의 키. */
  sector: string;
  /** 평가기준 쪽 항목을 우리가 부르는 이름(지식 문서 6·7·10절 행 이름). 공식 항목명이 아니다. */
  criterion: string;
  degree: FsiDegree;
  /** 지식 문서에 적힌 원 번호가 제품 id와 다를 때만(예: KISA PC-02 → 제품 PC-02a·PC-02b). */
  docId?: string;
  note?: string;
}

export const FSI_SECTORS: Record<string, string> = 자료.sectors;
export const FSI_MAP: readonly FsiMapEntry[] = 자료.entries as FsiMapEntry[];
export const FSI_DISCLAIMER: string = 자료.disclaimer;
export const FSI_SOURCE_DOC: string = 자료.sourceDoc;
/** 대응표에 일부러 안 올린 항목과 그 이유 — 「빠뜨린 것」과 「안 올린 것」을 가른다. */
export const FSI_UNMAPPED_WHY: Record<string, string> = 자료.unmappedWhy;

const 항목별 = new Map<string, FsiMapEntry>(FSI_MAP.map((e) => [e.id, e]));

/** 하드닝 항목 id로 평가기준 대응을 찾는다. 없으면 undefined = **미대응**. */
export function fsiEntryFor(id: string): FsiMapEntry | undefined {
  return 항목별.get(id);
}

export function fsiEntriesForStandard(standard: StandardId): FsiMapEntry[] {
  return FSI_MAP.filter((e) => e.standard === standard);
}

export interface FsiCoverage {
  /** 이 점검이 돌린 표준 항목 수(전부). */
  total: number;
  /** 그중 평가기준 대응이 지어진 항목 수. */
  mapped: number;
  /** 대응이 아직 없는 항목 수 — 표에 없음이 곧 미대응. */
  unmapped: number;
  /** 대응된 항목 중 양호(PASS). */
  pass: number;
  /** 대응된 항목 중 취약(FAIL). */
  fail: number;
  /** 대응된 항목 중 미측정(WARN 확인필요 + NA 해당없음) — 「양호」로 세면 준수율이 부푼다. */
  unmeasured: number;
}

/**
 * **세는 곳은 여기 하나다.** 리포트·축약 답·화면이 각자 세면 같은 점검이 다른 수를 말한다.
 * 미측정에 WARN을 넣는 이유: 확인필요는 「봤는데 판단 못 함」이라 양호도 취약도 아니다.
 */
export function fsiCoverage(r: Pick<ScanReport, "items">): FsiCoverage {
  let mapped = 0, unmapped = 0, pass = 0, fail = 0, unmeasured = 0;
  for (const i of r.items) {
    if (!항목별.has(i.id)) { unmapped++; continue; }
    mapped++;
    const s: ScanStatus = i.status;
    if (s === "PASS") pass++;
    else if (s === "FAIL") fail++;
    else unmeasured++;
  }
  return { total: r.items.length, mapped, unmapped, pass, fail, unmeasured };
}

/**
 * 결과 문장 **한 줄** — 리포트와 축약 답이 이 함수 하나를 쓴다.
 * ⚠ 「평가기준을 다 봤다」로 읽히면 안 된다. 그래서 ①대응된 항목만 센 값이라는 말과
 *   ②공식 점검표가 아니라는 말을 **문장에서 뗄 수 없게** 한 줄에 붙여 둔다.
 *   평가기준 전체 항목 수는 적지 않는다 — 그 수는 그 해 안내서를 열어야 알 수 있다.
 */
export function fsiCoverageLine(r: Pick<ScanReport, "items">): string {
  const c = fsiCoverage(r);
  return (
    `금융보안원 평가기준 대응 — 표준 항목 ${c.total}개 중 대응 ${c.mapped}개: ` +
    `✓ 양호 ${c.pass} · ✗ 취약 ${c.fail} · 미측정 ${c.unmeasured} · 미대응 ${c.unmapped}. ` +
    `**대응된 항목만** 센 값입니다 — 평가기준 전체를 본 것이 아니며(항목 수는 그 해 안내서가 정본), ` +
    `대응표는 GIJO AS가 만든 것으로 금융보안원 공식 점검표가 아닙니다.`
  );
}
