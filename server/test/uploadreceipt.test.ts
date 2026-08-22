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
import { 영수증남기기, 영수증목록, 되묻기영수증지우기, 보관총량, 갈래이름 } from "../src/engine/uploadreceipt";
// ★ 「등급을 매길 행이 있나」 — 창구 게이트가 fail-open이 되지 않게 막는 잣대(2026-08-22 2라운드).
import { 등급판정가능 } from "../src/engine/memory";

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
    //   ★★ 2026-08-22 2라운드 검토관 [중] 수리 — 첫 단언이 **항진명제**였다.
    //     `건수 >= 목록.length`는 구현이 어떻든 늘 참이라, 구현을 결함 상태(건수=목록.length)로
    //     되돌려도 통과했다. 게다가 그 표본은 거르개를 지나는 줄이 1건뿐이라
    //     **상한에 애초에 안 걸렸다** — 「상한에 걸리면」이라는 전제 자체가 성립하지 않았다.
    //   → 상한에 **확실히 걸리는** 표본으로 재고, 둘이 **다르다**는 것을 못박는다.
    const 상한걸림 = 영수증목록(1, (r) => r.filename.startsWith(표식)); // 이 표본은 6줄이다
    expect(상한걸림.목록.length, "상한이 안 걸렸다 — 이 시험이 헛돈다").toBe(1);
    expect(상한걸림.건수, "총계를 목록 길이로 세고 있다 — 상한에 걸리면 거짓 숫자가 된다")
      .toBe(6);
    expect(상한걸림.건수, "총계와 목록 길이가 같다 — 자른 뒤에 센 것이다")
      .not.toBe(상한걸림.목록.length);
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
    // ★★ **판정할 근거가 없을 때 감추는가** (2026-08-22 2라운드 검토관 [높음] 수리).
    //   `열람불가공용`은 문서 메타 행이 없으면 false(=열어 준다)를 준다. 문서 라우트에선
    //   옳지만 **여기서는 fail-open**이라, 되묻는 중·SBOM·취약점 스캔처럼 문서 행이 없는
    //   갈래에서 남의 기밀 파일명이 그대로 보였다(내가 게이트를 넣고도 놓친 갈래다).
    expect(블록, "등급을 매길 행이 없을 때 감추지 않는다 — decision·SBOM·취약점 줄이 전원에게 샌다")
      .toMatch(/등급판정가능\s*\(/);
  });

  it("★★ 잣대가 **fail-open이 아닌지** 동작으로 잰다 — 문서 행이 없는 갈래", () => {
    // ⚠ 위 시험은 소스 감시다(문자열이 있나). 여기서는 **판정 함수의 성질**을 잰다:
    //   「막힘」이 아니라 「판정 가능함」을 먼저 물어야 한다는 그 순서를 못박는다.
    const 표식 = `시험_failopen_${Date.now()}`;
    영수증남기기({
      filename: `${표식}_남의_퇴사자명단.xlsx`, uploadedById: "다른사람",
      kind: "unknown", routedTo: "decision",         // ← 문서 행이 안 생기는 갈래
      originalSaved: false, mdSaved: false, ingested: false,
    });
    // 창구가 쓰는 것과 **같은 모양**의 거르개: 내 것 아니고 · 관리자 아니고 · 판정 근거 없음.
    const 게이트 = (r: { uploadedById?: string; filename: string }) => {
      if (r.uploadedById === "나") return true;
      if (!등급판정가능(r.filename)) return false;   // ★ 이 줄이 빠지면 아래가 실패한다
      return true;
    };
    const 보이는 = 영수증목록(300, 게이트).목록.filter((r) => r.filename.startsWith(표식));
    expect(보이는.map((r) => r.filename),
      "문서 행이 없는 남의 반입이 보인다 — 등급을 매길 자리가 없는데 통과시켰다(fail-open)")
      .toEqual([]);
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

// ─────────────────────────────────────────────────────────────────────────────
// ★★ **화면이 한 약속을 코드가 지키는가** — 📞 연락처의 개인정보 (2026-08-22 2라운드 [중])
//
// ■ 왜 여기 있나: 그날 [높음] 두 건이 연락처에서 나왔는데(빈 표 · 개인정보 전송),
//   **그 둘을 지키는 감시가 하나도 없었다.** 낮은 등급 지적에는 감시를 붙이면서
//   정작 개인정보를 서버로 보내던 한 줄에는 안 붙인 것이다. 되돌려도 아무도 못 잡는다.
//
// ■ 무엇을 재나: 화면(mydocs.html)과 챗봇(screenguide.ts)이 「전화·이메일은 이 PC에만
//   저장되고 **서버로 보내지 않습니다**」라고 약속한다. 그런데 매트릭스 칸을 누르면
//   그 값이 **대화창 선택**으로 실려 `/api/dispatch` → LLM 프롬프트까지 간다.
//   즉 「약속-코드 불일치」이자 개인정보 유출이다.
describe("★ 📞 연락처 — 「서버로 보내지 않습니다」가 코드로 지켜지는가", () => {
  const 화면 = fs.readFileSync(
    path.join(서버루트, "..", "client", "src", "renderer", "pages", "mydocs.html"), "utf8"
  );

  /** 연락처 매트릭스 칸 클릭 핸들러 블록을 뜬다 — 그 안에 전화·이메일이 실리면 안 된다. */
  function 칸클릭블록(): string {
    const 시작 = 화면.indexOf('querySelectorAll("table.mx td")');
    expect(시작, "연락처 칸 클릭 배선을 못 찾았다 — 이 시험이 헛돈다").toBeGreaterThan(0);
    // 그 forEach가 끝나는 자리까지(다음 함수 선언 전)로 넉넉히 뜬다.
    const 끝 = 화면.indexOf("\n  }", 시작);
    return 화면.slice(시작, 끝 > 시작 ? 끝 : 시작 + 2000);
  }

  it("★★ 칸을 눌러도 **전화·이메일을 대화창에 싣지 않는다**", () => {
    const 블록 = 칸클릭블록();
    // 감시가 헛돌지 않는지 — 실제로 알림(선택)을 부르는 블록을 떴나.
    expect(블록, "선택 알림을 부르는 자리가 아니다 — 블록을 잘못 떴다").toMatch(/알림\s*\(/);
    expect(블록, "전화번호를 대화창 선택으로 보낸다 — 화면이 「서버로 보내지 않습니다」라고 약속한 값이다")
      .not.toMatch(/c\.phone/);
    expect(블록, "이메일을 대화창 선택으로 보낸다 — 같은 약속을 어긴다")
      .not.toMatch(/c\.email/);
  });

  it("★ 그 약속이 화면에 실제로 적혀 있다 — 약속이 사라지면 이 시험의 전제가 무너진다", () => {
    expect(화면, "「서버로 보내지 않습니다」 약속이 화면에서 사라졌다 — 위 시험이 지킬 것이 없어졌다")
      .toMatch(/서버로 보내지 않/);
  });

  it("★★ 담당자를 **넣을 길이 있다** — 읽기만 하면 표는 영영 비어 있다", () => {
    // 2026-08-22 [높음]: 값을 쓰는 화면이 어느 셸에서도 안 열려 표가 영구히 비었고,
    //   빈 상태는 **없는 도구**(대화창 「담당자 등록해줘」)를 안내했다.
    expect(화면, "담당자 관리로 가는 길이 없다 — 연락처 탭이 다시 읽기 전용이 된다")
      .toMatch(/lite-contacts\.html/);
    // ⚠ **주석은 빼고 본다.** 이 저장소는 주석에 사고 이력을 남기는 방식이라
    //   「예전엔 이렇게 안내했다」는 설명이 그대로 걸린다 — 역사를 적는 것을 시험이 막으면
    //   다음 사람은 **왜 이렇게 됐는지 못 적는다**(같은 함정을 lite-edition-shell이 이미 겪었다).
    //   ⚠⚠ 줄 끝 주석을 `//`로 자를 때 앞 글자가 `:`면 URL이다 — 자르면 안 된다.
    //   ⚠ HTML 주석·블록 주석은 **여러 줄에 걸친다** — 줄 머리만 보면 이어지는 줄이 안 걸린다
    //     (처음에 그렇게 썼다가 이 시험이 스스로 헛실패했다).
    const 코드만 = 화면
      .replace(/<!--[\s\S]*?-->/g, "")   // HTML 주석 블록
      .replace(/\/\*[\s\S]*?\*\//g, "")  // JS 블록 주석
      .split("\n")
      .filter((l) => !/^\s*\/\//.test(l))
      .map((l) => l.replace(/([^:])\/\/.*$/, "$1"))
      .join("\n");
    expect(코드만, "감시가 헛돌지 않는지 — 주석을 걷고도 화면 코드가 남아 있나")
      .toMatch(/연락처그리기/);
    expect(코드만, "없는 대화 도구를 안내한다 — 그런 도구는 없다(연락처는 이 PC 저장이다)")
      .not.toMatch(/담당자 등록해줘/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ★★ **결합을 못 박는다** — 이 게이트 전체가 서 있는 전제 (2026-08-22 2라운드 [중])
//
// ■ 문제: 영수증 게이트는 「영수증의 `filename` == memory_documents의 `documentId`」라는
//   결합 위에 서 있다. 그 결합이 어긋나는 순간 `등급판정가능`이 늘 false를 돌려주거나
//   `열람불가공용`이 늘 통과시킨다 — 어느 쪽이든 **조용히** 잘못된다.
//   그런데 그 결합을 재는 시험이 **하나도 없었다.**
// ■ 이 시험은 그 결합을 **소스로** 못 박는다: 저장 키를 만드는 자리와 영수증에 적는 자리가
//   같은 값(filename)을 쓰는지 본다. 라이브 실측은 커밋에 남겼다(둘이 같은 열쇠임을 확인).
describe("★ 영수증 filename == 지식 documentId — 게이트가 서 있는 결합", () => {
  const 업로드 = fs.readFileSync(path.join(서버루트, "src", "engine", "autoupload.ts"), "utf8");

  it("★★ 문서를 저장할 때 쓰는 키와 영수증에 적는 이름이 **같은 변수**다", () => {
    // saveDocArtifacts가 documentId로 무엇을 넘기는가 — 이것이 지식 쪽 열쇠다.
    expect(업로드, "문서 저장 키를 만드는 자리를 못 찾았다 — 이 시험이 헛돈다")
      .toMatch(/saveDocArtifacts\(\{\s*documentId:\s*filename\b/);
    // 영수증에 적는 이름 — 이것이 게이트가 조회에 쓰는 값이다.
    expect(업로드, "영수증에 filename을 안 적는다 — 게이트가 무엇으로 조회할지 알 수 없다")
      .toMatch(/영수증남기기\(\{\s*[\s\S]{0,80}?filename,/);
    // 둘 사이에 가공(basename·trim·소문자화)이 끼면 열쇠가 갈린다. 그 모양을 막는다.
    expect(업로드, "영수증 이름에 basename을 쓰면 열쇠가 갈린다 — 2026-08-22 오전 기밀 유출의 그 부류다")
      .not.toMatch(/영수증남기기\(\{[\s\S]{0,120}?path\.basename/);
  });

  it("★ 게이트가 그 값을 그대로 조회에 쓴다 — 중간에 가공하면 조용히 어긋난다", () => {
    const 창구 = 업로드.slice(업로드.indexOf('"/api/upload/receipts"'));
    const 블록 = 창구.slice(0, 창구.indexOf("app.post"));
    expect(블록, "row.filename을 그대로 안 쓴다 — 가공하면 지식 쪽 열쇠와 갈린다")
      .toMatch(/등급판정가능\(row\.filename\)/);
    expect(블록, "등급 잣대에도 같은 값을 넘겨야 한다")
      .toMatch(/열람불가공용\(row\.filename,\s*req\)/);
  });
});

// ★ 되묻기 줄 삭제 — **스스로 「안전장치」라 부른 세 조건**을 시험이 지킨다 (2026-08-22 2라운드 [낮음])
describe("★ 되묻기 영수증 삭제 — 안전장치 세 겹", () => {
  it("★★ 확정된 줄은 **절대** 안 지운다", () => {
    const 이름 = `시험_삭제안전_${Date.now()}.pdf`;
    const id = 영수증남기기({
      filename: 이름, uploadedById: "나", kind: "document", routedTo: "memory",  // ← 확정 줄
      originalSaved: false, mdSaved: true, ingested: true,
    });
    expect(id, "영수증을 못 남겼다 — 이 시험이 헛돈다").toBeTruthy();
    expect(되묻기영수증지우기(id!, 이름, "나"), "확정된 감사 기록이 지워졌다").toBe(false);
    expect(영수증목록(300).목록.some((r) => r.id === id), "확정 줄이 사라졌다").toBe(true);
  });

  it("★★ **다른 파일**의 물음 줄은 못 지운다 — 그 줄이 그 파일의 유일한 흔적이다", () => {
    const 이름 = `시험_삭제파일대조_${Date.now()}.dat`;
    const id = 영수증남기기({
      filename: 이름, uploadedById: "나", kind: "unknown", routedTo: "decision",
      originalSaved: false, mdSaved: false, ingested: false,
    });
    // 무관한 파일 이름으로 지우려 든다 — id가 맞아도 막혀야 한다.
    expect(되묻기영수증지우기(id!, "무관한파일.md", "나"), "파일 대조 없이 지워졌다").toBe(false);
    expect(영수증목록(300).목록.some((r) => r.id === id), "다른 파일 업로드로 물음 줄이 사라졌다").toBe(true);
    // 제 이름으로는 지워진다 — 감시가 헛돌지 않는지 스스로 확인.
    expect(되묻기영수증지우기(id!, 이름, "나"), "정상 경로인데 안 지워진다 — 위 시험이 헛돈다").toBe(true);
  });

  it("★ 남의 물음 줄은 못 지운다", () => {
    const 이름 = `시험_삭제남의것_${Date.now()}.dat`;
    const id = 영수증남기기({
      filename: 이름, uploadedById: "다른사람", kind: "unknown", routedTo: "decision",
      originalSaved: false, mdSaved: false, ingested: false,
    });
    expect(되묻기영수증지우기(id!, 이름, "나"), "남의 영수증이 지워졌다").toBe(false);
  });
});
