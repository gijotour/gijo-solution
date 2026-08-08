// 작업 기록에 **사람이 읽는 이름**이 남는가 — 계정 아이디가 아니라.
//
// 실측(2026-08-09, 150상황 측정): "누가 뭘 지웠는지 볼 수 있어?"의 답이
//   「배포 자동화 전용 36 · 정요한 24 · claude-deploy 1」
// 이었다. 앞의 둘은 표시 이름인데 마지막 하나만 **계정 아이디**다 — 같은 사람이 두 이름으로
// 나뉘어 세어지고, 담당자에게는 내부 식별자가 그대로 노출된다.
//
// 원인: 감사 기록을 남기는 자리마다 손으로 적다 보니 어떤 곳은 displayName, 어떤 곳은
// username을 썼다(7곳이 username이었다). 이런 건 사람이 매번 기억할 수 없어서 감시로 못 박는다.
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const 엔진방 = path.join(__dirname, "..", "src");

function 소스전부(dir: string): { 파일: string; 내용: string }[] {
  const out: { 파일: string; 내용: string }[] = [];
  for (const name of fs.readdirSync(dir)) {
    // __로 시작하는 파일은 다른 시험(airgap)이 잠깐 만드는 표본이다 — 제품 소스가 아니고,
    // 병렬 실행 중 읽는 순간 사라질 수 있다(실측: __airgap_probe_tmp.ts ENOENT로 이 시험이 깨짐).
    if (name.startsWith("__")) continue;
    const full = path.join(dir, name);
    let st; try { st = fs.statSync(full); } catch { continue; }
    if (st.isDirectory()) out.push(...소스전부(full));
    else if (name.endsWith(".ts")) { try { out.push({ 파일: path.relative(엔진방, full), 내용: fs.readFileSync(full, "utf8") }); } catch { /* 경합으로 사라짐 */ } }
  }
  return out;
}

describe("작업 기록의 「누가」는 사람이 읽는 이름이다", () => {
  it("actor에 계정 아이디(username)를 쓰는 자리가 없다", () => {
    const 위반: string[] = [];
    for (const { 파일, 내용 } of 소스전부(엔진방)) {
      // 주석의 설명은 봐주고 실행되는 코드만 본다.
      const code = 내용.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1 ");
      // actorOf(...) 정의나 actor: 값으로 username을 쓰는 꼴.
      if (/actorOf[^\n]*user\?\.username/.test(code)) 위반.push(`${파일} (actorOf)`);
      if (/actor:\s*[^\n,]*user\?\.username/.test(code)) 위반.push(`${파일} (actor:)`);
    }
    expect(위반, `감사 actor에 계정 아이디를 쓰는 곳: ${위반.join(", ")}`).toEqual([]);
  });

  it("이름을 모를 때도 내부 식별자 대신 사람 말로 적는다", () => {
    // "unknown"은 화면에 그대로 나온다 — 담당자가 읽는 글자다.
    const 위반: string[] = [];
    for (const { 파일, 내용 } of 소스전부(엔진방)) {
      const code = 내용.replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1 ");
      if (/actorOf[^\n]*\?\?\s*"unknown"/.test(code)) 위반.push(파일);
    }
    expect(위반, `actor 기본값이 "unknown"인 곳: ${위반.join(", ")}`).toEqual([]);
  });
});
