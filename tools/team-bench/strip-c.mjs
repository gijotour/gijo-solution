#!/usr/bin/env node
// tools/team-bench/strip-c.mjs — 이미 구워 둔 학습 재료에서 **등급 C 행을 걷어낸다**.
//
// ■ 왜 이 파일이 저장소에 생겼나 (2026-09-10 · 검토관 적발)
//   같은 일을 하는 도구가 **두 벌**이었다. 재료 빌더(material-r5.mjs)는 창을 1자 걸음으로 훑는데,
//   gb10의 재료를 실제로 지운 스크래치패드 스크립트(strip-c.py)는 아직 10자 걸음이었다. 그래서
//   「-o 판 재검사 결과 C 0행」이 **제 잣대로 잰 0**이었고, 저장소가 채택한 잣대로 다시 훑으니
//   1,957행 중 859행(43.9%)에 C 본문이 남아 있었다. 이 저장소가 반복해 겪은 그것 —
//   **같은 것을 여러 곳에 적으면 어긋난다** — 이 잣대에서 또 났다.
//   고치는 방법은 값을 맞추는 것이 아니라 **구현을 하나로 만드는 것**이다. 그래서 이 도구는
//   등급 판정을 한 줄도 새로 적지 않고 material-r5.mjs의 그 함수를 부른다.
//
// ■ 이 도구가 지키는 것
//   ① 판정은 material-r5.mjs의 `등급판정` 하나다(질문 해시 ∪ 창 해시 · 40자 · 1자 걸음 · 2적중).
//   ② **C만 걷어낸다.** 남는 행에는 판정한 등급을 **그대로** 적는다("O" 또는 "미매칭"/"?").
//      ⚠ 남은 행에 일괄 "O"를 찍지 않는다 — 그것이 바로 등급관문이 잡으려는 거짓이다.
//      실측(2026-09-10): longform-vuln-v2는 153행이 전부 미매칭·C였고 **O가 0행**이다. 일괄 O를
//      찍었다면 「등급을 본 적 없는 행」이 초록 딱지를 달고 학습에 들어갔을 것이다.
//   ③ 지운 목록에는 **본문을 안 적는다**(지우려는 내용을 목록으로 남기면 지운 것이 아니다).
//   ④ 쓰고 나서 `등급관문`을 걸고 그 결과를 **그대로** 적는다 — 미매칭이 남으면 빨강이 맞다.
//      이 도구의 일은 「C를 없애는 것」이지 「초록을 만드는 것」이 아니다.
//
// 쓰는 법:
//   node tools/team-bench/strip-c.mjs --grade-map <f> --cwin <f> [--apply] [--report <f>] <파일...>
//   --apply 없이는 세기만 한다(기본이 안전한 쪽).
//   출력 파일 이름은 <입력>-o.json 이다.
//
// 나가는 코드: 0=C를 다 걷어냈다 · 1=걷어낸 판이 등급관문에 빨강(미매칭이 남았다 등) · 2=쓰는 법 틀림
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const 여기 = path.dirname(fileURLToPath(import.meta.url));
const 빌더 = process.env.GIJO_MATERIAL_R5 || path.join(여기, "material-r5.mjs");
const { 등급판정, 등급관문, 등급세기, 잣대지문 } = await import(pathToFileURL(빌더).href);

/**
 * 파일 하나를 걷어낸다.
 * @returns { 남긴, 지운, 셈 } — 지운 목록은 자리·적중 수만 담는다(본문 없음).
 */
export function 걷어내기(rows, 지도, 창집합) {
  const 남긴 = [], 지운 = [];
  const 셈 = { 행: rows.length, ...등급세기(rows, 지도, 창집합) };
  rows.forEach((r, i) => {
    const g = 등급판정(r, 지도, 창집합);
    if (g === "C") { 지운.push({ i, 질문길이: String(r?.question ?? "").length, 답길이: String(r?.answer ?? "").length }); return; }
    남긴.push({ ...r, grade: g });   // ★ 판정한 등급을 그대로 — 일괄 "O"는 거짓이다
  });
  return { 남긴, 지운, 셈 };
}

if (process.argv[1] && process.argv[1].split(path.sep).join("/").endsWith("strip-c.mjs")) {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const mapP = opt("--grade-map", ""), cwinP = opt("--cwin", ""), repP = opt("--report", "");
  const 적용 = args.includes("--apply");
  const 파일들 = args.filter((a, i) => !a.startsWith("--") && !["--grade-map", "--cwin", "--report"].includes(args[i - 1]));
  if (!mapP || !파일들.length) {
    console.error("쓰는 법: node tools/team-bench/strip-c.mjs --grade-map <f> [--cwin <f>] [--apply] [--report <f>] <파일...>");
    process.exit(2);
  }
  const 읽기 = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
  const 지도 = 읽기(mapP).map ?? 읽기(mapP);
  const 창집합 = cwinP ? new Set(읽기(cwinP).windows) : null;

  const 보고 = { 만든때: new Date().toISOString(), 잣대: 잣대지문(), 적용, 파일: {} };
  let 모두초록 = true;
  console.log("| 파일 | 행 | 지움(C) | 남김 | 남은 등급 | 반출 감시 |");
  console.log("|---|---|---|---|---|---|");
  for (const f of 파일들) {
    const rows = 읽기(f);
    const { 남긴, 지운, 셈 } = 걷어내기(rows, 지도, 창집합);
    const 관문 = 등급관문(남긴, 창집합);
    const 남은등급 = 등급세기(남긴, 지도, 창집합);
    모두초록 = 모두초록 && 관문.ok;
    const out = f.replace(/\.json$/, "-o.json");
    if (적용) {
      fs.writeFileSync(out, JSON.stringify(남긴, null, 2));
      fs.writeFileSync(f.replace(/\.json$/, "") + ".removed-C.json",
        JSON.stringify({ 원본: path.basename(f), 행: rows.length, 지운수: 지운.length, 잣대: 잣대지문(), 지운: 지운 }, null, 2));
    }
    보고.파일[path.basename(f)] = { 행: rows.length, 지움: 지운.length, 남김: 남긴.length, 등급: 셈, 남은등급, 관문, 출력: 적용 ? path.basename(out) : null };
    console.log(`| ${path.basename(f)} | ${rows.length} | ${지운.length} | ${남긴.length} | ${JSON.stringify(남은등급)} | ${관문.ok ? "✅" : "❌ " + 관문.사유.join(" / ")} |`);
  }
  console.log("");
  console.log(모두초록
    ? "✅ 걷어낸 판이 전부 반출 감시를 지난다"
    : "❌ 걷어냈지만 **반출 감시는 빨강**이다 — C는 없어도 「등급을 모르는 행」이 남았다는 뜻이다(모르는 것은 O가 아니다)");
  if (repP) { fs.mkdirSync(path.dirname(repP), { recursive: true }); fs.writeFileSync(repP, JSON.stringify(보고, null, 2)); console.log(`보고서: ${repP}`); }
  process.exit(모두초록 ? 0 : 1);
}
