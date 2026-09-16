import fs from "node:fs";
const P = "server/src/engine/agentloop.ts";
let s = fs.readFileSync(P, "utf8");
const a = `  조문표기.lastIndex = 0;
  const 있는것 = [...String(사내.result ?? "").matchAll(조문표기)].map((m) => m[1].replace(/\s+/g, " ").trim());`;
const b = `  // ⚠⚠ **「자주 나는 오해」로 적힌 조문을 베끼면 안 된다**(2026-09-01 실측으로 즉시 드러났다).
  //   이 저장소의 근거 문서들은 **틀린 답을 일부러 적어 둔다** — 「⚠ 자주 나는 오해: 「정보통신망법
  //   제12조」가 근거라고 답하면 틀리다」처럼. 문맥을 안 보고 조문만 긁으면 **그 틀린 답을
  //   근거로 붙인다.** 처음 판이 정확히 그랬고 fin-mangbunri 회귀가 그 자리에서 깨졌다.
  //   (기억 속 「코퍼스가 부정을 앞세워 조문이 답에서 빠지던 것」과 같은 병의 뒷면이다.)
  //   → 조문이 **부정·정정 문장 안**에 있으면 건너뛴다. 문장은 줄바꿈·마침표로 가른다.
  const 부정말 = /오해|틀리|아니|잘못|혼동|착각|해당\s*없|근거가\s*아니/;
  const 원문 = String(사내.result ?? "");
  const 문장들 = 원문.split(/(?<=[.!?。])\s+|\n+/);
  조문표기.lastIndex = 0;
  const 있는것 = [];
  for (const 문장 of 문장들) {
    if (부정말.test(문장)) continue; // 틀린 답으로 적힌 조문이다 — 베끼지 않는다
    조문표기.lastIndex = 0;
    for (const m of 문장.matchAll(조문표기)) 있는것.push(m[1].replace(/\s+/g, " ").trim());
  }`;
if (s.split(a).length - 1 !== 1) { console.log("✗ 앵커 " + (s.split(a).length - 1)); process.exit(1); }
fs.writeFileSync(P, s.replace(a, b));
console.log("부정 맥락 거르기 추가");
