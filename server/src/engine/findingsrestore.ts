// engine/findingsrestore.ts — 실패한 스캔이 덮어써 잃은 취약점을 스캔 이력에서 되살린다.
//
// ★ 왜 이 기능이 있는가 (2026-08-03 운영 실측)
//   담당자 brian이 2026-07-31에 "서버이름이 oracle 찾아줘"가 엉뚱한 답을 준다고 지적했다.
//   그 지적을 따라가 보니 오라클 서버는 등록부에 **있었고**, 다만 취약점이 0건이었다.
//   스캔 이력을 열어 보니 2026-07-28에 `Oracle Server Scan.nessus`로 **352건**이 들어왔고,
//   그날 저녁부터 맞지도 않는 modelscan이 실패하며 남긴 `scan_error` 한 줄이 그것을 덮어썼다.
//   같은 일이 자산 46개에서 일어나 **4,817건**이 사라져 있었다.
//
//   덮어쓰기 자체는 2026-08-02 가드(assets.ts 실패로덮어쓰지않기)로 막혔다. 그러나 **그 전에
//   잃은 것을 되돌리는 길이 없었다.** 다행히 원본은 스캔 이력에 그대로 남아 있다 — 이 파일은
//   그것을 찾아 되돌린다.
//
// ■ 지키는 것
//   1) **지어내지 않는다.** 이력에 있는 그대로만 되살린다. 없는 자산은 손대지 않는다.
//   2) **시점을 밝힌다.** 되살린 것은 그때의 스캔 결과다 — "지금"이 아니다. 언제 것인지 적는다.
//   3) **실패 기록을 감추지 않는다.** 되살린 취약점 뒤에 최근 스캔 실패 기록을 함께 남긴다.
//   4) **덮어쓰지 않는다.** 지금 진짜 취약점이 하나라도 있는 자산은 후보에서 뺀다.
//   5) **사람이 결정한다.** 미리보기를 보여 주고 승인받은 뒤에만 쓴다(결재판).
import { listAssets, getAsset, recordFindings, type Asset, type ScanRun } from "./assets";
import type { StandardFinding } from "./bridge";
import { recordAudit } from "./audit";
import { isRealVulnerability } from "./agenttools";

// ⚠ **판정은 여기서 다시 하지 않는다.** "이게 진짜 취약점인가"는 isRealVulnerability 하나가
//   정한다(agenttools.ts). 여기서 따로 `scan_error`를 나열하면 판정 종류가 늘 때 이 파일만
//   낡는다 — findingcount.test.ts가 그 어긋남을 감시한다.
const 실패한기록 = (f: StandardFinding) => !isRealVulnerability(f);

export interface 잃은자산 {
  assetId: string;
  이름: string;
  되찾을건수: number;
  스캔시각: number;
  출처: string[];
}

/**
 * 같은 취약점인지 가르는 열쇠.
 *
 * ⚠ **출처(source_tool)를 넣지 않는다.** 처음엔 넣었다가 운영에서 같은 취약점이 두 벌로
 *   되살아났다(2026-08-03: 10.10.20.41의 Zerologon이 `demo-scan.csv`와
 *   `demo-nessus-2026-08` 두 이름으로 각각 남아 「오늘 할 일」에 나란히 떴다).
 *   `key`는 StandardFinding 정의부터가 **"스캔 사이 동일 취약점을 잇는 안정적 식별자"**다 —
 *   어느 파일로 들어왔는지는 같은 취약점을 다른 것으로 만들지 않는다.
 */
const 열쇠 = (f: StandardFinding) => String(f.key ?? f.finding_type);

/** 같은 열쇠는 하나만 남긴다 — **먼저 있던 것**을 남긴다(담당자의 검토·배정이 붙어 있다). */
function 중복정리(list: StandardFinding[]): StandardFinding[] {
  const 본것 = new Set<string>();
  return list.filter((f) => (본것.has(열쇠(f)) ? false : (본것.add(열쇠(f)), true)));
}

/**
 * 이력에서 되살릴 것을 모은다 — **출처(점검 파일)별로 가장 최근 것**을 모아 합친다.
 *
 * ★ 왜 "가장 최근 스캔 하나"가 아닌가(2026-08-03 실측으로 고침):
 *   처음엔 가장 최근 진짜 스캔 하나만 되살렸다. 그랬더니 192.168.219.98에서 **2건**만 돌아왔다.
 *   이력을 열어 보니 7-28 10:44에 `Oracle Server Scan.nessus`로 352건이 들어왔고,
 *   같은 날 19:04에 `DHSAMPLE_scan.xml`이라는 **다른 점검 보고서**가 2건을 넣은 것이었다.
 *   나중 보고서가 앞 보고서를 **대체하지 않는다** — 서로 보는 범위가 다르다.
 *   그래서 출처마다 그 출처의 최신 결과를 골라 합친다.
 *
 * ⚠ 이렇게 하면 **정상 재스캔으로 사라진 것을 되살리지 않는다** — 같은 출처를 다시 돌리면
 *   그 출처의 최신이 새 결과이기 때문이다. 고쳐서 없어진 것은 없어진 채로 둔다.
 */
function 이력에서모으기(history: ScanRun[]): {
  findings: StandardFinding[];
  마지막시각: number;
  출처: string[];
  /** 출처별 스캔 시각 — **되살리는 출처의 날짜만** 적기 위해 필요하다.
   *  전체 최댓값을 쓰면 7-28 오라클 결과에 오늘 날짜가 붙는다(2026-08-03 실측). */
  출처시각: Map<string, number>;
} {
  const 출처별최신 = new Map<string, { at: number; findings: StandardFinding[] }>();
  for (const run of history) {
    const real = (run.findings ?? []).filter((f) => !실패한기록(f));
    if (real.length === 0) continue;
    for (const src of new Set(real.map((f) => f.source_tool ?? ""))) {
      const 이번 = real.filter((f) => (f.source_tool ?? "") === src);
      const 있던것 = 출처별최신.get(src);
      if (!있던것 || run.scannedAt >= 있던것.at) 출처별최신.set(src, { at: run.scannedAt, findings: 이번 });
    }
  }
  const 모음: StandardFinding[] = [];
  const 본열쇠 = new Set<string>();
  for (const { findings } of 출처별최신.values()) {
    for (const f of findings) if (!본열쇠.has(열쇠(f))) { 본열쇠.add(열쇠(f)); 모음.push(f); }
  }
  return {
    findings: 모음,
    마지막시각: Math.max(0, ...[...출처별최신.values()].map((v) => v.at)),
    출처: [...출처별최신.keys()].filter(Boolean),
    출처시각: new Map([...출처별최신].map(([k, v]) => [k, v.at])),
  };
}

/**
 * 되살릴 수 있는 자산을 훑는다 — 읽기만 한다.
 *
 * 후보 판정은 "지금 진짜가 0건인가"가 아니라 **"이력에 있는데 지금 없는 것이 있는가"**로 본다.
 *   0건 조건만 보면, 한 출처만 부분 복구된 자산이 후보에서 빠져 나머지를 영영 못 되찾는다
 *   (2026-08-03에 실제로 그렇게 됐다 — 352건짜리 자산이 2건만 돌아온 뒤 후보에서 사라졌다).
 */
export function 잃은취약점찾기(): 잃은자산[] {
  const out: 잃은자산[] = [];
  for (const a of listAssets()) {
    const 모음 = 이력에서모으기(a.scanHistory ?? []);
    const 지금 = new Set((a.findings ?? []).map(열쇠));
    const 없는것 = 모음.findings.filter((f) => !지금.has(열쇠(f)));
    // 지금 목록에 같은 열쇠가 두 벌 있으면 그것도 바로잡을 거리다(내가 만든 중복을 포함해).
    const 중복 = (a.findings ?? []).length - 지금.size;
    if (없는것.length === 0 && 중복 === 0) continue;
    // ⚠ 날짜는 **되살릴 출처의 것**만 본다. 전체 최댓값을 쓰면 7-28 오라클 결과에
    //   오늘 날짜가 붙어, 담당자가 오늘 스캔한 결과로 읽는다(2026-08-03 실측).
    const 되살릴출처 = [...new Set(없는것.map((f) => f.source_tool ?? "").filter(Boolean))];
    out.push({
      assetId: a.id,
      이름: a.displayName || a.name,
      되찾을건수: 없는것.length,
      스캔시각: Math.max(0, ...되살릴출처.map((s) => 모음.출처시각.get(s) ?? 0)) || 모음.마지막시각,
      출처: 되살릴출처,
    });
  }
  return out.sort((x, y) => y.되찾을건수 - x.되찾을건수);
}

export interface 복구결과 {
  되살린자산: number;
  되살린건수: number;
  건너뛴자산: number;
}

/**
 * 실제로 되돌린다. assetIds를 주면 그것만, 비우면 찾은 것 전부.
 *
 * ⚠ 되살린 목록 **끝에 최근 실패 기록을 붙인다.** 감추면 "왜 스캔해도 안 바뀌지?"가 된다.
 *   그리고 recordFindings가 이력에 새 항목을 하나 더 남기므로, 되돌린 사실 자체도 기록에 남는다.
 */
export function 되살리기(assetIds?: string[], actor?: string): 복구결과 {
  const 대상 = 잃은취약점찾기().filter((c) => !assetIds || assetIds.includes(c.assetId));
  let 되살린자산 = 0;
  let 되살린건수 = 0;
  let 건너뛴자산 = 0;

  for (const c of 대상) {
    const a: Asset | undefined = getAsset(c.assetId);
    if (!a) { 건너뛴자산++; continue; }
    const 모음 = 이력에서모으기(a.scanHistory ?? []);
    const 지금 = new Set((a.findings ?? []).map(열쇠));
    const 없는것 = 모음.findings.filter((f) => !지금.has(열쇠(f)));
    const 중복 = (a.findings ?? []).length - 지금.size;
    if (없는것.length === 0 && 중복 === 0) { 건너뛴자산++; continue; }

    // ⚠ 지금 있는 것은 **그대로 둔다**(실패 기록 포함). 되살림은 **더하는 일**이지
    //   갈아치우는 일이 아니다 — 갈아치우면 그 사이 손댄 것이 날아간다.
    //   다만 같은 열쇠가 두 벌이면 하나로 줄인다(먼저 있던 것을 남긴다).
    recordFindings(c.assetId, 중복정리([...(a.findings ?? []), ...없는것]));
    되살린자산++;
    되살린건수 += 없는것.length;

    recordAudit({
      kind: "config",
      actor: actor ?? null,
      action: "잃은 취약점 되살림",
      target: c.이름,
      detail: `${없는것.length}건 — ${new Date(c.스캔시각).toISOString().slice(0, 10)}까지의 점검 이력(${c.출처.join(", ") || "출처 미상"})`,
      result: "ok",
    });
  }
  return { 되살린자산, 되살린건수, 건너뛴자산 };
}

/** 대화창에 그대로 나가는 글 — 미리보기(쓰지 않는다). */
export function 잃은취약점현황글(): string {
  const 후보 = 잃은취약점찾기();
  if (후보.length === 0) {
    return "실패한 스캔에 덮여 잃은 취약점은 없습니다 — 되살릴 것이 없습니다.";
  }
  const 총건 = 후보.reduce((n, c) => n + c.되찾을건수, 0);
  if (총건 === 0) {
    // 되찾을 것은 없고 **같은 취약점이 두 벌인 자산**만 남은 경우다.
    return [
      `되살릴 취약점은 없지만, 같은 취약점이 두 벌로 들어간 자산 ${후보.length}개가 있습니다.`,
      '정리하시려면 "잃은 취약점 되살려줘"라고 말씀해 주세요 — 승인 창이 뜨고, 먼저 있던 것만 남깁니다.',
    ].join("\n");
  }
  const 줄 = 후보.slice(0, 12).map(
    (c) => `- ${c.이름} — ${c.되찾을건수}건 · ${new Date(c.스캔시각).toISOString().slice(0, 10)} 스캔 (${c.출처.join(", ") || "출처 미상"})`
  );
  const 더 = 후보.length > 12 ? `\n… 외 ${후보.length - 12}개 자산` : "";
  return [
    `실패한 스캔에 덮여 잃은 취약점 **${총건}건** (자산 ${후보.length}개)`,
    ...줄,
    더,
    "",
    // ⚠ 되살린 것이 "지금 상태"인 척하지 않는다. 며칠 지난 스캔 결과다.
    "⚠ 되살리면 **그때 스캔한 결과**가 돌아옵니다 — 지금 다시 스캔한 것이 아닙니다. 그 사이 조치했다면 재스캔으로 확인해 주세요.",
    '되돌리시려면 "잃은 취약점 되살려줘"라고 말씀해 주세요 — 승인 창이 뜹니다.',
  ].filter(Boolean).join("\n");
}
