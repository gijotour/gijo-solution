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
//   · 결과 문장은 「이름이 지어진 항목만」 센 값임을 매번 함께 말한다 — 안 그러면 「평가기준을
//     다 봤다」로 읽히고, 그것이 이 기능이 만들 수 있는 가장 나쁜 거짓이다.
//   · **덜 재는 부분(gap)은 결과에 그대로 싣는다.** 문서가 「돌고 쌓인다」를 양호로 적은 자리를
//     제품이 「돌기만」 보는데 이름표만 이어 붙이면, 이름이 거짓을 덮는다.
//
// ■ 잣대 한 곳
//   세는 것은 fsiCoverage 하나, 문장은 fsiCoverageLine 하나, 부문·항목 표는 fsiSectionLines
//   하나다. 리포트(formatHardeningReport)와 축약 답(scanSummaryText)이 **같은 함수**를 부른다.
//
// ■ 왜 「대응 정도」 칸이 없나 (2026-09-08 검토관 적발로 걷어냄)
//   첫 판에는 degree(same/partial)가 있었는데 값이 standard에서 100% 유도됐고 뜻마저 틀렸다 —
//   U-01과 SSH-01은 **같은 명령·같은 판정**인데 하나는 「같음」, 하나는 「일부」였다. 재지 않은
//   구분은 적지 않는다. 자료 파일 noDegreeWhy에 근거를 남겼고 시험이 재도입을 막는다.
import 자료 from "./hardening-fsi-map.json";
import type { ScanReport, ScanStatus, StandardId } from "./hardeningscan";

export interface FsiMapEntry {
  /** 하드닝 점검 항목 id — hardeningscan.ts의 CheckItem.id와 **같아야** 한다(시험이 지킨다). */
  id: string;
  standard: StandardId;
  /** 평가기준 부문 코드 — FSI_SECTORS의 키. 지식 문서의 어느 절에 있는 줄인지와 같다(시험이 대조). */
  sector: string;
  /** 평가기준 쪽 항목을 우리가 부르는 이름(지식 문서 6·7·10절 행 이름). 공식 항목명이 아니다. */
  criterion: string;
  /** 문서가 보라는 잣대 중 **제품이 아직 안 재는 부분**. 있으면 결과 절에 그대로 실린다. */
  gap?: string;
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
/** 표에 **한 줄도 없는** 부문과 그 이유 — 「보이는 것이 전체」로 읽히는 것을 막는다. */
export const FSI_ABSENT_SECTORS: string = 자료.absentSectors;

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
  /** 그중 평가기준 이름이 지어진 항목 수. */
  mapped: number;
  /** 이름이 아직 없는 항목 수 — 표에 없음이 곧 미대응. */
  unmapped: number;
  /** 이름이 지어진 항목 중 양호(PASS). */
  pass: number;
  /** 이름이 지어진 항목 중 취약(FAIL). */
  fail: number;
  /** 이름이 지어진 항목 중 미측정(WARN 확인필요 + NA 해당없음) — 「양호」로 세면 준수율이 부푼다. */
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
 * ⚠ 「평가기준을 다 봤다」로 읽히면 안 된다. 그래서 ①이름이 지어진 항목만 센 값이라는 말과
 *   ②공식 점검표가 아니라는 말을 **문장에서 뗄 수 없게** 한 줄에 붙여 둔다.
 *   평가기준 전체 항목 수는 적지 않는다 — 그 수는 그 해 안내서를 열어야 알 수 있다.
 * ⚠ 앞 절에 「표준 항목 N개 중 대응 M개 … 미대응 0」이라 적던 판을 걷어냈다(2026-09-08 검토관):
 *   문장이 이름 댄 표준은 평가기준뿐이라 「평가기준 N개 중 M개 대응, 빠진 것 0」으로 읽혔고,
 *   축약 답에서는 바로 윗줄과 이 줄이 **다른 수를 같은 「✓ 양호」 이름표로** 나란히 찍었다.
 */
export function fsiCoverageLine(r: Pick<ScanReport, "items">): string {
  const c = fsiCoverage(r);
  return (
    `금융보안원 평가기준 대응 — 이번 점검 항목 ${c.total}개 가운데 평가기준 이름을 지은 것 ${c.mapped}개` +
    `(이름 없음 ${c.unmapped}개). 그 ${c.mapped}개만 세면 양호 ${c.pass} · 취약 ${c.fail} · 미측정 ${c.unmeasured}. ` +
    `**이름이 지어진 항목만** 센 값입니다 — 평가기준 전체를 본 것이 아니며(평가기준 항목 수는 그 해 안내서가 정본), ` +
    `대응표는 GIJO AS가 만든 것으로 금융보안원 공식 점검표가 아닙니다.`
  );
}

export interface FsiCriterionRow {
  /** 부문 코드(FSI_SECTORS의 키). */
  sector: string;
  sectorLabel: string;
  criterion: string;
  /** 이 평가기준 항목에 걸린 **이번 점검의** 항목 id들. */
  ids: string[];
  pass: number;
  fail: number;
  unmeasured: number;
  /** 취약이 하나라도 있으면 취약 · 없고 미측정이 있으면 미측정 · 전부 양호면 양호. */
  verdict: "취약" | "미측정" | "양호";
  /** 이 줄에 걸린 항목들이 안고 있는 「덜 재는 부분」(중복 제거). */
  gaps: string[];
}

/**
 * 부문 › 평가기준 항목으로 **묶은 표**. 화면 안내가 약속한 「부문·항목으로 읽는다」의 실체다.
 * ⚠ 이 함수가 없던 판(2026-09-08 검토관 적발): sector·criterion을 자료 파일에만 적어 두고
 *   출력에는 계수 한 줄만 냈다 — 「U-01을 모르는 분과 같은 표를 본다」는 약속이 글로만 있었다.
 */
export function fsiCriterionRollup(r: Pick<ScanReport, "items">): FsiCriterionRow[] {
  const 순서 = Object.keys(FSI_SECTORS);
  const 표 = new Map<string, FsiCriterionRow>();
  for (const i of r.items) {
    const e = 항목별.get(i.id);
    if (!e) continue;
    const key = e.sector + "␟" + e.criterion;
    let row = 표.get(key);
    if (!row) {
      row = {
        sector: e.sector, sectorLabel: FSI_SECTORS[e.sector] ?? e.sector, criterion: e.criterion,
        ids: [], pass: 0, fail: 0, unmeasured: 0, verdict: "양호", gaps: [],
      };
      표.set(key, row);
    }
    row.ids.push(i.id);
    if (i.status === "PASS") row.pass++;
    else if (i.status === "FAIL") row.fail++;
    else row.unmeasured++;
    if (e.gap && !row.gaps.includes(e.gap)) row.gaps.push(e.gap);
  }
  for (const row of 표.values()) row.verdict = row.fail > 0 ? "취약" : row.unmeasured > 0 ? "미측정" : "양호";
  return [...표.values()].sort((a, b) => 순서.indexOf(a.sector) - 순서.indexOf(b.sector));
}

const 판정표시: Record<FsiCriterionRow["verdict"], string> = { 취약: "✗ 취약", 미측정: "⚠ 미측정", 양호: "✓ 양호" };

/**
 * 리포트에 싣는 **부문별 표**(마크다운 줄들). 제목 줄까지 여기서 만든다 —
 * 화면 안내가 「「## 금융보안원 평가기준 대응」 절」이라 약속하고, 시험이 그 제목을 대조한다.
 */
export function fsiSectionLines(r: Pick<ScanReport, "items">): string[] {
  const rows = fsiCriterionRollup(r);
  const c = fsiCoverage(r);
  const L: string[] = [];
  L.push(`## 금융보안원 평가기준 대응`);
  L.push("");
  L.push(
    `> 우리 항목 번호(U-01·PC-04·N-33)를 모르는 분도 읽도록, 같은 결과를 평가기준의 **부문·항목 이름**으로 다시 적은 표입니다.`,
  );
  L.push(`> ⚠ ${FSI_DISCLAIMER}`);
  if (!rows.length) {
    L.push("");
    L.push(`- 이번 점검 항목 ${c.total}개에는 평가기준 이름을 지은 것이 **하나도 없습니다** — 아래 「이름을 못 지은 항목」을 보세요.`);
  }
  let 현재부문 = "";
  for (const row of rows) {
    if (row.sectorLabel !== 현재부문) {
      현재부문 = row.sectorLabel;
      L.push("");
      L.push(`**${현재부문}**`);
      L.push("");
      L.push(`| 평가기준 항목 | 결과 | 걸린 점검 항목 |`);
      L.push(`|---|---|---|`);
    }
    const 셈 = `${판정표시[row.verdict]} (양호 ${row.pass} · 취약 ${row.fail} · 미측정 ${row.unmeasured})`;
    L.push(`| ${row.criterion} | ${셈} | ${row.ids.join(" · ")} |`);
  }
  const gaps = rows.flatMap((row) => row.gaps);
  if (gaps.length) {
    L.push("");
    L.push(`**⚠ 이름은 이었지만 덜 재는 부분** — 평가기준 문서가 보라고 적은 잣대 중 이 점검이 아직 안 보는 것입니다.`);
    L.push("");
    for (const g of gaps) L.push(`- ${g}`);
  }
  const 미대응 = r.items.filter((i) => !항목별.has(i.id)).map((i) => i.id);
  if (미대응.length) {
    L.push("");
    L.push(`**이름을 못 지은 항목 ${미대응.length}개** — ${미대응.join(" · ")}`);
    L.push("");
    for (const id of 미대응) {
      const why = FSI_UNMAPPED_WHY[id];
      L.push(`- ${id}: ${why ?? "아직 대응을 못 지었습니다(빠뜨린 것인지 확인이 필요합니다)."}`);
    }
  }
  L.push("");
  L.push(`⚠ ${FSI_ABSENT_SECTORS}`);
  return L;
}

/**
 * 축약 답(대화창·라이트 단독 모드에서 그대로 최종 답이 되는 글)에 붙는 **한 줄**.
 * 계수만 말하면 「평가기준의 말로 읽는다」가 성립하지 않으므로, 손이 가야 할 항목의
 * **부문·이름**을 함께 부른다. 길어지지 않게 앞 6개까지만 부르고 나머지는 수로 말한다.
 */
export function fsiAttentionLine(r: Pick<ScanReport, "items">): string | null {
  const rows = fsiCriterionRollup(r);
  if (!rows.length) return null;
  const 손댈것 = rows.filter((x) => x.verdict !== "양호");
  const 이름 = (x: FsiCriterionRow) => `${x.sectorLabel.replace(/^기술적 보안 — /, "")} › ${x.criterion}(${x.ids.join("·")})`;
  if (!손댈것.length) {
    const 부문 = [...new Set(rows.map((x) => x.sectorLabel))].join(" · ");
    return `평가기준 말로는 — 이름이 지어진 항목은 모두 양호입니다(다룬 부문: ${부문}).`;
  }
  const 앞 = 손댈것.slice(0, 6).map((x) => `${판정표시[x.verdict]} ${이름(x)}`).join(" / ");
  const 나머지 = 손댈것.length > 6 ? ` 외 ${손댈것.length - 6}개 항목` : "";
  return `평가기준 말로는 — ${앞}${나머지}.`;
}
