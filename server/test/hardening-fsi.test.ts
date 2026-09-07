// 하드닝 점검 ↔ 전자금융기반시설 취약점 평가기준 **대응표**의 짝 시험.
//
// [전중후 계획서: 전-7 「보여 주기」 · 중-7 확장] 사장님 물음 「실제 우리 자산에 점검도
// 가능할까」의 첫 걸음 — 새 점검 엔진 없이, 이미 도는 점검 결과를 금융권 담당자의 말로도
// 읽히게 하는 표 한 장이다.
//
// ■ 이 시험이 막는 사고
//   ① **문서와 표가 어긋나는 것** — 지식 문서(knowledge/…금융_취약점_평가기준.md)의
//      「제품이 잰다」 칸이 대응표의 씨앗이다. 한쪽만 고치면 제품이 문서와 다른 말을 한다.
//      ⚠ 번호가 적힌 줄만 대조하던 판(2026-09-08 검토관 적발)에서는 CIS 7줄의 **항목 이름**과
//        모든 줄의 **부문**을 아무도 안 봤다 — SSH-01의 이름을 「웹 통신 구간 암호화」로,
//        U-01의 부문을 「임직원 단말」로 바꿔도 21개가 전부 초록이었다. 이제 이름·부문 둘 다
//        문서에서 읽어 대조한다(아래 ③).
//   ② **없는 항목을 대응했다고 적는 것** — 대응표의 id가 실제 점검 항목 id가 아니면
//      그 줄은 영원히 아무것도 가리키지 않는데 화면에는 「대응됨」으로 센다.
//   ③ **두 곳에서 따로 세는 것** — 리포트와 축약 답이 각자 세면 같은 점검이 다른 수를 말한다.
//   ④ **「평가기준을 전부 봤다」로 읽히는 것** — 결과 문장에서 「이름이 지어진 항목만」이라는
//      단서와 「공식 점검표가 아니다」라는 고지가 떨어져 나가면, 그 자체가 규제 문서에 실릴
//      거짓이 된다.
//   ⑤ **약속만 있고 출력이 없는 것** — 화면 안내가 「부문·항목으로 읽는 자리」라고 말하면
//      리포트에 그 표가 실제로 나와야 한다(2026-09-08 검토관: 자료 파일에만 있었다).
//   ⑥ **덜 재는 부분이 이름표에 덮이는 것** — 문서가 「돌고 쌓인다」를 양호로 적은 자리를
//      제품이 「돌기만」 보는데 이름만 이으면, 이름이 거짓을 덮는다. gap은 반드시 출력에 실린다.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  FSI_MAP, FSI_SECTORS, FSI_DISCLAIMER, FSI_SOURCE_DOC, FSI_UNMAPPED_WHY, FSI_ABSENT_SECTORS,
  fsiCoverage, fsiCoverageLine, fsiEntryFor, fsiEntriesForStandard,
  fsiCriterionRollup, fsiSectionLines, fsiAttentionLine,
} from "../src/engine/hardeningfsi";
import { listChecklists, type ScanReport, type ScanStatus } from "../src/engine/hardeningscan";
import { getScreenGuide } from "../src/engine/screenguide";

const 서버뿌리 = path.join(__dirname, "..");
const 저장소뿌리 = path.join(__dirname, "..", "..");
const 자료원문 = JSON.parse(
  fs.readFileSync(path.join(서버뿌리, "src", "engine", "hardening-fsi-map.json"), "utf8"),
) as Record<string, unknown>;

/** 점검 엔진이 실제로 들고 있는 항목 id 전부(표준 4종 합) — 대응표가 가리켜도 되는 유일한 집합. */
const 실제항목: Map<string, string> = new Map(
  listChecklists().flatMap((s) => s.items.map((i) => [i.id, s.id] as [string, string])),
);

// ── ① 자료 파일 스키마 ────────────────────────────────────────────────────────
describe("대응표 자료 파일 — 스키마", () => {
  it("모든 줄이 필수 칸을 갖추고 값이 정해진 범위 안에 있다", () => {
    expect(FSI_MAP.length).toBeGreaterThan(0);
    const 허용표준 = new Set(["kisa", "cis", "kisa_pc", "kisa_net"]);
    for (const e of FSI_MAP) {
      expect(typeof e.id).toBe("string");
      expect(e.id.length).toBeGreaterThan(0);
      expect(허용표준.has(e.standard), e.id + ": 모르는 표준 " + e.standard).toBe(true);
      expect(Object.keys(FSI_SECTORS), e.id + ": 부문 코드가 sectors 표에 없다").toContain(e.sector);
      expect(typeof e.criterion).toBe("string");
      expect(e.criterion.trim().length).toBeGreaterThan(0);
    }
  });

  it("id가 겹치지 않는다 — 겹치면 한 항목을 두 번 세게 된다", () => {
    const ids = FSI_MAP.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("평가기준 **항목 번호를 적지 않는다** — 해마다 개정돼 미확인이기 때문", () => {
    // 지식 문서 2·13절: 「세 자리 번호는 알려진 예시일 뿐, 그 해 안내서가 정본」.
    // 표에 번호 칸을 만들면 다음 해에 조용히 틀린 번호를 말하게 된다.
    for (const e of FSI_MAP) {
      expect(Object.keys(e), e.id + ": 번호 칸을 만들지 않는다").not.toContain("criterionNo");
      expect(/\b\d{3}\b/.test(e.criterion), e.id + ": 항목 이름에 세 자리 번호가 섞였다").toBe(false);
    }
  });

  it("**「대응 정도」 칸을 되살리지 않는다** — 재지 않은 구분은 적지 않는다", () => {
    // 첫 판(2026-09-08.1)의 degree(same/partial)는 standard에서 100% 유도된 값이었고, 뜻마저
    // 틀렸다 — U-01과 SSH-01은 `grep PermitRootLogin` 같은 명령·같은 판정, U-72와 LOG-01은
    // `systemctl is-active rsyslog` 한 줄로 **똑같은** 점검인데 하나는 「같음」, 하나는 「일부」였다.
    // 정도를 말하려면 항목마다 재야 한다. 그 전에는 standard 칸이 사실의 전부다.
    for (const e of FSI_MAP) {
      expect(Object.keys(e), e.id + ": 대응 정도 칸을 되살렸다 — 근거(noDegreeWhy)를 먼저 뒤집을 것").not.toContain("degree");
    }
    expect(Object.keys(자료원문)).not.toContain("degreeRule");
    expect(String(자료원문.noDegreeWhy ?? "")).toContain("SSH-01");
  });

  it("덜 재는 부분(gap)은 빈 문자열이 아니고, 그 항목 이름으로 시작한다", () => {
    const gap있는줄 = FSI_MAP.filter((e) => e.gap);
    expect(gap있는줄.length, "실측으로 확인한 gap이 하나도 없다 — 문서 잣대와 코드를 맞대 본 적이 없다는 뜻").toBeGreaterThan(0);
    for (const e of gap있는줄) {
      expect(e.gap!.trim().length, e.id + ": gap이 비었다").toBeGreaterThan(10);
      expect(e.gap!.startsWith(e.criterion), e.id + ": gap 첫머리에 어느 평가기준 항목 얘기인지 적는다").toBe(true);
    }
    expect(String(자료원문.gapRule ?? "")).toContain("hardeningscan.ts");
  });

  it("자료 파일이 설치본에 실린다 — **정적 import**라 tsc가 dist로 함께 옮긴다", () => {
    // ⚠ 왜 시험으로 못박나: onto-aliases-ko.json과 같은 방식이라 copy-assets.mjs에 등록하지
    //   않았다(실측 2026-09-08: npm run build 뒤 dist/engine/hardening-fsi-map.json 생김).
    //   누군가 이것을 assetPath로 **런타임에 읽는 꼴**로 바꾸면 tsc가 더는 안 옮기고,
    //   설치본에서 조용히 대응표 0줄이 된다 — 화면은 「미대응 36」이라 적고 아무도 이유를 모른다.
    //   그렇게 바꾸려면 copy-assets.mjs에 함께 등록해야 한다. 이 시험이 그 갈림길을 지킨다.
    const 소스 = fs.readFileSync(path.join(서버뿌리, "src", "engine", "hardeningfsi.ts"), "utf8");
    expect(소스).toContain("from \"./hardening-fsi-map.json\"");
    expect(소스).not.toContain("assetPath(");
  });

  it("공식 자료가 아니라는 고지와 **없는 부문** 설명을 자료 파일이 들고 있다", () => {
    expect(FSI_DISCLAIMER).toContain("공식");
    expect(FSI_ABSENT_SECTORS).toContain("데이터베이스");
    expect(FSI_SOURCE_DOC).toBe("knowledge/GIJO_지식_금융_취약점_평가기준.md");
    expect(fs.existsSync(path.join(저장소뿌리, FSI_SOURCE_DOC))).toBe(true);
  });
});

// ── ② 대응표 id ⊆ 실제 점검 항목 id ──────────────────────────────────────────
describe("대응표 ↔ 점검 엔진", () => {
  it("대응표의 모든 id가 hardeningscan의 실제 항목이다", () => {
    for (const e of FSI_MAP) {
      expect(실제항목.has(e.id), e.id + ": 점검 엔진에 없는 항목을 가리킨다").toBe(true);
    }
  });

  it("대응표가 적은 표준이 그 항목의 실제 표준과 같다", () => {
    for (const e of FSI_MAP) expect(실제항목.get(e.id), e.id + ": 표준이 어긋난다").toBe(e.standard);
  });

  it("표에 없는 항목은 「미대응」이며, 왜 안 올렸는지가 적혀 있다", () => {
    const 미대응 = [...실제항목.keys()].filter((id) => !fsiEntryFor(id));
    expect(미대응.length).toBeGreaterThan(0); // 「전부 대응됐다」는 지금 사실이 아니다
    for (const id of 미대응) {
      expect(Object.keys(FSI_UNMAPPED_WHY), id + ": 대응표에도 없고 이유도 없다 — 빠뜨린 것인지 안 올린 것인지 알 수 없다").toContain(id);
    }
  });
});

// ── ③ 지식 문서 「제품 대응」 칸과 기계 대조 ─────────────────────────────────
/** 문서의 표에서 「제품이 잰다」로 적힌 줄만 뽑아 {이름, ids, 부문}으로 돌려준다. */
function 문서의제품이재는줄(): Array<{ label: string; ids: string[]; sector: string | null }> {
  const md = fs.readFileSync(path.join(저장소뿌리, FSI_SOURCE_DOC), "utf8");
  // 절 제목이 곧 **부문**이다 — 표의 줄이 어느 절에 있는지가 sector 칸의 원천이다.
  const 절부문: Record<string, string> = { "6": "tech_server", "7": "tech_network", "10": "tech_endpoint" };
  const out: Array<{ label: string; ids: string[]; sector: string | null }> = [];
  let 지금부문: string | null = null;
  for (const line of md.split(/\r?\n/)) {
    const 절 = /^##\s+(\d+)\./.exec(line);
    if (절) { 지금부문 = 절부문[절[1]] ?? null; continue; }
    if (!line.trim().startsWith("|")) continue;
    const cells = line.split("|").map((c) => c.trim()).filter((c, i, a) => !(c === "" && (i === 0 || i === a.length - 1)));
    if (cells.length < 3) continue;
    if (cells[cells.length - 1] !== "제품이 잰다") continue; // 「사람이 본다」·「제품이 받아 관리한다」는 제외
    const 라벨 = cells[0];
    const ids = 라벨.match(/[A-Z]{1,5}-\d{1,3}[a-z]?/g) ?? [];
    // 번호 묶음 괄호만 걷어낸다 — 남는 것이 평가기준 쪽 항목 이름이다.
    const 이름 = 라벨
      .replace(/\(([^)]*)\)/g, (m, inner: string) =>
        /^[A-Z]{1,5}-\d{1,3}[a-z]?(·[A-Z]{1,5}-\d{1,3}[a-z]?)*$/.test(inner.trim()) ? "" : m)
      .trim();
    out.push({ label: 이름, ids, sector: 지금부문 });
  }
  return out;
}

describe("지식 문서 「제품이 잰다」 ↔ 대응표", () => {
  const 줄들 = 문서의제품이재는줄();
  const 문서id = [...new Set(줄들.flatMap((r) => r.ids))];
  /** 문서 줄 이름 → 그 이름이 놓인 부문(같은 이름이 여러 절에 있으면 여럿). */
  const 이름별부문 = new Map<string, Set<string>>();
  for (const r of 줄들) {
    if (!r.sector) continue;
    if (!이름별부문.has(r.label)) 이름별부문.set(r.label, new Set());
    이름별부문.get(r.label)!.add(r.sector);
  }

  it("문서에서 항목 번호가 실제로 읽힌다 — 표 꼴이 바뀌면 여기서 걸린다", () => {
    // 26개(서버 15 · 네트워크 6 · 단말 5). 줄어들면 파싱이 헛돌아 「대조했다」는 거짓이 된다.
    expect(문서id.length, "문서에서 읽은 번호: " + 문서id.join(",")).toBeGreaterThanOrEqual(26);
  });

  it("문서에서 부문(절)이 실제로 읽힌다 — 절 제목이 바뀌면 여기서 걸린다", () => {
    expect([...이름별부문.keys()].length, "문서에서 읽은 줄 이름 수").toBeGreaterThanOrEqual(11);
    expect(new Set([...이름별부문.values()].flatMap((s) => [...s])).size, "세 부문이 다 읽혀야 한다").toBe(3);
  });

  it("문서가 「제품이 잰다」고 적은 번호는 전부 대응표에 있다", () => {
    const 표에있는번호 = new Set(FSI_MAP.flatMap((e) => [e.id, e.docId].filter(Boolean) as string[]));
    for (const id of 문서id) {
      expect(표에있는번호.has(id), id + ": 문서는 「제품이 잰다」인데 대응표에 없다 — 문서와 제품이 다른 말을 한다").toBe(true);
    }
  });

  it("**대응표의 모든 줄**이 문서의 「제품이 잰다」 이름을 그대로 쓴다 — 번호 없는 줄(CIS 7개)도", () => {
    // ⚠ 번호가 적힌 줄만 보던 판에서는 SSH-01·ACCT-01·LOG-01·TIME-01·FW-01·UPD-01·SVC-01의
    //   이름을 아무도 안 봤다. 그 일곱은 문서가 U-번호로만 적었거나(앞 셋) 번호가 아예 없는
    //   줄(뒤 넷)에 붙어, 문서가 하지 않은 대응 주장을 표가 대신 하고 있었다.
    const 문서이름 = new Set(줄들.map((r) => r.label));
    for (const e of FSI_MAP) {
      expect(문서이름.has(e.criterion), e.id + ": 「" + e.criterion + "」은 문서의 「제품이 잰다」 줄에 없는 이름이다").toBe(true);
    }
  });

  it("**부문(sector)도 문서에서 온다** — 표가 제 마음대로 부문을 옮기지 못한다", () => {
    for (const e of FSI_MAP) {
      const 문서부문 = 이름별부문.get(e.criterion);
      expect(문서부문, e.id + ": 문서에서 그 이름의 부문을 못 찾았다").toBeTruthy();
      expect([...문서부문!], e.id + ": 대응표 부문이 문서의 절과 어긋난다").toContain(e.sector);
    }
  });

  it("같은 줄의 번호들은 대응표에서 **같은 평가기준 항목 이름**을 가리킨다", () => {
    for (const r of 줄들) {
      if (!r.ids.length) continue; // 번호 없는 줄(로그 도착 여부 등)은 하드닝 항목이 아니다
      for (const id of r.ids) {
        const 줄 = FSI_MAP.filter((e) => e.id === id || e.docId === id);
        expect(줄.length, id + ": 대응표에 없다").toBeGreaterThan(0);
        for (const e of 줄) {
          expect(e.criterion, id + ": 문서 줄 이름과 대응표 항목 이름이 어긋난다").toBe(r.label);
        }
      }
    }
  });

  it("문서가 「사람이 본다」로 적은 것은 대응표에 없다", () => {
    // 실측: PC-06(승인 프로그램 대조)은 사내 승인 목록이 제품 안에 없어 절반만 자동이다.
    expect(fsiEntryFor("PC-06")).toBeUndefined();
  });
});

// ── ④ 계수 함수 — 세는 곳은 한 곳 ────────────────────────────────────────────
function 가짜리포트(items: Array<[string, ScanStatus]>): ScanReport {
  return {
    standard: "kisa", standardLabel: "테스트", target: "t", ranOn: "self",
    startedAt: new Date().toISOString(), durationMs: 1,
    items: items.map(([id, status]) => ({ id, cat: "c", title: "t", ref: "r", remediation: "m", status, evidence: "e" })),
    summary: { total: items.length, pass: 0, fail: 0, warn: 0, na: 0, scored: 0, rate: 0, verdict: "" },
  };
}

describe("계수 — 양호·취약·미측정·미대응", () => {
  it("대응된 항목만 세고, 확인필요·해당없음은 미측정으로 간다", () => {
    const c = fsiCoverage(가짜리포트([
      ["U-01", "PASS"], ["U-02", "FAIL"], ["U-07", "WARN"], ["U-08", "NA"],
      ["PC-06", "PASS"], // 미대응 — 양호여도 대응 계산에 안 들어간다
    ]));
    expect(c).toEqual({ total: 5, mapped: 4, unmapped: 1, pass: 1, fail: 1, unmeasured: 2 });
  });

  it("미대응 항목의 양호가 대응 쪽 양호로 새지 않는다", () => {
    const c = fsiCoverage(가짜리포트([["PC-06", "PASS"], ["PC-07", "PASS"]]));
    expect(c.mapped).toBe(0);
    expect(c.pass).toBe(0);
    expect(c.unmapped).toBe(2);
  });

  it("표준별로 대응 수를 셀 수 있다", () => {
    expect(fsiEntriesForStandard("kisa_net").length).toBe(6);
    expect(fsiEntriesForStandard("cis").length).toBe(7);
  });
});

// ── ⑤ 부문 › 항목 표 — 「우리 번호를 모르는 분과 같은 표를 본다」의 실체 ──────
describe("부문 › 평가기준 항목 표", () => {
  it("같은 평가기준 항목에 걸린 점검 항목이 **한 줄로 묶이고**, 취약이 하나면 그 줄은 취약이다", () => {
    const rows = fsiCriterionRollup(가짜리포트([
      ["U-01", "PASS"], ["SSH-01", "FAIL"],     // 같은 이름 — 한 줄
      ["N-33", "WARN"],                          // 미측정
      ["PC-03", "PASS"],
      ["PC-06", "PASS"],                         // 이름 없음 — 표에 안 나온다
    ]));
    const 접속 = rows.find((r) => r.criterion === "관리자 원격 접속 제한")!;
    expect(접속.ids).toEqual(["U-01", "SSH-01"]);
    expect(접속.verdict).toBe("취약");
    expect(rows.find((r) => r.criterion === "대리 응답 기능 차단")!.verdict).toBe("미측정");
    expect(rows.find((r) => r.criterion === "복구 콘솔 자동 로그온 금지")!.verdict).toBe("양호");
    expect(rows.some((r) => r.ids.includes("PC-06"))).toBe(false);
    // 부문 차례는 자료 파일의 sectors 차례(서버 → 네트워크 → 단말)
    expect(rows.map((r) => r.sector)).toEqual(["tech_server", "tech_network", "tech_endpoint"]);
  });

  it("리포트 절에 **부문 이름과 평가기준 항목 이름이 실제로 찍힌다**", () => {
    // ⚠ 2026-09-08 검토관 적발: 계수 한 줄만 내던 판에서는 sector·criterion이 자료 파일 안에서만
    //   살아 있었다 — 화면 안내는 「부문·항목으로 읽는 자리」라고 말하는데 출력엔 한 글자도 없었다.
    const md = fsiSectionLines(가짜리포트([["U-01", "FAIL"], ["N-34", "PASS"], ["PC-06", "PASS"]])).join("\n");
    expect(md).toContain("## 금융보안원 평가기준 대응");
    expect(md).toContain(FSI_SECTORS["tech_server"]);
    expect(md).toContain(FSI_SECTORS["tech_network"]);
    expect(md).toContain("관리자 원격 접속 제한");
    expect(md).toContain("내부를 알려 주는 응답 차단");
    expect(md).toContain("✗ 취약");
    // 이름 못 지은 항목은 이유까지 적는다
    expect(md).toContain("이름을 못 지은 항목 1개");
    expect(md).toContain(FSI_UNMAPPED_WHY["PC-06"]);
    // 없는 부문을 「전체 커버리지」로 읽지 않게 한다
    expect(md).toContain("데이터베이스");
  });

  it("**덜 재는 부분(gap)이 결과에 그대로 실린다** — 이름표가 거짓을 덮지 않는다", () => {
    const gap있는줄 = FSI_MAP.filter((e) => e.gap);
    const md = fsiSectionLines(가짜리포트(gap있는줄.map((e) => [e.id, "PASS"] as [string, ScanStatus]))).join("\n");
    for (const e of gap있는줄) expect(md, e.id + ": gap을 적어 두고 출력엔 안 실었다").toContain(e.gap!);
  });

  it("gap이 없는 점검에는 「덜 재는 부분」 머리말을 띄우지 않는다", () => {
    const md = fsiSectionLines(가짜리포트([["U-02", "PASS"]])).join("\n");
    expect(md).not.toContain("덜 재는 부분");
  });

  it("축약 답 한 줄이 **손댈 항목을 부문·이름으로** 부른다", () => {
    const line = fsiAttentionLine(가짜리포트([["U-01", "FAIL"], ["U-02", "PASS"]]))!;
    expect(line).toContain("관리자 원격 접속 제한");
    expect(line).toContain("U-01");
    expect(line).toContain("서버·운영체제");
    const 전부양호 = fsiAttentionLine(가짜리포트([["U-02", "PASS"]]))!;
    expect(전부양호).toContain("모두 양호");
    expect(fsiAttentionLine(가짜리포트([["PC-06", "PASS"]])), "이름 지은 항목이 하나도 없으면 부를 이름도 없다").toBeNull();
  });
});

// ── ⑥ 결과 문장 — 한 곳에서 만들고, 정직 단서가 떨어지지 않는다 ──────────────
describe("결과 문장", () => {
  const r = 가짜리포트([["U-01", "PASS"], ["U-02", "FAIL"], ["PC-06", "PASS"]]);

  it("「이름이 지어진 항목만」과 「공식 아님」이 문장에서 떨어지지 않는다", () => {
    const line = fsiCoverageLine(r);
    expect(line).toContain("이름이 지어진 항목만");
    expect(line).toContain("공식 점검표가 아닙니다");
    expect(line).toContain("이번 점검 항목 3개 가운데 평가기준 이름을 지은 것 2개");
    expect(line).toContain("이름 없음 1개");
  });

  it("「대응 N개 … 미대응 0」으로 **전량 대응**처럼 읽히지 않는다", () => {
    // ⚠ 2026-09-08 검토관 적발: 문장이 이름 댄 표준은 평가기준뿐이라 「표준 항목 15개 중 대응
    //   15개 … 미대응 0」이 「평가기준 15개를 다 대응했고 빠진 것 0」으로 읽혔다.
    const 전부대응 = fsiCoverageLine(가짜리포트([["U-01", "PASS"], ["U-02", "PASS"]]));
    expect(전부대응).not.toContain("미대응 0");
    expect(전부대응).toContain("이번 점검 항목");
  });

  it("축약 답에서 **같은 이름표로 다른 수**를 나란히 찍지 않는다", async () => {
    // 바로 윗줄이 「✓ 양호 8 · ✗ 취약 0 …」인데 이 줄도 「✓ 양호 6」이면 8과 6이 무엇으로
    //   갈리는지 글 안에 없다. 이 줄은 「그 N개만 세면 양호 …」로 말한다.
    const line = fsiCoverageLine(r);
    expect(line).not.toContain("✓ 양호");
    expect(line).toContain("개만 세면 양호");
  });

  it("평가기준 **전체 항목 수**를 지어내지 않는다", () => {
    // 그 수는 그 해 안내서를 열어야 안다(지식 문서 2절). 지어내면 검사에서 그대로 인용된다.
    expect(fsiCoverageLine(r)).toContain("평가기준 항목 수는 그 해 안내서가 정본");
  });

  it("리포트와 축약 답이 **같은 문장**을 쓴다", async () => {
    const { formatHardeningReport, scanSummaryText } = await import("../src/engine/hardeningscan");
    const line = fsiCoverageLine(r);
    expect(formatHardeningReport(r)).toContain(line);
    expect(scanSummaryText(r)).toContain(line);
    // 부문 표는 리포트에, 손댈 항목 한 줄은 축약 답에.
    expect(formatHardeningReport(r)).toContain(fsiSectionLines(r).join("\n"));
    expect(scanSummaryText(r)).toContain(fsiAttentionLine(r)!);
  });

  it("문장·표를 짜는 곳이 hardeningfsi.ts 하나뿐이다", () => {
    // 소스 감시(세 번째면 감시) — 다른 파일이 손으로 같은 문장을 짜면 곧 다른 수를 말한다.
    const 표식 = ["평가기준 이름을 지은 것 ${", "push(`## 금융보안원 평가기준 대응"];
    for (const 표 of 표식) {
      const 짓는곳: string[] = [];
      const 훑기 = (dir: string) => {
        for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
          const p = path.join(dir, f.name);
          if (f.isDirectory()) 훑기(p);
          else if (f.name.endsWith(".ts") && fs.readFileSync(p, "utf8").includes(표)) 짓는곳.push(path.relative(서버뿌리, p).replace(/\\/g, "/"));
        }
      };
      훑기(path.join(서버뿌리, "src"));
      expect(짓는곳, "「" + 표 + "」를 짓는 곳").toEqual(["src/engine/hardeningfsi.ts"]);
    }
  });

  it("**라이트(단독 PC)에서도 고지가 따라간다** — 축약 답이 그대로 최종 답이기 때문", async () => {
    // 라이트는 이 도구를 directAnswer로 쓴다(재요약 없이 답이 된다). 화면 안내(screenguide 구역)는
    // 라이트 화면에 닿지 않으므로, **문장 자체가** 세 경고를 안고 가야 한다.
    const lite = JSON.parse(fs.readFileSync(path.join(서버뿌리, "src", "lite", "lite-tools.json"), "utf8")) as string;
    expect(JSON.stringify(lite), "라이트가 하드닝 점검을 더 이상 안 쓰면 이 시험의 전제가 바뀐다").toContain("run_hardening_scan");
    const { scanSummaryText } = await import("../src/engine/hardeningscan");
    const t = scanSummaryText(r);
    expect(t).toContain("공식 점검표가 아닙니다");
    expect(t).toContain("이름이 지어진 항목만");
  });
});

// ── ⑦ 화면 안내 — 약속과 출력이 같은가 ───────────────────────────────────────
describe("화면 안내(screenguide) ↔ 출력", () => {
  // ⚠ 2026-09-08 검토관 적발: 예전 시험은 소스 텍스트를 `indexOf("\"hardening.html\"")`로 잘랐는데
  //   그 첫 등장이 GUIDES가 아니라 PANEL_ALIASES라 **1,098행을 통째로** 훑었다. 구역을 지워도,
  //   다른 화면으로 옮겨도 초록이었다(실측). 이제 화면 열쇠로 **실제 구역 글**을 받아 본다.
  const 패널 = getScreenGuide("hardening.html").panels?.["금융 평가기준 대응"];

  it("하드닝 화면에 「금융 평가기준 대응」 구역이 있다 — 다른 화면이 아니라 여기", () => {
    expect(패널, "hardening.html에 그 구역이 없다").toBeTruthy();
  });

  it("세 경고(공식 아님 · 번호 미표기 · 이름 지은 항목만)가 구역 글에 있다", () => {
    expect(패널!).toContain("공식 점검표도, 공식 대응표도 아닙니다");
    expect(패널!).toContain("항목 번호는 적지 않습니다");
    expect(패널!).toContain("이름이 지어진 항목만");
    expect(패널!).toContain("덜 재는 부분");
  });

  it("구역이 약속한 **자리와 이름**이 실제 출력에 있다", async () => {
    const { formatHardeningReport } = await import("../src/engine/hardeningscan");
    const md = formatHardeningReport(가짜리포트([["U-01", "PASS"], ["SSH-01", "PASS"]]));
    expect(패널!, "구역 글이 절 제목을 인용한다").toContain("「## 금융보안원 평가기준 대응」");
    expect(md, "인용한 절 제목이 리포트에 없다 — 약속과 출력이 어긋난다").toContain("## 금융보안원 평가기준 대응");
    // 구역이 예로 든 부문·항목·번호가 실제로 그 표에 찍힌다.
    expect(패널!).toContain("기술적 보안 — 서버·운영체제");
    expect(md).toContain("기술적 보안 — 서버·운영체제");
    expect(md).toContain("| 관리자 원격 접속 제한 |");
    expect(md).toContain("U-01 · SSH-01");
  });

  it("구역이 「맨 아래」처럼 **틀린 자리**를 말하지 않는다", () => {
    // 실제 자리는 「## 요약」 안(한 줄) + 항목표 뒤의 대응 절이다. 맨 아래가 아니다.
    expect(패널!).not.toContain("맨 아래");
  });

  it("새 구역 이름이 지식 물음을 가로채지 않는다 — 야간 회귀 ⑱", async () => {
    // 구역 이름 자체도 매칭면이다(resolvePanelHit 첫 훑기). 「금융 취약점 평가기준 항목 알려줘」가
    // 화면 안내로 새면 지식 답이 죽는다.
    const { isHelpIntent } = await import("../src/engine/screenguide");
    expect(isHelpIntent("금융 취약점 평가기준 항목 알려줘", "hardening.html")).toBe(false);
    expect(isHelpIntent("전자금융기반시설 평가기준이 뭐야", "hardening.html")).toBe(false);
  });
});
