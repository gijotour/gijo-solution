// 반입 영수증 — **내가 넣은 모든 파일이 내 문서에서 보이는가** (2026-08-22 신설).
//
// ■ 왜 생겼나 — 사장님 「사용자가 넣는 파일 내문서에서 다 확인 가능해야 해. **취약점파일도**」
//   설계관 실측으로 **넷이 아무 흔적도 안 남기고 있었다**:
//     · 자동 취약점(Nessus CSV·XML·JSON·HTML) — 자산·findings로는 가는데 원본도 문서행도 없다
//     · SBOM — 검수 결과만 남고 **우리가 검수한 그 파일**이 없다(라이선스 분쟁 때 못 낸다)
//     · 사용자 지정 vulnreport 중 Nessus HTML 갈래
//     · ★ **유형 결정 카드를 무시하면 감사 기록조차 없었다** — 파일을 올렸는데 아무 데도 없다
//
// ⚠ 이 시험이 지키는 것은 「표가 있다」가 아니라 **「지식에 안 들어가는 갈래도 기록된다」**이다.
//   그게 이 기능의 존재 이유이고, 그 갈래는 원리상 문서 목록에 안 뜬다.
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { 영수증남기기, 영수증목록, 보관총량, 갈래이름 } from "../src/engine/uploadreceipt";

const 서버루트 = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

describe("반입 영수증 — 넣은 사실은 갈래와 무관하게 남는다", () => {
  it("★★ 지식에 **안 들어가는** 갈래도 기록된다 — 이게 이 기능의 전부다", () => {
    const 이름 = `시험_취약점스캔_${Date.now()}.csv`;
    영수증남기기({
      filename: 이름, kind: "vulnreport", routedTo: "vulnscan", decidedBy: "auto",
      originalSaved: false, mdSaved: false, ingested: false,   // ← 셋 다 false가 정상인 갈래다
      bytes: 12345, detail: "Nessus CSV — 자산 3대 · 취약점 12건",
    });
    const 찾음 = 영수증목록(50).find((r) => r.filename === 이름);
    expect(찾음, "취약점 파일이 영수증에 없다 — 「내가 뭘 올렸더라」에 답할 수 없다").toBeTruthy();
    expect(찾음!.ingested, "취약점 표는 지식에 안 넣는 것이 옳다").toBe(false);
    expect(찾음!.routedTo).toBe("vulnscan");
  });

  it("★ 되묻는 중(유형 미정)도 기록된다 — 그전엔 감사조차 없었다", () => {
    const 이름 = `시험_애매한파일_${Date.now()}.dat`;
    영수증남기기({
      filename: 이름, kind: "unknown", routedTo: "decision", decidedBy: "auto",
      originalSaved: false, mdSaved: false, ingested: false,
      detail: "유형을 되물었습니다 — 아직 반영되지 않았습니다",
    });
    const 찾음 = 영수증목록(50).find((r) => r.filename === 이름);
    expect(찾음, "결정 카드를 무시하면 파일을 올린 사실 자체가 사라진다").toBeTruthy();
    expect(찾음!.routedTo).toBe("decision");
  });

  it("★ 같은 이름을 두 번 올리면 **두 줄**이다 — 영수증은 사건 기록이다", () => {
    // ⚠ 문서 쪽 계약은 「같은 이름 = 같은 문서」(basename 1:1, 커밋 132f19c6)다.
    //   영수증에 그 계약을 그대로 쓰면 **두 번째 반입이 첫 기록을 덮어** 기록이 사라진다.
    //   그래서 PK가 uuid다. 두 계약이 서로를 안 건드린다.
    const 이름 = `시험_같은이름_${Date.now()}.pdf`;
    영수증남기기({ filename: 이름, kind: "document", routedTo: "memory", originalSaved: true, mdSaved: true, ingested: true });
    영수증남기기({ filename: 이름, kind: "document", routedTo: "memory", originalSaved: false, mdSaved: true, ingested: true });
    const 둘 = 영수증목록(100).filter((r) => r.filename === 이름);
    expect(둘.length, "두 번 올렸으면 두 줄이어야 한다 — 덮으면 기록이 사라진다").toBe(2);
  });

  it("★ 누가 갈래를 정했는지 남는다 — 「이 문서를 사내규정으로 분류한 것은 누구인가」", () => {
    const 이름 = `시험_사람지정_${Date.now()}.md`;
    영수증남기기({
      filename: 이름, kind: "guideline", routedTo: "memory", decidedBy: "user",
      category: "사내규정", originalSaved: false, mdSaved: true, ingested: true,
    });
    const 찾음 = 영수증목록(50).find((r) => r.filename === 이름);
    expect(찾음!.decidedBy, "사람이 고른 것과 제품이 판별한 것은 구분돼야 한다").toBe("user");
    expect(찾음!.category).toBe("사내규정");
  });

  it("보관 총량을 센다 — 상한을 지금 정하지 않는 대신 근거를 모은다", () => {
    const 총 = 보관총량();
    expect(총.건수).toBeGreaterThan(0);
    expect(총.전체바이트).toBeGreaterThanOrEqual(0);
    expect(총.원본보관바이트).toBeLessThanOrEqual(총.전체바이트);
  });

  it("★ 갈래 이름이 한 곳에만 있다 — 화면이 사본을 만들면 반드시 어긋난다", () => {
    // TYPE_LABEL 사본 3벌 함정(2026-08-21)을 여기서 되풀이하지 않는다.
    for (const k of ["vulnreport", "sbom", "securitylog", "document"]) {
      expect(갈래이름[k as keyof typeof 갈래이름], `${k}의 사람 말 이름이 없다`).toBeTruthy();
    }
  });
});

describe("반입 경로가 영수증을 실제로 남기는가 — 소스 계약", () => {
  const 업로드 = fs.readFileSync(path.join(서버루트, "src", "engine", "autoupload.ts"), "utf8");

  it("★★ 되묻는 중에도 남긴다 — 감사는 건너뛰지만 영수증은 남아야 한다", () => {
    // 감사(recordAudit)는 「행위가 확정됐을 때만」이 옳다. 그런데 그 가드가 영수증까지 막으면
    // **파일을 올린 사실 자체가 사라진다** — 이 기능이 막으려는 그 구멍이다.
    expect(업로드, "영수증을 남기는 코드가 없다").toMatch(/영수증남기기\s*\(/);
    // 영수증 호출이 `if (!되묻는중)` 블록 **밖**에 있어야 한다.
    const 감사블록 = 업로드.indexOf("if (!되묻는중)");
    const 영수증호출 = 업로드.indexOf("영수증남기기({");
    expect(감사블록, "감사 가드를 못 찾았다 — 이 시험이 헛돈다").toBeGreaterThan(0);
    expect(영수증호출, "영수증 호출을 못 찾았다").toBeGreaterThan(감사블록);
  });

  it("★ 회사 문서 반입에 **비밀 검사**가 붙어 있다", () => {
    // ⚠ 2026-08-22까지 **아예 없었다.** 개인 문서는 공유할 때 가리는데 회사 문서는 무검사로
    //   지식이 됐다 — API 키가 든 문서가 그대로 답변 근거로 인용될 수 있었다.
    expect(업로드, "비밀 검사가 없다").toMatch(/maskSecrets\s*\(/);
    // ⚠ **findSecrets를 쓰면 안 된다** — 그건 원본 값을 담아서, 경고하려다 유출한다.
    expect(업로드, "findSecrets는 원본 값을 담는다 — 밖으로 나가는 자리에 쓰면 안 된다")
      .not.toMatch(/findSecrets\s*\(/);
  });
});
