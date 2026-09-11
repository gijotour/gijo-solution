// 학습 후보함(환류 1단계, 2026-07-29) — 계획서 전-3 검증.
// [전중후 계획서 정렬] 이 시험이 지키는 단계 기준: "승인된 좋은 문답 50~100개"로 가는 관로가
// 자동 반영 없이(원칙) 안전하게(비밀 필터) 동작하는가. 중-3(평가 게이트 100~200문항)은 다음 단계.
// 가장 중요한 성질 두 가지:
//   ① 자동으로 어디에도 안 먹인다 — 승인해야만 👍가 된다.
//   ② 비밀·잡담·회피·복창은 후보조차 되지 않는다.
import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../src/db";
import { listLearnCandidates, decideLearnCandidate, acceptStrongCandidates } from "../src/engine/learncandidates";
import { recordChatLog, listChatLogs, putLearnloopConfig } from "../src/engine/learnloop";
import { createSession, appendTurn } from "../src/engine/worksessions";
import { 자료없음배너, 지정범위배너, 자료요청배너, 근거약함배너, 온톨로지전용알림, 목록전용알림 } from "../src/engine/noevidence";

function wipe() {
  db.prepare("DELETE FROM chat_logs").run();
  db.prepare("DELETE FROM learn_candidate_decisions").run();
  db.prepare("DELETE FROM work_session_turns").run();
  db.prepare("DELETE FROM work_sessions").run();
}

// 근거 인용이 있는 "좋은 답" 표본 — 길이 80자 이상(가점 창 안).
const GOOD_ANSWER =
  "KEV 등재 취약점은 BOD 22-01 기준 조치 기한이 지정되며, 사내 SLA(Critical 7일)가 더 빠르면 그쪽을 따릅니다. " +
  "자세한 절차는 GIJO_AS_취약점관리_지침.md를 참고했습니다. 지금 미조치 건은 우선순위 화면에서 확인하세요.";

describe("학습 후보함 — 선별 규칙", () => {
  beforeEach(() => {
    wipe();
    putLearnloopConfig({ autoCollect: true });
  });

  it("미평가 대화 로그가 후보로 나오고, 근거 인용은 점수가 높다", () => {
    recordChatLog("orchestrator", "KEV 조치 기한이 언제까지야?", GOOD_ANSWER);
    // 근거 인용 없는 평범한 문답 — 점수 비교용 (⚠ '날씨'는 잡담 규칙에 걸리므로 표본으로 쓰면 안 된다)
    recordChatLog("orchestrator", "이번 주 점검 일정 알려줘", "이번 주 예정된 유지보수 점검은 2건입니다. 화요일 방화벽 정책 점검, 금요일 IPS 시그니처 업데이트가 있습니다. 각 점검의 담당자와 시간은 유지보수 화면에서 확인할 수 있습니다.");
    const { candidates } = listLearnCandidates();
    expect(candidates.length).toBe(2);
    expect(candidates[0].question).toContain("KEV"); // cite 3점이 앞으로
    expect(candidates[0].signals.cite).toBe(true);
    expect(candidates[0].score).toBeGreaterThan(candidates[1].score);
  });

  it("잡담·회피 답변·비밀·도구 복창은 후보가 되지 않는다", () => {
    recordChatLog("orchestrator", "고마워 수고했어", GOOD_ANSWER); // 잡담
    recordChatLog("orchestrator", "웹서버 취약점 알려줘", "요청하신 내용을 사내 자료에서 찾을 수 없습니다. 다른 표현으로 물어보시거나 관련 문서를 올려 주세요."); // 회피 → 지식 구멍
    recordChatLog("orchestrator", "토큰 등록 방법", "설정에서 password= supersecret123 을 입력하면 됩니다. 등록 후에는 화면에 끝 4자만 표시되고 다시 보여주지 않습니다."); // 비밀
    recordChatLog("orchestrator", "자산 검색해줘", "AI 자산 3건:\n  - web-01 | 웹 서비스 (id=vuln:web-01) — 점수 9. 상세는 자산 화면에서 확인하세요. 필요하면 담당자 배정도 할 수 있습니다."); // 복창
    const { candidates, kpis } = listLearnCandidates();
    expect(candidates.length).toBe(0);
    expect(kpis.excludedByReason["잡담"]).toBe(1);
    expect(kpis.excludedByReason["회피 답변(지식 구멍)"]).toBe(1);
    expect(kpis.excludedByReason["비밀 흔적"]).toBe(1);
    expect(kpis.excludedByReason["도구 원출력 복창"]).toBe(1);
  });

  it("작업내역 user→assistant 짝이 후보가 되고, 도구 실행은 가점이다", () => {
    const s = createSession("점검 세션");
    appendTurn(s.id, "user", "ASA 106023 로그가 반복되는데 무슨 뜻이야?");
    appendTurn(s.id, "assistant", "ACL에서 차단된 패킷 기록입니다. 한 IP에서 반복되면 스캔·공격 시도 의심 신호로, 차단을 유지한 채 출발지 평판과 대상 포트를 함께 확인하는 것이 표준 대응입니다. 세부 절차는 로그체계 문서를 참고했습니다.", "search");
    const { candidates } = listLearnCandidates();
    expect(candidates.length).toBe(1);
    expect(candidates[0].source).toBe("worksession");
    expect(candidates[0].signals.tool).toBe(true);
    expect(candidates[0].signals.cite).toBe(true);
  });

  // ★ 2026-09-05 검토관 — 「근거가 없다」고 **스스로 밝힌 답**이 인용 가점을 받던 결함.
  //   2026-08-05에 「근거 약함」 하나만 막아 뒀는데 그 뒤 배너가 4종으로 늘었고,
  //   **자료요청 배너**의 「사내 자료에 근거가 없습니다」가 CITE_RE의 `근거`에 걸려 +3점을 받았다.
  //   → 이제 판정기 한 곳(noevidence.ts)에 묻는다. 배너가 다섯째로 늘어도 이 시험이 따라간다.
  it("★ 배너 4종이 붙은 답은 인용 가점을 못 받는다 — 근거 없다고 밝힌 답이 상위에 서면 안 된다", () => {
    const 본문 = "일반적으로 접근권한 검토는 분기마다 하고, 퇴사자 계정은 즉시 회수합니다. 사내 규정이 다르면 그쪽을 따르세요. 자세한 절차는 담당 부서에 확인이 필요합니다.";
    let 실제로잰것 = 0;
    for (const [종류, 배너] of [
      ["자료없음", 자료없음배너], ["지정범위", 지정범위배너],
      ["자료요청", 자료요청배너], ["근거약함", 근거약함배너],
    ] as [string, string][]) {
      wipe();
      recordChatLog("orchestrator", `우리 회사 접근권한 검토 주기 알려줘 (${종류})`, `${배너}\n\n${본문}`);
      const { candidates } = listLearnCandidates();
      // 후보로 아예 안 나오는 배너도 있다(근거약함 배너는 「없습니다」가 회피 답변 규칙에 먼저 걸린다).
      // 그건 **더 강한 차단**이라 통과다 — 여기서 재는 것은 「후보가 됐다면 인용 가점은 없어야 한다」다.
      for (const c of candidates) { 실제로잰것++; expect(c.signals.cite, `${종류} 배너가 붙었는데 인용 가점을 받았다`).toBe(false); }
    }
    // ⚠ 넷이 다 후보에서 빠지면 이 시험은 **아무것도 안 잰 채 초록**이 된다(헛시험 방지).
    expect(실제로잰것, "배너 답이 하나도 후보로 안 나왔다 — 표본이 낡았는지 보라").toBeGreaterThan(0);
  });

  // ★ 2026-09-11 검토관 — **세 번째 재발**. 배너가 아닌 정직 표지(B2, 온톨로지·목록 전용)가
  //   생겼는데 배너표 밖이라 판정기가 null을 냈고, 표지 문장의 「근거」가 CITE_RE에 걸려
  //   근거 없다고 스스로 밝힌 답이 다시 +3점을 받았다. 표지도 같은 판정기에 묻게 했다.
  it("★ 배너가 아닌 정직 표지(본문 근거 없음)가 붙은 답은 후보에서 아예 빠진다 — 지식 구멍이다", () => {
    // 잣대가 두 겹이다: ① 회피 답변(지식 구멍) 제외 — sessionpatterns.NO_ANSWER가 표지를 읽는다
    //   ② 그래도 후보가 됐다면 인용 가점 없음 — learncandidates가 noevidence 판정기에 묻는다.
    //   ①이 더 강한 차단이라 실제로는 여기서 걸린다(근거약함 배너와 같은 꼴). ②는 표지가
    //   문장만 바뀌어도 남는 안전망이라 함께 둔다(explain-banner.test가 그쪽을 문다).
    const 본문 = "VPR은 취약점의 실제 위험도를 0.1~10.0으로 매긴 점수입니다. 이론적 심각도만 보는 CVSS와 달리 악용 성숙도와 위협 정보를 함께 반영합니다. 자세한 기준은 담당 부서에 확인이 필요합니다.";
    for (const [종류, 표지] of [["온톨로지전용", 온톨로지전용알림], ["목록전용", 목록전용알림]] as [string, string][]) {
      wipe();
      recordChatLog("orchestrator", `VPR이 뭐야? (${종류})`, `${표지}\n\n${본문}`);
      const { candidates, kpis } = listLearnCandidates();
      for (const c of candidates) expect(c.signals.cite, `${종류} 표지가 붙었는데 인용 가점을 받았다`).toBe(false);
      expect(candidates.length, `${종류} 표지를 단 답이 학습 후보로 섰다`).toBe(0);
      expect(kpis.excludedByReason["회피 답변(지식 구멍)"], `${종류} 표지가 지식 구멍 신호에서 빠졌다`).toBe(1);
    }
    // 표지가 없는 같은 본문은 **후보가 된다** — 위 0건이 「표본이 낡아서」가 아님을 못 박는다.
    wipe();
    recordChatLog("orchestrator", "VPR이 뭐야? (표지 없음)", 본문);
    expect(listLearnCandidates().candidates.length, "표지 없는 표본까지 0이면 이 시험은 아무것도 안 잰다").toBe(1);
  });

  it("직후에 고쳐 물으면 수용 신호가 꺼진다(암묵 거부)", () => {
    const s = createSession("재질문 세션");
    appendTurn(s.id, "user", "방화벽 장애 대응 절차 알려줘");
    appendTurn(s.id, "assistant", "장애 대응은 증상 기록부터 시작해 로그 확보, 이중화 절체 확인, 유지보수 접수 순으로 진행합니다. 재부팅 전 로그 백업이 가장 중요합니다. 세부는 유지보수 절차 문서를 참고했습니다.");
    appendTurn(s.id, "user", "아니 방화벽 장애 대응 절차 자세히 알려줘"); // 같은 말 고쳐 묻기
    const { candidates } = listLearnCandidates();
    const c = candidates.find((x) => x.question.includes("방화벽 장애"));
    expect(c).toBeDefined();
    expect(c!.signals.accepted).toBe(false);
  });

  it("승인해야만 👍가 된다 — 자동 반영 없음", () => {
    recordChatLog("orchestrator", "KEV 조치 기한이 언제까지야?", GOOD_ANSWER);
    const before = listChatLogs(10);
    expect(before.kpis.positive).toBe(0); // 후보로 떴다고 👍가 되진 않는다
    const { candidates } = listLearnCandidates();
    decideLearnCandidate(candidates[0].id, true, "시험");
    expect(listChatLogs(10).kpis.positive).toBe(1);
  });

  it("작업내역 후보를 승인하면 로그로 옮겨지고(👍), 같은 문답은 다시 후보로 안 나온다", () => {
    const s = createSession("승인 세션");
    appendTurn(s.id, "user", "KEV 조치 기한이 언제까지야?");
    appendTurn(s.id, "assistant", GOOD_ANSWER);
    const first = listLearnCandidates();
    expect(first.candidates.length).toBe(1);
    decideLearnCandidate(first.candidates[0].id, true, "시험");
    const logs = listChatLogs(10);
    expect(logs.kpis.positive).toBe(1);
    expect(logs.logs[0].answer).toBe(GOOD_ANSWER);
    // 옮겨진 뒤에는 지문 중복으로 다시 안 나온다
    expect(listLearnCandidates().candidates.length).toBe(0);
  });

  it("제외한 작업내역 후보는 다시 나오지 않는다", () => {
    const s = createSession("제외 세션");
    appendTurn(s.id, "user", "KEV 조치 기한이 언제까지야?");
    appendTurn(s.id, "assistant", GOOD_ANSWER);
    const first = listLearnCandidates();
    decideLearnCandidate(first.candidates[0].id, false, "시험");
    expect(listLearnCandidates().candidates.length).toBe(0);
    expect(listChatLogs(10).kpis.positive).toBe(0); // 제외는 👍가 아니다
  });

  it("일괄 승인은 신호 강한 것(기본 3점 이상)만 집는다", () => {
    recordChatLog("orchestrator", "KEV 조치 기한이 언제까지야?", GOOD_ANSWER); // cite+length = 4점
    recordChatLog("orchestrator", "안녕하세요 반갑습니다 오늘 일정 알려줘", "오늘 등록된 일정은 없습니다. 새 일정은 유지보수 화면에서 등록할 수 있고, 등록하면 오늘 할 일에도 표시됩니다."); // 약한 신호(1점)
    const r = acceptStrongCandidates(3, "시험");
    expect(r.accepted).toBe(1);
    expect(listChatLogs(10).kpis.positive).toBe(1);
  });
});
