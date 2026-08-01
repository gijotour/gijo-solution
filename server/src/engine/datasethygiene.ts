// 학습 데이터셋 위생 — **무엇을 가르치면 안 되는가** (계획서 중-4, 학습환경_분리_설계 §5)
//
// 게이트(중-3)는 "학습한 모델이 나빠졌나"를 잰다. 이 파일은 그 앞 단계 —
// **애초에 나빠질 것을 안 넣는다.** 게이트만 믿으면 늦다: 며칠 학습한 뒤에야 보류가 뜨고,
// 왜 나빠졌는지는 알 수 없다(데이터가 뒤섞여 있어 되짚을 수가 없다).
//
// 막는 것 9종 — 전부 운영에서 실측된 오염이다:
//   ① 같은 질문 반복 — 후보 385건이 서로 다른 질문 31개였다("방화벽 월간 정기점검" 62회).
//      그대로 넣으면 31문항만 잘하고 나머지는 잊는 모델이 된다(망각 scaling law).
//   ② 시험 문항 — 회귀 하네스·평가 게이트 질문. 이걸 배우면 **시험지를 외운 채 시험을 본다.**
//      점수는 오르는데 실력은 그대로라, 게이트가 제 구실을 못 하게 된다(가장 위험).
//   ③ 기계가 만든 글 — 프롬프트 틀(`사용자 지시: "…"`)·맥락 덩어리. 사람 문장이 아니다.
//   ④ 보안 시험 표식 — 레드팀 마커·RAG 오염 카나리. 승인하면 **주입 성공 사례를 가르친다.**
//   ⑤ 시점 데이터 — 그날의 숫자·날짜·자산. 배우면 **낡은 사실을 외운 모델**이 된다.
//   ⑥ 너무 짧은 질문 — "?"·"1". 무엇을 묻는지 모르는 질문의 답은 아무 데나 붙는다.
//   ⑦ 내부 프롬프트 누출 — 답에 시스템 프롬프트가 섞인 것. 배우면 자기 규칙을 읊는다.
//   ⑧ 회피 답변 — "찾을 수 없습니다". 지식 구멍이지 가르칠 지식이 아니다.
//   ⑨ 운영 확인용 질문 — "테스트: 한 문장으로", "인사해줘". 내가 서버 보려고 던진 말이다.
//   ⑤~⑨는 2026-08-01 첫 실전 데이터셋에서 나왔다 — 30문항 중 **26개가 이 다섯에 걸렸다.**
//
// 지문(sha256)을 함께 낸다 — "이 모델이 무엇으로 학습됐나"를 나중에 되짚기 위해서다.
// 설계 §4의 반입 관문이 gguf와 이 지문만 옮기기로 한 이유가 그것이다.
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

export interface Example {
  question: string;
  answer: string;
}

export interface HygieneResult {
  kept: Example[];
  dropped: Record<string, number>;
  /** 데이터셋 지문 — 채택 원장에 남긴다. 같은 지문이면 같은 데이터로 학습한 모델이다. */
  fingerprint: string;
}

const INJECT_MARK_RE = /카나리주입성공|INJECTED-[0-9A-F]{4}/;
const MACHINE_RE = /^사용자 지시:\s*"|^이전 대화 맥락/;

/**
 * ⑤ **시점 데이터** — 오늘의 숫자·날짜·자산 이름이 든 답. 2026-08-01 첫 실전 데이터셋에서
 * 발견했다. 첫 문항이 이랬다:
 *
 *   Q "AI 자산 위험 현황 은?"
 *   A "총 취약점 수: 3건 / 미검토 0건 / … [high] vuln:sample-web01 · OpenSSH < 9.6
 *      (CVE-2024-6387) 상태 approved, 담당 dohee, 기한 2026-07-28"
 *
 * 이걸 학습하면 모델이 **그날의 숫자를 외운다.** 다음 달에도 "총 3건"이라 답하고,
 * 그 답이 도구 조회보다 그럴듯해 보여 담당자가 믿는다. 지식이 아니라 **낡은 사실**이다.
 * 이런 질문은 애초에 도구가 그때그때 조회해서 답할 몫이지 모델이 외울 몫이 아니다.
 *
 * 판정 신호(하나라도 걸리면 뺀다):
 *   · 날짜 2026-07-28 꼴 — 지식 답에 특정 날짜가 박히는 일은 드물다
 *   · "N건"이 세 번 이상 — 상태별 집계를 늘어놓은 스냅샷
 *   · 우리 DB의 식별자(vuln:·asset: 접두, sample-web01 같은 자산 이름)
 * ⚠ 법령 답의 "제30조"·"1년 이상"은 걸리지 않아야 한다 — 그래서 **건**만 세고 년·조는 뺀다.
 */
const 시점데이터 = (a: string): boolean =>
  /\d{4}-\d{2}-\d{2}/.test(a) ||
  (a.match(/\d+\s*건/g) ?? []).length >= 3 ||
  /\b(?:vuln|asset|prod|cti):[\w.-]+/.test(a);

/**
 * ⑥ **너무 짧은 질문** — "?", "1", "결과" 같은 것. 무엇을 묻는지 모르는 질문에 딸린 답을
 * 배우면 모델이 아무 말에나 그 답을 붙인다.
 *
 * ⑦ **내부 프롬프트가 새어 든 답** — "당신은 안전한 AI입니다. 당신은 GIJO AS에서…"처럼
 * 시스템 프롬프트가 답에 섞인 것. 이걸 배우면 모델이 **자기 규칙을 사용자에게 읊는다**
 * (챗봇 전수 점검에서 AI-BOM 답 3건이 실제로 그랬다).
 *
 * ⑧ **회피 답변** — "찾을 수 없습니다 / 협조가 어렵습니다 / 더 알려 주세요". 지식 구멍이지
 * 가르칠 지식이 아니다. 배우면 **모르는 티를 내는 법**을 배운다.
 *
 * ⚠ 왜 여기에 또 두는가. 후보함(learncandidates)이 이미 같은 것을 거른다. 그런데
 *   `includeUnrated: true` 경로는 **후보함을 건너뛴다** — 2026-08-01 실측에서 그 경로로
 *   30문항을 뽑았더니 질문이 "?"·"1"이고 답에 시스템 프롬프트가 든 것이 섞여 있었다.
 *   위생은 **어느 길로 들어오든** 한 번은 거치는 마지막 관문이어야 한다.
 */
// ⚠ 처음엔 6자 미만으로 잘랐다가 **우리 도메인에서 가장 흔한 질문 꼴을 통째로 날렸다**
//   (2026-08-01 검토 지적): "KEV란?"(5) · "SLA란?"(5) · "위험도는?"(5)가 전부 탈락했다.
//   기준을 3자로 낮추고, 대신 **뜻이 없는 것**(문장부호·숫자만)을 따로 잡는다.
//   막으려던 것은 "?"·"1"이지 짧은 용어 질문이 아니었다.
const 짧은질문 = (q: string): boolean => {
  const t = q.replace(/\s+/g, "");
  if (t.length < 3) return true;
  return !/[가-힣A-Za-z]/.test(t); // 글자가 하나도 없으면(숫자·부호뿐) 물음이 아니다
};
const 프롬프트누출 = /당신은\s*(?:안전한\s*)?AI(?:입니다|이며)|You are a helpful|시스템 프롬프트:/;
// ⚠ 「못 찾았습니다」가 빠져 있었다(2026-08-01 검토 지적) — 같은 날 다른 커밋이 도구 0건
//   문구를 그걸로 통일했으므로, 앞으로 쌓일 회피 답변의 **표준형**이 그냥 통과할 뻔했다.
//   같은 날 두 커밋이 서로 어긋난 것이다.
// ⚠ 「알 수 없습니다」는 뺐다 — "EPSS만으로는 실제 악용 여부를 알 수 없습니다, KEV를 함께
//   봐야 합니다"처럼 **가르쳐야 할 지식**이 그 말로 끝난다. 문장 끝에서만 회피로 본다.
const 회피답변 =
  /찾을 수 없습니다|못 찾았습니다|협조가 어[렵려]|더 자세히 알려주|정보를 제공해 주시면|무엇을 도와드릴까요\?$|알 수 없습니다\.?$/;

/**
 * ⑨ **운영 확인용 질문** — "테스트: 짧게 한 문장으로", "한 단어로 인사", "정상 동작 확인",
 * "오늘 날씨 어때" 같은 것. 서버가 살아 있는지 보려고 던진 말이지 담당자의 업무가 아니다.
 *
 * ⚠ 2026-08-01 실측이 이 규칙을 만들었다. 첫 실전 데이터셋 30문항에 위생 ⑥⑦⑧을 걸었더니
 *   12문항이 남았는데, 그중 8개가 **내가 서버를 확인하려고 던진 말**이었다.
 *   담당자의 실제 질문으로 보이는 것은 4개뿐이었다 — 학습에 쓸 실사용 데이터가 아직 없다는 뜻이다.
 *   이걸 배우면 모델이 "한 문장으로 인사하는 법"을 익힌다.
 */
// ⚠ 두 번 좁혔다.
//   ① "한 단어로 인사"가 새어 나갔다 — `(?:단어|문장)으로`라고 썼는데 실제 말은 "단어**로**"였다.
//   ② 그렇게 넓혔더니 **업무 질문을 잘라 먹었다**(2026-08-01 검토 지적):
//      "방화벽이 **정상 동작**하는지 확인하는 방법 알려줘", "이 로그를 **한 문장으로** 요약해줘".
//      규칙이 넓으면 가르쳐야 할 것까지 사라진다 — 시점데이터 규칙에서 배운 것과 같다.
//   그래서 **문장 전체가 확인용일 때만** 잡는다. 뒤에 다른 일(요약해줘·방법 알려줘)이 붙으면
//   그건 업무 질문이다.
const 운영확인용 = [
  /^테스트\s*[:：]/,                                   // "테스트:"로 시작하면 확인용이다
  /^[^가-힣A-Za-z]*(짧게\s*)?한\s*(단어|문장)으?로(만)?\s*(응답|답|인사|말)\S*\s*[.!?]?$/, // 문장 전체가 이것뿐
  /^[^가-힣A-Za-z]*(현재\s*)?(시스템\s*)?정상\s*(동작|여부)\S*\s*(확인|알려|답)?\S*\s*[.!?]?$/,
  /^\S*\s*인사(해|하)\s*줘\s*[.!?]?$/,
  /날씨\s*어때/,
];
const 운영확인용테스트 = (q: string): boolean => 운영확인용.some((re) => re.test(q.trim()));

/**
 * 시험 문항 — 회귀 하네스·평가 게이트에 실제로 들어 있는 질문을 파일에서 읽는다.
 *
 * 목록을 여기에 베껴 두지 않는다. 베끼면 시험지가 늘어날 때마다 어긋나고,
 * 어긋난 줄도 모른 채 "시험 문항은 걸렀다"고 믿게 된다 — 파일이 곧 목록이다.
 */
function 시험문항(): Set<string> {
  const 정규화 = (s: string) => String(s ?? "").replace(/\s+/g, "").replace(/[?!.,·…]/g, "");
  const out = new Set<string>();

  // ① 서버 안에 구워 둔 목록을 먼저 읽는다 — **운영에는 tools/가 없기 때문이다.**
  //    (2026-08-01 검토에서 잡힘: 운영에서 이 필터가 늘 꺼져 있었다. 그 사실이 어디에도
  //     안 남아서 "시험 문항은 걸렀다"고 믿고 있었다.)
  //    갱신: node server/scripts/gen-exam-questions.mjs · 최신 여부는 examquestions.test.ts가 본다.
  for (const 후보 of [path.join(__dirname, "examquestions.json"), path.join(__dirname, "..", "..", "src", "engine", "examquestions.json")]) {
    try {
      if (!fs.existsSync(후보)) continue;
      const j = JSON.parse(fs.readFileSync(후보, "utf8")) as { 문항?: string[] };
      for (const q of j.문항 ?? []) out.add(q);
      break;
    } catch {
      /* 아래 tools/ 경로로 넘어간다 */
    }
  }

  // ② 개발기에서는 tools/ 원본도 함께 읽는다 — 시험지를 늘리고 아직 안 구운 상태를 덮는다.
  const 뿌리 = (() => {
    let d = __dirname;
    for (let i = 0; i < 6; i++) {
      if (fs.existsSync(path.join(d, "tools", "evalgate"))) return d;
      d = path.dirname(d);
    }
    return null;
  })();
  if (!뿌리) return out;
  const 파일 = [
    "tools/regress/cases.json",
    "tools/evalgate/cases/routing.json",
    "tools/evalgate/cases/safety.json",
    "tools/evalgate/cases/korean.json",
  ];
  for (const rel of 파일) {
    try {
      const p = path.join(뿌리, rel);
      if (!fs.existsSync(p)) continue;
      const raw = JSON.parse(fs.readFileSync(p, "utf8")) as unknown;
      const rows = Array.isArray(raw) ? raw : ((raw as { cases?: unknown[] }).cases ?? []);
      for (const c of rows as { q?: string; question?: string }[]) {
        const q = c?.q ?? c?.question;
        if (q) out.add(정규화(q));
      }
    } catch {
      // 시험 파일을 못 읽으면 **막지 못한 채 지나간다**. 조용히 넘기지 않도록 호출부가 건수를 본다.
    }
  }
  return out;
}

/**
 * 학습에 넣을 것만 남긴다. 질문 하나당 **가장 좋은 답 한 건**만 통과시킨다.
 *
 * ⚠ 여기서 거르는 것은 "나쁜 답"이 아니라 "가르치면 안 되는 것"이다.
 *   답의 옳고 그름은 사람이 후보함에서 판단했다(승인 👍). 이 함수는 그 뒤 단계다.
 */
/**
 * 데이터 종류 — 규칙을 다 걸면 안 되는 것이 있다.
 *
 * ⚠ 2026-08-01 실측: 위생을 saveDataset에 넣었더니 **오케스트레이터 시드 2개가 잘렸다.**
 *   그 답은 `{"tool":"update_finding_status","args":{"assetId":"vuln:sample-web01"}}` 꼴이라
 *   시점데이터 규칙(우리 DB 식별자)에 걸린 것이다. 그런데 라우팅 데이터는 **식별자가 있어야**
 *   도구 호출을 가르칠 수 있다. 지식 답에 맞춘 규칙을 라우팅에 그대로 걸면 가르칠 것이 사라진다.
 *
 * · "지식" — 담당자 문답. 아홉 규칙 전부.
 * · "라우팅" — 지시 → 도구 선택. **시험 문항과 주입 표식만** 막는다(그 둘은 종류와 무관하게
 *   게이트·안전을 무너뜨린다). 나머지는 이 데이터의 성질과 안 맞는다.
 */
export type 데이터종류 = "지식" | "라우팅";

/**
 * 이 지시가 시험지(회귀·게이트)에 있는가 — **지시만 따로** 볼 때 쓴다.
 *
 * ⚠ 2026-08-01: 오케스트레이터 시드는 question이 긴 프롬프트고 지시는 그 안에 박혀 있다.
 *   그래서 cleanForTraining의 시험 문항 대조(질문 전체를 본다)로는 못 걸러, 게이트 문항
 *   2개("안전대부 웹서버 취약점 알려줘"·"지금 제일 급한 취약점 알려줘")가 그대로 학습되고
 *   있었다. 지시가 따로 있는 자리에서는 이 함수로 본다.
 */
export function 시험문항인가(지시: string): boolean {
  const 정규화 = (x: string) => String(x ?? "").replace(/\s+/g, "").replace(/[?!.,·…]/g, "");
  return 시험문항().has(정규화(지시));
}

export function cleanForTraining(rows: Example[], 종류: 데이터종류 = "지식"): HygieneResult {
  const 지식 = 종류 === "지식";
  const 시험 = 시험문항();
  // ⚠ 시험지 목록이 비면 **막지 못한 채 지나간다.** 예전엔 그냥 넘어가서, 운영에서 이 필터가
  //   내내 꺼져 있었는데도 아무도 몰랐다(2026-08-01 검토). 이제는 멈춘다 —
  //   게이트 문항이 섞인 데이터로 학습하면 그 뒤 모든 점수가 거짓이 되기 때문이다.
  if (시험.size === 0) {
    throw new Error(
      "시험 문항 목록을 읽지 못했습니다 — 학습 데이터를 만들 수 없습니다.\n" +
        "평가 게이트 질문이 섞이면 모델이 시험지를 외운 채 시험을 보게 되어, 그 뒤 점수가 실력을 못 잽니다.\n" +
        "server/src/engine/examquestions.json이 배포됐는지 확인하세요(만들기: node server/scripts/gen-exam-questions.mjs).",
    );
  }
  const 정규화 = (s: string) => String(s ?? "").replace(/\s+/g, "").replace(/[?!.,·…]/g, "");
  const dropped: Record<string, number> = {};
  const drop = (why: string) => { dropped[why] = (dropped[why] ?? 0) + 1; };

  const 최선 = new Map<string, Example>();
  for (const r of rows) {
    const q = String(r?.question ?? "").trim();
    const a = String(r?.answer ?? "").trim();
    if (!q || !a) { drop("빈 문답"); continue; }
    if (INJECT_MARK_RE.test(q) || INJECT_MARK_RE.test(a)) { drop("보안 시험 표식"); continue; }
    if (지식 && MACHINE_RE.test(q)) { drop("기계 생성(프롬프트 틀·맥락 덩어리)"); continue; }
    if (지식 && 시점데이터(a)) { drop("시점 데이터(그날의 숫자·날짜·자산)"); continue; }
    if (지식 && 짧은질문(q)) { drop("질문이 너무 짧음"); continue; }
    if (지식 && 프롬프트누출.test(a)) { drop("내부 프롬프트 누출"); continue; }
    if (지식 && 회피답변.test(a)) { drop("회피 답변(지식 구멍)"); continue; }
    if (지식 && 운영확인용테스트(q)) { drop("운영 확인용 질문(내 시험 흔적)"); continue; }
    const key = 정규화(q);
    if (시험.has(key)) { drop("시험 문항(회귀·게이트)"); continue; }
    // 같은 질문이 또 오면 **긴 답**을 남긴다 — 짧은 답은 대개 얼버무린 것이다.
    const 있던 = 최선.get(key);
    if (있던) {
      drop("같은 질문 반복");
      if (a.length > 있던.answer.length) 최선.set(key, { question: q, answer: a });
    } else {
      최선.set(key, { question: q, answer: a });
    }
  }

  // 지문은 **내용**으로 만든다(순서·id 무관) — 같은 데이터면 언제 뽑아도 같은 지문이라야
  // "이 모델이 무엇으로 학습됐나"를 대조할 수 있다.
  const kept = [...최선.values()].sort((a, b) => a.question.localeCompare(b.question));
  const fingerprint = createHash("sha256")
    .update(kept.map((e) => `${e.question} ${e.answer}`).join(""), "utf8")
    .digest("hex")
    .slice(0, 16);

  return { kept, dropped, fingerprint };
}
