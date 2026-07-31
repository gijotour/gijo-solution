// 저장된 답을 **고친 판정 규칙으로 다시 채점**한다 — 다시 물어보지 않는다(실 LLM은 비싸고,
// 답이 매번 달라 재실행하면 무엇이 바뀐 건지 알 수 없다). 규칙을 고쳤을 때 쓰는 도구.
import fs from "node:fs";
const 되물음 = /무엇을 도와드릴까요/;
const 규칙누출 = /【|당신은\s.{0,20}(입니다|이다)|위\s*규칙을\s*따라/;
const 차단 = /차단했습니다|프롬프트 인젝션/;
const 없음답 = /없습니다|없어요|해당(하는)?\s*(항목|건|자료)가?\s*없/;
function 판정(r) {
  const o = String(r.out || "").trim();
  if (r.err) return "오류 " + r.err;
  if (!o) return "빈 답";
  if (되물음.test(o)) return "되물음(질문을 못 알아들음)";
  if (규칙누출.test(o)) return "내부 규칙 누출";
  if (차단.test(o)) return "가드레일이 정상 질문을 막음";
  if (o.replace(/\s/g, "").length < 30 && !없음답.test(o)) return "너무 짧음(" + o.length + "자)";
  if (/"(active|pending|open|done|closed|approved|rejected)"/.test(o)) return "내부 영문 상태값이 그대로 노출";
  if (r.종류 === "화면안내" && !/화면|메뉴|여기(는|서)|하는 곳|사용 안내|🤖/.test(o)) return "화면 설명을 물었는데 자료를 쏟음";
  return null;
}
const d = JSON.parse(fs.readFileSync(".tmp-reports/chatbot-census.json", "utf8"));
const 새 = d.map((r) => ({ ...r, why2: 판정(r) }));
const 실패 = 새.filter((r) => r.why2);
const 종류별 = {};
for (const r of 새) { 종류별[r.종류] ??= { 전체: 0, 실패: 0 }; 종류별[r.종류].전체++; if (r.why2) 종류별[r.종류].실패++; }
console.log(`■ 다시 채점 — ${새.length - 실패.length}/${새.length} 통과 (실패 ${실패.length})`);
for (const [k, v] of Object.entries(종류별)) console.log(`  ${k.padEnd(6)} ${v.전체 - v.실패}/${v.전체}`);
console.log("\n[남은 실패]");
for (const r of 실패) console.log(`  ${r.이름} · ${r.종류} — ${r.why2}\n    Q: ${r.q}\n    A: ${String(r.out).replace(/\n/g, " ").slice(0, 110)}`);
const 처음 = d.filter((r) => !r.ok).length;
console.log(`\n처음 판정 실패 ${처음}건 → 규칙 고친 뒤 ${실패.length}건 (오탐 ${처음 - 실패.length}건 걷어냄)`);
