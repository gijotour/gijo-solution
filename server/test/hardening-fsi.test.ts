// 하드닝 점검 ↔ 전자금융기반시설 취약점 평가기준 **대응표**의 짝 시험.
//
// [전중후 계획서: 전-7 「보여 주기」 · 중-7 확장] 사장님 물음 「실제 우리 자산에 점검도
// 가능할까」의 첫 걸음 — 새 점검 엔진 없이, 이미 도는 점검 결과를 금융권 담당자의 말로도
// 읽히게 하는 표 한 장이다.
//
// ■ 이 시험이 막는 사고
//   ① **문서와 표가 어긋나는 것** — 지식 문서(knowledge/…금융_취약점_평가기준.md)의
//      「제품이 잰다」 칸이 대응표의 씨앗이다. 한쪽만 고치면 제품이 문서와 다른 말을 한다.
//   ② **없는 항목을 대응했다고 적는 것** — 대응표의 id가 실제 점검 항목 id가 아니면
//      그 줄은 영원히 아무것도 가리키지 않는데 화면에는 「대응됨」으로 센다.
//   ③ **두 곳에서 따로 세는 것** — 리포트와 축약 답이 각자 세면 같은 점검이 다른 수를 말한다.
//   ④ **「평가기준을 전부 봤다」로 읽히는 것** — 결과 문장에서 「대응된 항목만」이라는 단서와
//      「공식 점검표가 아니다」라는 고지가 떨어져 나가면, 그 자체가 규제 문서에 실릴 거짓이 된다.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  FSI_MAP, FSI_SECTORS, FSI_DISCLAIMER, FSI_SOURCE_DOC, FSI_UNMAPPED_WHY,
  fsiCoverage, fsiCoverageLine, fsiEntryFor, fsiEntriesForStandard,
} from "../src/engine/hardeningfsi";
import { listChecklists, type ScanReport, type ScanStatus } from "../src/engine/hardeningscan";

const 서버뿌리 = path.join(__dirname, "..");
const 저장소뿌리 = path.join(__dirname, "..", "..");

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
      expect(["same", "partial"], e.id + ": 대응 정도는 same·partial뿐").toContain(e.degree);
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

  it("공식 자료가 아니라는 고지를 자료 파일이 들고 있다", () => {
    expect(FSI_DISCLAIMER).toContain("공식");
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

  it("대응 정도는 규칙으로 정해진다 — 국내 CCE(U·PC·N)=같음 · CIS=일부", () => {
    // 손으로 예외를 두기 시작하면 표가 곧 어긋난다. 규칙을 기계가 지킨다.
    for (const e of FSI_MAP) {
      expect(e.degree, e.id + ": " + e.standard + "의 대응 정도 규칙 위반").toBe(e.standard === "cis" ? "partial" : "same");
    }
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
/** 문서의 표에서 「제품이 잰다」로 적힌 줄만 뽑아 {이름, ids}로 돌려준다. */
function 문서의제품이재는줄(): Array<{ label: string; ids: string[] }> {
  const md = fs.readFileSync(path.join(저장소뿌리, FSI_SOURCE_DOC), "utf8");
  const out: Array<{ label: string; ids: string[] }> = [];
  for (const line of md.split(/\r?\n/)) {
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
    out.push({ label: 이름, ids });
  }
  return out;
}

describe("지식 문서 「제품이 잰다」 ↔ 대응표", () => {
  const 줄들 = 문서의제품이재는줄();
  const 문서id = [...new Set(줄들.flatMap((r) => r.ids))];

  it("문서에서 항목 번호가 실제로 읽힌다 — 표 꼴이 바뀌면 여기서 걸린다", () => {
    // 26개(서버 15 · 네트워크 6 · 단말 5). 줄어들면 파싱이 헛돌아 「대조했다」는 거짓이 된다.
    expect(문서id.length, "문서에서 읽은 번호: " + 문서id.join(",")).toBeGreaterThanOrEqual(26);
  });

  it("문서가 「제품이 잰다」고 적은 번호는 전부 대응표에 있다", () => {
    const 표에있는번호 = new Set(FSI_MAP.flatMap((e) => [e.id, e.docId].filter(Boolean) as string[]));
    for (const id of 문서id) {
      expect(표에있는번호.has(id), id + ": 문서는 「제품이 잰다」인데 대응표에 없다 — 문서와 제품이 다른 말을 한다").toBe(true);
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
    expect(fsiEntriesForStandard("cis").every((e) => e.degree === "partial")).toBe(true);
    expect(fsiEntriesForStandard("kisa_net").length).toBe(6);
  });
});

// ── ⑤ 결과 문장 — 한 곳에서 만들고, 정직 단서가 떨어지지 않는다 ──────────────
describe("결과 문장", () => {
  const r = 가짜리포트([["U-01", "PASS"], ["U-02", "FAIL"], ["PC-06", "PASS"]]);

  it("「대응된 항목만」과 「공식 아님」이 문장에서 떨어지지 않는다", () => {
    const line = fsiCoverageLine(r);
    expect(line).toContain("대응된 항목만");
    expect(line).toContain("공식 점검표가 아닙니다");
    expect(line).toContain("표준 항목 3개 중 대응 2개");
    expect(line).toContain("미대응 1");
  });

  it("평가기준 **전체 항목 수**를 지어내지 않는다", () => {
    // 그 수는 그 해 안내서를 열어야 안다(지식 문서 2절). 지어내면 검사에서 그대로 인용된다.
    expect(fsiCoverageLine(r)).toContain("항목 수는 그 해 안내서가 정본");
  });

  it("리포트와 축약 답이 **같은 문장**을 쓴다", async () => {
    const { formatHardeningReport, scanSummaryText } = await import("../src/engine/hardeningscan");
    const line = fsiCoverageLine(r);
    expect(formatHardeningReport(r)).toContain(line);
    expect(scanSummaryText(r)).toContain(line);
  });

  it("문장을 짜는 곳이 hardeningfsi.ts 하나뿐이다", () => {
    // 소스 감시(세 번째면 감시) — 다른 파일이 손으로 같은 문장을 짜면 곧 다른 수를 말한다.
    const 짓는곳: string[] = [];
    const 훑기 = (dir: string) => {
      for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, f.name);
        if (f.isDirectory()) 훑기(p);
        else if (f.name.endsWith(".ts") && fs.readFileSync(p, "utf8").includes("중 대응 ${")) 짓는곳.push(path.relative(서버뿌리, p).replace(/\\/g, "/"));
      }
    };
    훑기(path.join(서버뿌리, "src"));
    expect(짓는곳).toEqual(["src/engine/hardeningfsi.ts"]);
  });

  it("화면 안내(screenguide)가 「공식 아님」을 함께 말한다", () => {
    const 안내 = fs.readFileSync(path.join(서버뿌리, "src", "engine", "screenguide.ts"), "utf8");
    const 시작 = 안내.indexOf("\"hardening.html\"");
    const 끝 = 안내.indexOf("\"maintenance.html\"", 시작);
    const 패널 = 안내.slice(시작, 끝);
    expect(패널).toContain("금융 평가기준 대응");
    expect(패널).toContain("공식");
  });
});
