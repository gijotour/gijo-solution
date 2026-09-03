// 주제 딱지 — [2026-08-07 · 「전문 에이전트」 논의에서 실측이 시킨 것]
//
// 발견: 역할 딱지(agentId)는 이미 있었는데 **한쪽에만 쌓였다** — orchestrator 1,403건(66%),
//   전문 역할 scan 10 · ti 9. 대화창 지시가 전부 orchestrator로 가기 때문이다.
//   이대로면 파일럿 4주 뒤에도 전문가별 재료는 한 자릿수다.
// 계약: 질문의 **주제**를 코드로(LLM 없이) 판정해 함께 남긴다. 애매하면 null — 억지로 안 붙인다.
//
// [2026-09-03 · 증류 5번째 주제 「일반」 — 증류학습 계획서 §3.3.1 normaltic 재료]
//   「일반」은 용어·개념을 묻는 질문에만 붙는 **낱말 규칙**이다(catch-all 아님). 업무 주제 넷이 전부 0점일 때만
//   본다 — 「CVE-2021-44228이 뭐야?」는 용어 질문 꼴이지만 취약점 몫이라는 위 계약을 지키기 위해서다.
//   짝 계약 둘: ① TOPICS마다 어댑터 슬러그가 있다("misc" 폴백 금지) ② TOPICS ⊆ CATEGORIES(§3.6-9 「매핑 불필요」).
import { describe, it, expect } from "vitest";
import { 질문주제, TOPICS, topicSlug } from "../src/engine/learnloop";
import { CATEGORIES } from "../src/engine/hybridsearch";
import { forcedToolFor } from "../src/engine/agentloop";

describe("질문 주제 판정 — 결정적, 억지 없음", () => {
  it("★ 실전 질문이 제 주제로 간다", () => {
    expect(질문주제("미조치 취약점 알려줘")).toBe("취약점");
    expect(질문주제("CVE-2021-44228이 뭐야?")).toBe("취약점");
    expect(질문주제("방화벽 월간 정기점검 절차를 알려줘")).toBe("장비운영");
    expect(질문주제("USB로 로그 반출해도 돼?")).toBe("사내규정");
    expect(질문주제("최근 위협 인텔 요약해줘")).toBe("위협대응");
  });

  it("★★ 애매하면 안 붙인다 — 억지 딱지가 오분류보다 나쁘다", () => {
    expect(질문주제("오늘 뭐부터 볼까?")).toBeNull();
    expect(질문주제("그거 어떻게 해")).toBeNull();
    expect(질문주제("")).toBeNull();
  });

  it("★★ 동점(경계 질문)도 안 붙인다", () => {
    // 방화벽(장비운영 1) + 규정(사내규정 1) — 어느 쪽이라 단정할 수 없다
    expect(질문주제("방화벽 규정 어디 있어?")).toBeNull();
  });

  it("같은 질문은 언제나 같은 딱지 — 지난달 판정을 설명할 수 있어야 한다", () => {
    const q = "패치 안 된 지 오래된 취약점 알려줘";
    expect(질문주제(q)).toBe(질문주제(q));
    expect(질문주제(q)).toBe("취약점");
  });
});

describe("주제 「일반」 — 용어·개념 질문(해설 팀원 재료), catch-all 아님 [계획서 §3.3.1 normaltic]", () => {
  it("★ 용어사전 표제어를 실제로 묻는 꼴이 「일반」로 간다", () => {
    // 「**온프레미스(on-premise)** / 쉽게 말하면 …」 — 용어사전의 표제어 형식을 사람이 묻는 모양 그대로
    expect(질문주제("온프레미스가 뭐야?")).toBe("일반");
    expect(질문주제("온톨로지란 무엇인가요")).toBe("일반");
    expect(질문주제("SBOM 뜻이 뭐야")).toBe("일반");
    expect(질문주제("MFA 약어 풀어줘")).toBe("일반");
    expect(질문주제("가드레일 개념 쉽게 설명해줘")).toBe("일반");
    expect(질문주제("레드팀이랑 가드레일 차이가 뭐야")).toBe("일반");
    expect(질문주제("팝업 셸이란?")).toBe("일반");
  });

  it("★★ 반증 — 「(미분류)」는 그대로 남는다: 잡담·맨 「뭐」는 「일반」이 아니다", () => {
    expect(질문주제("안녕")).toBeNull();
    expect(질문주제("안녕하세요")).toBeNull();
    expect(질문주제("고마워")).toBeNull();
    expect(질문주제("오늘 뭐부터 볼까?")).toBeNull(); // 맨 「뭐」는 용어 질문이 아니다(기존 계약 그대로)
    expect(질문주제("그거 어떻게 해")).toBeNull();
  });

  it("★★ 업무 낱말이 든 용어 질문은 그 업무 주제 — 「일반」이 동점을 만들어 null로 떨어뜨리지 않는다", () => {
    expect(질문주제("CVSS가 뭐야?")).toBe("취약점");
    expect(질문주제("IOC 뜻이 뭐야")).toBe("위협대응");
    expect(질문주제("룰셋이란?")).toBe("장비운영");
  });

  it("★★ 업무 주제끼리의 동점(경계)은 「일반」 신호가 있어도 여전히 null", () => {
    // 방화벽(장비운영 1) + 규정(사내규정 1) + 「가 뭐야」(일반) — 경계 질문을 「일반」로 삼키지 않는다
    expect(질문주제("방화벽 규정이 뭐야?")).toBeNull();
  });

  it("★★ 과포착 반증(검토관 2026-09-03 라) — 국가명 「이란」·끝음절 「란」·상태·일정 조회는 「일반」이 아니다", () => {
    // 「이란」은 앞에 글자가 붙은 꼴(「SBOM이란」)만 용어 물음이다 — 단독 낱말은 국가명
    expect(질문주제("이란 핵 협상 뉴스")).toBeNull();
    expect(질문주제("SBOM이란")).toBe("일반"); // 물음 표지 없이 끝나도 앞글자가 있으면 그대로 「일반」(기존 계약 보존)
    // 「혼란·분란·교란·…」은 끝음절이 「란」일 뿐이다
    expect(질문주제("혼란이 생겼어")).toBeNull();
    expect(질문주제("교란 전파가 잡혔어")).toBeNull();
    // 「○○이/가 뭐야」 꼴의 상태·일정 조회 — 반증 낱말(할 일·일정·상태·상황·진행·오늘·지금·몇·언제·어디)이 있으면 안 붙인다
    expect(질문주제("오늘 할 일이 뭐야")).toBeNull();
    expect(질문주제("지금 상태가 뭐야")).toBeNull();
    expect(질문주제("진행 상황이 뭐야")).toBeNull();
  });

  it("판본 없는 「CVE가 뭐야」는 용어 질문 → 「일반」(검토관 2026-09-03 바) — 낱말 「CVE」만으로 취약점 신호를 세지 않는다", () => {
    // 이걸 취약점 신호에 넣으면 용어 질문이 전부 취약점으로 가서 해설 팀원 재료가 준다. 판본이 붙은 CVE는 취약점(위 계약).
    expect(질문주제("CVE가 뭐야")).toBe("일반");
    expect(질문주제("CVE-2021-44228이 뭐야?")).toBe("취약점");
  });

  it("같은 질문은 언제나 같은 딱지", () => {
    const q = "폐쇄망이 무슨 말이야";
    expect(질문주제(q)).toBe(질문주제(q));
    expect(질문주제(q)).toBe("일반");
  });
});

describe("TOPICS 짝 계약 — 슬러그·업무영역 (2026-09-03)", () => {
  it("★ TOPICS에 「일반」이 있고, 다섯째다", () => {
    expect(TOPICS).toContain("일반");
    expect(TOPICS.length).toBe(5);
  });

  it("★★ TOPICS마다 어댑터 슬러그가 있다 — 'misc' 폴백은 주제를 잃은 것이다", () => {
    // learnloop.ts: 학습 산출 어댑터 id = `${modelPrefix}-${topicSlug(topic)}`. 슬러그가 빠지면 조용히 "misc"가 된다.
    for (const t of TOPICS) expect(topicSlug(t), `주제 ${t}의 슬러그`).not.toBe("misc");
    expect(topicSlug("일반")).toBe("general");
    expect(new Set(TOPICS.map(topicSlug)).size, "슬러그가 서로 겹치면 두 주제가 한 어댑터 id를 다툰다").toBe(TOPICS.length);
    expect(topicSlug("없는주제")).toBe("misc"); // 폴백 자체는 그대로다 — 모르는 값을 지어내지 않는다
  });

  it("★★ TOPICS ⊆ CATEGORIES — 배지 topic이 반입 문서 category와 같은 문자열이어야 한다(§3.6-9)", () => {
    // learnmemory.ts ingest(): category = log.topic ?? "일반" 을 그대로 넘긴다.
    // memory.ts ingestText(): CATEGORIES 밖이면 그 값을 버리고 다시 분류한다 → 배지와 저장 분류가 갈라진다.
    for (const t of TOPICS) expect(CATEGORIES as readonly string[], `주제 ${t}가 업무영역에 없다`).toContain(t);
  });
});

describe("「일반」 어댑터 반입 지시 — 결정적 파서가 handlers 주제별칭 표와 같은 낱말을 본다(검토관 2026-09-03 다)", () => {
  // agentloop.ts forcedToolFor의 분야 정규식에 낱말이 없으면 topic ""로 반입돼 어댑터가 분야를 잃는다.
  // 정식 이름(「용어」→「일반」)으로 바꾸는 것은 handlers.ts runAdapterImport 주제별칭 표의 몫 — 여기서는 낱말이 살아남는지만 본다.
  const admin = { role: "admin" as const };
  it("「일반/용어/개념 분야로 반입」이 주제를 잃지 않는다", () => {
    for (const 낱말 of ["일반", "용어", "개념"]) {
      const r = forcedToolFor(`normaltic-terms-v1.gguf 어댑터 ${낱말} 분야로 반입해줘`, admin);
      expect(r?.tool, 낱말).toBe("import_adapter");
      expect(r?.args.file, 낱말).toBe("normaltic-terms-v1.gguf");
      expect(r?.args.topic, 낱말).toBe(낱말);
    }
  });
});
