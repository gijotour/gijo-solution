// tools/docs-drift — **고친 문서가 운영 AI에 실제로 반영됐는가.**
//
// ■ 왜 필요한가 (2026-08-08 실사고)
//   문서를 고쳐도 운영 AI는 **8월 7일판을 근거로 계속 답하고 있었다.** 이유가 셋 겹쳤다.
//     ① 배포는 소스만 옮기고 문서는 아무도 안 옮겼다(사람이 기억해야만 맞는 구조).
//     ② 운영 서버에는 문서 사본이 **세 곳**에 있다 — server/docs · gijo-as/docs · 리포 루트.
//        정작 읽는 곳은 env(GIJO_DOCS_DIR)가 가리키는 **한 곳뿐**인데, 다른 곳에 복사하면
//        아무 오류 없이 옛 문서가 계속 쓰인다(실제로 내가 그렇게 넣었다).
//     ③ 저장소에 들어간 조각이 낡아도 화면·로그 어디에도 표시가 없다.
//
//   "고쳤다"와 "AI가 안다"는 다른 말이다. 이 도구는 셋을 한 줄로 대조한다:
//     리포지토리 원본  ↔  운영 문서 폴더  ↔  지식 저장소에 들어간 조각
//
// ■ ⚠ 이 도구는 **win 호스트에서만** 돈다 (2026-09-04 실사고)
//   배포 실행자가 이 도구를 **WSL 안에서** 돌렸더니 「30건 어긋남 · 문서 0건 인입 ·
//   ✗ 문서가 어긋나 있습니다」가 나왔다. 전부 거짓이었다 — win에서 다시 돌리니 30/30 초록.
//   원인: 운영 값을 읽는 헬퍼가 `wsl` 명령을 부르는데 **WSL 안에는 wsl 명령이 없다.**
//   그런데 catch가 **빈 문자열**을 돌려주는 바람에
//     · GIJO_DOCS_DIR 조회가 조용히 기본값(/home/gijo/gijo-as/server/docs)으로 떨어지고
//       (실제 운영은 /home/gijo/gijo-as/docs — 그래서 전 문서가 「운영 폴더에 없음」이 됐다)
//     · 지식 저장소 조회도 빈 문자열 → 「0건 인입」으로 보고됐다.
//   **실패를 빈 값으로 삼키면 도구가 거짓말을 한다.** 같은 폴백은 반대 방향으로도 터진다 —
//   진짜 어긋남을 초록으로 덮을 수 있다. 그래서 이제는 **빈 값 대신 즉시 멈춘다(exit 2)**.
//
// 사용: node tools/docs-drift.mjs            (읽기만 — 아무것도 고치지 않는다)
//       node tools/docs-drift.mjs --자세히    (문서별 조각 수까지)
// 종료 코드: 0 = 같음 · 1 = 문서가 어긋남 · **2 = 도구를 돌릴 환경이 아님**(판정 못 함)

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";
import { execFileSync } from "child_process";

// ⚠ 경로에 공백이 있다("D:\Connect AI"). URL의 pathname을 그대로 쓰면 %20이 남아 파일을
//   못 찾는다 — fileURLToPath로 풀어야 한다(이 저장소에서 반복된 함정).
const 이파일 = fileURLToPath(import.meta.url);
const 뿌리 = path.resolve(path.dirname(이파일), "..");
const DISTRO = process.env.GIJO_WSL_DISTRO ?? "Ubuntu-24.04";

// 헬퍼가 부르는 명령. **짝 시험이 일부러 실패시키려고** 갈아끼우는 자리다
// (server/test/docsdrift.test.ts — 없는 명령을 넣어 「헬퍼 실패 → exit 2」를 확인한다).
// 평상시에는 손대지 않는다.
const WSL_CMD = process.env.DOCS_DRIFT_WSL_CMD ?? "wsl";

// ── 「같은 이름의 다른 사본」 경고에서 뺄 자리 (2026-09-04) ────────────────────
// 왜: 이 경고의 뜻은 「여기 복사하면 헛일이다」인데, 실측 30건이 **전부** 시험 사본과
//     옛 보관함이었다. 잡음이 30줄이면 **진짜 위험한 사본 한 줄이 거기 묻힌다.**
// ⚠ 빼되 **조용히 빼지 않는다** — 뺀 수를 한 줄로 찍는다(감춘 것과 거른 것은 다르다).
const 사본_제외 = [
  // ⚠ 이름이 한 가지가 아니다(2026-09-04 실측): gijo-as-test · gijo-as-test-wt94f0b0 ·
  //   **gijo-as-wt-test**(워크트리 샌드박스)까지 있다. `gijo-as-test`로만 재면 마지막이 샌다.
  //   운영은 `/home/gijo/gijo-as` 한 곳뿐이므로 이름에 test가 든 형제는 전부 시험 사본이다.
  { 무엇: "wsl-test 사본", 패턴: /^\/home\/gijo\/gijo-as-[^/]*test/ },
  { 무엇: "시험 실행별 사본(runs/)", 패턴: /\/runs\// },
  { 무엇: "옛 문서 보관함(_old-doc-copies-*)", 패턴: /\/_old-doc-copies-/ },
];

/** 사본 경로를 「남길 것」과 「거른 것」으로 가른다. 순수 함수 — 짝 시험이 여기를 본다. */
export function 사본거르기(경로들) {
  const 남김 = [];
  const 제외 = [];
  for (const p of 경로들 ?? []) {
    const 걸림 = 사본_제외.find(({ 패턴 }) => 패턴.test(p));
    if (걸림) 제외.push({ 경로: p, 무엇: 걸림.무엇 });
    else 남김.push(p);
  }
  return { 남김, 제외 };
}

/** 거른 것을 사람에게 알리는 한 줄. 0건이어도 찍는다 — 「안 걸렀다」도 정보다. */
export function 제외요약(제외) {
  if (!제외?.length) return "  ℹ 사본 경고에서 제외한 시험 사본·보관함: 0건";
  const 셈 = new Map();
  for (const { 무엇 } of 제외) 셈.set(무엇, (셈.get(무엇) ?? 0) + 1);
  const 내역 = [...셈].map(([무엇, n]) => `${무엇} ${n}건`).join(" · ");
  return `  ℹ 사본 경고에서 제외한 시험 사본·보관함: ${제외.length}건 (${내역})`;
}

// ── 두 잣대 대조용 순수 함수 (2026-09-07) ─────────────────────────────────────
//
// ■ 왜 두 숫자가 다른가 — **세는 대상이 다르다**
//   · `memory_documents`(sqlite) = **반입 대장**. 문서 한 편당 한 줄이고, 조각 수는 그때 적어 둔 값이다.
//   · docs-drift의 「문서 N건 인입됨」 = **지식 저장소(LanceDB)에 실제 조각이 남아 있는 문서 수**.
//   그래서 대장에 줄은 남았는데 벡터가 사라진 문서가 있으면 대장이 하나 더 크다
//   (2026-09-07 실측: 대장 3,921 · 저장소 3,920 — 차이는 `2025년 사이버 위협 전망.pdf` 21조각 한 편).
//   ⚠ 이 도구는 **아무것도 지우지 않는다.** 무엇이 어긋났는지 이름을 대는 데까지가 일이다.

/** 파일 경로에서 이름만(목록에는 knowledge/… 처럼 하위 폴더가 붙어 오는데 저장소 id는 이름뿐이다). */
const 이름만 = (p) => String(p ?? "").replace(/^.*[/\\]/, "");

/**
 * 반입 대장 ↔ 지식 저장소 대조.
 * @param {{documentId: string, chunks?: number, origin?: string}[]} 대장
 * @param {Record<string, number>} 저장조각  문서 id → 조각 수
 */
export function 잣대대조(대장, 저장조각) {
  const 저장이름 = new Set(Object.keys(저장조각 ?? {}));
  const 대장이름 = new Set((대장 ?? []).map((r) => String(r.documentId)));
  // 유령 = 대장에는 있는데 저장소에 조각이 없다 → **AI가 근거로 못 쓴다**(반입됐다고 적혀만 있다).
  const 유령 = (대장 ?? [])
    .filter((r) => !저장이름.has(String(r.documentId)))
    .map((r) => ({ 이름: String(r.documentId), 조각: Number(r.chunks) || 0 }));
  // 대장밖 = 저장소에는 조각이 있는데 대장에 줄이 없다 → 지운 대장/직접 넣은 벡터.
  const 대장밖 = [...저장이름].filter((n) => !대장이름.has(n)).sort();
  return { 대장수: 대장이름.size, 저장수: 저장이름.size, 유령, 대장밖 };
}

/**
 * 목록(docs-manifest.json)에 없는데 저장소에 있는 문서를 갈래별로 가른다.
 * ⚠ built-in만 이름을 다 적는다 — 승인 문답이 3,700편이라 전부 찍으면 그 안에서 아무것도 안 보인다.
 *   나머지는 **출처별 건수**로 말한다(감춘 것과 요약한 것은 다르다 — 셈은 그대로 보인다).
 */
export function 매니페스트밖(저장조각, 문서들, 대장) {
  const 목록이름 = new Set((문서들 ?? []).map(이름만));
  const 출처 = new Map((대장 ?? []).map((r) => [String(r.documentId), String(r.origin ?? "") || "(출처 없음)"]));
  const 밖 = Object.keys(저장조각 ?? {}).filter((n) => !목록이름.has(n)).sort();
  const builtin = 밖.filter((n) => 출처.get(n) === "builtin");
  const 갈래별 = {};
  for (const n of 밖) {
    const k = 출처.get(n) ?? "(대장에 없음)";
    if (k === "builtin") continue;
    갈래별[k] = (갈래별[k] ?? 0) + 1;
  }
  return { 총: 밖.length, builtin, 갈래별 };
}

// ⚠ 양쪽을 **같은 잣대로** 씻어서 비교한다. 처음엔 한쪽만 끝 공백을 자르는 바람에
//   방금 복사한 파일도 "내용이 다름"으로 나왔다(도구가 거짓 경보를 냈다).
//   줄바꿈 방식(CRLF/LF)도 맞춘다 — Windows에서 편집해 리눅스로 옮기면 늘 다르게 보인다.
export const 씻기 = (s) => String(s ?? "").replace(/\r\n/g, "\n").trim();
export const 해시 = (s) => createHash("sha256").update(씻기(s), "utf8").digest("hex").slice(0, 12);

const 이어붙이기 = (줄들) => 줄들.join("\n") + "\n";

/** 판정할 수 없는 상태 — 초록도 빨강도 아니다. 추측하지 말고 멈춘다.
 *  ⚠ console.error 대신 fs.writeSync(2) — Windows에서 파이프로 나갈 때 console은 비동기라
 *    process.exit이 **말을 끝맺기 전에** 프로세스를 닫는다(안내가 통째로 사라진다). */
function 중단(줄들) {
  const 글 = 이어붙이기(["", "✗ 문서 동기화 상태를 판정하지 못했습니다 — 아래를 보고 다시 돌리세요.", ...줄들, ""]);
  try { fs.writeSync(2, 글); } catch { console.error(글); }
  process.exit(2);
}

const 호스트안내 = "이 도구는 win 호스트에서 실행합니다 — WSL 안에서는 wsl 명령이 없습니다.";

/**
 * WSL 안에서 한 줄 명령을 돌린다.
 * @param {string} 명령
 * @param {{이유?: string, 빈값허용?: boolean}} opt
 *   이유 — 무엇을 읽으려던 것인지(멈출 때 사람에게 보여 준다)
 *   빈값허용 — 「빈 출력·비정상 종료」가 **그 자체로 답인** 경우에만 true.
 *              (없는 파일 cat · 걸린 게 없는 find — 없다는 것이 결과다)
 * ⚠ 기본은 **엄격**이다. 실패를 빈 문자열로 삼키면 호출부가 「없다」로 오해하고,
 *   그 오해가 2026-09-04의 거짓 경보 30건이었다.
 */
function wsl(명령, { 이유 = "운영 값 조회", 빈값허용 = false } = {}) {
  let 결과;
  try {
    결과 = execFileSync(WSL_CMD, ["-d", DISTRO, "--", "bash", "-lc", 명령], {
      encoding: "utf-8",
      maxBuffer: 32 * 1024 * 1024,
      // stderr도 잡아 둔다 — 멈출 때 「왜 못 했는지」를 사람에게 그대로 보여 주려고.
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    // status가 숫자면 **명령은 돌았고** 종료코드만 0이 아니다(없는 파일 cat 등).
    // status가 없으면 wsl 자체를 못 띄운 것이다(ENOENT 등) — 빈값허용과 무관하게 멈춘다.
    const 돌긴했다 = e?.status != null && e?.code !== "ENOENT";
    if (돌긴했다 && 빈값허용) return "";
    중단([
      `  ${호스트안내}`,
      `  · 하려던 일: ${이유}`,
      `  · 부른 명령: ${WSL_CMD} -d ${DISTRO} -- bash -lc '${명령.split("\n")[0].slice(0, 80)}…'`,
      `  · 받은 오류: ${e?.code ?? e?.message ?? e}`,
      ...(String(e?.stderr ?? "").trim() ? [`  · 명령이 남긴 말: ${String(e.stderr).trim().split("\n").slice(0, 3).join(" / ").slice(0, 300)}`] : []),
      "  → win의 PowerShell/Git Bash에서 `node tools/docs-drift.mjs`로 돌리세요.",
    ]);
  }
  const 출력 = String(결과 ?? "").trim();
  if (!출력 && !빈값허용) {
    중단([
      `  · 하려던 일: ${이유}`,
      "  · 명령은 성공했는데 **출력이 비어 있습니다.** 빈 값을 기본값으로 바꿔 읽으면",
      "    멀쩡한 문서를 「어긋남」이라 하거나, 반대로 어긋난 문서를 초록으로 덮게 됩니다.",
      "  → 운영 서버(WSL)가 떠 있는지, 경로·파일이 그대로인지 확인하세요.",
    ]);
  }
  return 출력;
}

function main() {
  const 자세히 = process.argv.includes("--자세히") || process.argv.includes("--verbose");

  // ── ⓪ 실행 환경 관문 — wsl을 부르기 **전에** 막는다 ─────────────────────────
  if (process.platform !== "win32") {
    중단([
      `  ${호스트안내}`,
      `  · 지금 플랫폼: ${process.platform}`,
      "  · 여기서 억지로 돌리면 운영 값을 못 읽고 **전부 어긋남으로 보이는 거짓 경보**가 납니다",
      "    (2026-09-04 실사고: WSL 안에서 돌려 「30건 어긋남 · 0건 인입」이 나왔지만 실제는 30/30 초록).",
      "  → win의 PowerShell/Git Bash에서 `node tools/docs-drift.mjs`로 돌리세요.",
    ]);
  }

  // ── ① 운영이 **실제로 읽는** 문서 폴더 (env가 진실 원천) ─────────────────
  // ⚠ 기본값으로 떨어지지 않는다. 못 읽으면 판정 자체를 포기한다 — 엉뚱한 폴더를 재는 것이
  //   「모르겠다」보다 나쁘다(그 폴더는 늘 비어 보이므로 **전부 어긋남**이 된다).
  const docsDir = wsl("grep -m1 '^GIJO_DOCS_DIR=' /home/gijo/gijo-as/gijo-as.env | cut -d= -f2", {
    이유: "운영 env에서 GIJO_DOCS_DIR 읽기(/home/gijo/gijo-as/gijo-as.env)",
  });
  console.log(`운영이 읽는 문서 폴더: ${docsDir}`);

  // 같은 이름의 사본이 다른 곳에도 있으면 알린다 — 거기 복사하면 조용히 헛일이 된다.
  const 사본경고 = [];
  const 사본제외 = [];

  // ── ② 목록(docs-manifest)에 적힌 문서를 한 편씩 대조 ─────────────────────
  const manifest = JSON.parse(fs.readFileSync(path.join(뿌리, "server", "docs-manifest.json"), "utf8"));
  const 문서들 = (manifest.files ?? []).map((f) => f.file);

  const 어긋남 = [];
  const 없음 = [];
  const 같음 = [];

  for (const 이름 of 문서들) {
    const 로컬 = path.join(뿌리, 이름);
    if (!fs.existsSync(로컬)) { 없음.push(`${이름} (리포지토리에 없음)`); continue; }
    const 로컬해시 = 해시(fs.readFileSync(로컬, "utf8"));

    // 없는 파일이면 cat이 실패한다 — 그것이 답이므로 빈값을 받는다.
    const 운영본 = wsl(`cat '${docsDir}/${이름}' 2>/dev/null`, { 빈값허용: true });
    if (!운영본) { 어긋남.push({ 이름, 왜: "운영 폴더에 없음", 로컬해시, 운영해시: "—" }); continue; }
    const 운영해시 = 해시(운영본);

    if (로컬해시 !== 운영해시) 어긋남.push({ 이름, 왜: "내용이 다름", 로컬해시, 운영해시 });
    else 같음.push(이름);

    // 다른 자리에 같은 이름의 사본이 있나 — 있으면 "거기 복사해도 소용없다"고 미리 알린다.
    // ⚠ head는 **거르기 전** 넉넉히 받는다. 앞 3줄이 전부 시험 사본이면 진짜 사본이 잘린다.
    const 사본 = wsl(`find /home/gijo -name '${이름}' -not -path '${docsDir}/*' 2>/dev/null | head -20`, { 빈값허용: true });
    if (!사본) continue;
    const { 남김, 제외 } = 사본거르기(사본.split("\n").map((s) => s.trim()).filter(Boolean));
    사본제외.push(...제외);
    if (남김.length) 사본경고.push(`${이름} → ${남김.slice(0, 3).join(" · ")}`);
  }

  console.log(`\n■ 리포지토리 ↔ 운영 문서 폴더`);
  console.log(`  ✓ 같음 ${같음.length}건 · ✗ 어긋남 ${어긋남.length}건 · ○ 리포에 없음 ${없음.length}건`);
  for (const d of 어긋남) console.log(`     ✗ ${d.이름} — ${d.왜} (리포 ${d.로컬해시} / 운영 ${d.운영해시})`);
  for (const n of 없음) console.log(`     ○ ${n}`);

  if (사본경고.length) {
    console.log(`\n  ⚠ 같은 이름의 **다른 사본**이 있습니다 — 여기 복사하면 운영에 반영되지 않습니다:`);
    for (const c of 사본경고.slice(0, 8)) console.log(`     ${c}`);
    if (사본경고.length > 8) console.log(`     … 그 밖 ${사본경고.length - 8}건`);
  }
  console.log(제외요약(사본제외));

  // ── ③ 지식 저장소에 실제로 들어간 판이 최신인가 ──────────────────────────
  // 문서를 폴더에 넣어도 **재인입되지 않으면** AI는 옛 판으로 답한다(해시가 같아 건너뛴다).
  // 여기서는 저장소 조각을 훑어 "운영 문서에만 있는 문구"가 실제로 들어갔는지 본다.
  // ⚠ 조회가 실패하면 **빈 결과로 넘어가지 않는다** — 그러면 전 문서가 「미인입」으로 보인다
  //   (2026-09-04의 「문서 0건 인입」이 정확히 이 삼킴이었다).
  const 조각확인 = wsl(`cd /home/gijo/gijo-as/server && node -e "
const l=require('@lancedb/lancedb');
(async()=>{
  const db=await l.connect('data/memory.lancedb');
  const t=await db.openTable('documents');
  const 문서={};
  for await (const b of t.query().select(['documentId','text']).execute()) {
    const a = typeof b.toArray==='function'? b.toArray():b;
    for (const r of a) { const id=String(r.documentId); (문서[id] ??= []).push(String(r.text||'')); }
  }
  const out={};
  for (const [k,v] of Object.entries(문서)) out[k]=v.length;
  console.log(JSON.stringify(out));
})()"`, { 이유: "지식 저장소(LanceDB documents) 조각 수 조회" });

  let 저장조각;
  try {
    저장조각 = JSON.parse(조각확인.split("\n").pop() || "");
  } catch {
    중단([
      "  · 하려던 일: 지식 저장소 조회 결과 읽기",
      "  · 돌아온 것이 JSON이 아닙니다(앞쪽에 오류가 섞였을 수 있습니다):",
      `    ${조각확인.split("\n").slice(-3).join(" / ").slice(0, 300)}`,
      "  → 운영 서버의 data/memory.lancedb 상태를 확인하세요. 조회 실패를 「0건 인입」으로",
      "    보고하면 멀쩡한 저장소를 비었다고 말하게 됩니다.",
    ]);
  }

  console.log(`\n■ 지식 저장소 반영 (문서 ${Object.keys(저장조각).length}건 인입됨)`);
  // ⚠ 저장소의 문서 이름은 **파일 이름만**이다(docsbundle이 basename을 문서 id로 쓴다).
  //   목록에는 하위 폴더가 붙어 있어(knowledge/…) 그대로 대조하면 멀쩡한 문서를 "없다"고 한다.
  const 미인입 = 문서들.filter((n) => !저장조각[path.basename(n)]);
  if (미인입.length) {
    console.log(`  ✗ 목록에 있으나 저장소에 없는 문서 ${미인입.length}건 — AI가 근거로 쓸 수 없습니다:`);
    for (const n of 미인입) console.log(`     ${n}`);
  } else {
    console.log("  ✓ 목록의 문서가 모두 저장소에 있습니다.");
  }
  if (자세히) {
    for (const 이름 of 문서들) {
      const n = 저장조각[path.basename(이름)];
      if (n) console.log(`     ${n}조각\t${이름}`);
    }
  }

  // ── ④ 두 잣대 대조 — 반입 대장(sqlite) ↔ 지식 저장소(LanceDB) ─────────────
  // ⚠ 왜 필요한가(2026-09-07): 위 ③이 「문서 3,920건 인입됨」이라 하는데 운영 대장에는 3,921줄이
  //   있었다. 두 숫자가 다른 것 자체는 결함이 아니라 **세는 대상이 다른 것**인데(위 잣대대조 머리말),
  //   그 사실이 어디에도 안 적혀 있어 사람이 매번 「하나가 새는가」를 손으로 찾아야 했다.
  //   이제 도구가 **이름을 대고** 지나간다. ⚠ 지우지는 않는다 — 판단은 사람이 한다.
  // ⚠ 못 읽을 수 있다: 운영 DB를 다시 암호화하면(개발 모드 해제) 맨 better-sqlite3로는 못 연다.
  //   그때는 **건너뛰었다고 말한다** — 0건으로 적어 「대장이 비었다」는 거짓을 만들지 않는다
  //   (2026-09-04의 「0건 인입」이 정확히 그 삼킴이었다).
  // ⚠ 실패를 **말로 돌려받는다** — 조회가 죽어도 node는 0으로 끝나고 왜 못 읽었는지를 함께 준다.
  //   `2>/dev/null`로 입을 막으면 「건너뛰었다」까지는 정직해도 **왜인지는 영영 모른다**(암호화인지
  //   파일이 없는지 모듈이 없는지에 따라 사람이 할 일이 다르다).
  // ⚠ sqlite3 CLI는 쓰지 않는다 — 운영 WSL에 그 명령이 **없다**(2026-09-07 확인). 없는 명령은
  //   빈 결과를 내놓아 「표 없음」이라는 거짓 판정을 만든다(.claude/commands/GIJOAS배포.md의 그 함정).
  const 대장json = wsl(
    "cd /home/gijo/gijo-as/server && node -e \"" +
    "let out; try { const D=require('better-sqlite3');" +
    "const db=new D('data/gijo-as.sqlite',{readonly:true});" +
    "const r=db.prepare('SELECT documentId, origin, chunks FROM memory_documents').all();" +
    "db.close(); out={ok:true,rows:r}; } catch(e) { out={ok:false,why:String((e&&e.message)||e).slice(0,200)}; } " +
    "console.log(JSON.stringify(out));\"",
    { 빈값허용: true },
  );
  let 대장 = null, 대장못읽음 = "조회 명령이 아무것도 내놓지 않았습니다";
  if (대장json) {
    try {
      const j = JSON.parse(대장json.split("\n").pop() || "");
      if (j && j.ok && Array.isArray(j.rows)) 대장 = j.rows;
      else 대장못읽음 = String((j && j.why) || "돌아온 것이 대장 모양이 아닙니다");
    } catch { 대장못읽음 = "조회 결과가 JSON이 아닙니다: " + 대장json.split("\n").pop().slice(0, 120); }
  }

  console.log(`\n■ 반입 대장 ↔ 지식 저장소 (두 잣대)`);
  if (!Array.isArray(대장)) {
    console.log("  ℹ 대장(memory_documents) 대조를 **건너뛰었습니다** — 운영 DB를 열지 못했습니다:");
    console.log(`     ${대장못읽음}`);
    console.log("    (암호화됐거나 파일·모듈이 없을 수 있습니다). 아래 「매니페스트 밖」은 저장소 기준만입니다.");
    const 밖 = 매니페스트밖(저장조각, 문서들, null);
    console.log(`  · 목록에 없는데 저장소에 있는 문서: ${밖.총}건 (출처는 대장을 못 읽어 못 가릅니다)`);
  } else {
    const 대조 = 잣대대조(대장, 저장조각);
    console.log(`  대장 ${대조.대장수}건 · 저장소 ${대조.저장수}건 (차이 ${대조.대장수 - 대조.저장수})`);
    if (대조.유령.length) {
      console.log(`  ⚠ 대장에는 있는데 **저장소에 조각이 없는** 문서 ${대조.유령.length}건 — AI가 근거로 못 씁니다(지우지 않았습니다):`);
      for (const g of 대조.유령.slice(0, 20)) console.log(`     ${g.이름} (대장에 적힌 조각 ${g.조각}개)`);
      if (대조.유령.length > 20) console.log(`     … 그 밖 ${대조.유령.length - 20}건`);
    } else {
      console.log("  ✓ 대장의 문서가 모두 저장소에 조각을 갖고 있습니다.");
    }
    if (대조.대장밖.length) {
      console.log(`  ⚠ 저장소에는 있는데 **대장에 줄이 없는** 문서 ${대조.대장밖.length}건:`);
      for (const n of 대조.대장밖.slice(0, 10)) console.log(`     ${n}`);
      if (대조.대장밖.length > 10) console.log(`     … 그 밖 ${대조.대장밖.length - 10}건`);
    }

    // 매니페스트 밖 — built-in은 이름을 다 적고, 대량 갈래(승인 문답 등)는 출처별 건수로 말한다.
    const 밖 = 매니페스트밖(저장조각, 문서들, 대장);
    console.log(`\n■ 목록(docs-manifest.json) 밖의 문서 ${밖.총}건 — 저장소에는 있으나 목록이 안 가리킵니다`);
    console.log(`  · built-in(제품 동봉 지식) ${밖.builtin.length}건${밖.builtin.length ? ":" : ""}`);
    for (const n of 밖.builtin) console.log(`     ${n}`);
    const 갈래 = Object.entries(밖.갈래별).sort((x, y) => y[1] - x[1]);
    if (갈래.length) console.log(`  · 그 밖 ${갈래.reduce((s, [, n]) => s + n, 0)}건 — ${갈래.map(([k, n]) => `${k} ${n}`).join(" · ")}`);
    console.log("  ℹ 이 줄들은 **보고만** 합니다 — 목록 밖이라고 잘못된 것이 아닙니다(승인 문답·침해사고 사례처럼");
    console.log("    사람이 넣은 지식이 여기 옵니다). 지울지 말지는 사람이 정합니다.");
  }

  const 실패 = 어긋남.length > 0 || 미인입.length > 0;
  console.log(`\n${실패 ? "✗ 문서가 어긋나 있습니다 — 배포(tools/deploy-prod.ps1)로 동기화하고, 바뀐 문서는 재인입되게 서버를 재시작하세요." : "✓ 리포지토리·운영·지식 저장소가 같은 문서를 보고 있습니다."}`);
  process.exit(실패 ? 1 : 0);
}

// 직접 실행할 때만 돈다 — 짝 시험은 위 순수 함수만 불러다 쓴다(WSL 없이 검산 가능).
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(이파일)) main();
