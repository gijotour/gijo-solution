// tools/team-bench/tasks-r2.mjs — AI 팀원 역할별 시험 2회차 재료와 결정적 채점기.
//
// 왜 2회차인가(문항 의도):
//   1회차(tasks.mjs)는 「깨끗한 재료」였다 — 표가 반듯하고, 중복도 오탐도 없고, 문맥은 16K였다.
//   실무 재료는 그렇지 않다. 2회차는 **현장에서 실제로 걸려 넘어지는 것**만 골라 담는다.
//   - scan_messy : 표가 깨지고 영문·오탈자가 섞인 리포트에서 **중복을 합치고 오탐을 빼는가**.
//                  1회차의 「빠짐없이 뽑기」와 반대로, 여기서는 **덜 뽑는 절제**를 잰다.
//   - needle_32k : 약 50,000자(≈32K 토큰) 한국어 문서에서 사실 5개 회수. 1회차 16K의 두 배.
//   - needle_64k : 약 100,000자(≈64K 토큰). **하네스를 --ctx 65536으로 돌려야 한다**(그보다 작으면
//                  앞쪽이 잘려 나가 「모델이 못 찾은 것」이 아니라 「우리가 안 준 것」을 재게 된다).
//   - ti_trap    : 위협정보 6건 × 자산 5개. 함정 셋 — ① 버전 경계(7.0.13 취약 vs 자산 7.0.14)
//                  ② 제품명 유사(FortiGate vs FortiWeb, 버전 숫자가 서로 낚시질을 한다)
//                  ③ 같은 제품 다른 메이저(Exchange 2016 vs 2019). 정답 2건·해당 없음 4건 —
//                  **오탐에 감점**을 두어 「일단 다 넣고 보는」 답을 걸러낸다.
//   - priority_6 : 동률을 깨는 규칙(둘 다 KEV면 → 외부 노출 → 자산 중요도 → CVSS)을 주고
//                  **규칙대로 정렬하는가**를 본다. CVSS 9.8짜리 내부·미등재 미끼가 들어 있다.
//   - report_fix : 서식(6절)만 채우고 **사실(기한 3일·담당 인프라팀)은 빠뜨리는** 답을 잡는다.
//                  1회차 report_draft는 절 제목만 셌다 — 서식은 맞는데 내용이 빈 답을 못 걸렀다.
//
// 인터페이스는 1회차와 같다: { id, role, 설명, messages, schema?, score(text) → {score, detail} }.
// 채점은 전부 코드(정규식·필드 대조·개수)로만 한다 — LLM 채점기는 게이트 원칙(중-3)대로 쓰지 않는다.
// 재료는 전부 이 파일 안에서 만든다(외부 파일 없음 — gb10에 복사 한 번이면 돈다).
//   ⚠ 딱 하나 예외: **절 세기**(`절세기`)는 tasks.mjs에서 불러 쓴다. 두 회차의 「6절 서식」이 같은
//     잣대여야 report_draft와 report_fix를 견줄 수 있는데, 규칙을 두 곳에 적으면 어긋난다 —
//     실제로 두 곳 다 `includes(절이름)`이라는 **같은 구멍**을 갖고 있었고, 한쪽만 고치면 그때부터
//     두 회차의 「절 N/6」이 서로 다른 뜻이 된다. day2-train.sh는 네 파일을 **함께** 복사하므로
//     gb10에서도 그대로 돈다.
// 등장하는 회사·사람·도메인·IP는 전부 지어낸 것이다(실제 조직·개인 정보 아님).
//
// 실행: run.mjs가 아니라 **run-r2.mjs**로 돌린다(run.mjs는 './tasks.mjs'를 고정으로 import 한다).
//   node run-r2.mjs --only <model> --port 8093 --ctx 65536 --out results-r2

import { 절세기 } from "./tasks.mjs";

export const 한글비율 = (s) => {
  const t = (s || "").replace(/\s|[0-9A-Za-z[\]{}(),.:;"'`_\-/\\<>=+*#%|]/g, "");
  if (!t.length) return 0;
  const ko = (t.match(/[가-힣]/g) || []).length;
  return ko / t.length;
};
export const 한자수 = (s) => ((s || "").match(/[一-鿿]/g) || []).length;

function jsonOf(text) {
  if (!text) return null;
  const m = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

// ── R1 scan_messy: 지저분한 리포트 → 고유 항목 7개 ──────────────────────────
// 10줄이 적혀 있지만 실제 고유 항목은 7개다.
//   · 4번은 1번과 같은 건(호스트를 IP로, 취약점 이름을 다르게, 위험도를 영문으로 적었을 뿐)
//   · 9번은 6번과 같은 건(영문 표기 + 「보통」이라는 다른 위험도 낱말)
//   · 7번은 오탐으로 표시돼 있다 → 목록에서 빼야 한다
const 지저분리포트 = `■ 2026-09 웹 취약점 진단 결과(초안 — 원본 표에서 붙여넣다가 줄이 섞였습니다. 서식 깨짐 양해 바랍니다)

No | 대상 | 취약점 | 위험도 | 비고
1 | portal.example.co.kr /board/view.jsp | SQL Injection (SQLi)
  | 높음 | id 파라미터에 1' AND 1=1-- 입력 시 정상, 1=2 입력 시 빈 화면. DB 에러메세지 노출됨
2 | portal.example.co.kr /search | 반사형 XSS (Reflected Cross-Site Scripting) | 중간
  | q 파라미터 미필터링, alert(1) 실행 확인
3 | hr.example.co.kr /admin/list.do | 인증 우회 (Authentication Bypass) | 높음 | 세션 쿠키 없이 직접 접근 시 200 OK, 관리자 목록 노출
4 | 10.20.1.15 (포탈) /board/view.jsp | SQL-삽입 취약점 | High
  | id 파라메터 조작시 DB 오류메시지 출력. 진단도구 B 결과
5 | hr.example.co.kr /upload.do | 임의 파일 업로드(웹셸 업로드 가능) | 긴급 | jsp 확장자 차단을 대소문자 혼용(jSp)으로 우회
6 | files.example.co.kr /backup/ | 디렉터리 리스팅 | 중간 | 백업 파일 3건 목록 노출(db_2026.sql 포함)
7 | hr.example.co.kr /mypage/edit.do | CSRF (사이트 간 요청 위조) | 중간
  | ※ 오탐(재검증 결과 해당 없음) — 토큰 검증이 정상 동작함을 담당자 입회 하에 확인
8 | api.example.co.kr /v1/login | 민감정보 평문 전송 (HTTP) | 중간 | 로그인 요청이 http로 전송되어 계정정보가 평문 노출
9 | files.example.co.kr /backup | Directory Listing(디렉토리 목록노출) | 보통
  | 스캐너 2대 결과를 합치는 과정에서 표기가 달라짐. 백업파일 리스트 확인
10 | vpn.example.co.kr | 취약한 TLS 버전 지원 (TLS 1.0/1.1 accepted) | 낮음 | sslscan 결과 TLSv1.0 accepted

※ 대상 IP: portal 10.20.1.15 / hr 10.20.1.22 / files 10.20.1.40 / api 10.20.1.51 / vpn 10.20.1.60`;

const 기대_고유 = [
  { key: "portal-sqli", asset: /portal|10\.20\.1\.15/i, vuln: /sql/i },
  { key: "portal-xss", asset: /portal|10\.20\.1\.15/i, vuln: /xss|스크립트|cross[- ]?site scripting/i },
  { key: "hr-authbypass", asset: /hr|10\.20\.1\.22/i, vuln: /인증|우회|bypass/i },
  { key: "hr-upload", asset: /hr|10\.20\.1\.22/i, vuln: /업로드|웹셸|웹쉘|upload|shell/i },
  { key: "files-listing", asset: /files|10\.20\.1\.40/i, vuln: /디렉터리|디렉토리|listing|리스팅|목록/i },
  { key: "api-plaintext", asset: /api|10\.20\.1\.51/i, vuln: /평문|http|전송|민감/i },
  { key: "vpn-tls", asset: /vpn|10\.20\.1\.60/i, vuln: /tls|ssl|암호화|프로토콜/i },
];
const 오탐표식 = /csrf|요청\s*위조/i;

export const R1 = {
  id: "scan_messy", role: "scan", 설명: "깨진 리포트 10줄 → 고유 7건(중복 합침·오탐 제외)",
  schema: { type: "object", properties: { findings: { type: "array", items: { type: "object", properties: { asset: { type: "string" }, vuln: { type: "string" }, severity: { type: "string" }, evidence: { type: "string" } }, required: ["asset", "vuln", "severity"] } } }, required: ["findings"] },
  messages: [
    { role: "system", content: "너는 진단 결과를 정리하는 보안 담당자다. 표 서식이 깨져 한 항목이 여러 줄에 걸쳐 있을 수 있다. 같은 호스트에 같은 취약점이 표기만 다르게 두 번 적혀 있으면 하나로 합친다(호스트를 IP로 적은 것도 같은 호스트다). 오탐으로 표시된 항목은 목록에서 뺀다. 한국어로." },
    { role: "user", content: 지저분리포트 + "\n\n실제 조치가 필요한 취약점만 {\"findings\":[{\"asset\":호스트,\"vuln\":취약점 이름,\"severity\":위험도,\"evidence\":근거 한 줄}]} 형식으로 정리하라. 중복은 합치고 오탐은 제외한다." },
  ],
  score(text) {
    const j = jsonOf(text); if (!j || !Array.isArray(j.findings)) return { score: 0, detail: "JSON 없음" };
    const 줄 = j.findings.map((x) => `${x.asset || ""} ${x.vuln || ""} ${x.evidence || ""} ${x.severity || ""}`);
    let hit = 0;
    for (const e of 기대_고유) if (줄.some((s) => e.asset.test(s) && e.vuln.test(s))) hit++;
    const n = j.findings.length;
    const fp = 줄.some((s) => 오탐표식.test(s));
    // ★ 보너스(중복 제거·오탐 제외)는 **실제로 뽑았을 때만** 준다.
    //   빈 배열이면 「중복도 없고 오탐도 없다」가 저절로 참이 되어 0.5점이 공짜로 굴러온다 —
    //   아무것도 안 한 답에 절반을 주는 채점기는 잣대가 아니다. 그래서 hit>=4 문턱을 둔다.
    const 유효 = hit >= 4;
    const s = (hit / 기대_고유.length) * 0.5 + (유효 && n <= 8 ? 0.25 : 0) + (유효 && !fp ? 0.25 : 0);
    return { score: s, detail: `고유 ${hit}/7 · 뽑은 수 ${n}${n <= 8 ? "(≤8)" : "(중복 남음)"} · 오탐${fp ? " 포함(감점)" : " 제외"}` };
  },
};

// ── R2/R3 needle: 긴 한국어 문맥(32K·64K)에 사실 5개 ─────────────────────────
const 채움문단 = [
  "정보보호 관리체계는 계획, 실행, 점검, 개선의 순환으로 유지한다. 각 단계의 산출물은 다음 심사에서 근거로 제출되므로 작성자와 승인자를 함께 남긴다.",
  "서버 접근 통제는 최소 권한을 기본으로 한다. 권한 부여는 신청, 승인, 적용, 회수의 네 단계를 거치며 회수 누락을 막기 위해 분기마다 권한 재검토를 실시한다.",
  "네트워크 구간은 업무망, 개발망, 운영망으로 나누고 구간 사이 통신은 허용 목록으로만 연다. 임시 허용은 종료 일자를 반드시 함께 적는다.",
  "보안 패치는 시험 환경에서 먼저 적용해 영향을 확인한 뒤 운영에 반영한다. 서비스 중단이 필요한 패치는 사전 공지 기간을 둔다.",
  "이상 행위 탐지 규칙은 오탐이 쌓이면 규칙 자체를 다시 본다. 규칙을 끄는 것은 최후의 수단이며 끈 사유와 재개 시점을 기록한다.",
  "문서 반출은 승인권자의 결재를 받은 뒤 지정된 경로로만 한다. 반출 이력은 자동으로 기록되며 임의 삭제는 불가능하다.",
  "협력사와의 계약서에는 보안 요구사항과 사고 발생 시 통지 의무를 명시한다. 계약 종료 시 자료 반납과 파기 확인서를 받는다.",
  "교육은 신규 입사자 교육과 연간 정기 교육으로 나뉜다. 개발자에게는 안전한 코딩 교육을 별도로 편성한다.",
];

const 사실_32k = [
  { 문장: "통합 로그 수집기의 이중화는 관제운영3팀이 맡고 있으며, 주 수집기 장애 시 대체 수집기 주소는 10.44.8.71이다.", 질문: "주 수집기 장애 시 대체 로그 수집기 주소는?", 정답: /10\.44\.8\.71/ },
  { 문장: "올해 피싱 모의훈련은 연 4회 실시하며 훈련 코드명은 「푸른등대」다.", 질문: "피싱 모의훈련의 코드명은?", 정답: /푸른등대/ },
  { 문장: "암호키 교체 주기는 18개월이고 교체 승인은 정보보호위원회가 한다.", 질문: "암호키 교체 주기는 몇 개월인가?", 정답: /18\s*개?월|\b18\b/ },
  { 문장: "외주 개발자의 반입 매체 검사는 본관 B동 207호 반입검사실에서만 한다.", 질문: "반입 매체 검사를 하는 장소의 호실 번호는?", 정답: /207/ },
  { 문장: "재해복구 훈련의 목표 복구 시간은 4시간, 목표 복구 시점은 30분으로 정해져 있다.", 질문: "목표 복구 시점(RPO)은 몇 분인가?", 정답: /30\s*분/ },
];

const 사실_64k = [
  { 문장: "백업 매체 외부 보관 위탁처의 계약 코드는 VT-9932이다.", 질문: "백업 매체 외부 보관 위탁처의 계약 코드는?", 정답: /VT-?\s?9932/i },
  { 문장: "침해사고 비상연락망의 1순위는 보안운영팀장이며, 유선이 끊겼을 때 쓰는 위성전화 내선은 8802번이다.", 질문: "유선이 끊겼을 때 쓰는 위성전화 내선 번호는?", 정답: /8802/ },
  { 문장: "서버실 출입은 지문과 사원증 두 가지로 확인하며, 임시 출입증의 유효 시간은 6시간이다.", 질문: "임시 출입증의 유효 시간은 몇 시간인가?", 정답: /6\s*시간|\b6\b/ },
  { 문장: "개인정보 파기 확인서의 보관 연한은 5년이다.", 질문: "개인정보 파기 확인서는 몇 년 보관하는가?", 정답: /5\s*년/ },
  { 문장: "사내 취약점 점검 도구의 정기 점검은 격주 수요일 오전 9시에 자동 실행된다.", 질문: "취약점 점검 도구의 정기 점검은 무슨 요일에 실행되는가?", 정답: /수요일/ },
];

// 사실을 문서의 10%·30%·50%·70%·90% 지점에 흩뿌린다(앞뒤 어디에 있든 찾아야 한다).
function 긴문서(목표자수, 사실) {
  const out = []; let n = 0, i = 0;
  const 자리 = [0.1, 0.3, 0.5, 0.7, 0.9].map((p) => Math.floor(p * 목표자수));
  let next = 0;
  while (n < 목표자수) {
    const p = 채움문단[i % 채움문단.length] + ` (문단 ${i + 1})`;
    out.push(p); n += p.length; i++;
    if (next < 사실.length && n >= 자리[next]) { out.push(사실[next].문장); n += 사실[next].문장.length; next++; }
  }
  while (next < 사실.length) { out.push(사실[next].문장); next++; }
  return out.join("\n");
}

function needle과제(id, 자수, 사실, 설명) {
  const doc = 긴문서(자수, 사실);
  return {
    id, role: "scan", 설명,
    messages: [
      { role: "system", content: "주어진 사내 문서만 근거로 짧게 답한다. 문서에 없으면 「문서에 없음」이라고 답한다. 한국어로." },
      { role: "user", content: "문서:\n" + doc + "\n\n질문 5개에 번호를 붙여 각각 한 줄로 답하라.\n" + 사실.map((s, k) => `${k + 1}. ${s.질문}`).join("\n") },
    ],
    문서자수: doc.length,
    score(text) {
      let hit = 0; for (const s of 사실) if (s.정답.test(text || "")) hit++;
      return { score: hit / 사실.length, detail: `회수 ${hit}/5` };
    },
  };
}

export const R2 = needle과제("needle_32k", 50000, 사실_32k, "약 50,000자(≈32K 토큰) 한국어 문서에서 사실 5개 회수");
export const R3 = needle과제("needle_64k", 100000, 사실_64k, "약 100,000자(≈64K 토큰) 문서에서 사실 5개 회수 — 하네스 --ctx 65536 필요");

// ── R4 ti_trap: 위협정보 6건 × 자산 5개, 함정 셋 ─────────────────────────────
// 정답 2건: C3(Exchange 2019 CU14가 CU12~CU14 범위 안) · C5(nginx 1.25.3이 1.25.0~1.25.3 범위 안)
// 해당 없음 4건: C1 버전 경계(자산 7.0.14 > 취약 상한 7.0.13) · C2 제품 다름(FortiWeb 7.0.x vs 자산 7.2.5,
//   버전 숫자 7.0.14가 FortiGate 자산과 같아 제품을 헷갈리면 오탐이 난다) ·
//   C4 같은 제품 다른 메이저(2016 vs 2019) · C6 다른 메이저(15.x vs 16.2)
const 자산목록 = `A1 VPN 장비  FortiGate (FortiOS 7.0.14)
A2 웹 방화벽 FortiWeb 7.2.5
A3 메일 서버 Microsoft Exchange Server 2019 CU14
A4 웹 서버   nginx 1.25.3
A5 DB 서버   PostgreSQL 16.2`;
const 위협목록 = `C1 CVE-2024-21762  FortiOS 7.0.0 ~ 7.0.13  SSL-VPN 원격 코드 실행
C2 CVE-2023-29183  FortiWeb 7.0.0 ~ 7.0.14  관리 화면 스크립트 삽입
C3 CVE-2024-26198  Exchange Server 2019 CU12 ~ CU14  원격 코드 실행
C4 CVE-2021-42321  Exchange Server 2016 CU21 ~ CU23  인증 후 원격 코드 실행
C5 CVE-2024-32760  nginx 1.25.0 ~ 1.25.3  HTTP/3 처리 메모리 오류
C6 CVE-2024-10977  PostgreSQL 15.0 ~ 15.6  클라이언트 라이브러리 오류 처리 결함`;

export const R4 = {
  id: "ti_trap", role: "ti", 설명: "위협정보 6건 ↔ 자산 5개 — 버전 경계·제품명 유사·메이저 차이 함정(정답 2건)",
  schema: { type: "object", properties: { matches: { type: "array", items: { type: "object", properties: { cve: { type: "string" }, asset: { type: "string" }, reason: { type: "string" } }, required: ["cve", "asset"] } } }, required: ["matches"] },
  messages: [
    { role: "system", content: "너는 위협 정보를 우리 자산과 대조하는 팀원이다. 제품과 버전이 실제로 범위 안에 들어갈 때만 해당으로 본다. 제품 이름이 비슷해도 다른 제품이면 해당이 아니고, 버전이 취약 범위 밖이면 해당이 아니다. 해당 없는 것은 넣지 않는다. 한국어로." },
    { role: "user", content: `우리 자산:\n${자산목록}\n\n위협 정보:\n${위협목록}\n\n우리 자산에 실제로 해당하는 것만 {"matches":[{"cve":..,"asset":..,"reason":한 줄}]}로. 해당 없으면 넣지 않는다.` },
  ],
  score(text) {
    const j = jsonOf(text); if (!j || !Array.isArray(j.matches)) return { score: 0, detail: "JSON 없음" };
    // 항목 번호(C1~C6)로 답해도 받는다 — 번호는 문제에 우리가 붙인 것이다.
    const 별칭 = { C1: "2024-21762", C2: "2023-29183", C3: "2024-26198", C4: "2021-42321", C5: "2024-32760", C6: "2024-10977" };
    const norm = (s) => { const u = String(s || "").trim().toUpperCase(); if (별칭[u]) return 별칭[u]; const m = u.match(/(\d{4})-?(\d{4,5})/); return m ? `${m[1]}-${m[2]}` : u; };
    const got = new Set(j.matches.map((m) => norm(m.cve)));
    const want = ["2024-26198", "2024-32760"];
    const wrong = ["2024-21762", "2023-29183", "2021-42321", "2024-10977"];
    const tp = want.filter((w) => got.has(w)).length;
    const fp = wrong.filter((w) => got.has(w)).length;
    return { score: Math.max(0, tp / 2 - fp * 0.5), detail: `맞음 ${tp}/2 · 오탐 ${fp}/4` };
  },
};

// ── R5 priority_6: 동률 깨기 규칙대로 정렬 ──────────────────────────────────
// 규칙: ① KEV 등재가 먼저 ② 둘 다 KEV면 외부 노출 ③ 그래도 같으면 자산 중요도 ④ 그래도 같으면 CVSS
// 정답 상위 3: V2(KEV·노출·최상) > V3(KEV·노출·높음) > V4(KEV·노출 없음)
// 미끼: V1은 CVSS 9.8이지만 KEV 미등재·내부 전용·중요도 낮음 → 4위 아래여야 한다
const 취약점6 = [
  { id: "V1", 설명: "내부 전용 빌드 서버 · CVSS 9.8 · KEV 미등재 · 외부 노출 없음 · 자산 중요도 낮음" },
  { id: "V2", 설명: "대외 결제 게이트웨이 · CVSS 6.5 · KEV 등재 · 외부 노출 있음 · 자산 중요도 최상" },
  { id: "V3", 설명: "대외 포털 웹서버 · CVSS 7.5 · KEV 등재 · 외부 노출 있음 · 자산 중요도 높음" },
  { id: "V4", 설명: "사내 인사 시스템 · CVSS 8.8 · KEV 등재 · 외부 노출 없음 · 자산 중요도 높음" },
  { id: "V5", 설명: "시험용 임시 장비 · CVSS 5.3 · KEV 미등재 · 외부 노출 있음 · 자산 중요도 낮음" },
  { id: "V6", 설명: "사내 파일 서버 · CVSS 7.2 · KEV 미등재 · 외부 노출 없음 · 자산 중요도 중간" },
];
export const R5 = {
  id: "priority_6", role: "analysis", 설명: "취약점 6건을 동률 깨기 규칙대로 정렬(상위 3 순서·미끼 배제)",
  schema: { type: "object", properties: { order: { type: "array", items: { type: "string" } }, reason: { type: "string" } }, required: ["order"] },
  messages: [
    { role: "system", content: "너는 조치 우선순위를 정하는 분석 담당자다. 순서는 다음 규칙으로만 정한다.\n① 실제 악용이 확인된 것(KEV 등재)이 미등재보다 먼저다.\n② 둘 다 KEV면 외부 노출이 있는 쪽이 먼저다.\n③ 그래도 같으면 자산 중요도가 높은 쪽(최상 > 높음 > 중간 > 낮음)이 먼저다.\n④ 그래도 같으면 CVSS가 높은 쪽이 먼저다.\nCVSS 점수만 보고 정하지 않는다. 한국어로." },
    { role: "user", content: 취약점6.map((v) => `${v.id}: ${v.설명}`).join("\n") + "\n\n6건 전부의 조치 순서를 {\"order\":[id...],\"reason\":한 문단}으로." },
  ],
  score(text) {
    const j = jsonOf(text); if (!j || !Array.isArray(j.order)) return { score: 0, detail: "JSON 없음" };
    const o = j.order.map((x) => String(x).trim().toUpperCase());
    const top3 = o.slice(0, 3).join(">") === "V2>V3>V4" ? 1 : 0;
    const i1 = o.indexOf("V1");
    const 미끼배제 = i1 >= 3 ? 1 : 0; // 목록에 없으면(-1) 0점 — 6건 전부를 정렬하라고 했다
    return { score: top3 * 0.6 + 미끼배제 * 0.4, detail: `상위3 ${o.slice(0, 3).join(">") || "-"} · V1 자리 ${i1 < 0 ? "없음" : i1 + 1}위` };
  },
};

// ── R6 report_fix: 서식 6절 + 사실 반영 ─────────────────────────────────────
const 필수절6 = ["제목", "대상 자산", "위험 요약", "조치 방법", "조치 기한", "담당 부서"];
export const R6 = {
  id: "report_fix", role: "report", 설명: "조치 요청서 6절 서식 + 사실(기한 3일·담당 인프라팀) 본문 반영",
  messages: [
    { role: "system", content: "너는 보안 담당자의 조치 요청서를 쓰는 팀원이다. 다음 여섯 절 제목을 그대로 써서 마크다운으로 쓴다: 제목 / 대상 자산 / 위험 요약 / 조치 방법 / 조치 기한 / 담당 부서. 지시받은 기한과 담당 부서는 본문에 반드시 그대로 적는다. 한국어로 쓴다." },
    { role: "user", content: "hr.example.co.kr(10.20.1.22) /upload.do 의 임의 파일 업로드 취약점(웹셸 업로드 가능, 확장자 차단을 대소문자 혼용으로 우회) 조치 요청서를 써라. 조치 기한은 3일 안, 담당은 인프라팀이다." },
  ],
  score(text) {
    const t = text || "";
    // ★ 2026-09-04: 예전에는 `t.includes(절이름)`이라 **절 이름을 나열만 해도 6/6**이었다(실측).
    //   서식 회귀를 잡으려고 만든 채점기가 서식을 안 지킨 답에 만점을 줬다 — 잣대는 tasks.mjs 한 곳.
    const { 수: n } = 절세기(t, 필수절6);
    const 기한 = /3\s*일/.test(t) ? 1 : 0;
    const 담당 = /인프라\s*팀/.test(t) ? 1 : 0;
    const ko = 한글비율(t);
    const s = (n / 필수절6.length) * 0.5 + ((기한 + 담당) / 2) * 0.3 + Math.min(ko / 0.6, 1) * 0.2;
    return { score: s, detail: `절 ${n}/6 · 기한 ${기한} · 담당 ${담당} · 한글 ${(ko * 100).toFixed(0)}%` };
  },
};

export const TASKS = [R1, R2, R3, R4, R5, R6];
