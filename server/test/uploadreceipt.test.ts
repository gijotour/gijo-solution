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
    const 찾음 = 영수증목록(50).목록.find((r) => r.filename === 이름);
    expect(찾음, "취약점 파일이 영수증에 없다 — 「내가 뭘 올렸더라」에 답할 수 없다").toBeTruthy();
    expect(찾음!.ingested, "취약점 표는 지식에 안 넣는 것이 옳다").toBe(false);
    expect(찾음!.routedTo).toBe("vulnscan");
  });

  it("★★ 목록이 **거르고 나서 자른다** — 순서를 뒤집으면 내 것이 남의 것에 밀려 사라진다", () => {
    // ⚠ 2026-08-22 게시 전 검토관 [높음] 수리의 핵심. 잣대 자체는 `열람불가공용`(memory.ts)이
    //   한 곳이라 여기서는 **거르개가 실제로 걸리는가**와 **자르는 순서**를 잰다.
    const 표식 = `시험_거르기_${Date.now()}`;
    for (let i = 0; i < 5; i++) {
      영수증남기기({
        filename: `${표식}_남의것_${i}.md`, uploadedById: "다른사람",
        kind: "document", routedTo: "memory", originalSaved: false, mdSaved: true, ingested: true, bytes: 100,
      });
    }
    영수증남기기({
      filename: `${표식}_내것.md`, uploadedById: "나",
      kind: "document", routedTo: "memory", originalSaved: false, mdSaved: true, ingested: true, bytes: 100,
    });

    // ① 거르개가 실제로 걸린다 — 「내 것」만 남긴다.
    const 내것만 = 영수증목록(300, (r) => r.uploadedById === "나" || !r.filename.startsWith(표식));
    const 이번것 = 내것만.목록.filter((r) => r.filename.startsWith(표식));
    expect(이번것.map((r) => r.filename), "거르개가 안 걸린다 — 남의 것이 그대로 나온다")
      .toEqual([`${표식}_내것.md`]);

    // ② **순서**가 맞다 — 상한 1로 잘라도 「내 것」이 살아남아야 한다.
    //    먼저 자르고 걸렀다면, 가장 최근 1줄(=남의 것일 수 있다)만 남아 내 것이 사라진다.
    //    ⚠ 이 시험이 그 뒤바뀜을 잡는 유일한 자리다.
    const 한줄 = 영수증목록(1, (r) => r.uploadedById === "나");
    expect(한줄.목록.length, "상한이 안 걸렸다 — 이 시험이 헛돈다").toBe(1);
    expect(한줄.목록[0].uploadedById, "먼저 자르고 걸러서 내 것이 밀려났다").toBe("나");

    // ③ 총계는 **거른 뒤** 건수다 — 목록 길이(상한에 걸린 수)가 아니다.
    expect(한줄.건수, "총계가 목록 길이와 같다 — 상한에 걸리면 거짓 숫자가 된다")
      .toBeGreaterThanOrEqual(1);
    expect(한줄.건수, "총계가 목록 길이로 잘려 있다").toBeGreaterThan(한줄.목록.length - 1);
  });

  it("★ 되묻는 중(유형 미정)도 기록된다 — 그전엔 감사조차 없었다", () => {
    const 이름 = `시험_애매한파일_${Date.now()}.dat`;
    영수증남기기({
      filename: 이름, kind: "unknown", routedTo: "decision", decidedBy: "auto",
      originalSaved: false, mdSaved: false, ingested: false,
      detail: "유형을 되물었습니다 — 아직 반영되지 않았습니다",
    });
    const 찾음 = 영수증목록(50).목록.find((r) => r.filename === 이름);
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
    const 둘 = 영수증목록(100).목록.filter((r) => r.filename === 이름);
    expect(둘.length, "두 번 올렸으면 두 줄이어야 한다 — 덮으면 기록이 사라진다").toBe(2);
  });

  it("★ 누가 갈래를 정했는지 남는다 — 「이 문서를 사내규정으로 분류한 것은 누구인가」", () => {
    const 이름 = `시험_사람지정_${Date.now()}.md`;
    영수증남기기({
      filename: 이름, kind: "guideline", routedTo: "memory", decidedBy: "user",
      category: "사내규정", originalSaved: false, mdSaved: true, ingested: true,
    });
    const 찾음 = 영수증목록(50).목록.find((r) => r.filename === 이름);
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

    // ★★ 2026-08-22 게시 전 검토관 [낮음] 수리 — **이 시험이 헛돌고 있었다.**
    //   그전엔 `indexOf("if (!되묻는중)") < indexOf("영수증남기기({")` 만 봤다. 그런데
    //   **블록 안으로 옮겨도 그 순서는 그대로다** — 즉 막으려던 그 변경을 못 잡았다.
    //   그래서 블록의 **범위를 실제로 떠서**, 그 안에 호출이 없음을 본다.
    const 시작 = 업로드.indexOf("if (!되묻는중)");
    expect(시작, "감사 가드를 못 찾았다 — 이 시험이 헛돈다").toBeGreaterThan(0);
    const 여는중괄호 = 업로드.indexOf("{", 시작);
    expect(여는중괄호, "가드 블록의 여는 중괄호를 못 찾았다").toBeGreaterThan(시작);
    let 깊이 = 0;
    let 끝 = -1;
    for (let i = 여는중괄호; i < 업로드.length; i++) {
      if (업로드[i] === "{") 깊이++;
      else if (업로드[i] === "}" && --깊이 === 0) { 끝 = i; break; }
    }
    expect(끝, "가드 블록의 끝을 못 찾았다").toBeGreaterThan(여는중괄호);
    const 가드안 = 업로드.slice(여는중괄호, 끝);
    expect(가드안, "영수증 호출이 감사 가드 **안**으로 들어갔다 — 되물으면 기록이 사라진다")
      .not.toMatch(/영수증남기기\s*\(/);
    // 감시가 헛돌지 않는지 스스로 확인 — 블록을 실제로 떴다면 감사 호출은 그 안에 있어야 한다.
    expect(가드안, "가드 블록을 잘못 떴다 — recordAudit이 안 보인다면 범위가 틀린 것이다")
      .toMatch(/recordAudit\s*\(/);
  });

  it("★★ 영수증 창구가 **등급·소유자를 건다** — 파일명만으로도 새는 것이 있다", () => {
    // ⚠ 2026-08-22 게시 전 검토관 [높음]: 이 창구가 **전 사용자의 반입 목록**을 필터 없이 줬다.
    //   그전에 같은 탭이 쓰던 `/api/memory/documents`는 등급 필터를 지났으므로 **회귀**였다.
    //   gradeblock.test:169가 이미 못 박아 두었다 — 「제목도 가린다」.
    const 창구 = 업로드.slice(업로드.indexOf('"/api/upload/receipts"'));
    const 블록 = 창구.slice(0, 창구.indexOf("app.post"));
    expect(블록, "등급 잣대(열람불가공용)를 안 부른다 — 남의 기밀 파일명이 샌다")
      .toMatch(/열람불가공용\s*\(/);
    expect(블록, "소유자를 **id**로 가르지 않는다 — 표시 이름으로 가르면 동명이인에서 어긋난다")
      .toMatch(/uploadedById/);
    // 표시 이름으로 가르는 퇴행을 막는다(basename 키잉 사고와 같은 부류).
    expect(블록, "표시 이름(uploadedBy)으로 소유자를 가르고 있다")
      .not.toMatch(/row\.uploadedBy\s*===/);
  });

  it("★★ 회사 문서 반입 **창구 둘 다**에 비밀 검사가 붙어 있다", () => {
    // ⚠ 2026-08-22까지 **아예 없었다.** 개인 문서는 공유할 때 가리는데 회사 문서는 무검사로
    //   지식이 됐다 — API 키가 든 문서가 그대로 답변 근거로 인용될 수 있었다.
    // ★★ 그날 오후 검토관 [중]: 고친 것이 **창구 하나뿐**이었다. 회사 문서가 들어오는 길은
    //   둘이다 — 콘솔 ＋(`/api/upload/auto`, autoupload.ts)와 **`/api/memory/ingest-file`**
    //   (라이트 화면·knowledge-ingest 도구가 쓰는 길, memory.ts). 앞엣것만 고쳐 놓고
    //   커밋·화면 문구는 전칭으로 「고쳤다」고 말했다. **그것이 「잣대가 두 벌」의 정의다.**
    //   그래서 이 시험은 **두 파일을 함께** 본다 — 한쪽만 고치면 여기서 걸린다.
    const 창구들: [string, string][] = [
      ["autoupload.ts (콘솔 ＋)", 업로드],
      ["memory.ts (ingest-file)", fs.readFileSync(path.join(서버루트, "src", "engine", "memory.ts"), "utf8")],
    ];
    for (const [이름, src] of 창구들) {
      expect(src, `${이름}에 비밀 검사가 없다 — 같은 파일을 이 길로 올리면 경고가 안 뜬다`)
        .toMatch(/maskSecrets\s*\(/);
      // ⚠ **findSecrets를 쓰면 안 된다** — 그건 원본 값을 담아서, 경고하려다 유출한다.
      expect(src, `${이름}이 findSecrets를 쓴다 — 원본 값을 담아 경고하려다 유출한다`)
        .not.toMatch(/findSecrets\s*\(/);
    }
  });
});
