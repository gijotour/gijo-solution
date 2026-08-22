// tools/lib/vendor-manifest.mjs — **동봉 vendor 원장(VERSIONS.md)을 읽는 단 하나의 파서.**
//
// ■ 왜 여기로 뺐나 (2026-08-22 검토관 [중])
//   이 파서가 처음엔 gen-sbom-self.mjs 안에만 있었고, 감시 시험(vendornotice.test.ts)은
//   **같은 로직을 손으로 옮겨 적은 사본**을 쟀다. 그러면 시험이 초록이어도
//   **게시에 물린 진짜 파서가 깨져 있을 수 있다** — 시험이 자기 사본만 검증하기 때문이다.
//   이 저장소가 반복해 겪은 「같은 것을 여러 곳에 적으면 어긋난다」가 감시 층에서 재현된 꼴이다.
//
//   ★ 그래서 도구와 시험이 **이 파일 하나**를 부른다. 시험은 이제 게시가 실제로 쓰는 파서를 잰다.
//
// ⚠ 외부 꾸러미를 쓰지 않는다(server/test/toolsdeps.test.ts 계약) — node 내장만.
// ⚠ 이 파일은 .mjs다 — vitest(TS)에서도 그대로 import 된다.
import fs from "node:fs";
import path from "node:path";

/**
 * 마크다운 표를 읽어 부품 목록을 돌려준다.
 *
 * ⚠ **칸 번호를 손으로 박지 않는다** — 머리글에서 찾는다(표에 칸이 늘어도 안 어긋난다).
 *   원래 사고가 「형식이 바뀌었는데 아무도 몰랐다」였다.
 *
 * @param {string} 원문 VERSIONS.md 내용
 * @returns {{이름:string, 판:string, 라이선스:string}[]}
 */
export function 표읽기(원문) {
  const 줄들 = String(원문 ?? "").split("\n").filter((l) => l.trim().startsWith("|"));
  if (줄들.length < 3) return [];          // [0]=머리글 [1]=구분선 [2~]=값
  const 칸 = (l) => l.split("|").slice(1, -1).map((s) => s.trim());
  const 머리 = 칸(줄들[0]);
  const iName = 머리.findIndex((h) => /library|name|이름/i.test(h));
  const iVer = 머리.findIndex((h) => /version|판/i.test(h));
  const iLic = 머리.findIndex((h) => /licen[cs]e|라이선스/i.test(h));
  if (iName < 0 || iLic < 0) return [];
  const 모음 = [];
  for (const l of 줄들.slice(2)) {
    const c = 칸(l);
    if (c.length <= Math.max(iName, iLic) || !c[iName]) continue;
    모음.push({
      이름: c[iName].replace(/`/g, "").trim(),
      판: iVer >= 0 ? (c[iVer] || "") : "",
      라이선스: c[iLic],
    });
  }
  return 모음;
}

/** 저장소 뿌리에서 원장 자리를 만든다. */
export function 원장자리(루트) {
  const 뿌리 = path.join(루트, "client", "smartmd");
  return { 뿌리, 원장: path.join(뿌리, "vendor", "VERSIONS.md") };
}

/**
 * 원장을 읽어 부품과 **고장 사유**를 함께 돌려준다.
 *
 * ★ 「싣지 않는다」와 「싣는데 못 읽는다」를 가른다 — 이 구분이 이 파일의 존재 이유다.
 *   `client/smartmd/`는 git이 추적하지 않고 게시 직전 외부 저장소에서 받아온다.
 *   그 폴더가 아예 없는 기계(mac·gb10·새 클론)에서는 **싣지 않는 것**이라 정상이다.
 *   폴더는 있는데 원장을 못 읽으면 **고지가 통째로 빠지는 사고**다.
 *
 * @returns {{싣나:boolean, 목록:{이름:string,판:string,라이선스:string}[], 고장:string}}
 */
export function 원장읽기(루트) {
  const { 뿌리, 원장 } = 원장자리(루트);
  if (!fs.existsSync(뿌리)) return { 싣나: false, 목록: [], 고장: "" };
  if (!fs.existsSync(원장)) {
    return { 싣나: true, 목록: [], 고장: `원장 파일이 없습니다: ${path.relative(루트, 원장)}` };
  }
  const 목록 = 표읽기(fs.readFileSync(원장, "utf8"));
  return {
    싣나: true,
    목록,
    고장: 목록.length ? "" :
      `${path.relative(루트, 원장)} 를 읽었지만 **부품을 하나도 못 찾았습니다** ` +
      "(표 머리글에 Library/Version/License 칸이 있는지 보세요).",
  };
}
