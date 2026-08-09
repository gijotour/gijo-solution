// tools/test-map.mjs — 시험 지도를 만든다. `node tools/test-map.mjs`
//
// 왜: 시험이 275개인데 **어떤 시험이 무엇을 지키는지** 볼 자리가 없었다. 새로 온 사람은
// 물론이고 우리도 "이건 어디서 막히지?"를 매번 grep으로 찾았다.
//
// ★ 분류 근거는 **파일 이름이 아니라 그 시험이 실제로 import하는 소스**다.
//   이름으로 나누면 그럴듯한데 틀린 지도가 나온다(예: adaptertools는 모델 쪽인데
//   이름만 보면 도구로 간다). import는 거짓말을 못 한다.
//
// 분류하지 못한 것은 **감추지 않고 「분류 못 함」에 그대로 싣는다** — 지도에 빈 곳이 있으면
// 그 사실이 보여야 한다.
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(import.meta.dirname, "..");
const TEST_DIR = path.join(ROOT, "server", "test");
const OUT = path.join(ROOT, "GIJO_AS_시험지도.md");

// 영역 = (묶음 이름, 이 영역으로 볼 소스 모듈 이름 조각). 위에서부터 먼저 맞는 것을 쓴다.
// ⚠ 순서가 곧 우선순위다. 좁은 것을 위에 둔다.
// ⚠ 규칙은 **모듈 이름 하나씩** 두들긴다. 예전엔 import를 전부 한 줄로 붙여 놓고 `^`를 썼는데
//   그러면 `app`을 먼저 import한 시험은 뒤의 `engine/cti`가 영영 안 걸렸다(27개가 그렇게 샜다).
const 영역들 = [
  ["보안·인증", /^(auth|users|mfa|totp|cryptopack|dbcrypt|dbencrypt|jwt|sessionmgmt|guardrail|redteam|injection|injectionrules|airgap|cors|gateway|gatewaypii|promptleak|harmfulrequest|corpusleak|scopeguard|innerkeymask|inputvalidation|grades|gradeblock|secretscan|auth-secret-guard|ragsanitize|routing-leak|totp)/i],
  ["대화·라우팅", /^(dispatch|dispatcher|agentloop|agenttools|intent|routes|screenguide|screencontext|console|consoleguide|consoledrawer|picklist|anaphora|assetanaphora|selectioncontext|forced|urgentroute|policyroute|assignroute|nextstep|smalltalk|cmdsuggest|tools|agents|scope-resolve|stepdisambiguate|streamdispatch|tooldomain|routingfixes)/i],
  ["말투·표기", /^(tone|tonewatch|statuswords|answerlength|listformat|report-preamble|interpretline|severity-korean|uireadability|findingplain)/i],
  ["모델·엔진", /^(localengine|llm|llmactivity|model|models?|finetune|adapter|adapters|lora|prompt|promptcache|llamabin|pythonbin|trainenv|dataset|orchestrator|merge|modeldex|modelauth|modellicense|modelquirks|modelscan|modelsmoke|modeladoption|hfmodels|observability-model)/i],
  ["지식·RAG", /^(memory|rag|docs?|docbox|knowledge|ontology|embed|glossary|learn|terms|bundle|seed|hybridsearch|grounding|kbhygiene|docgraph|docdigest|docdupe|docenrich|docrequest|docsbundle|howto|productfaq|productintro|productmanual|answerfeedback|learncandidates|learnhygiene|learnloop|learnpolicy|examquestions|ingestquality)/i],
  ["취약점·자산", /^(vuln|finding|asset|sbom|aibom|scan|cve|kev|epss|packagescan|reposcan|eol|exposed|attackpath|serviceimpact|vex|shadowai|severity|autoassign|scanoverwrite|assethub|assetcoverage|assetimport|assetdocsearch|assetbyname|vulnimport|webreport|bundleimport|bundleverify|adapterimport)/i],
  ["규정·법령", /^(compliance|law|lawinfo|lawarticle|lawlookup|policy|actioncheck|license|n2sf|demo-disclosure|categoryreject)/i],
  ["점검·하드닝", /^(hardening|maintenance|verify|verifyengine|verifyrag|verifyroutes|verifyaccess|playbook|incident|incidentsteps|hygiene|selfinstall|preflight|hardeningscan|hardeningtargets|netmikorunner|domaintools)/i],
  ["로그·분석", /^(logs?|logguide|analysis|analysishub|siem|correlat|crosscorrelation|event|eventlifecycle|cti|ctimatch|threat|observability|activityaudit|audit|auditactor|reposcan)/i],
  ["보고·리포트", /^(report|reportactivity|reportschedule|reporthandoff|longanswer|longnotice|qalongwait|kpi|timesaved|usage|progress|ga-readiness|demoscript|vexexport|shotlist)/i],
  ["업무·세션", /^(task|tasks|work|workflow|worksessions|worksteps|workprogress|worklockroute|mytasks|mywork|session|sessionarchive|sessionpatterns|handover|handoverhistory|collaboration|today|approvals|agentapproval|undo|schedule|alertschedule|backup|findingsrestore|datacleanup|teamview)/i],
  ["화면·클라이언트", /^(client|clientglobals|clientrelease|clientdownloadlog|nav|navwiring|window|windowlayout|shell|shelllayout|ui|screen|screen-where|layout|viewer|viewerctx|deadelement|silentbutton|guidecard|drawer|map-view|personaldocs|vizpromise|guidance)/i],
  ["기반(DB·유틸)", /^(db|dbkey|date|util|versioncmp|email|gracefulclose|hfmodels-queue|cloudegress|cloudllm|corsutil)/i],
];

/** 시험이 제품 소스를 안 부르고 **소스·문서 자체를 읽어 검사**하는가(감시 시험). */
const 감시인가 = (src) =>
  /readFileSync|execFileSync|git\s+ls-files|guidance-check|readdirSync/.test(src) &&
  !/from\s+["']\.\.\/src\//.test(src);

const 파일들 = fs
  .readdirSync(TEST_DIR)
  .filter((f) => f.endsWith(".test.ts"))
  .sort();

const 분류 = new Map(); // 영역 -> [{이름, 근거}]
const push = (영역, 값) => (분류.get(영역) ?? 분류.set(영역, []).get(영역)).push(값);

let 감시수 = 0;
for (const f of 파일들) {
  const src = fs.readFileSync(path.join(TEST_DIR, f), "utf8");
  const 이름 = f.replace(/\.test\.ts$/, "");

  if (감시인가(src)) {
    감시수++;
    push("★ 감시 — 약속을 지키는지 본다", { 이름, 근거: "소스·문서를 직접 읽어 검사" });
    continue;
  }

  // 이 시험이 부르는 제품 소스들(../src/... 경로의 마지막 조각).
  const 모듈들 = [...src.matchAll(/from\s+["']\.\.\/src\/([^"']+)["']/g)].map((m) =>
    m[1].replace(/\.js$/, "")
  );
  const 근거 = 모듈들[0] ? `src/${모듈들[0]}` : "(제품 소스 import 없음)";
  // 후보 = 부르는 모듈의 **이름 조각들** + 시험 자기 이름. 하나씩 따로 두들긴다.
  //   `app`은 거의 모든 라우트 시험이 부르므로 영역을 못 가른다 — 후보에서 뺀다.
  const 후보 = [...모듈들.map((m) => m.split("/").pop()), 이름].filter((x) => x && x !== "app");

  const hit = 영역들.find(([, re]) => 후보.some((c) => re.test(c)));
  push(hit ? hit[0] : "분류 못 함", { 이름, 근거 });
}

// ── 문서로 뽑는다 ───────────────────────────────────────────────
const 순서 = ["★ 감시 — 약속을 지키는지 본다", ...영역들.map(([n]) => n), "분류 못 함"];
const 줄 = [];
줄.push("# GIJO AS — 시험 지도");
줄.push("");
줄.push(`\`node tools/test-map.mjs\` 로 만듭니다. **손으로 고치지 마세요** — 다시 만들면 덮어씁니다.`);
줄.push("");
줄.push(`시험 파일 **${파일들.length}개**. 분류 근거는 파일 이름이 아니라 **그 시험이 실제로 import하는 소스**입니다.`);
줄.push("");
줄.push("```");
줄.push("server/test/");
for (const 영역 of 순서) {
  const 목록 = 분류.get(영역);
  if (!목록 || !목록.length) continue;
  줄.push(`├── ${영역}/  (${목록.length})`);
  목록.sort((a, b) => a.이름.localeCompare(b.이름));
  목록.forEach((t, i) => {
    const 가지 = i === 목록.length - 1 ? "└──" : "├──";
    줄.push(`│   ${가지} ${t.이름}.test.ts`);
  });
}
줄.push("```");
줄.push("");
줄.push("## 영역별 근거");
줄.push("");
줄.push("| 영역 | 개수 | 대표 시험 → 무엇을 부르나 |");
줄.push("| --- | ---: | --- |");
for (const 영역 of 순서) {
  const 목록 = 분류.get(영역);
  if (!목록 || !목록.length) continue;
  const 예 = 목록.slice(0, 2).map((t) => `\`${t.이름}\` → ${t.근거}`).join(" · ");
  줄.push(`| ${영역} | ${목록.length} | ${예} |`);
}
줄.push("");
const 못함 = 분류.get("분류 못 함") ?? [];
줄.push(
  못함.length
    ? `> ⚠ **분류 못 한 시험이 ${못함.length}개** 있습니다. 지도에 빈 곳이 있으면 그 사실이 보여야 하므로 감추지 않습니다. tools/test-map.mjs의 \`영역들\`에 규칙을 더하면 줄어듭니다.`
    : "> 분류 못 한 시험은 없습니다."
);
줄.push("");
줄.push("## ★ 감시 시험이란");
줄.push("");
줄.push(
  "제품 코드를 부르는 대신 **소스와 문서를 직접 읽어** 약속이 지켜지는지 보는 시험입니다" +
    `(${감시수}개). 예: 제품이 "이렇게 물어보세요"라고 적어 준 말이 정말 그 기능으로 가는가(\`guidance-routing\`), ` +
    "비밀번호가 코드에 적혀 있지 않은가(`no-hardcoded-credentials`), 눌러도 말없는 버튼이 없는가(`silentbuttons`)."
);
줄.push("");
줄.push(
  "> ⚠ **헛통과 주의.** 감시 시험은 대상을 하나도 못 읽으면 「0건 발견」으로 **항상 통과**합니다. " +
    "그래서 각 시험은 「대상을 실제로 읽었는가」를 함께 확인합니다. 그 확인을 지우지 마세요."
);
줄.push("");

fs.writeFileSync(OUT, 줄.join("\n"), "utf8");
console.log(`시험 ${파일들.length}개 → ${path.relative(ROOT, OUT)}`);
for (const 영역 of 순서) {
  const n = (분류.get(영역) ?? []).length;
  if (n) console.log(`  ${String(n).padStart(3)}  ${영역}`);
}
