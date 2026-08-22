// tools/gen-sbom-self.mjs — **우리 제품 자신의 부품표(SBOM)를 만들고 라이선스를 점검한다.**
//
// ■ 왜 생겼나 (2026-08-22)
//   스캔 문서 기능을 만들며 **PyMuPDF(AGPL-3.0)를 설치본에 동봉**했다가 게시 직전 검토에서 걸렸다.
//   그전엔 「고객이 알아서 까는 옵션」이라 우리가 배포하는 물건이 아니었는데, 동봉하는 순간
//   **우리가 배포하는 제품의 일부**가 된 것을 아무도 못 봤다. 사람 눈으로는 못 막는다 — 실제로 못 막았다.
//   공공·금융 납품 심사나 SBOM 점검에서 잡히면 **제품 소스 공개** 또는 **상용 라이선스 구매**를
//   요구받는다. AI-BOM·SBOM을 파는 제품이 자기 SBOM에서 걸리는 모양이 된다.
//
// ■ 무엇을 하나
//   ① 우리가 **실제로 배포하는** 부품을 모은다 — node 꾸러미(server·client) + 동봉 파이썬.
//   ② `licenserisk.ts`의 **같은 판정기**로 등급을 매긴다(잣대를 두 벌 두지 않는다).
//   ③ 무거운 것이 있으면 **exit 1** — 게시 사슬에 물리면 같은 사고가 원리상 재발하지 않는다.
//   ④ 서드파티 **고지 목록**을 만든다(BSD·Apache·MIT는 고지가 의무인데 그 자리가 없었다).
//
// ⚠ 외부 꾸러미를 쓰지 않는다(server/test/toolsdeps.test.ts 계약) — node 내장만.
// ⚠ `--json`으로 SBOM(CycloneDX 비슷한 최소형)을 찍고, 기본은 사람이 읽는 표를 낸다.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { 원장읽기 } from "./lib/vendor-manifest.mjs";

const 루트 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const JSON출력 = process.argv.includes("--json");
const 고지쓰기 = process.argv.includes("--write-notice");

// ── 판정기를 가져온다 — **여기서 규칙을 다시 쓰지 않는다** ────────────────────────
//   dist가 있으면 그걸 쓰고, 없으면 안내하고 멈춘다(규칙을 복사해 두면 반드시 어긋난다).
const 판정기경로 = path.join(루트, "server", "dist", "engine", "licenserisk.js");
if (!fs.existsSync(판정기경로)) {
  console.error(`★ 판정기가 없습니다: ${판정기경로}`);
  console.error("  server에서 빌드가 필요합니다:  cd server && npx tsc -p tsconfig.json");
  console.error("  ⚠ 여기에 규칙을 복사하지 마세요 — 잣대가 두 벌이 되면 반드시 하나가 낡습니다.");
  process.exit(2);
}
// ⚠ 서버는 CommonJS로 빌드된다 — ESM import()로는 못 읽는다(`exports is not defined`).
//   createRequire로 부른다(이 파일은 .mjs라 require가 없다).
const { 등급판정, 등급요약, 면책문구, 라이선스모름, 상용사용금지 } = createRequire(import.meta.url)(판정기경로);

/** node_modules에서 **실제로 설치된** 꾸러미의 라이선스를 읽는다.
 *  ⚠ package.json의 dependencies 목록이 아니라 **설치된 것**을 본다 — 전이 의존까지 배포되기 때문이다.
 *    (우리가 걸린 것도 직접 의존이 아니라 「함께 실려 나간 것」이었다.) */
function node꾸러미(어디) {
  const nm = path.join(어디, "node_modules");
  const 모음 = [];
  if (!fs.existsSync(nm)) return 모음;
  const 훑기 = (디렉터리, 접두 = "") => {
    let 목록;
    try { 목록 = fs.readdirSync(디렉터리, { withFileTypes: true }); } catch { return; }
    for (const e of 목록) {
      if (!e.isDirectory() && !e.isSymbolicLink()) continue;
      if (e.name === ".bin" || e.name === ".cache") continue;
      if (e.name.startsWith("@")) { 훑기(path.join(디렉터리, e.name), e.name + "/"); continue; }
      const pj = path.join(디렉터리, e.name, "package.json");
      if (!fs.existsSync(pj)) continue;
      try {
        const j = JSON.parse(fs.readFileSync(pj, "utf8"));
        // license가 문자열이 아닐 수 있다(옛 형식은 licenses 배열).
        let lic = j.license;
        if (!lic && Array.isArray(j.licenses)) lic = j.licenses.map((l) => l.type || l).join(" OR ");
        if (lic && typeof lic === "object") lic = lic.type || "";
        모음.push({ 이름: 접두 + e.name, 판: j.version || "", 라이선스: String(lic ?? ""), 갈래: "node" });
      } catch { /* 읽을 수 없는 package.json은 건너뛴다 — 아래 「판정불가」로 잡히지 않게 목록에서 뺀다 */ }
    }
  };
  훑기(nm);
  return 모음;
}

/** 동봉 파이썬에 실제로 심긴 것 — 표식(GIJO-PYTHON-VERSION.json)이 판까지 적어 둔다.
 *  ⚠ requirements 파일이 아니라 **표식**을 본다: 「적힌 것」과 「실린 것」은 다를 수 있고,
 *    우리가 데인 것이 바로 그 차이였다. */
function 파이썬꾸러미() {
  const 표식 = path.join(루트, "client", "build", "python-dist", "GIJO-PYTHON-VERSION.json");
  if (!fs.existsSync(표식)) return { 목록: [], 표식있나: false };
  const j = JSON.parse(fs.readFileSync(표식, "utf8"));
  const 사이트 = path.join(루트, "client", "build", "python-dist", "site-packages");
  const 목록 = [];
  // dist-info의 METADATA에서 라이선스를 읽는다 — 표식은 판만 적는다.
  if (fs.existsSync(사이트)) {
    for (const d of fs.readdirSync(사이트)) {
      if (!/\.dist-info$/.test(d)) continue;
      const m = path.join(사이트, d, "METADATA");
      if (!fs.existsSync(m)) continue;
      const t = fs.readFileSync(m, "utf8").slice(0, 8000);
      const 이름 = (t.match(/^Name:\s*(.+)$/m) || [])[1] || d.replace(/-[^-]*\.dist-info$/, "");
      const 판 = (t.match(/^Version:\s*(.+)$/m) || [])[1] || "";
      // ⚠ **`License-Expression:`을 먼저 본다**(PEP 639, 2026-08-22 실측으로 발견).
      //   요즘 파이썬 꾸러미는 이 줄에 **정본 SPDX 식**을 적는다 — 우리에게 가장 좋은 자료인데
      //   `License:`만 보다가 numpy·pypdf·rapidocr 등 7개를 「표기 없음」으로 잘못 세고 있었다.
      //   실측 예: numpy → `BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0`(식 그대로 온다).
      //   순서: License-Expression(정본) → License(자유 표기) → Classifier(분류표).
      let lic = (t.match(/^License-Expression:\s*(.+)$/m) || [])[1] || "";
      // ⚠ **`License: UNKNOWN`은 「비어 있음」과 같이 다뤄야 한다**(2026-08-22 실측).
      //   omegaconf 2.0.0이 정확히 그렇다 — `License: UNKNOWN`이라 적어 놓고
      //   바로 아래 `Classifier: License :: OSI Approved :: BSD License`가 있고
      //   LICENSE 파일에도 BSD 전문이 들어 있다. 그런데 "UNKNOWN"이 **빈 문자열이 아니라서**
      //   분류표 대체 경로가 영영 안 돌았고, 우리 부품표에 **판정불가 1건**으로 남아 있었다.
      //   ★ 「모른다」의 잣대는 판정기가 갖고 있다(모름표기 집합) — 여기에 두 벌째를 만들지 않는다.
      if (라이선스모름(lic)) lic = "";
      if (!lic) lic = (t.match(/^License:\s*(.+)$/m) || [])[1] || "";
      if (라이선스모름(lic)) lic = "";
      if (!lic) {
        // 분류표는 여러 줄일 수 있다 — 전부 모아 AND로 잇는다(하나만 보면 무거운 것을 놓친다).
        const cs = [...t.matchAll(/^Classifier:\s*License\s*::\s*(.+)$/gm)]
          .map((m) => m[1].replace(/^OSI Approved\s*::\s*/, "").trim())
          .filter((s) => s && !/^OSI Approved$/i.test(s));
        if (cs.length) lic = [...new Set(cs)].join(" AND ");
      }
      목록.push({ 이름: 이름.trim(), 판: 판.trim(), 라이선스: lic.trim(), 갈래: "python(동봉)" });
    }
  }
  return { 목록, 표식있나: true, ocr: j.ocr, python: j.python };
}

/** node 꾸러미가 아닌 **동봉물** — 있으면 센다.
 *
 *  ⚠ 이것들은 dist-info도 package.json도 없어 **원리상 자동으로 안 잡힌다.** 그래서 여기 적는다.
 *    손 목록이라 낡을 수 있으므로 **파일이 실제로 있을 때만** 싣고, 없으면 그냥 뺀다
 *    (「목록에 있는데 파일이 없다」로 관문이 빨개지면 아무도 안 본다).
 *  ⚠ 새 동봉물을 extraResources에 더할 때 **여기도 더할 것** — 안 그러면 고지에서 빠진다.
 */
/** smartmd 원장을 **싣는데 못 읽은** 경우의 사유. 비어 있으면 정상.
 *  ⚠ 이 사고의 본체가 「조용한 0」이었으므로 경고만 찍고 넘어가지 않는다 — 관문이 막는다. */
let 동봉원장고장 = "";

function 동봉바이너리() {
  const 표 = [
    { 이름: "llama.cpp (CUDA 빌드)", 라이선스: "MIT", 어디: path.join(루트, "client", "build", "llama-cuda") },
    { 이름: "llama.cpp (Metal 빌드)", 라이선스: "MIT", 어디: path.join(루트, "client", "build", "llama-metal") },
    { 이름: "CPython (임베더블 런타임)", 라이선스: "Python-2.0", 어디: path.join(루트, "client", "build", "python-dist", "python.exe") },
    // ⚠ **여기에 「MIT」라고 적혀 있었다**(2026-08-22 실측으로 발견). 마이크로소프트 재배포
    //   런타임은 오픈소스가 아니고 MIT도 아니다 — 비고에는 「오픈소스 아님」이라 적어 두고
    //   라이선스 칸에는 MIT를 넣어 **고지 목록에 「MIT」로 나가고 있었다.** 거짓 고지다.
    //   이 관문의 존재 이유가 「거짓 고지를 막는 것」인데 관문 자신이 하나를 만들고 있었다.
    //   정직하게 적으면 판정불가로 떨어지는데, 판정불가는 관문을 막지 않으니(아래 240행) 맞는 자리다.
    { 이름: "Microsoft Visual C++ 재배포 런타임 (msvcp140 계열)",
      라이선스: "LicenseRef-Microsoft-VC-Redist (Visual Studio 재배포 조건 — 오픈소스 아님)",
      어디: path.join(루트, "client", "build", "python-dist", "msvcp140.dll"),
      비고: "마이크로소프트가 정한 재배포 조건을 따릅니다. 오픈소스 라이선스가 아니며 SPDX 식별자가 없습니다." },
    { 이름: "bge-m3 (임베딩 모델)", 라이선스: "MIT", 어디: path.join(루트, "server", "models", "bge-m3") },
    { 이름: "PP-OCRv5 한국어 모델", 라이선스: "Apache-2.0", 어디: path.join(루트, "client", "build", "python-dist", "site-packages", "rapidocr", "models") },
  ];
  const 모음 = [];
  for (const t of 표) {
    if (!fs.existsSync(t.어디)) continue;
    모음.push({ 이름: t.이름, 판: "", 라이선스: t.라이선스, 갈래: "동봉물", 비고: t.비고 });
  }
  모음.push(...smartmd동봉());
  return 모음;
}

/** smartmd vendor 동봉물 — **파서는 tools/lib/vendor-manifest.mjs 한 곳**에 있다.
 *
 *  ★★ 이 자리가 조용히 0개를 읽고 있었다(2026-08-22 실측).
 *    옛 정규식은 「- 이름 | 판 | 라이선스」 꼴(목록)을 기다렸는데 그 파일은 **마크다운 표**다.
 *    한 줄도 안 걸렸고 **아무 오류도 안 났다** — 「없는 것」과 「못 읽은 것」이 구분되지 않았다.
 *    그래서 우리가 배포하는 **Font Awesome의 CC-BY-4.0(아이콘)·SIL OFL-1.1(글꼴)** 고지가
 *    통째로 빠져 있었다. 둘 다 **고지가 의무**인 라이선스다.
 *
 *  ⚠ 파서를 여기 두지 않는 이유: 감시 시험이 **사본**을 재고 있어서, 시험이 초록이어도
 *    게시에 물린 진짜 파서가 깨질 수 있었다(검토관 [중]). 이제 둘이 같은 것을 부른다.
 */
function smartmd동봉() {
  const r = 원장읽기(루트);
  동봉원장고장 = r.고장;
  return r.목록.map((c) => ({
    이름: `${c.이름} (문서 작성 도구)`, 판: c.판, 라이선스: c.라이선스, 갈래: "동봉물",
  }));
}

// ── 모으기 ────────────────────────────────────────────────────────────────
//
// ⚠ **모집단이 「실제로 배포하는 것」이어야 한다**(2026-08-22 검토관 [높음]).
//   처음엔 server·client의 node_modules를 통째로 훑었는데, 그러면 두 방향으로 다 틀린다:
//     ① 개발 도구(vitest·electron-builder·typescript…)를 「제품에 포함돼 있습니다」라고 고지한다 —
//        client는 dependencies가 아예 없어 **전부** 개발 도구다. 거짓 고지다.
//     ② 반대로 **정말 나가는 것**을 빠뜨린다 — llama.cpp 바이너리·bge-m3 모델·
//        임베더블 CPython 자체·MSVC 재배포 DLL·smartmd vendor(JS 4종).
//   이 관문의 존재 이유가 「우리가 배포하는 물건이 된 순간을 아무도 못 봤다」인데
//   모집단이 배포물과 다르면 같은 사고가 다시 난다.
//   ★ 그래서 **추측하지 않고 실제 배포 집합을 잰다** — build-server-dist가
//     `npm ci --omit=dev`로 만든 `client/server-dist/node_modules`가 고객에게 나가는 그것이다.
//     실측 2026-08-22: 개발 트리 543개 vs **실제 배포 265개**. 절반이 개발 도구였다.
//     (devDeps 이름만 걸러 내는 방식은 **그 하위 의존이 그대로 남아** 10개밖에 못 걸렀다.)
//   ⚠ 이 폴더는 build-server-dist가 만든다 — 그래서 관문이 **그 뒤**에 돈다(client/package.json).
const 배포집합 = path.join(루트, "client", "server-dist");
if (!fs.existsSync(path.join(배포집합, "node_modules"))) {
  console.error(`★ 실제 배포 집합이 없습니다: ${배포집합}/node_modules`);
  console.error("  이 관문은 build-server-dist **뒤에** 돌아야 합니다(개발 트리를 재면 절반이 개발 도구다).");
  console.error("  만들려면:  cd client && npm run build-server-dist");
  process.exit(2);
}
const 부품 = node꾸러미(배포집합);
const py = 파이썬꾸러미();
부품.push(...py.목록);
부품.push(...동봉바이너리());

// 같은 이름·판이 두 곳에 있으면 한 번만 센다.
const 중복제거 = new Map();
for (const c of 부품) 중복제거.set(`${c.갈래}|${c.이름}|${c.판}`, c);
const 최종 = [...중복제거.values()].sort((a, b) => a.이름.localeCompare(b.이름));

const 판정된것 = 최종.map((c) => ({ ...c, 판정: 등급판정(c.라이선스) }));
const 요약 = 등급요약(판정된것.map((c) => c.판정));

// ── 내보내기 ──────────────────────────────────────────────────────────────
if (JSON출력) {
  console.log(JSON.stringify({
    제품: "GIJO AS",
    만든날: new Date().toISOString(),
    파이썬동봉: py.표식있나 ? { python: py.python, ocr: py.ocr } : null,
    요약: 요약.등급별,
    부품: 판정된것.map((c) => ({
      name: c.이름, version: c.판, license: c.라이선스, 갈래: c.갈래,
      등급: c.판정.등급, 받게되는요구: c.판정.받게되는요구, 확인필요: c.판정.확인필요,
    })),
  }, null, 2));
} else {
  const 배지 = { 의무없음: "⚪", 고지만: "🟢", 고친파일공개: "🟡", 전체소스공개: "🟠", 서비스도공개: "🔴", 판정불가: "❓" };
  console.log(`\n■ GIJO AS 부품표 — ${최종.length}개 (node ${최종.filter((c) => c.갈래 === "node").length} · 파이썬 동봉 ${py.목록.length})`);
  // ⚠ mac에서는 파이썬을 **일부러 안 싣는다**(stage-python이 win32가 아니면 비켜 간다).
  //   거기서 「아직 안 꾸려졌습니다」라고 하면 무언가 잘못된 것처럼 읽혀 사람을 헤매게 한다.
  if (!py.표식있나) {
    console.log(process.platform === "win32"
      ? "  ⚠ 동봉 파이썬이 아직 안 꾸려졌습니다 — `node tools/stage-python.mjs` 뒤에 다시 재세요."
      : "  ℹ 이 기계(mac/리눅스)에는 파이썬을 동봉하지 않습니다 — 파이썬 부품은 목록에 없는 것이 정상입니다.");
  }
  console.log("\n  등급별:");
  for (const [등급, n] of Object.entries(요약.등급별)) {
    if (n) console.log(`    ${배지[등급]} ${등급.padEnd(8)} ${String(n).padStart(4)}개`);
  }
  if (요약.무거운것.length) {
    console.log(`\n  ⚠ 지금 봐야 하는 것 ${요약.무거운것.length}개:`);
    for (const c of 판정된것.filter((x) => 요약.무거운것.includes(x.판정))) {
      console.log(`    ${배지[c.판정.등급]} ${c.이름}@${c.판} [${c.갈래}] — ${c.라이선스 || "(라이선스 표기 없음)"}`);
      console.log(`       → ${c.판정.받게되는요구}`);
      // 판정불가는 **왜 못 정했는지**가 실제로 할 일을 가른다 — 「표기가 틀렸다」와
      // 「정본에 없는 개별 라이선스라 원문을 받아야 한다」는 다음 행동이 다르다.
      if (c.판정.등급 === "판정불가") console.log(`       ↳ ${c.판정.근거}`);
    }
  }
  console.log(`\n  ${면책문구}`);
}

// ── 고지 목록 ─────────────────────────────────────────────────────────────
if (고지쓰기) {
  const 줄 = ["# GIJO AS — 서드파티 고지(Third-Party Notices)", "",
    // ⚠ 「오픈소스 부품」이라고만 적으면 **거짓**이다 — 마이크로소프트 재배포 런타임처럼
    //   오픈소스가 아닌 동봉물도 이 목록에 있다(2026-08-22).
    "이 제품에는 아래 제3자 부품이 포함돼 있습니다. 각 부품의 저작권과 라이선스를 고지합니다.",
    "대부분 오픈소스이며, 오픈소스가 아닌 것은 항목에 그렇게 적어 두었습니다.",
    "", `- 만든 날: ${new Date().toISOString().slice(0, 10)}`,
    `- 부품 수: ${최종.length}개`, "", "---", ""];
  for (const c of 판정된것) {
    줄.push(`- **${c.이름}** ${c.판}${c.갈래 !== "node" ? ` (${c.갈래})` : ""} — ${c.라이선스 || "라이선스 표기 없음"}`);
    // ⚠ 비고를 **찍지 않고 있었다** — 「오픈소스 아님」 같은 말이 코드에만 있고
    //   정작 고객이 보는 고지에는 안 나갔다. 적어 둔 것은 나가야 적어 둔 값이 있다.
    if (c.비고) 줄.push(`  - ${c.비고}`);
  }
  const 내용 = 줄.join("\n") + "\n";
  // ⚠ **두 곳에 쓴다** — 뜻이 다르다(2026-08-22).
  //   ① 저장소 뿌리: 개발자가 보는 것. 추적하지 않는다(빌드 산출물이라 두 벌이 되면 어긋난다).
  //   ② client/build/: **고객 설치본에 실려 나가는 것.** MIT·Apache·BSD는 고지가 **의무**인데
  //      그 자리가 아예 없었다 — 570개를 싣고도 고지를 안 하는 상태였다.
  //      electron-builder의 extraResources가 이 파일을 resources/로 옮긴다.
  const 자리들 = [path.join(루트, "THIRD-PARTY-NOTICES.md"), path.join(루트, "client", "build", "THIRD-PARTY-NOTICES.md")];
  for (const 자리 of 자리들) {
    fs.mkdirSync(path.dirname(자리), { recursive: true });
    fs.writeFileSync(자리, 내용, "utf8");
  }
  console.log(`\n  고지 목록: ${자리들.map((p) => path.relative(루트, p)).join(" · ")}`);
}

// ── 관문 ──────────────────────────────────────────────────────────────────
// ⚠ 여기서 막는 것은 **배포에 실리는 카피레프트**다. 「판정 불가」는 막지 않는다 —
//   node 생태계에는 라이선스를 안 적은 꾸러미가 흔해서, 막으면 관문이 늘 빨개져 아무도 안 본다.
//   대신 숫자로 보여 준다(그 수가 늘면 그때 좁힌다).
// ★ **「상용으로 아예 못 쓴다」도 막는다**(2026-08-22 보강). 등급 5단계와 다른 축이라
//   위 조건만으로는 안 걸린다 — NC/ND는 판정불가로 떨어지는데 판정불가는 안 막기 때문이다.
//   우리는 바로 이날 CC BY-NC-ND 문서를 상용 제품에 실어 배포하다가 **사람 눈으로** 잡았다.
//   그것이 부품이었다면 이 관문을 그대로 통과했을 것이다.
//   ⚠ 판단은 licenserisk의 `상용사용금지()` 한 곳 — 여기에 정규식을 복사하지 말 것.
const 상용불가 = 판정된것.filter((c) => 상용사용금지(c.라이선스));
const 막을것 = 판정된것.filter((c) => c.판정.등급 === "서비스도공개" || c.판정.등급 === "전체소스공개");
if (상용불가.length) {
  console.error(`\n★ **상용 제품에 실을 수 없는** 부품 ${상용불가.length}건 — 비영리(NC)·변경금지(ND) 조건입니다.`);
  console.error("  소스를 공개해도 풀리지 않습니다 — 사용 자체가 허락되지 않은 경우입니다.");
  for (const c of 상용불가) console.error(`  · ${c.이름}@${c.판} [${c.갈래}] ${c.라이선스}`);
  console.error("  대체 부품을 찾거나 저작권자에게 상용 이용 허락을 받으세요.");
}
if (막을것.length) {
  console.error(`\n★ 배포에 실을 수 없는 라이선스 ${막을것.length}건 — 게시하면 소스 공개 또는 상용 구매를 요구받습니다.`);
  for (const c of 막을것) console.error(`  · ${c.이름}@${c.판} [${c.갈래}] ${c.라이선스}`);
  console.error("  대체 부품을 찾거나, 이 부품을 배포물에서 빼세요.");
}
// ★ **「싣는데 못 읽었다」도 막는다**(2026-08-22 검토관 [중]).
//   그전엔 stderr 경고만 찍고 exit 0으로 통과했다 — 그러면 THIRD-PARTY-NOTICES.md가
//   vendor 부품이 빠진 채 **덮어써지고** electron-builder가 그대로 굽는다.
//   이 관문이 닫았다는 「조용한 0」이 게시 층에서는 그대로 열려 있었다.
//   ⚠ 원장 형식의 결정권은 우리에게 없다(외부 저장소에서 받아온다) — 그래서 더더욱 막아야 한다.
if (동봉원장고장) {
  console.error(`\n★ 동봉 원장을 못 읽었습니다 — ${동봉원장고장}`);
  console.error("  고지 목록에서 그 부품들이 통째로 빠집니다(우리가 실제로 겪은 사고입니다).");
  console.error("  client/smartmd/vendor/VERSIONS.md 의 표 형식을 확인하세요.");
}
if (동봉원장고장 || 상용불가.length || 막을것.length) process.exit(1);
if (!JSON출력) console.log("\n✓ 배포에 실을 수 없는 라이선스는 없습니다.");
