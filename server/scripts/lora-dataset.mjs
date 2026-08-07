// scripts/lora-dataset.mjs — 주제별 전문가 LoRA 재료 만들기(승인 배치 + 데이터셋 내보내기).
//
// [2026-08-08 · 사용자 지시 "LoRA를 통해서 우리 제품 고민 많이 해서 적용해줘"]
// 위임받은 승인 배치(#120)를 수행한다 — 사람이 하나하나 누르던 👍를 기준을 정해 대신 누른다.
//
// ★ 무엇을 학습 재료로 삼나 (고민의 핵심):
//   - 넣는 것: **개념 설명·절차·판단** 답변 — 전문가 어댑터의 몫은 "그 영역의 말과 판단"이다.
//   - 빼는 것: **그날그날 바뀌는 현재 상태 답**(미조치 N건 목록, 자산 나열). 오늘 맞는 숫자가
//     내일 틀린다 — 이런 답을 학습하면 모델이 근거 없이 숫자를 지어내는 버릇을 배운다.
//     어차피 그 답은 코드(도구)가 결정적으로 내므로 모델이 배울 필요가 없다.
//   - 도구 꼬리(▸ 이어서)·결재판·되물음·폴백·내부 식별자 낀 답도 전부 제외.
// ⚠ 자동 선별만 믿지 않는다 — --dry가 표본을 보여 주고, 사람이(또는 위임받은 내가) 읽고
//   --apply 한다. 승인은 rating=1로 남고 감사 기록을 적는다.
//
// 실행: node scripts/lora-dataset.mjs --topic 취약점 [--cap 300] [--apply]
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";
const require = createRequire(import.meta.url);
const { db } = require(path.resolve("dist/db.js"));

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const TOPIC = arg("--topic", "취약점");
const CAP = Number(arg("--cap", "300"));
const APPLY = argv.includes("--apply");

// ⚠ rating=-1도 후보에 넣는다(2026-08-08 실측 근거): 취약점 549건 중 530건이 -1인데, 그중에
//   명백히 옳은 설명 답(Log4Shell=RCE, KEV 기한=BOD 22-01)이 다수다 — 개별 품질 판정이 아니라
//   **예전 일반 루프 후보함을 비우던 일괄 처리**였다는 증거다. 목적이 다른 재검토(주제별 전문가
//   재료)이므로 품질 기준을 통과한 것만 골라 다시 승인하고, 그 사실을 감사 기록에 남긴다.
const rows = db.prepare(
  `SELECT id, question, answer, agentId, rating, createdAt FROM chat_logs
    WHERE topic = ? AND (usedInDataset IS NULL OR usedInDataset = 0)
    ORDER BY createdAt DESC`
).all(TOPIC);

const 제외사유 = new Map();
const 세다 = (k) => 제외사유.set(k, (제외사유.get(k) ?? 0) + 1);

function 좋은가(q, a) {
  // 기계가 만든 합성 프롬프트가 질문 칸에 남은 것 — 사람 질문이 아니라 학습 재료가 못 된다.
  if (/사용자 지시:|방금 시스템에서 조회한|이전 대화 맥락|\[현재 지시\]/.test(q)) return 세다("합성 프롬프트"), false;
  // 현재 상태를 묻는 데이터 질문 — 답이 그날 데이터에 달려 있어 학습하면 지어내기를 가르친다.
  if (/몇\s*건|보여\s*줘|리스트|목록|추려서|현황\s*(알려|보여)/.test(q)) return 세다("현재 상태 질문"), false;
  if (q.length < 8 || q.length > 140) return 세다("질문 길이"), false;
  if (a.length < 100 || a.length > 1800) return 세다("답 길이"), false;
  if (/연결.{0,3}실패|오류가 발생|죄송|알 수 없습니다|찾지 못했|불러오지 못/.test(a)) return 세다("폴백·오류"), false;
  // 표본 검수(2026-08-08)에서 자동 선별을 뚫고 나온 4종 — 전부 우리가 코드로 잡아 온 결함이라
  // 학습하면 그 결함을 도로 가르치는 셈이다.
  if (/인사말.{0,8}(생략|없이)|서두 없이|바로 본론으로 시작/.test(a)) return 세다("내부 지시문 복창"), false;
  if (/\[(대상|리스트|내용|이름|값|목록)\]/.test(a)) return 세다("자리표시자"), false;
  if (/보안 담당자 여러분|보안 담당자로 주|안녕하세요[,.! ]/.test(a)) return 세다("헛인사"), false;
  if (/저는 GIJO|보안 AI로 (작동|동작)/.test(a)) return 세다("자기소개 서두"), false;
  if (a.trim().endsWith("?")) return 세다("되물음"), false;
  if (/준비했습니다|승인해 주세요|결재판|확인하고 승인/.test(a)) return 세다("결재판"), false;
  if (/차단했습니다|프롬프트 인젝션/.test(a)) return 세다("가드레일"), false;
  if (/\(id=|vuln:|sha1|qa:true/.test(a)) return 세다("내부 식별자"), false;
  if (/▸ 이어서/.test(a)) return 세다("도구 꼬리(현재 상태 답)"), false;
  // 현재 상태 나열 냄새 — "N건"이 3번 이상 + 번호 목록 + @자산 표기가 겹치면 데이터 덤프다
  const 건수 = (a.match(/\d+\s*건/g) ?? []).length;
  if (건수 >= 3 && /(^|\n)\s*\d+\.\s/.test(a) && /@ /.test(a)) return 세다("현재 상태 나열"), false;
  return true;
}

// 같은 질문은 하나만 — 답이 긴(설명이 풍부한) 쪽을 남긴다.
const 고른것 = new Map();
for (const r of rows) {
  const q = String(r.question).trim(), a = String(r.answer).trim();
  if (!좋은가(q, a)) continue;
  const 열쇠 = q.replace(/\s+/g, " ").toLowerCase();
  const 기존 = 고른것.get(열쇠);
  if (!기존 || a.length > 기존.answer.length) 고른것.set(열쇠, { id: r.id, question: q, answer: a, rating: r.rating });
}
const 최종 = [...고른것.values()].slice(0, CAP);

console.log(`주제 「${TOPIC}」 — 후보 ${rows.length}건 → 선별 ${고른것.size}건 → 채택 ${최종.length}건 (상한 ${CAP})`);
console.log("제외 사유:", [...제외사유.entries()].map(([k, v]) => `${k} ${v}`).join(" · ") || "(없음)");

if (!APPLY) {
  console.log("\n── 표본 12건(사람 검수용 — 앞 80자) ──");
  const 표본 = [...최종].sort(() => Math.random() - 0.5).slice(0, 12);
  for (const s of 표본) {
    console.log(`\nQ: ${s.question.slice(0, 80)}`);
    console.log(`A: ${s.answer.replace(/\n/g, " ").slice(0, 160)}`);
  }
  console.log("\n(--apply 를 붙이면 rating=1 승인 + 데이터셋 파일을 만듭니다)");
  process.exit(0);
}

const 재검토 = 최종.filter((s) => s.rating === -1).length;
const rate = db.prepare("UPDATE chat_logs SET rating = 1 WHERE id = ?");
const tx = db.transaction(() => { for (const s of 최종) rate.run(s.id); });
tx();

const dsId = `lora-${TOPIC === "취약점" ? "vuln" : TOPIC}-${new Date().toISOString().slice(0, 10)}`;
const dsPath = path.resolve("data", "datasets", `${dsId}.json`);
fs.writeFileSync(dsPath, JSON.stringify(최종.map(({ question, answer }) => ({ question, answer })), null, 1), "utf8");

try {
  const { recordAudit } = require(path.resolve("dist/engine/audit.js"));
  recordAudit({
    kind: "write", action: "learnloop_rate_batch", target: dsId,
    detail: `LoRA 재료 승인 배치 — 주제 ${TOPIC} ${최종.length}건 승인(그중 예전 일괄 부정의 재검토 ${재검토}건 — 명백히 옳은 답이 -1로 남아 있어 일괄 처리로 판정). 기준: 개념·절차형만, 상태 나열·폴백·결재판·합성 프롬프트 제외. 데이터셋 ${dsId}`,
    actor: "claude(위임 승인 배치)",
  });
} catch (e) { console.warn("감사 기록 실패(승인 자체는 완료):", e?.message); }

console.log(`\n승인 ${최종.length}건(rating=1) + 데이터셋 저장: ${dsPath}`);
