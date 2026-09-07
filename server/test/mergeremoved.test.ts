// merge(LLM 합성)를 **통째로 내렸다** — 반쪽만 지워지지 않았는지 소스로 감시한다. (2026-09-07)
//
// 무엇을 내렸나: 화면 merge.html · 엔진 server/src/engine/merge.ts · 창구 /api/merge/plan·
//   /api/merge/preflight · 클라 API(mergeApi·MergePlan) · preload(planMerge·mergePreflight) ·
//   안내 문서 GIJO_AS_LLM_합성_안내.md · 화면 안내(GUIDES·screencontext) · 용어 별칭.
//   ＋ 2026-09-07 2차: **그 화면이 유일한 소비자였던 것들** — 보안 특화 LLM 도감
//   (SECURITY_LLM_DEX·합성 호환 그룹·GET /api/modeldex·클라 DexModel·preload listModelDex).
//   1차에서 이것을 못 봤다: 화면을 지우면 화면이 **부르던 창구**도 고아가 되는데, 그 창구는
//   merge라는 낱말을 하나도 안 갖고 있어 낱말 감시로는 원리상 안 잡힌다.
//
// 왜 감시가 필요한가 — 이 저장소가 반복해 겪은 「반쪽 수리」다:
//   · 화면만 지우면 **아무도 안 부르는 인증 창구**가 둘 남는다(소비자 0인 API는 공격면일 뿐이다).
//   · 표(게시 관문 제외표·배선 대장·격리 표)에 이름만 남으면 다음 사람은 그 화면이 아직 있는 줄 안다.
//   · 문서·별칭만 남으면 챗봇이 **없는 기능**을 「관리자에게 요청하세요」라고 계속 안내한다.
//
// ⚠ 되살릴 때: 이 시험을 지우기 전에 화면·엔진·창구·문서를 **함께** 되살릴 것. 하나만 되살리면
//   여기서 빨간불이 뜨는 것이 정상이다(그것이 이 시험의 값어치다).
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const 뿌리 = path.join(__dirname, "..", "..");

// 코드에서 이 낱말이 하나라도 살아 있으면 반쪽 삭제다.
const 흔적 = [
  "merge.html", "/api/merge", "planMerge", "mergePreflight", "registerMergeRoutes", "mergeApi", "MergePlan", "engine/merge",
  // 화면이 **부르던** 것들 — merge라는 낱말이 없어 위 목록으로는 안 잡힌다(2026-09-07 2차).
  // ⚠ "/api/modeldex" 는 **닫는 따옴표까지** 넣는다 — 그래야 살아 있는
  //   "/api/modeldex/agent-recommendations"(agent.html이 실제로 부른다)를 오폭하지 않는다.
  "SECURITY_LLM_DEX", "synthesisGroups", "listModelDex", "\"/api/modeldex\"",
];

// ★ 2026-09-08 — 지운 화면의 **이름 자체가 반드시 살아 있어야 하는 곳이 한 군데** 있다.
//   셸(app.html)은 localStorage에 저장된 탭을 그대로 iframe에 무는데, 파일이 없으면
//   ERR_FILE_NOT_FOUND라 그 탭을 켜 둔 채 업데이트한 담당자는 **영구 빈 탭**을 만난다.
//   nav.js의 TAB_REDIRECT는 이걸 못 막는다 — 파일이 없으면 nav.js가 실리기도 전에 죽는다.
//   그래서 셸의 「옛탭」 표만이 이 사고를 받을 수 있고, 그 표는 옛 파일명을 **적어야** 한다.
//   ⇒ 아래 파일·낱말 쌍만 예외로 둔다. 「흔적 0건」을 곧이곧대로 지키면 이 안전망을 못 만든다.
//   (아래 「셸의 옛탭 표」 시험이 이 예외가 **실제로 그 목적에 쓰였는지**까지 되짚는다.)
const 코드예외: Record<string, { 낱말: string[]; 왜: string }> = {
  "client/src/renderer/pages/app.html": {
    낱말: ["merge.html"],
    왜: "셸의 「옛탭」 표 — 지운 화면의 옛 탭을 닫고 알리려면 그 파일명을 표가 들고 있어야 한다. 여기서 지우면 merge.html 탭을 켜 둔 채 업데이트한 담당자는 영구 빈 탭을 본다(nav.js 리다이렉트로는 원리상 못 막는다).",
  },
};

// 주석에 남는 것은 **기록**이라 막지 않는다 — 다만 어느 파일에 왜 남겼는지 여기 적어야 한다.
// 표에 없는 파일이 주석으로 merge를 부르면 빨간불이 뜬다(새 주석은 사람이 판단할 자리다).
const 주석예외: Record<string, string> = {
  "server/src/engine/screenguide.ts":
    "화면위치안내()의 retired 분기가 왜 있는지를 적은 교훈 주석 — 「메뉴에서 내려갔습니다」와 「사이드바에서 찾으세요」가 한 답에서 모순됐던 실측이 merge.html이었다. 다음에 화면을 내릴 때 이 분기를 다시 쓴다.",
  "server/src/engine/modeldex.ts":
    "도감(SECURITY_LLM_DEX·합성 호환 그룹·GET /api/modeldex)을 왜 통째로 내렸는지를 적은 묘비 — 그리던 화면이 merge.html 하나뿐이었다. 파일 이름과 남은 경로(/api/modeldex/agent-recommendations)가 옛 이름 그대로라, 적어 두지 않으면 다음 사람이 도감이 아직 있는 줄 안다.",
  "server/test/modeldex.test.ts":
    "도감 시험 셋(카탈로그·합성 호환 그룹·GET /api/modeldex)을 왜 뺐는지를 적은 기록 — 아무도 안 쓰는 창구를 시험이 지켜 주면 초록이 거짓 안심을 준다.",
  "client/src/api/llm-engine.ts":
    "mergeApi가 있던 자리에 「왜 통째로 내렸나」를 남긴 묘비 — 화면만 지우고 API를 남기면 소비자 0인 인증 창구가 둘 남는다는 판단 기록.",
};

const 볼곳 = ["client/src", "server/src", "server/test", "tools"];
const 건너뛸곳 = [/node_modules/, /[\/]dist[\/]/, /[\/]release/, /review-2026-/, /[\/]server-dist[\/]/];

function 파일들(): string[] {
  const out: string[] = [];
  const 훑기 = (dir: string) => {
    let 목록: fs.Dirent[];
    try { 목록 = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of 목록) {
      const p = path.join(dir, e.name);
      if (건너뛸곳.some((r) => r.test(p))) continue;
      if (e.isDirectory()) 훑기(p);
      else if (/\.(ts|js|mjs|html|json)$/.test(e.name)) out.push(p);
    }
  };
  for (const d of 볼곳) 훑기(path.join(뿌리, d));
  return out;
}

// 줄 통째로 주석인 것만 뗀다(URL의 // 를 주석으로 오독하지 않게 — testisolation.test와 같은 방식).
const 주석뗀 = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/<!--[\s\S]*?-->/g, "").replace(/(^|\n)\s*\/\/[^\n]*/g, "$1");

const 상대 = (p: string) => path.relative(뿌리, p).split(path.sep).join("/");

describe("★ merge(LLM 합성) 삭제 — 반쪽만 지워지지 않았다", () => {
  const 목록 = 파일들();

  it("이 감시가 헛돌지 않는다 — 소스를 실제로 훑고 있다", () => {
    expect(목록.length, "훑기가 파일을 하나도 못 찾았다 — 아래 검사가 통째로 헛돈다").toBeGreaterThan(200);
    expect(목록.some((p) => 상대(p) === "server/src/app.ts"), "app.ts를 못 봤다 — 경로가 어긋났다").toBe(true);
  });

  it("★ 코드에 merge 흔적이 0건이다", () => {
    const 걸린것: string[] = [];
    for (const p of 목록) {
      const 이름 = 상대(p);
      if (이름 === "server/test/mergeremoved.test.ts") continue; // 이 시험 자신(낱말을 들고 있어야 한다)
      const 허용 = 코드예외[이름]?.낱말 ?? [];
      const 코드 = 주석뗀(fs.readFileSync(p, "utf8"));
      for (const t of 흔적) if (코드.includes(t) && !허용.includes(t)) 걸린것.push(`${이름}: ${t}`);
    }
    expect([...new Set(걸린것)],
      "merge를 내렸는데 코드에 아직 살아 있다 — 화면만 지우고 창구·표를 남기면 아무도 안 부르는 인증 창구가 남는다").toEqual([]);
  });

  it("지운 파일이 실제로 없다", () => {
    for (const f of ["client/src/renderer/pages/merge.html", "server/src/engine/merge.ts", "server/test/merge.test.ts", "GIJO_AS_LLM_합성_안내.md"]) {
      expect(fs.existsSync(path.join(뿌리, f)), `${f}이 아직 있다 — 지웠다면 함께 지울 것`).toBe(false);
    }
  });

  it("주석에 남은 언급은 **왜 남겼는지**가 적힌 것뿐이다", () => {
    const 표밖: string[] = [];
    for (const p of 목록) {
      const 이름 = 상대(p);
      if (이름 === "server/test/mergeremoved.test.ts") continue;
      const 글 = fs.readFileSync(p, "utf8");
      if (!흔적.some((t) => 글.includes(t))) continue;
      if (!(이름 in 주석예외) && !(이름 in 코드예외)) 표밖.push(이름);
    }
    expect(표밖, "merge를 언급하는 새 주석이 생겼다 — 기록으로 남길 이유를 mergeremoved.test.ts 주석예외 표에 적거나, 언급을 지울 것").toEqual([]);
    for (const [f, 사유] of Object.entries(주석예외)) {
      expect(사유.length, `${f}: 예외인데 이유가 없다 — 이유 없는 예외는 다음 사람이 그냥 늘린다`).toBeGreaterThan(30);
      expect(fs.existsSync(path.join(뿌리, f)), `${f}: 표에 있는데 파일이 없다 — 낡은 표는 거짓 안심을 준다`).toBe(true);
    }
    for (const [f, e] of Object.entries(코드예외)) {
      expect(e.왜.length, `${f}: 코드예외인데 이유가 없다 — 이유 없는 예외는 다음 사람이 그냥 늘린다`).toBeGreaterThan(30);
      expect(e.낱말.length, `${f}: 허용 낱말이 비었다 — 그러면 예외가 파일 전체를 통째로 뚫는다`).toBeGreaterThan(0);
      expect(fs.existsSync(path.join(뿌리, f)), `${f}: 표에 있는데 파일이 없다 — 낡은 표는 거짓 안심을 준다`).toBe(true);
    }
  });

  // ★ 2026-09-08 — 위 「흔적 0건」이 **너무 잘 지켜지면 나는 사고**를 여기서 되짚는다.
  //
  //   실측한 사고 모양(intro.html, 2026-08-22 검토관 [높음]): 화면 파일을 지우면서 셸의 옛탭 표에
  //   안 적으면, 그 탭을 켜 둔 채 업데이트한 담당자는 **영구 빈 탭**을 만난다 — 셸이 localStorage의
  //   탭을 그대로 iframe에 무는데 파일이 없어 ERR_FILE_NOT_FOUND다. 오류 화면도 안 뜨고, 껐다 켜도
  //   저장값이 그대로라 **영원히** 그 상태다. nav.js TAB_REDIRECT는 원리상 못 받는다(파일이 없으면
  //   nav.js가 실리기도 전에 로드가 실패한다).
  //   merge.html은 흡수처조차 없는 **폐지**라 도착지를 지어낼 수도 없다 ⇒ `버림`으로 적어
  //   탭을 닫고 한 번 알린다. 그 약속이 코드에 실제로 있는지를 여기서 본다.
  it("★ 지운 화면 이름이 셸의 「옛탭」 표에 살아 있다 — 빈 탭 대신 닫고 알린다", () => {
    const 셸 = fs.readFileSync(path.join(뿌리, "client/src/renderer/pages/app.html"), "utf8");
    // ① 표에 등재돼 있다(폐지 표시 `버림`과 사람이 읽을 이름까지).
    const 줄 = /"merge\.html":\s*\{([^}]*)\}/.exec(셸);
    expect(줄, "셸의 옛탭 표에 merge.html이 없다 — 그 탭을 켜 둔 담당자는 영구 빈 탭을 본다").toBeTruthy();
    expect(줄![1], "merge.html 항목에 `버림`이 없다 — 흡수처가 없는 화면을 그럴듯한 곳으로 보내면 이름과 내용이 어긋난다").toContain("버림");
    expect(/label\s*:\s*"[^"]+"/.test(줄![1]), "이름이 없다 — 못 찾으면 탭 이름이 파일명으로 뜬다(2026-08-18에 고친 결함)").toBe(true);
    // ② 표만 있고 받는 코드가 없으면 아무 일도 안 일어난다 — 바로잡기가 `버림`을 실제로 읽는다.
    expect(/if\s*\(m\s*&&\s*m\.버림\)\s*return null;/.test(셸),
      "옛탭바로잡기가 `버림`을 안 읽는다 — 표에 적어도 탭이 그대로 열려 빈 탭이 된다").toBe(true);
    // ③ 조용히 닫지 않는다 — 닫았으면 사람에게 말한다(사슬 꼬리에 붙였다).
    expect(셸.includes("function 폐지된탭알리기()"), "닫기만 하고 안 알린다 — 담당자는 자기 탭이 왜 사라졌는지 모른다").toBe(true);
    // ④ 저장값에서도 지운다 — 안 지우면 부팅마다 같은 알림이 되풀이된다.
    expect(/save\(\); \/\/ 폐지된 탭을 저장값에서도 지운다/.test(셸),
      "복원 뒤 save()가 없다 — 저장값에 남은 폐지 탭이 부팅마다 같은 알림을 다시 띄운다").toBe(true);
  });

  // ★ 2026-09-07 2차 — 위 검사들이 **원리상 못 보던 곳** 둘을 덮는다.
  //
  //   실측: 1차 감시가 초록 6,396개를 통과한 그 커밋에서 아래가 그대로 살아 있었다.
  //     · GIJO_AS_제품소개.md:392 「(모델 합성은 고급 옵션으로 보존)」 — 매니페스트에 실려
  //       RAG로 들어가는 문서다. 챗봇이 「LLM 합성 되나요」에 이 조각을 근거로 **된다고** 답한다.
  //     · GIJO_AS_사용자_매뉴얼.md — 303줄은 「없앴습니다」로 고쳤는데 370줄은 「학습·모델 병합」을
  //       현행 기능으로 열거했다. **한 문서 안에서 상반된 답**이 나온다.
  //     · server/src/engine/airgap.ts 등 — 고객에게 내는 봉인 증명서의 통로 목록.
  //   왜 못 봤나: 흔적이 영문 토큰 8개뿐이라 「모델 병합」 같은 우리말을 원리상 못 잡고,
  //   볼곳이 소스 네 곳이라 매니페스트가 실어 보내는 md는 아예 감시 밖이었다.
  //   「반쪽 삭제를 막는다」는 이 시험의 약속이 실제 잔재 앞에서 성립하지 않았다.
  const 우리말흔적 = /LLM ?합성|모델 ?합성|모델 ?병합|학습·병합|SLERP|mergekit|합성 호환/;
  // 묘비는 남긴다 — 「LLM 합성 되나요」에 **없앴다고** 답하려면 그 낱말이 문서에 있어야 한다.
  // 살아 있는 기능처럼 적힌 것과 가르는 잣대가 이 표식이다(같은 줄에 있어야 한다).
  const 묘비표식 = ["없앤 기능", "없앴습니다", "없앴다", "제공되지 않습니다", "내렸습니다", "내린 기능"];

  it("★ 인입 문서(md)에 **살아 있는 기능처럼** 적힌 곳이 없다", () => {
    const m = JSON.parse(fs.readFileSync(path.join(뿌리, "server", "docs-manifest.json"), "utf8")) as { files: { file: string }[] };
    expect(m.files.length, "매니페스트를 못 읽었다 — 이 검사가 통째로 헛돈다").toBeGreaterThan(10);
    let 읽은문서 = 0;
    const 걸린것: string[] = [];
    for (const e of m.files) {
      const p = path.join(뿌리, String(e.file));
      if (!fs.existsSync(p)) continue; // 존재 여부는 docsmanifest.test가 따로 본다
      읽은문서++;
      fs.readFileSync(p, "utf8").split(/\r?\n/).forEach((줄, i) => {
        if (!우리말흔적.test(줄)) return;
        if (묘비표식.some((t) => 줄.includes(t))) return; // 「없앴습니다」라고 적힌 묘비는 통과
        걸린것.push(`${e.file}:${i + 1}: ${줄.trim().slice(0, 80)}`);
      });
    }
    expect(읽은문서, "매니페스트 문서를 하나도 못 읽었다").toBeGreaterThan(10);
    expect(걸린것,
      "인입 문서가 없는 기능을 현행처럼 적는다 — 챗봇이 이 조각을 근거로 「됩니다」라고 답한다. 같은 줄에 「없앴습니다」 같은 표식을 넣어 묘비로 만들거나 문장을 지울 것").toEqual([]);
  });

  it("★ 제품이 **사람에게 내는 글**에 없는 기능이 남지 않았다", () => {
    // 화면 안내·에어갭 봉인 증명서·대화 답변처럼 고객이 그대로 읽는 문자열을 본다(주석은 뗀다).
    const 문자열예외: Record<string, string> = {
      "server/src/engine/modellicense.ts":
        "합성으로 **만들어진 모델 파일**의 라이선스 규칙이다 — 제품 기능 안내가 아니라 디스크에 남아 있을 수 있는 산출물의 출처 표기라, 지우면 그 모델을 받은 고객의 라이선스 조회가 「모름」이 된다.",
      // ★ 2026-09-08 — 셸의 옛탭 표에 적힌 「LLM 합성」은 **기능 안내가 아니라 닫은 탭의 이름**이다.
      //   담당자에게 나가는 문장은 「제품에서 없어진 화면이라 닫았습니다」이고, 이 낱말은 어느 탭을
      //   닫았는지 말하기 위해서만 쓰인다. 이름을 지우면 탭 이름이 파일명(merge.html)으로 나간다.
      //   ⚠ 파일 통째 예외가 감시를 뚫지 않게, 바로 아래 검사에서 **그 한 줄뿐인지**까지 센다.
      "client/src/renderer/pages/app.html":
        "폐지된 화면의 옛 탭을 닫고 알릴 때 쓰는 **탭 이름**이다(기능 안내가 아니다) — 지우면 담당자에게 파일명 merge.html이 그대로 나간다. 쓰임이 그 한 줄뿐인지는 아래에서 센다.",
    };
    const 걸린것: string[] = [];
    // ⚠ 제품 소스만 본다 — 시험 이름·도구 스크립트는 고객이 읽지 않는다. 넓게 잡으면
    //   modellicense.test의 시험 제목까지 걸려(실제로 걸렸다) 예외가 늘고 감시가 무뎌진다.
    const 제품소스 = 목록.filter((p) => /^(client|server)\/src\//.test(상대(p)));
    expect(제품소스.length, "제품 소스를 하나도 못 찾았다 — 이 검사가 헛돈다").toBeGreaterThan(100);
    for (const p of 제품소스) {
      const 이름 = 상대(p);
      if (이름 in 문자열예외) continue;
      const 코드 = 주석뗀(fs.readFileSync(p, "utf8"));
      코드.split(/\r?\n/).forEach((줄) => {
        if (!우리말흔적.test(줄)) return;
        if (묘비표식.some((t) => 줄.includes(t))) return;
        걸린것.push(`${이름}: ${줄.trim().slice(0, 80)}`);
      });
    }
    expect(걸린것,
      "고객이 읽는 글에 없는 기능이 남았다 — 봉인 증명서·화면 안내가 없는 통로를 열거하면 그 증명서 전체를 못 믿게 된다").toEqual([]);
    for (const [f, 사유] of Object.entries(문자열예외)) {
      expect(사유.length, `${f}: 예외인데 이유가 없다`).toBeGreaterThan(30);
      expect(fs.existsSync(path.join(뿌리, f)), `${f}: 표에 있는데 파일이 없다 — 낡은 표는 거짓 안심을 준다`).toBe(true);
    }
    // ⚠ **파일 통째 예외가 감시를 뚫지 않게 센다**(2026-09-08). app.html은 4,000줄 가까운 셸이라
    //   「예외 파일」로 두면 그 안에서 새로 생기는 문장이 영영 안 보인다. 허용은 옛탭 표 한 줄뿐이다.
    const 셸줄 = 주석뗀(fs.readFileSync(path.join(뿌리, "client/src/renderer/pages/app.html"), "utf8"))
      .split(/\r?\n/).filter((줄) => 우리말흔적.test(줄) && !묘비표식.some((t) => 줄.includes(t)));
    expect(셸줄.map((s) => s.trim().slice(0, 80)),
      "셸에서 합성을 말하는 줄이 옛탭 표 한 줄을 넘었다 — 예외를 늘리기 전에 그 문장이 없는 기능을 파는지 볼 것")
      .toEqual(['"merge.html": { 버림: true, label: "LLM 합성" },']);
  });

  it("안내 문서는 목록에서 빼는 것으로 끝내지 않고 **_제외에 등재**한다", () => {
    // 실측(2026-08-03): files[]에서 빼기만 하면 이미 인입된 조각이 그대로 남아 검색 1위로 나온다.
    const m = JSON.parse(fs.readFileSync(path.join(뿌리, "server", "docs-manifest.json"), "utf8")) as {
      files: { file: string }[]; _제외?: { file?: string; why?: string }[];
    };
    expect(m.files.some((f) => String(f.file).includes("LLM_합성")), "내린 문서가 아직 files[]에 있다").toBe(false);
    const 등재 = (m._제외 ?? []).find((x) => String(x.file ?? "").includes("LLM_합성"));
    expect(등재, "_제외에 없다 — 다음 기동에도 지식베이스에 남아 챗봇이 없는 기능을 안내한다").toBeTruthy();
    expect(String(등재!.why ?? "").length, "왜 뺐는지가 없다").toBeGreaterThan(20);
  });
});
