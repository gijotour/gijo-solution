// 긴 형식(D갈래) 학습 재료 생성기가 지키는 것 — 증류 사다리 회전 2 (계획서 §12).
//
// 이 파일이 지키는 것은 셋이다.
//   ① **결정성** — 같은 씨앗이면 같은 조각·같은 질문. 재료를 다시 만들 수 있어야 「무엇으로 배웠나」를 말할 수 있다.
//      (distill.mjs 는 씨앗에 **날짜**를 섞어 매일 달라진다. 학습 재료는 그러면 안 된다.)
//   ② **심사** — 절·길이·한글·인용·지어낸 값. 잣대가 무르면 회전 1의 실패(224자 짧은 답)를 그대로 반복한다.
//   ③ **저장 창구 미호출** — 이 재료는 학습 전용이라 승인함·지식 저장소에 들어가면 안 된다.
//      「안 넣기로 했다」는 약속은 사람이 지키지 못한다. 소스에 그 경로 문자열이 없는지 **기계가 본다.**
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  절_요청서, 절_요약보고, 절_벤치_1회차, 절_벤치_2회차, 서술절, 팀들, 기한들, 자산들, 금지자산, 금지CVE,
  제품이름, 레코드파싱, 조각모으기, 조각고르기, 변형, 질문만들기, 일감만들기, 이미채택된질문,
  절자리, 절본문, 문장수, 설명부, 인용뽑기, 심사, 교사지시, 인용못박기, 길이하한, 길이상한,
} from "../../tools/distill-longform.mjs";
import { 한글비율, sha12 } from "../../tools/distill-precheck.mjs";

const 루트 = path.join(__dirname, "..", "..");
const src = (rel: string) => fs.readFileSync(path.join(루트, rel), "utf8");
const 도구 = () => src("tools/distill-longform.mjs");

// ── 시험용 근거 조각 — 실제 nvd-ours 레코드와 같은 꼴로 손수 짠 것(운영 데이터를 안 쓴다) ──
const 조각텍스트 = [
  "CVE-2024-99001 · 공개일 2024-05-02 · CVSS v3 기반점수 9.8 (CRITICAL) · CWE-78",
  "벡터(vectorString): CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
  "설명(NVD 영어 원문): Example Report Server before 4.2.7 allows a remote unauthenticated attacker to execute arbitrary operating system commands through a crafted request to the export endpoint. The vendor released a fixed build and recommends restricting network access to the management interface.",
  "참조: https://example.invalid/advisory/1",
].join("\n");
const 조각 = { ref: "t/x.md#aaaaaaaaaaaa", sha: "aaaaaaaaaaaa", text: 조각텍스트, ...레코드파싱(조각텍스트)! };
const 변형값 = { 자산: 자산들[0], 팀: "인프라팀", 기한: 7 };
const 질문 = `${자산들[0].name}(${자산들[0].ip})의 Example Report Server 4.2.7 CVE-2024-99001에 대한 조치 요청서를 써 줘. 담당 인프라팀, 기한 7일.`;

/** 통과해야 하는 답 — **제품 서식** 7절이 줄 머리에 서고, 서술 절은 두 문장 이상, 끝에 원문 한 줄.
 *  ⚠ 「요청일」에 날짜를 적으면 시점데이터로 떨어진다 — 상대 표현으로 쓰는 것이 이 재료의 규칙이다. */
const 좋은답 = [
  "## 요청 유형",
  "취약점 조치",
  "",
  "## 수신처",
  "인프라팀",
  "",
  "## 요청일",
  "본 요청서 발송일 기준",
  "",
  "## 조치 기한",
  "7일 안",
  "",
  "## 재점검 조건",
  "수정 빌드를 올린 뒤 같은 창구로 재점검을 돌려 같은 항목이 다시 잡히지 않는지 확인해 주십시오. 재점검이 깨끗하게 나오면 조치가 끝난 것으로 봅니다. 다시 잡히면 담당자와 함께 원인을 살펴야 합니다.",
  "",
  "## 대상 취약점",
  `${자산들[0].name}(${자산들[0].ip}) — Example Report Server 4.2.7 · CVE-2024-99001 · 기반 점수 9.8`,
  "이 취약점은 인증을 거치지 않은 외부 공격자가 내보내기 창구에 조작된 요청을 보내 운영체제 명령을 그대로 실행하게 합니다. 점수가 높게 매겨진 만큼 성공하면 서버 전체가 공격자 손에 넘어가는 수준의 피해로 이어집니다. 관리 화면이 사내 밖에서도 열려 있다면 위험은 더 커집니다.",
  "",
  "## 요청 사항",
  "공급사가 내놓은 수정 빌드로 올려 주십시오. 올리기 전까지는 관리 화면에 닿는 통신을 사내 관리 대역으로만 제한해 임시로 막아 주십시오. 올린 뒤에는 내보내기 창구에 남은 접근 기록을 되짚어 이미 시도된 흔적이 있는지 확인이 필요합니다.",
  "",
  '원문: "Example Report Server before 4.2.7 allows a remote unauthenticated attacker to execute arbitrary operating system commands through a crafted request to the export endpoint."',
].join("\n");
// 길이 하한(1,000자)을 넘기려고 설명을 덧댄다 — 이 시험이 재는 것은 잣대이지 교사가 아니다.
const 채움 = "같은 계열의 명령 실행 취약점은 내보내기·업로드처럼 사용자 입력이 그대로 명령줄로 흘러가는 자리에서 반복해 나타납니다. 그래서 이번 조치와 함께 같은 제품군의 다른 창구도 함께 점검해 두시면 같은 일이 되풀이되는 것을 막을 수 있습니다. 점검 결과는 받으신 쪽에서 이 요청서에 이어 적어 주십시오. 확인이 필요한 값은 확인 필요라고 남겨 주십시오. 적용 창을 잡을 때는 서비스 영향이 가장 적은 시간대를 골라 주시고, 되돌리기 절차를 미리 문서로 남겨 두십시오. 조치가 끝나면 같은 창구로 재점검을 돌려 결과를 이 요청서에 적어 주십시오. 재점검에서 같은 항목이 다시 잡히면 함께 원인을 다시 살펴야 합니다. 이 요청서는 받으신 쪽에서 마감할 때까지 열려 있습니다. 같은 제품군을 쓰는 다른 자산이 더 있는지도 자산 대장에서 함께 확인해 주십시오. 확인 결과가 나오면 이 요청서에 이어 적겠습니다. 이 건의 처리 경과는 조치 이력에 그대로 남습니다.";
const 긴좋은답 = 좋은답.replace("\n원문: ", `\n${채움}\n\n원문: `);

// ⚠ 재료(server/data/ladder/material/…)는 **운영 데이터**라 WSL 시험 사본이 안 가져간다
//   (wsl-test.sh: 「DST은 소스·시험·설정만 가져간다」). 그래서 결정성 시험은 **손수 만든 조각**으로 돌리고,
//   진짜 재료가 있는 자리(win 호스트)에서만 실물 대조를 덧붙인다 — 없는 것을 초록으로 넘기지 않으려고
//   「있으면 검사, 없으면 그 사실을 적는다」로 갈랐다.
const 재료폴더 = "server/data/ladder/material/day1/nvd-ours";
const 재료있음 = fs.existsSync(path.join(루트, 재료폴더));

/** 결정성 시험용 가짜 조각 30개 — 실제 레코드와 같은 꼴이라 파싱·고르기가 실물과 같은 길을 탄다. */
const 가짜조각 = Array.from({ length: 30 }, (_, i) => {
  const t = [
    `CVE-2024-${90001 + i} · 공개일 2024-05-02 · CVSS v3 기반점수 9.${i % 10} (CRITICAL) · CWE-78`,
    "벡터(vectorString): CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
    `설명(NVD 영어 원문): Sample Product${i} Server before 1.${i}.0 allows a remote attacker to run commands through a crafted request to the export endpoint of the management console.`,
    "참조: https://example.invalid/a",
  ].join("\n");
  return { ref: `t/f-${i}.md#${"0".repeat(11)}${i % 10}`, sha: `${"0".repeat(11)}${i % 10}`, text: t, ...레코드파싱(t)! };
});

describe("① 결정성 — 같은 씨앗이면 같은 재료", () => {
  const pool = 재료있음 ? 조각모으기(루트, [재료폴더], 100) : 가짜조각;

  it("재료 조각이 실제로 잡힌다(CVE 레코드가 있는 것만)", () => {
    expect(pool.length).toBeGreaterThan(재료있음 ? 50 : 20);
    for (const c of pool.slice(0, 20)) expect(c.cve).toMatch(/^CVE-\d{4}-\d{4,7}$/);
  });

  it("조각 고르기는 씨앗이 같으면 같은 순서다", () => {
    const a = 조각고르기(pool, "remreq", "씨앗A", 20).map((c) => c.ref);
    const b = 조각고르기(pool, "remreq", "씨앗A", 20).map((c) => c.ref);
    expect(a).toEqual(b);
  });

  it("씨앗이 다르면 순서가 달라진다 — 안 그러면 씨앗이 아무 일도 안 하는 것이다", () => {
    const a = 조각고르기(pool, "remreq", "씨앗A", 20).map((c) => c.ref);
    const c = 조각고르기(pool, "remreq", "씨앗B", 20).map((c) => c.ref);
    expect(a).not.toEqual(c);
  });

  it("형식이 다르면 같은 씨앗이라도 다른 조각을 고른다(두 형식이 같은 CVE만 물지 않게)", () => {
    const a = 조각고르기(pool, "remreq", "씨앗A", 20).map((c) => c.ref);
    const b = 조각고르기(pool, "execsum", "씨앗A", 20).map((c) => c.ref);
    expect(a).not.toEqual(b);
  });

  it("질문 목록이 씨앗마다 결정적이다 — 두 번 돌려 글자까지 같다", () => {
    const 만들기 = () => 조각고르기(pool, "remreq", "씨앗A", 30).map((c) => 질문만들기(c, "remreq", "씨앗A").question);
    expect(만들기()).toEqual(만들기());
  });

  it("변형(자산·팀·기한)도 결정적이고 목록 안에서만 고른다", () => {
    for (const c of 조각고르기(pool, "remreq", "씨앗A", 30)) {
      const v1 = 변형("remreq", c.ref, "씨앗A"), v2 = 변형("remreq", c.ref, "씨앗A");
      expect(v1).toEqual(v2);
      expect(자산들.map((a) => a.name)).toContain(v1.자산.name);
      expect(팀들).toContain(v1.팀);
      expect(기한들).toContain(v1.기한);
      expect(v1.기한).toBeGreaterThanOrEqual(3);
      expect(v1.기한).toBeLessThanOrEqual(14);
    }
  });

  it("★ 시험 문항의 자산·CVE가 재료에 섞이지 않는다 — 시험을 답에 맞추는 짓을 막는다", () => {
    for (const c of pool) {
      expect(금지CVE).not.toContain(c.cve);
      for (const x of 금지자산) expect(c.text).not.toContain(x);
    }
    for (const a of 자산들) {
      expect(a.ip.startsWith("10.20.1.")).toBe(false); // team-bench 대역
      expect(금지자산).not.toContain(a.name);
    }
    // 질문에도 안 나온다.
    for (const c of 조각고르기(pool, "remreq", "씨앗A", 40)) {
      const q = 질문만들기(c, "remreq", "씨앗A").question;
      for (const x of 금지자산) expect(q).not.toContain(x);
    }
  });

  it("제품·버전은 조각에서만 온다 — 질문의 버전은 조각 본문에 반드시 있다", () => {
    for (const c of pool) {
      if (c.product) expect(c.text).toContain(c.product.split(" ")[0]);
      if (c.version) expect(c.text).toContain(c.version);
    }
  });
});

describe("② 재료 파싱 — 지어내지 않는다", () => {
  it("설명 앞머리의 CWE 상투구를 제품 이름으로 삼지 않는다", () => {
    expect(제품이름("Improper Check for Unusual Conditions vulnerability in Acme Portal allows RCE.")).toBe("Acme Portal");
    expect(제품이름("An issue was discovered in Vasion PrinterLogic Client for Windows before 25.0.0.818.")).toBe("Vasion PrinterLogic Client");
    expect(제품이름("A vulnerability in the crypto engine of Cisco IOS allows attackers to crash it.")).toBe("crypto engine");
  });

  it("설명 문장이 제품 이름으로 이어붙지 않는다", () => {
    expect(제품이름("Cacti provides an operational monitoring framework.")).toBe("Cacti");
  });

  it("버전은 **영향 버전 문구**에서만 온다 — 아무 숫자나 붙이지 않는다", () => {
    expect(레코드파싱(조각텍스트)!.version).toBe("4.2.7");
    const 숫자만 = 조각텍스트.replace("before 4.2.7", "and its 4.2.7 plugin catalog");
    expect(레코드파싱(숫자만)!.version).toBeNull();
  });

  it("레코드 끝을 줄 끝으로 착각하지 않는다(정규식 /m 함정)", () => {
    const r = 레코드파싱(조각텍스트);
    expect(r).not.toBeNull();
    expect(r!.설명).toContain("arbitrary operating system commands");
  });
});

describe("③ 심사 — 무엇을 떨어뜨리나", () => {
  it("좋은 답은 통과한다", () => {
    expect(긴좋은답.length).toBeGreaterThanOrEqual(길이하한);
    expect(긴좋은답.length).toBeLessThanOrEqual(길이상한);
    expect(심사("remreq", 질문, 긴좋은답, 조각, 변형값)).toBeNull();
  });

  it("절이 빠지면 떨어진다 — 회전 1이 무너진 바로 그 자리다", () => {
    const 답 = 긴좋은답.replace("## 수신처\n인프라팀", "인프라팀");
    expect(심사("remreq", 질문, 답, 조각, 변형값)).toMatch(/절 누락/);
  });

  it("절 제목이 줄 머리가 아니라 문장 속에 있으면 인정하지 않는다", () => {
    const 답 = 긴좋은답.replace("## 대상 취약점\n", "이번 건에서 살펴야 할 곳은 다음과 같습니다. ");
    expect(심사("remreq", 질문, 답, 조각, 변형값)).toMatch(/절 누락\(대상 취약점\)/);
  });

  it("서술 절 본문이 한 문장이면 떨어진다", () => {
    const 답 = 긴좋은답.replace(/## 재점검 조건\n[^\n]*/, "## 재점검 조건\n최신 빌드로 올리십시오.");
    expect(심사("remreq", 질문, 답, 조각, 변형값)).toMatch(/2문장 미만\(재점검 조건\)/);
  });

  it("짧은 절(요청 유형·요청일)에는 두 문장을 요구하지 않는다", () => {
    expect(서술절.has("요청 유형")).toBe(false);
    expect(서술절.has("요청일")).toBe(false);
    expect(서술절.has("대상 취약점")).toBe(true);
    expect(서술절.has("요청 사항")).toBe(true);
  });

  it("★ 벤치마크 절 세트가 여섯 다 모이면 버린다 — 시험을 답에 맞추지 않는다(D1)", () => {
    // 제품 서식은 **다 갖춘 채** 벤치 6절까지 덧붙인 답 — 절 누락으로 먼저 걸리지 않게 해서
    // 금지 규칙 자체를 겨눈다(먼저 걸리면 시험이 초록이어도 아무것도 안 지킨 것이 된다).
    const 덧 = 절_벤치_2회차.map((n) => `## ${n}\n${n === "조치 기한" ? "7일 안" : n === "담당 부서" ? "인프라팀" : "여기에는 설명을 적습니다."}`).join("\n\n");
    const 답 = 긴좋은답.replace("\n원문: ", `\n${덧}\n\n원문: `);
    expect(절자리(답, 절_요청서).찾음.length).toBe(절_요청서.length); // 제품 서식은 온전하다
    expect(심사("remreq", 질문, 답, 조각, 변형값)).toBe("벤치마크 절 세트 혼입");
  });

  it("벤치 절 낱말 하나가 겹치는 것은 막지 않는다 — 「조치 기한」은 제품 서식에도 있다", () => {
    expect(절_요청서).toContain("조치 기한");
    expect(절_벤치_2회차).toContain("조치 기한");
    expect(절자리(긴좋은답, 절_벤치_2회차).찾음.length).toBeLessThan(6);
    expect(심사("remreq", 질문, 긴좋은답, 조각, 변형값)).toBeNull();
  });

  it("1,000자에 못 미치면 떨어진다 — 이 재료의 존재 이유가 길이다", () => {
    expect(심사("remreq", 질문, 좋은답.slice(0, 400), 조각, 변형값)).toMatch(/길이 미달/);
  });

  it("날짜·「N건」 같은 시점데이터가 있으면 떨어진다(서버 위생 규칙의 사본)", () => {
    const 답 = 긴좋은답.replace("7일 안", "2026-09-30까지");
    expect(심사("remreq", 질문, 답, 조각, 변형값)).toMatch(/시점데이터|기한 불일치/);
  });

  it("「원문:」 인용이 없으면 떨어진다", () => {
    const 답 = 긴좋은답.replace(/\n원문: "[^"]*"/, "");
    expect(심사("remreq", 질문, 답, 조각, 변형값)).toBe("원문 인용 없음");
  });

  it("인용이 조각과 20자도 안 겹치면 떨어진다 — 교사가 지어낸 문장을 원문이라 부르는 것", () => {
    const 답 = 긴좋은답.replace(/원문: "[^"]*"/, 'and: "The vendor has not published any advisory for this product yet at all."'.replace("and", "원문"));
    expect(심사("remreq", 질문, 답, 조각, 변형값)).toMatch(/안 겹침/);
  });

  it("기한·담당이 질문과 다르면 떨어진다 — 시킨 것을 안 적는 답이 회전 1의 두 번째 실패였다", () => {
    expect(심사("remreq", 질문, 긴좋은답.replace("7일 안", "3일 안"), 조각, 변형값)).toBe("기한 불일치");
    expect(심사("remreq", 질문, 긴좋은답.replace("인프라팀", "정보보안팀"), 조각, 변형값)).toBe("담당 불일치");
  });

  it("질문에도 조각에도 없는 IP·버전을 적으면 떨어진다", () => {
    expect(심사("remreq", 질문, 긴좋은답.replace(자산들[0].ip, "192.168.7.7"), 조각, 변형값)).toBe("지어낸 IP");
    expect(심사("remreq", 질문, 긴좋은답.replace("4.2.7", "9.9.9"), 조각, 변형값)).toBe("지어낸 버전");
  });

  it("조각에 없는 CVE를 끌어오면 떨어진다", () => {
    const 답 = 긴좋은답.replace("\n원문: ", "\n함께 CVE-2011-11111도 살펴야 합니다. 같은 계열로 보입니다.\n\n원문: ");
    expect(심사("remreq", 질문, 답, 조각, 변형값)).toBe("지어낸 CVE");
  });

  it("설명이 통째로 영어면 한글 비율에서 떨어진다(인용은 비율에서 뺀다)", () => {
    const 영어답 = 긴좋은답.replace(/[가-힣][^\n]*/g, (m) => (m.startsWith("원문") ? m : "This section explains the issue in detail and repeats it twice for length. " + "It also mentions the fixed build and the network restriction. "));
    const 사유 = 심사("remreq", 질문, 영어답, 조각, 변형값);
    expect(사유).not.toBeNull();
  });

  it("5절(요약 보고)은 기한·담당을 안 본다 — 질문이 준 적이 없다", () => {
    const 답5 = [
      "## 요약", "이 취약점은 인증 없이 원격에서 명령을 실행하게 합니다. 기반 점수가 9.8이라 가장 급한 축입니다. CVE-2024-99001로 등록돼 있습니다.",
      "## 영향 범위", "내보내기 창구를 열어 둔 보고 서버가 모두 해당합니다. 관리 화면이 외부에 열려 있으면 위험이 더 큽니다. 대상 목록은 확인이 필요합니다.",
      "## 우선순위 판단", "인증이 필요 없고 원격에서 닿는다는 점에서 가장 높은 쪽에 둡니다. 같은 기간에 올라온 다른 건보다 먼저 처리하는 것이 맞습니다. 외부 노출 여부가 순위를 가릅니다.",
      "## 권고 조치", "공급사가 내놓은 수정 빌드로 올립니다. 올리기 전까지는 관리 화면 접근을 사내 대역으로 제한합니다. 적용 뒤 재점검으로 확인합니다.",
      "## 일정", "즉시 착수, 7일 안 마무리",
      "",
      '원문: "Example Report Server before 4.2.7 allows a remote unauthenticated attacker to execute arbitrary operating system commands through a crafted request to the export endpoint."',
      "",
      "이 보고는 경영진이 한눈에 읽도록 절을 나눠 적었습니다. 세부 조치 절차는 담당 부서의 조치 요청서로 이어집니다. 확인이 필요한 값은 확인 필요라고 남겼습니다. 대상 자산 수와 적용 창은 담당 부서가 채워 주셔야 합니다. 재점검 결과가 나오면 이 보고에 이어 적겠습니다. 같은 계열의 창구도 함께 점검하시길 권합니다. 이번 건은 인증 없이 원격에서 닿는다는 점 하나만으로도 미루기 어려운 사안입니다. 공급사 수정 빌드가 이미 나와 있어 조치 자체는 어렵지 않습니다. 다만 적용에 서비스 중단이 따르므로 담당 부서와 창을 맞춰야 합니다. 그때까지의 임시 조치로 관리 화면 접근 제한을 먼저 걸어 두시기를 권합니다. 임시 조치만으로 위험이 사라지지는 않으니 본 조치를 미루지 말아 주십시오. 진행 상황은 이 보고에 이어 적어 공유하겠습니다. 같은 제품군을 쓰는 다른 자산이 더 있는지는 자산 대장에서 확인이 필요합니다. 확인 결과에 따라 영향 범위가 넓어질 수 있습니다.",
    ].join("\n");
    expect(답5.length).toBeGreaterThanOrEqual(길이하한);
    expect(심사("execsum", "CVE-2024-99001에 대해 경영진 보고용 요약을 절을 나눠 써 줘.", 답5, 조각, 변형값)).toBeNull();
  });
});

describe("④ 부품 — 절 찾기·문장 세기·설명부", () => {
  it("여러 장식 꼴의 절 제목을 다 인정한다", () => {
    const 답 = ["# 요청 유형", "가", "**수신처**", "나", "3. 요청일", "다", "조치 기한:", "라", "## 재점검 조건", "마", "- 대상 취약점", "바", "### 요청 사항", "사"].join("\n");
    expect(절본문(답, 절_요청서).있는절).toEqual(절_요청서);
  });

  it("★ 제목 뒤에 같은 줄로 붙은 값을 본문으로 센다 — 제품 서식 앞 다섯 절이 그 꼴이다", () => {
    const 답 = ["- 요청 유형: 취약점 조치", "- 수신처: 인프라팀", "- 요청일: 발송일 기준", "- 조치 기한: 7일 안"].join("\n");
    const { 본문, 있는절 } = 절본문(답, 절_요청서);
    expect(있는절).toEqual(["요청 유형", "수신처", "요청일", "조치 기한"]);
    expect(본문["요청 유형"]).toBe("취약점 조치");
    expect(본문["수신처"]).toBe("인프라팀");
    expect(본문["조치 기한"]).toBe("7일 안");
  });

  it("제목 장식으로 붙은 「(N건)」은 본문이 아니다 — 제품 서식이 그 꼴로 찍는다", () => {
    const { 본문 } = 절본문("## 대상 취약점 (3건)\n", 절_요청서);
    expect(본문["대상 취약점"]).toBe("");
  });

  it("★ 한글 비율 잣대는 코드 식별자를 분모에서 뺀다(D4) — 함수 이름을 적었다고 떨어뜨리지 않는다", () => {
    const 답 = "이 결함은 open_cached_dir() 함수가 cmd_realtime.php 를 부를 때 register_argc_argv 설정에 따라 CRITICAL 등급으로 커집니다.";
    const s = 설명부(답);
    for (const x of ["open_cached_dir", "cmd_realtime.php", "register_argc_argv", "CRITICAL"]) expect(s).not.toContain(x);
    expect(s).toContain("이 결함은");
    expect(한글비율(s)).toBeGreaterThan(0.6);
  });

  it("그렇다고 평범한 영어 낱말까지 빼지는 않는다 — 통째로 영어인 답은 그대로 떨어져야 한다", () => {
    const 영어 = "This section explains the issue in detail and mentions the fixed build and the network restriction twice.";
    expect(설명부(영어)).toContain("section explains");
    expect(한글비율(설명부(영어))).toBeLessThan(0.6);
  });

  it("문장 세기는 줄바꿈과 마침표를 둘 다 센다", () => {
    expect(문장수("한 문장만 있습니다.")).toBe(1);
    expect(문장수("첫 문장입니다. 둘째 문장입니다.")).toBe(2);
    expect(문장수("- 첫 항목입니다\n- 둘째 항목입니다")).toBe(2);
  });

  it("설명부는 인용·CVE·URL을 빼고 남긴다", () => {
    const s = 설명부('설명은 한국어입니다.\n원문: "This is the English source sentence quoted verbatim."');
    expect(s).not.toContain("English source sentence");
    expect(s).toContain("설명은 한국어입니다");
  });

  it("인용뽑기는 곧은 따옴표·굽은 따옴표를 다 받는다", () => {
    expect(인용뽑기('원문: "abcdefghijklmnopqrstuvwxyz"')).toBe("abcdefghijklmnopqrstuvwxyz");
    expect(인용뽑기("원문: “abcdefghijklmnopqrstuvwxyz”")).toBe("abcdefghijklmnopqrstuvwxyz");
    expect(인용뽑기("원문 인용은 아직 없습니다")).toBeNull();
  });

  it("교사 지시는 형식마다 그 형식의 절만 말한다", () => {
    const 지시 = 교사지시("execsum", 변형값);
    for (const n of 절_요약보고) expect(지시).toContain(n);
    expect(지시).not.toContain("담당 부서");
  });

  // [2026-09-04 회전 2 실측] execsum 탈락 29건 중 「주인공 CVE 없음」이 13건으로 1위였다.
  //   잣대는 그대로 두고 **교사에게 자리를 지정**했다 — 그 지시가 실제로 execsum에만 붙어 있는지 본다.
  it("★ execsum 교사 지시가 「요약 절 첫 문장에 CVE 번호」를 못 박는다 — 탈락 1위를 겨눈 자리다", () => {
    const 지시 = 교사지시("execsum", 변형값);
    // 어느 절인지·어느 자리인지가 다 들어 있어야 지시가 자리를 「지정」한 것이다.
    expect(지시).toContain("「요약」 절");
    expect(지시).toContain("첫 문장");
    expect(지시).toContain("CVE-연도-번호");
    // remreq에는 안 붙인다 — 질문에 자산·제품이 함께 있어 번호가 자연히 실린다(지시를 늘리면 꼬리가 흘린다).
    expect(교사지시("remreq", 변형값)).not.toContain("「요약」 절");
    // ⚠ 잣대는 그대로여야 한다 — 지시를 넣었다고 심사를 눅여 주면 재료가 나빠지고 숫자만 좋아진다.
    const 번호없는답 = 긴좋은답.replace(/CVE-2024-99001/g, "해당 취약점");
    expect(심사("remreq", 질문, 번호없는답, 조각, 변형값)).toBe("주인공 CVE 없음");
  });
});

describe("★⑤ 저장 창구를 부르지 않는다 — 이 재료는 학습 전용이다", () => {
  const 금지경로 = [
    "/api/learnloop/distill/intake",
    "/api/learnloop/distill/corpus",
    "/api/learnloop/approve",
    "/api/learnloop/candidates",
    "/api/dataset/save",
    "/api/dataset",
    "/api/memory",
    "/api/documents",
  ];
  it("승인·편입·데이터셋 저장 창구 경로가 소스에 하나도 없다", () => {
    const code = 도구();
    for (const p of 금지경로) expect(code, `${p} 를 부르면 합성 문서가 승인함·지식 저장소로 샌다`).not.toContain(p);
  });
  it("쓰기(POST/PUT/DELETE)로 부르는 서버 창구가 로그인 하나뿐이다", () => {
    const code = 도구();
    const 호출 = [...code.matchAll(/SERVER \+ "([^"]+)"|\$\{SERVER\}([^"`]*)/g)].map((m) => m[1] ?? m[2]);
    for (const c of 호출) expect(["/api/auth/login", "/api/learnloop/raft/prompt"].some((x) => String(c).includes(x))).toBe(true);
  });
  it("읽기 창구(raft/prompt)는 실제로 쓴다 — 프롬프트를 베끼지 않는다는 뜻이다", () => {
    const code = 도구();
    expect(code).toContain("/api/learnloop/raft/prompt");
    // 팀원 프롬프트 문구를 소스에 적어 두면 그 순간 사본이 된다 — 받아 쓰는지 확인.
    expect(code).toContain("프롬프트.system");
    expect(code).toContain("프롬프트.ragHeader");
  });
  it("표준 라이브러리만 쓴다(toolsdeps 취지)", () => {
    const code = 도구();
    for (const m of code.matchAll(/^import .* from "([^"]+)";$/gm)) {
      const 원 = m[1];
      expect(원.startsWith("node:") || 원.startsWith("./") || 원.startsWith("../"), `외부 꾸러미 ${원}`).toBe(true);
    }
  });
});

describe("★⑥ 조치 요청서 절 이름의 정본은 **제품 서식**이다 — 소스로 대조한다(D1)", () => {
  it("절_요청서 가 remrequest.ts buildRequestDraft() 가 찍는 절과 순서까지 같다", () => {
    const code = src("server/src/engine/remrequest.ts");
    const fn = code.slice(code.indexOf("export function buildRequestDraft"), code.indexOf("/** 기한 기본값"));
    expect(fn.length, "remrequest.ts 에서 buildRequestDraft 를 못 찾았다").toBeGreaterThan(200);
    // 앞 다섯은 머리말 배열(`const L: string[] = [ … ]`)의 「- 이름: ${…}」 한 줄짜리,
    // 뒤 둘은 그 아래 L.push 로 찍는 「## 이름」 큰 절이다. ⚠ 머리말 배열 **밖**의
    // 「- 심각도:」는 취약점 한 건 한 건의 속성이지 절이 아니다 — 그래서 자리를 갈라 뽑는다.
    const 머리끝 = fn.indexOf("\n  ];");
    expect(머리끝, "머리말 배열의 끝을 못 찾았다").toBeGreaterThan(0);
    const 한줄 = [...fn.slice(0, 머리끝).matchAll(/`- ([가-힣][가-힣 ]*): \$\{/g)].map((m) => m[1]);
    const 큰절 = [...fn.slice(머리끝).matchAll(/["`]## ([가-힣][가-힣 ]*?)(?: \(\$\{|["`])/g)].map((m) => m[1]);
    expect(한줄.length, "remrequest.ts 에서 한 줄짜리 절을 못 찾았다").toBeGreaterThan(0);
    expect(큰절.length, "remrequest.ts 에서 큰 절을 못 찾았다").toBeGreaterThan(0);
    expect([...한줄, ...큰절]).toEqual(절_요청서);
  });

  it("★ 벤치마크 채점기의 절 세트와 **다르다** — 같아지는 순간 재료가 시험 답안지가 된다", () => {
    expect(절_요청서).not.toEqual(절_벤치_2회차);
    expect(절_요청서).not.toEqual(절_벤치_1회차);
    // 겹치는 낱말은 「조치 기한」 하나뿐 — 그 하나까지 없애려 들면 제품 서식을 왜곡하게 된다.
    expect(절_요청서.filter((n) => 절_벤치_2회차.includes(n))).toEqual(["조치 기한"]);
  });

  it("금지 목록에 적어 둔 벤치 절 세트가 채점기 원문과 같다 — 채점기가 바뀌면 여기가 알려 준다", () => {
    const r2 = src("tools/team-bench/tasks-r2.mjs").match(/필수절6\s*=\s*\[([^\]]*)\]/);
    expect(r2, "tasks-r2.mjs 에서 필수절6 을 못 찾았다").not.toBeNull();
    expect([...r2![1].matchAll(/"([^"]+)"/g)].map((x) => x[1])).toEqual(절_벤치_2회차);
    const t1 = src("tools/team-bench/tasks.mjs").match(/필수절\s*=\s*\[([^\]]*)\]/);
    expect(t1, "tasks.mjs 에서 필수절 을 못 찾았다").not.toBeNull();
    expect([...t1![1].matchAll(/"([^"]+)"/g)].map((x) => x[1])).toEqual(절_벤치_1회차);
  });
});

describe("★⑦ 이어 붙이기·번갈아 두기 (D3·D5)", () => {
  const pool = 재료있음 ? 조각모으기(루트, [재료폴더], 100) : 가짜조각;

  it("일감은 두 형식이 번갈아 선다 — 어디서 끊겨도 한쪽으로 안 기운다", () => {
    const 일감 = 일감만들기(pool, "씨앗A", 40);
    expect(일감.length).toBe(40);
    expect(일감.map((w) => w.kind).slice(0, 6)).toEqual(["remreq", "execsum", "remreq", "execsum", "remreq", "execsum"]);
    // 앞에서 잘라도 두 형식 수가 ±1 안이다(예산에 걸려 끊기는 자리가 곧 여기다).
    for (const n of [7, 13, 25]) {
      const 앞 = 일감.slice(0, n);
      const a = 앞.filter((w) => w.kind === "remreq").length, b = 앞.length - a;
      expect(Math.abs(a - b)).toBeLessThanOrEqual(1);
    }
  });

  it("이미 채택된 질문은 sha12 로 골라내 건너뛴다", () => {
    const 일감 = 일감만들기(pool, "씨앗A", 20);
    const 앞선행 = 일감.slice(0, 5).map((w) => ({ question: w.question, answer: "…", system: "…", meta: { kind: w.kind } }));
    const 이미 = 이미채택된질문(앞선행);
    expect(이미.size).toBe(5);
    // 본체(main)가 하는 것과 **같은 식**으로 거른다 — 남는 것은 뒤 15개, 그것도 순서 그대로다.
    const 남은 = 일감.filter((w) => !이미.has(sha12(w.question)));
    expect(남은.map((w) => w.question)).toEqual(일감.slice(5).map((w) => w.question));
    // 같은 씨앗으로 다시 만들어도 앞 5개는 그대로라 **다시 부르지 않는다**(결정성이 이어 붙이기의 전제다).
    expect(이미채택된질문(앞선행)).toEqual(이미);
  });

  it("빈 입력·깨진 입력에도 죽지 않는다 — --resume 은 앞 회차가 남긴 것을 읽는다", () => {
    expect(이미채택된질문(undefined as never).size).toBe(0);
    expect(이미채택된질문([] as never).size).toBe(0);
    expect(이미채택된질문([{}] as never).size).toBe(1); // 질문이 빈 문자열인 행도 키가 생긴다(중복 방지)
  });

  it("★ 인용 못 박기 한 줄이 교사 지시 1번과 **같은 것**을 말한다(D6) — 두 번 말하는 것이 목적이다", () => {
    const 지시 = 교사지시("remreq", 변형값);
    expect(지시.split("\n")[1]).toContain("원문:");        // 목록 맨 앞에 왔는가
    expect(인용못박기).toContain("마지막 줄");
    expect(인용못박기).toContain('원문: "…"');
  });

  // ⓒ D6은 **효과가 없었다**(5.4% → 5.1%). 되돌리지 않기로 했으니, 다음 사람이 같은 가설을 다시
  //   세우지 않도록 그 실측이 소스에 남아 있는지 본다 — 없어지면 이 시험이 먼저 말한다.
  it("★ D6이 효과 없었다는 실측이 주석에 남아 있다 — 안 남기면 다음 회전에서 같은 가설을 또 세운다", () => {
    const code = 도구();
    const i = code.indexOf("★ D6(2026-09-04)");
    expect(i, "D6 주석을 못 찾았다 — 이 감시가 헛돈다").toBeGreaterThan(-1);
    const 주석 = code.slice(i, i + 900);
    expect(주석, "효과 실측이 없다").toContain("효과 없음");
    expect(주석).toContain("8/149");
    expect(주석).toContain("7/136");
  });
});

// ⓑ 숫자만 남기면 「무엇이」는 알아도 「왜」는 모른다 — 회전 2에서 탈락 13건을 다시 재려다
//   사유마다 앞 2건·400자밖에 없어 **다시 굽지 않고는** 알 수 없었다(교사 시간이 가장 비싼 자원인데).
describe("★⑧ 탈락 답 전문을 남긴다 (<name>.rejected.json)", () => {
  it("떨어진 답을 사유·형식·질문·전문·조각 sha12 와 함께 모은다", () => {
    const code = 도구();
    expect(code, "탈락 전문을 모으는 자리가 없다").toContain("const 탈락기록 = []");
    const i = code.indexOf("탈락기록.push({");
    expect(i, "탈락 자리에서 전문을 안 모은다").toBeGreaterThan(-1);
    const 담는것 = code.slice(i, i + 320);
    for (const 칸 of ["사유", "kind", "cve", "chunkSha12", "question", "answer"]) {
      expect(담는것, `${칸} 칸이 없다 — 재측정에 필요한 값이 빠지면 이 파일도 400자짜리와 같아진다`).toContain(칸);
    }
    // ★ 머리 400자가 아니라 **전문**이어야 한다 — slice로 자르면 이 파일을 만든 뜻이 사라진다.
    expect(담는것, "전문이 아니라 잘라서 담고 있다").not.toMatch(/answer\.slice\(/);
  });

  it("파일로 실제로 쓰고, 학습 재료(rows)에는 안 섞는다", () => {
    const code = 도구();
    expect(code).toContain(".rejected.json");
    expect(code).toMatch(/writeFileSync\(탈락파일, JSON\.stringify\(탈락기록/);
    // ⚠ 떨어진 답이 산출 데이터셋에 섞이면 **거른 뜻이 사라진다.** rows에 들어가는 자리는 하나뿐이어야 한다.
    const rows에넣기 = [...code.matchAll(/rows\.push\(/g)];
    expect(rows에넣기.length, "rows.push가 여러 곳이다 — 떨어진 답이 섞이는 길이 열렸는지 봐야 한다").toBe(1);
    expect(code.slice(code.indexOf("rows.push("), code.indexOf("rows.push(") + 200)).not.toContain("탈락");
  });

  it("보고서(md)가 전문 파일을 가리킨다 — 표본 400자를 원본으로 착각하지 않게", () => {
    const code = 도구();
    expect(code).toContain("탈락 답 **전문**");
    expect(code).toContain("다시 재는 자리는 그 파일");
  });
});
