// tools/distill-precheck.mjs — 증류기 사전검사(교사 답을 서버에 보내기 전에 거르는 잣대).
//
// 왜 따로 떼었나: 이 잣대는 **서버 규칙의 사본**이다(learncandidates.근거겹침 · datasethygiene.시점데이터).
//   사본은 언젠가 어긋나므로, 떼어 놓고 시험에서 서버 함수와 **같은 답을 내는지 대조**한다
//   (server/test/distillprecheck.test.ts). distill.mjs 안에 두면 그 파일이 최상위 await 스크립트라
//   시험이 import할 수 없어 「정규식으로 소스를 훑는」 약한 감시밖에 못 건다.
//
// ⚠ 최종 관문은 서버다. 여기는 왕복을 아끼는 사전검사일 뿐이므로 **서버보다 느슨해서는 안 된다**.
//   딱 하나 서버보다 엄한 항목이 「한국어 아님」인데, 그건 --src-lang en 에서만 생기는 위험이다(아래).
import crypto from "node:crypto";

/** 서버 근거겹침과 같은 규칙 — 공백을 지우고 20자 창을 4칸씩 밀며 답에 그대로 들어 있는지 본다. */
export function overlap20(answer, text) {
  const a = String(answer ?? "").replace(/\s+/g, "");
  const s = String(text ?? "").replace(/\s+/g, "");
  if (a.length < 20 || s.length < 20) return null;
  for (let i = 0; i + 20 <= s.length; i += 4) { const w = s.slice(i, i + 20); if (a.includes(w)) return w; }
  return null;
}

// 위생 사전검사(서버 datasethygiene 시점데이터 규칙 세 신호 전부) — 날짜·「N건」 나열·우리 DB 식별자는 서버가 거절하니 미리 거른다.
export const 시점데이터 = (a) =>
  /\d{4}-\d{2}-\d{2}/.test(a) || ((String(a).match(/\d+\s*건/g) || []).length >= 3) || /\b(?:vuln|asset|prod|cti):[\w.-]+/.test(a);

/** ref = <경로>#<sha12(본문)> 의 꼬리 — 서버 편입이 본문 해시와 대조한다(같은 규칙을 여기서도 만든다). */
export const sha12 = (s) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 12);

/** 따옴표로 감싼 열 자 이상의 토막을 지운다 — 「인용을 뺀 나머지 설명」만 남긴다. */
export function 인용뺀설명(a) {
  return String(a ?? "").replace(/[“"']([^”"']{10,})[”"']/g, " ");
}

/** 한글 음절이 글자(공백 제외) 중 몇 할인가. 글자가 하나도 없으면 0. */
export function 한글비율(s) {
  const t = String(s ?? "").replace(/\s/g, "");
  if (!t.length) return 0;
  return (t.match(/[가-힣]/g) || []).length / t.length;
}

/**
 * 교사가 낸 문답 한 건을 볼까 말까 — 통과면 null, 아니면 **거절 사유**(보고서 preRejected의 키가 된다).
 *
 * srcLang="en"(영어 원천)일 때만 달라지는 것 둘:
 *   ① 「한국어 아님」 — 답이 통째로 영어로 오면 겹침은 통과하지만 그걸 배우면 **영어로 답하는 법**을 배운다.
 *      인용은 빼고 재므로(인용뺀설명) 정상적인 「한국어 설명 + 원문 한 문장」은 걸리지 않는다.
 *   ② 겹침 실패의 사유 이름 — 영어 모드에서 겹침이 없다는 건 「원문 인용을 안 했다」는 뜻이라 그렇게 적는다
 *      (한국어 모드의 「근거 겹침 없음」과 원인이 다르므로 보고서에서 섞이면 안 된다).
 */
export function 사전검사(question, answer, chunkText, { srcLang = "ko" } = {}) {
  const q = String(question ?? "").trim(), a = String(answer ?? "").trim();
  if (!q || !a) return "빈 문답";
  if (a.length < 80) return "답 너무 짧음";
  if (a.length > 1200) return "답 너무 김";
  if (시점데이터(a)) return "시점데이터(날짜·N건)";
  if (srcLang === "en" && 한글비율(인용뺀설명(a)) < 0.5) return "한국어 아님(설명이 영어)";
  if (!overlap20(a, chunkText)) return srcLang === "en" ? "영어 원문 인용 없음(20자 겹침)" : "근거 겹침 없음(20자)";
  return null;
}
