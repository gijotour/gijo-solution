// merge(LLM 합성)를 **통째로 내렸다** — 반쪽만 지워지지 않았는지 소스로 감시한다. (2026-09-07)
//
// 무엇을 내렸나: 화면 merge.html · 엔진 server/src/engine/merge.ts · 창구 /api/merge/plan·
//   /api/merge/preflight · 클라 API(mergeApi·MergePlan) · preload(planMerge·mergePreflight) ·
//   안내 문서 GIJO_AS_LLM_합성_안내.md · 화면 안내(GUIDES·screencontext) · 용어 별칭.
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
const 흔적 = ["merge.html", "/api/merge", "planMerge", "mergePreflight", "registerMergeRoutes", "mergeApi", "MergePlan", "engine/merge"];

// 주석에 남는 것은 **기록**이라 막지 않는다 — 다만 어느 파일에 왜 남겼는지 여기 적어야 한다.
// 표에 없는 파일이 주석으로 merge를 부르면 빨간불이 뜬다(새 주석은 사람이 판단할 자리다).
const 주석예외: Record<string, string> = {
  "server/src/engine/screenguide.ts":
    "화면위치안내()의 retired 분기가 왜 있는지를 적은 교훈 주석 — 「메뉴에서 내려갔습니다」와 「사이드바에서 찾으세요」가 한 답에서 모순됐던 실측이 merge.html이었다. 다음에 화면을 내릴 때 이 분기를 다시 쓴다.",
  "server/src/engine/modeldex.ts":
    "synthesisGroups()의 사람 소비자가 0이 된 사연 — 유일한 소비자가 merge.html이었다. 값은 /api/modeldex로 여전히 나가므로 지우지 않되, 누가 보는지를 남긴다.",
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
      const 코드 = 주석뗀(fs.readFileSync(p, "utf8"));
      for (const t of 흔적) if (코드.includes(t)) 걸린것.push(`${이름}: ${t}`);
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
      if (!(이름 in 주석예외)) 표밖.push(이름);
    }
    expect(표밖, "merge를 언급하는 새 주석이 생겼다 — 기록으로 남길 이유를 mergeremoved.test.ts 주석예외 표에 적거나, 언급을 지울 것").toEqual([]);
    for (const [f, 사유] of Object.entries(주석예외)) {
      expect(사유.length, `${f}: 예외인데 이유가 없다 — 이유 없는 예외는 다음 사람이 그냥 늘린다`).toBeGreaterThan(30);
      expect(fs.existsSync(path.join(뿌리, f)), `${f}: 표에 있는데 파일이 없다 — 낡은 표는 거짓 안심을 준다`).toBe(true);
    }
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
