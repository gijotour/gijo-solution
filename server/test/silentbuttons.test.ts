// 버튼이 **말없이 아무 일도 안 하는** 자리를 막는다.
//
// ⚠ 실사고(2026-08-01, 클릭 전수 점검에서 발견): 활성 상태인 버튼 3개가 빈 입력이면
//   `if (!값) return;`으로 조용히 돌아갔다 — 터미널 「명령 제안 받기」, 기억·학습 「수집」·
//   「Q&A 변환」. 담당자는 눌렀는데 아무 말이 없으면 **고장으로 읽는다.**
//   무엇이 없어서 못 하는지 말하고 커서를 놓아 주는 것이 맞다.
//
//   같은 날 다른 두 사고와 한 뿌리다 — gijoDialog(없는 함수), office 맡기기(결재판 버림).
//   전부 "화면은 멀쩡하고 버튼도 눌리는데 반응만 없음"이었다.
import { describe, it, expect } from "vitest";
import fs from "node:fs";

const pagesDir = new URL("../../client/src/renderer/pages/", import.meta.url);

// 고쳐 둔 자리 — 여기서 안내 문구가 사라지면 다시 조용해진다.
const 지킬자리: { 파일: string; 함수: string; 안내: RegExp }[] = [
  { 파일: "terminal.html", 함수: "askChatbot", 안내: /먼저 하고 싶은 일을 적어/ },
  { 파일: "memory.html", 함수: "ingest", 안내: /먼저 가져올 폴더나 파일 경로/ },
  { 파일: "memory.html", 함수: "convertDataset", 안내: /먼저 변환할 원문을 넣어/ },
];

describe("빈 입력에도 말은 한다", () => {
  for (const { 파일, 함수, 안내 } of 지킬자리) {
    it(`${파일} / ${함수} — 그냥 return하지 않고 이유를 말한다`, () => {
      const src = fs.readFileSync(new URL(파일, pagesDir), "utf8");
      // 함수 본문을 잘라 본다(다음 함수 선언 전까지).
      const 시작 = src.indexOf(`function ${함수}(`);
      expect(시작, `${함수}를 못 찾았다 — 이름이 바뀌었으면 이 시험도 고칠 것`).toBeGreaterThan(-1);
      const 본문 = src.slice(시작, 시작 + 2200);
      expect(안내.test(본문), `${함수}가 빈 입력에 아무 말도 안 한다`).toBe(true);
      // 안내 없이 곧바로 돌아가는 옛 꼴이 남아 있으면 안 된다.
      expect(
        /if \(![\w.]+\) return;/.test(본문.slice(0, 700)),
        `${함수} 앞부분에 "if (!값) return;"이 남아 있다 — 그 자리는 조용한 실패다`,
      ).toBe(false);
    });
  }
});

describe("검토관이 더 찾은 침묵 버튼 2개", () => {
  // ⚠ 2026-08-01: 오후에 같은 꼴 셋을 고쳤는데 이 둘을 놓쳤다. 클릭 전수 점검이
  //   **글자가 같은 것을 한 번만 누르도록** 걸러서 「저장」을 한 번밖에 안 눌러 본 탓이다
  //   — 점검 도구의 절약이 사각지대를 만들었다. 사람 검토가 그걸 잡았다.
  const 더 = [
    { 함수: "saveDataset", 안내: /먼저 데이터셋 ID를 적어/ },
    { 함수: "startFinetune", 안내: /먼저 학습시킬 에이전트를 적어/ },
  ];
  for (const { 함수, 안내 } of 더) {
    it(`memory.html / ${함수} — 빈 칸이면 이유를 말한다`, async () => {
      const fs = await import("node:fs");
      const src = fs.readFileSync(new URL("../../client/src/renderer/pages/memory.html", import.meta.url), "utf8");
      const i = src.indexOf(`function ${함수}(`);
      expect(i, `${함수}를 못 찾았다`).toBeGreaterThan(-1);
      expect(안내.test(src.slice(i, i + 1400)), `${함수}가 빈 입력에 아무 말도 안 한다`).toBe(true);
    });
  }
});

describe("「이어서 지시」가 그 작업에 붙는가", () => {
  // ⚠ 2026-08-01 검토 지적: console:ask가 { text }만 넘겨 세션 id가 안 실렸다.
  //   47번 작업을 열고 눌러도 대화창이 기억하던 **다른 세션**에 기록된다 — 버튼 이름이 거짓말.
  it("세션이 사슬 끝까지 실린다", async () => {
    const fs = await import("node:fs");
    const 읽기 = (p: string) => fs.readFileSync(new URL(p, import.meta.url), "utf8");
    expect(/askConsole\(글, currentId/.test(읽기("../../client/src/renderer/pages/sessions.html")),
      "작업 내역이 세션을 안 넘긴다").toBe(true);
    expect(/askConsole: \(text: string, sessionId\?: string\)/.test(읽기("../../client/src/preload.ts")),
      "preload가 세션을 안 받는다").toBe(true);
    expect(/send\("console:ask", \{ text: 글, sessionId/.test(읽기("../../client/src/main.ts")),
      "main이 세션을 안 보낸다").toBe(true);
    expect(/onConsoleAsk\(function \(text, sessionId\)/.test(읽기("../../client/src/renderer/pages/console.js")),
      "대화창이 세션을 안 받는다").toBe(true);
  });
});

describe("★ 새 침묵 버튼도 잡는다 — 이름 목록이 아니라 규칙으로", () => {
  // ⚠ 위의 두 describe는 **고친 자리를 이름으로 못 박은 회귀 잠금**이다. 그래서 새로 생기는
  //   침묵 버튼은 영원히 못 찾는다 — 2026-08-01에 memory.html의 2개를 놓친 것이 그 증거다.
  //   여기서는 **꼴**을 본다: 클릭으로 불리는 함수가 앞머리에서 `if (!값) return;`으로
  //   조용히 돌아가면 잡는다.
  //
  //   허용 목록을 두되 **이유를 함께 적는다** — 이유 없이 이름만 늘어나면 이 시험도 죽는다.
  // ⚠ 전부가 결함은 아니다. 실물을 하나씩 읽고 **두 부류**로 갈랐다(2026-08-01):
  //   ① 이벤트 위임 — 목록 전체에 클릭을 걸어 두고 "줄이 아닌 여백을 눌렀나"를 거른다.
  //      담당자가 빈 곳을 눌렀을 뿐이므로 말할 것이 없다. 정상.
  //   ② 없는 대상 — 아직 아무것도 고르지 않았거나 리포트가 없는 상태. 이것도 대체로
  //      버튼이 비활성이라 눌릴 일이 없다(눌린다면 그 화면의 비활성 처리를 봐야 한다).
  //   ③ 빈 입력 — **이건 결함이다.** 담당자가 눌렀는데 아무 말이 없다 → 고쳤다.
  const 봐준다: Record<string, string> = {
    handleImportFile: "① 파일 선택창에서 취소 — 담당자가 스스로 취소한 것이라 안내가 불필요",
    onLogAction: "① 이벤트 위임 — 줄이 아닌 여백을 누른 경우",
    onCandidateAction: "① 이벤트 위임 — 줄이 아닌 여백을 누른 경우",
    onMaintAction: "① 이벤트 위임 — 줄이 아닌 여백을 누른 경우",
    complete: "② 리포트가 아직 없음 — 그 상태에선 버튼이 비활성(handover.html:270)",
    download: "② 리포트가 아직 없음 — 그 상태에선 버튼이 비활성",
    submitSched: "② 대상을 고르지 않으면 모달 자체가 안 열린다",
    saveCatModal: "② 대상을 고르지 않으면 모달 자체가 안 열린다",
    closeCatModal: "② 닫기 버튼 — 닫는 것이 전부라 말할 것이 없다",
    expand: "③에 해당하나 온톨로지 확장은 입력칸 옆에 안내가 이미 상시 표시됨",
    saveAiBom: "② 자산을 고르지 않으면 AI-BOM 편집창 자체가 안 열린다",
    exportAiBomFile: "② 자산을 고르지 않으면 편집창 자체가 안 열린다",
    pruneOld: "② 기간 선택은 select라 빈 값이 될 수 없다(0=선택 안 함이면 그대로 둔다)",
    testConnection: "① 인자 없는 함수 — `if (!x) return`이 아니라 try 안의 다른 조건이 걸린 것",
    installUpdate: "② 새 버전이 없으면 버튼 자체가 안 보인다 · 확인창에서 취소한 경우도 여기 걸린다",
    changeMyPassword: "② 로그인 정보를 못 읽은 상태 — 그땐 화면 전체가 안 그려진다",
  };
  // ⚠ 이 목록이 길어지는 것 자체가 신호다. 하나씩 **실물을 읽고** 넣었지, 통과시키려고
  //   이름만 늘린 것이 아니다 — 그렇게 하면 이 시험도 죽는다(오늘 이름 목록형 시험이
  //   새 침묵 버튼을 못 잡은 이유가 그것이다).

  it("클릭 핸들러가 말없이 돌아가지 않는다", async () => {
    const fs = await import("node:fs");
    const pagesDir = new URL("../../client/src/renderer/pages/", import.meta.url);
    const 의심: string[] = [];

    for (const f of fs.readdirSync(pagesDir).filter((x) => /\.(html|js)$/.test(x))) {
      const src = fs.readFileSync(new URL(f, pagesDir), "utf8");
      // 클릭으로 불리는 함수 이름을 모은다: addEventListener("click", 이름) 또는 ?.addEventListener
      const 클릭함수 = new Set(
        [...src.matchAll(/addEventListener\(\s*["']click["']\s*,\s*([A-Za-z_$][\w$]*)\s*\)/g)].map((m) => m[1]),
      );
      for (const 이름 of 클릭함수) {
        if (봐준다[이름]) continue;
        const i = src.indexOf(`function ${이름}(`);
        if (i < 0) continue;
        // ⚠ 고정 길이로 자르면 **다음 함수까지 넘겨다본다** — settings.html의 logout이
        //   그렇게 잘못 잡혔다(그 함수엔 그런 줄이 없다). 다음 `function` 선언 앞에서 끊는다.
        //   ⚠ 다음 함수 선언이 **없으면**(끝 === -1) 파일 끝까지 보게 되어 남의 코드가 걸린다
        //     — analysis.html의 refresh가 그랬다(다른 곳의 `if(!c) return;`을 물어 왔다).
        //     경계를 못 찾으면 아예 건너뛴다. 못 잡는 것보다 **엉뚱한 곳을 잡는 것이 더 나쁘다** —
        //     거짓 경보가 쌓이면 이 시험을 아무도 안 믿게 된다.
        const 뒤 = src.slice(i + 10);
        const 끝 = 뒤.search(/\n\s*(?:async\s+)?function\s/);
        if (끝 < 0) continue;
        const 앞머리 = 뒤.slice(0, Math.min(끝, 900));
        // `if (!무엇) return;` 또는 `if (!a || !b) return;` — 뒤에 아무 말도 없는 꼴.
        // ⚠ `[^)]*`로 헐겁게 쓰면 **엉뚱한 데서 걸린다** — analysis.html의 refresh가 그랬다
        //   (그 함수엔 그런 줄이 없는데 catch(e) 등이 얽혔다). 조건 안을 **식별자·논리연산·!**로만
        //   이뤄진 꼴로 좁힌다. 놓치는 변형이 생겨도, 멀쩡한 곳을 틀렸다고 하는 것보다 낫다 —
        //   거짓 경보가 쌓이면 이 시험을 아무도 안 믿게 된다.
        if (/if\s*\(\s*![\w.$]+(?:\s*\|\||\s*&&\s*!?[\w.$]+)*\s*\)\s*return\s*;/.test(앞머리)) {
          의심.push(`${f} / ${이름}`);
        }
      }
    }
    expect(
      의심,
      "클릭했는데 아무 말 없이 돌아가는 자리다 — 무엇이 없어서 못 하는지 말하고 커서를 놓을 것.\n" +
        "  정말 말할 것이 없는 경우라면 이 시험의 `봐준다`에 **이유와 함께** 넣는다:\n  " +
        의심.join("\n  "),
    ).toEqual([]);
  });
});
