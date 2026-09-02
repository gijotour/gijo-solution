// tools/team-bench/tasks.mjs — AI 팀원 역할별 시험 재료와 결정적 채점기.
//
// 왜 있나(2026-09-03 사장님 「허깅페이스에서 우리가 쓸 만한 것을 AI 팀별로 다양하게 테스트」):
//   후보 모델을 **같은 문항·같은 채점기**로 재야 표가 된다. 채점은 전부 코드(정규식·필드 대조·
//   글자 겹침)로만 한다 — LLM 채점기는 게이트 원칙(중-3)대로 쓰지 않는다.
// 역할: scan(파일 읽기) · analysis(우선순위) · report(서식) · ti(위협 매칭) · normaltic(용어·근거) ·
//       orchestrator(도구 선택). 공통: 긴 문맥 바늘(16K), 한국어 비율, 한자 누출, JSON 유효성.
// 재료는 전부 이 파일 안에서 만든다(외부 파일 없음 — gb10에 복사 한 번이면 돈다).

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

// ── T1 scan: 웹 취약점 리포트 발췌 → 구조화 ─────────────────────────────
const 리포트 = `[웹 취약점 진단 결과 보고서 — 2026-08 정기 진단]
대상: 사내 포털(portal.example.co.kr, 10.20.1.15), 인사 시스템(hr.example.co.kr, 10.20.1.22), 파일 서버(files.example.co.kr, 10.20.1.40)

1. [높음] SQL 인젝션 — portal.example.co.kr /board/view.jsp (파라미터 id)
   증거: id=1' AND 1=1-- 입력 시 정상 응답, 1=2 입력 시 빈 페이지. DB 오류 문구 노출.
   조치: 준비된 문(PreparedStatement) 사용, 입력 검증.
2. [중간] 반사형 XSS — portal.example.co.kr /search (파라미터 q)
   증거: q=<script>alert(1)</script> 입력 시 스크립트 실행 확인.
3. [높음] 인증 우회 — hr.example.co.kr /admin/list.do
   증거: 세션 없이 직접 접근 시 관리자 목록 200 OK 응답.
4. [낮음] 서버 버전 정보 노출 — hr.example.co.kr 응답 헤더 Server: Apache/2.4.29
5. [긴급] 원격 코드 실행 — files.example.co.kr Apache Struts 2.3.31 (CVE-2017-5638)
   증거: Content-Type 헤더 OGNL 페이로드로 id 명령 실행 결과 회신. KEV 등재 취약점.
6. [중간] 디렉터리 리스팅 — files.example.co.kr /backup/ 목록 노출(백업 파일 3건)
진단 결론: 긴급 1, 높음 2, 중간 2, 낮음 1. 원격 코드 실행 건은 즉시 조치 요망.`;

const 기대_findings = [
  { asset: "portal", vuln: /sql|인젝션/i, severity: "높음" },
  { asset: "portal", vuln: /xss|스크립트/i, severity: "중간" },
  { asset: "hr", vuln: /인증|우회/i, severity: "높음" },
  { asset: "hr", vuln: /버전|헤더|노출/i, severity: "낮음" },
  { asset: "files", vuln: /원격|rce|struts|5638/i, severity: "긴급" },
  { asset: "files", vuln: /디렉터리|리스팅|backup/i, severity: "중간" },
];

export const T1 = {
  id: "scan_extract", role: "scan", 설명: "리포트 발췌 → 취약점 목록 JSON(자산·취약점·심각도·근거)",
  schema: { type: "object", properties: { findings: { type: "array", items: { type: "object", properties: { asset: { type: "string" }, vuln: { type: "string" }, severity: { type: "string" }, evidence: { type: "string" } }, required: ["asset", "vuln", "severity"] } } }, required: ["findings"] },
  messages: [
    { role: "system", content: "너는 보안 스캔 결과를 구조화하는 담당자다. 주어진 보고서에서 취약점 항목을 빠짐없이 JSON으로 뽑는다. severity는 보고서의 표기(긴급/높음/중간/낮음)를 그대로 쓴다. 한국어로." },
    { role: "user", content: 리포트 + "\n\n위 보고서의 모든 취약점을 {\"findings\":[{\"asset\":호스트,\"vuln\":취약점 이름,\"severity\":심각도,\"evidence\":근거 한 줄}]} 형식으로." },
  ],
  score(text) {
    const j = jsonOf(text); if (!j || !Array.isArray(j.findings)) return { score: 0, detail: "JSON 없음" };
    let hit = 0, sevOk = 0;
    for (const e of 기대_findings) {
      const f = j.findings.find((x) => (String(x.asset || "") + " " + String(x.vuln || "") + " " + String(x.evidence || "")).toLowerCase().includes(e.asset) && e.vuln.test(String(x.vuln || "") + " " + String(x.evidence || "")));
      if (f) { hit++; if (String(f.severity || "").includes(e.severity)) sevOk++; }
    }
    return { score: (hit / 6) * 0.7 + (sevOk / 6) * 0.3, detail: `항목 ${hit}/6 · 심각도 ${sevOk}/6 · 뽑은 수 ${j.findings.length}` };
  },
};

// ── T2 needle: 긴 한국어 문맥(약 16K 토큰)에 사실 5개 ───────────────────────
const 채움문단 = [
  "취약점 관리는 자산 식별, 취약점 탐지, 위험 평가, 조치, 검증의 순환으로 이루어진다. 각 단계의 기록은 감사 대응의 근거가 되므로 담당자와 일시를 남겨야 한다.",
  "보안 장비의 정책 변경은 변경 요청서, 승인, 적용, 사후 검토의 절차를 따른다. 긴급 변경도 사후 승인을 반드시 받는다.",
  "로그는 최소 1년 보관하며, 접근 기록과 관리자 행위 기록은 별도로 보호한다. 로그 위변조 방지를 위해 해시 체인이나 외부 저장을 권장한다.",
  "침해사고 대응은 탐지, 초동 조치, 분석, 복구, 재발 방지의 다섯 단계로 나뉜다. 초동 조치에서는 증거 보전을 우선한다.",
  "협력사 접근 계정은 기간을 정해 발급하고 만료 시 자동 회수한다. 공유 계정은 원칙적으로 금지한다.",
];
const 사실 = [
  { 문장: "이번 분기 외부 모의해킹 업체는 「청람보안」이며 계약 번호는 CT-2026-0417이다.", 질문: "이번 분기 외부 모의해킹 업체 이름은?", 정답: /청람보안/ },
  { 문장: "백업 서버의 관리 IP는 10.77.3.9이고 백업 창은 매일 새벽 2시 30분이다.", 질문: "백업 서버의 관리 IP는?", 정답: /10\.77\.3\.9/ },
  { 문장: "패치 유예 승인권자는 정보보호최고책임자이며 유예 기간은 최대 45일이다.", 질문: "패치 유예 기간은 최대 며칠인가?", 정답: /45/ },
  { 문장: "SIEM 연동 담당은 운영2팀 박도윤 과장이고 연동 포트는 5514이다.", 질문: "SIEM 연동 포트 번호는?", 정답: /5514/ },
  { 문장: "위험 수용 결정은 분기마다 재검토하며 재검토 회의체 이름은 「보안조정협의회」다.", 질문: "위험 수용을 재검토하는 회의체 이름은?", 정답: /보안조정협의회/ },
];
function 긴문서(목표자수) {
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
export const T2 = {
  id: "needle_16k", role: "scan", 설명: "약 25,000자(≈16K 토큰) 한국어 문서에서 사실 5개 회수",
  messages: (() => {
    const doc = 긴문서(25000);
    return [
      { role: "system", content: "주어진 사내 문서만 근거로 짧게 답한다. 문서에 없으면 「문서에 없음」이라고 답한다. 한국어로." },
      { role: "user", content: "문서:\n" + doc + "\n\n질문 5개에 번호를 붙여 각각 한 줄로 답하라.\n" + 사실.map((s, k) => `${k + 1}. ${s.질문}`).join("\n") },
    ];
  })(),
  score(text) {
    let hit = 0; for (const s of 사실) if (s.정답.test(text || "")) hit++;
    return { score: hit / 사실.length, detail: `회수 ${hit}/5` };
  },
};

// ── T3 analysis: 우선순위 ───────────────────────────────────────────────
const 취약점들 = [
  { id: "V1", 설명: "내부 전용 개발 서버, CVSS 9.8, KEV 미등재, 외부 노출 없음, 자산 중요도 낮음" },
  { id: "V2", 설명: "대외 서비스 웹 서버, CVSS 7.5, KEV 등재(실제 악용 확인), 외부 노출, 자산 중요도 높음" },
  { id: "V3", 설명: "사내 인사 시스템, CVSS 8.1, KEV 미등재, 외부 노출 없음, 개인정보 보유(중요도 높음)" },
  { id: "V4", 설명: "테스트 장비, CVSS 5.3, KEV 미등재, 외부 노출, 자산 중요도 낮음" },
  { id: "V5", 설명: "대외 결제 게이트웨이, CVSS 6.5, KEV 등재, 외부 노출, 자산 중요도 최상" },
];
export const T3 = {
  id: "priority_rank", role: "analysis", 설명: "KEV·노출·중요도를 함께 보아 조치 순서 정하기",
  schema: { type: "object", properties: { order: { type: "array", items: { type: "string" } }, reason: { type: "string" } }, required: ["order"] },
  messages: [
    { role: "system", content: "너는 취약점 조치 우선순위를 정하는 분석 담당자다. 규칙: 실제 악용이 확인된(KEV) 취약점이 최우선이고, 그다음 외부 노출과 자산 중요도를 본다. CVSS 점수만으로 정하지 않는다. 한국어로." },
    { role: "user", content: 취약점들.map((v) => `${v.id}: ${v.설명}`).join("\n") + "\n\n조치 순서를 {\"order\":[id...],\"reason\":한 문단}으로." },
  ],
  score(text) {
    const j = jsonOf(text); if (!j || !Array.isArray(j.order)) return { score: 0, detail: "JSON 없음" };
    const o = j.order.map(String);
    const top2 = new Set(o.slice(0, 2)); const okTop = (top2.has("V5") ? 0.5 : 0) + (top2.has("V2") ? 0.5 : 0);
    const v1Last = o.indexOf("V1") >= 3 ? 1 : 0; // CVSS 9.8이지만 내부·미등재 → 앞이 아니다
    return { score: okTop * 0.7 + v1Last * 0.3, detail: `순서 ${o.join(">")}` };
  },
};

// ── T4 report: 조치 요청서 서식 ─────────────────────────────────────────
const 필수절 = ["제목", "대상 자산", "취약점 요약", "조치 방법", "조치 기한", "담당"];
export const T4 = {
  id: "report_draft", role: "report", 설명: "조치 요청서 6절 서식·한국어·한자 누출",
  messages: [
    { role: "system", content: "너는 보안 담당자의 보고서를 쓰는 팀원이다. 반드시 다음 여섯 절 제목을 그대로 써서 마크다운으로 쓴다: 제목 / 대상 자산 / 취약점 요약 / 조치 방법 / 조치 기한 / 담당. 한국어만 쓰고 한자는 쓰지 않는다." },
    { role: "user", content: "files.example.co.kr(10.20.1.40)의 Apache Struts 2.3.31 원격 코드 실행(CVE-2017-5638, KEV 등재)에 대한 조치 요청서를 써라. 담당은 인프라팀, 기한은 3일 안." },
  ],
  score(text) {
    const t = text || ""; let n = 0; for (const s of 필수절) if (t.includes(s)) n++;
    const ko = 한글비율(t), han = 한자수(t);
    const s = (n / 필수절.length) * 0.6 + Math.min(ko / 0.6, 1) * 0.3 + (han === 0 ? 0.1 : 0);
    return { score: s, detail: `절 ${n}/6 · 한글 ${(ko * 100).toFixed(0)}% · 한자 ${han}` };
  },
};

// ── T5 ti: 위협 정보 ↔ 자산 매칭 ─────────────────────────────────────────
export const T5 = {
  id: "ti_match", role: "ti", 설명: "CTI 4건 중 우리 자산에 해당하는 것만 고르기(절제 포함)",
  schema: { type: "object", properties: { matches: { type: "array", items: { type: "object", properties: { cve: { type: "string" }, asset: { type: "string" } }, required: ["cve", "asset"] } } }, required: ["matches"] },
  messages: [
    { role: "system", content: "너는 위협 정보를 우리 자산과 대조하는 팀원이다. 제품과 버전이 실제로 일치할 때만 해당으로 본다. 해당 없는 것은 넣지 않는다. 한국어로." },
    { role: "user", content: `우리 자산:
A1 웹서버 nginx 1.24.0 / A2 DB PostgreSQL 15.3 / A3 VPN FortiGate 7.0.12 / A4 메일 Exchange 2019 CU12

위협 정보:
C1 CVE-2024-21762 FortiOS 7.0.0~7.0.13 SSL-VPN 원격 코드 실행
C2 CVE-2023-38545 curl 8.4.0 미만 SOCKS5 힙 오버플로
C3 CVE-2024-26198 Exchange Server 2019 CU12~CU14 원격 코드 실행
C4 CVE-2021-44228 Log4j 2.0~2.14.1

해당하는 것만 {"matches":[{"cve":..,"asset":..}]}로.` },
  ],
  score(text) {
    const j = jsonOf(text); if (!j || !Array.isArray(j.matches)) return { score: 0, detail: "JSON 없음" };
    const got = new Set(j.matches.map((m) => String(m.cve || "").replace(/^CVE-/i, "").replace(/^C/i, "")));
    const want = ["2024-21762", "2024-26198"], wrong = ["2023-38545", "2021-44228"];
    const tp = want.filter((w) => [...got].some((g) => g.includes(w) || g === w.replace("-", ""))).length;
    const fp = wrong.filter((w) => [...got].some((g) => g.includes(w))).length;
    return { score: Math.max(0, tp / 2 - fp * 0.5), detail: `맞음 ${tp}/2 · 오탐 ${fp}` };
  },
};

// ── T6 normaltic: 근거 인용 해설 ────────────────────────────────────────
const 조각 = "[조각 K#7] 위험 수용이란 취약점이 실재함을 알면서도 사업상 판단으로 정해진 기한까지 조치하지 않기로 기록하는 결정이다. 오탐 처리와 다르며, 기한이 지나면 반드시 재검토한다. 영구 수용은 허용하지 않는다.";
export const T6 = {
  id: "glossary_cite", role: "normaltic", 설명: "근거 조각만으로 용어 해설 + 인용",
  messages: [
    { role: "system", content: "주어진 근거 조각만으로 답하고, 답 끝에 [근거: K#7]처럼 조각 id를 적는다. 근거에 없는 내용은 쓰지 않는다. 한국어로." },
    { role: "user", content: "근거:\n" + 조각 + "\n\n질문: 위험 수용과 오탐 처리는 어떻게 다른가?" },
  ],
  score(text) {
    const t = text || "";
    const cite = /K#7/.test(t) ? 1 : 0;
    // 20자 겹침: 조각의 20자 창 중 하나라도 답에 그대로 있으면 근거를 실제로 썼다고 본다
    let overlap = 0; for (let i = 0; i + 20 <= 조각.length; i += 5) if (t.includes(조각.slice(i, i + 20))) { overlap = 1; break; }
    const 핵심 = /기한/.test(t) && /(재검토|영구)/.test(t) ? 1 : 0;
    return { score: cite * 0.3 + overlap * 0.3 + 핵심 * 0.4, detail: `인용 ${cite} · 20자겹침 ${overlap} · 핵심 ${핵심}` };
  },
};

// ── T7 orchestrator: 도구 선택 ──────────────────────────────────────────
const 도구들 = [
  { name: "vuln_list", desc: "취약점 목록 조회(필터: severity, kev, asset)" },
  { name: "asset_register", desc: "자산 등록(name, ip, owner)" },
  { name: "report_create", desc: "보고서 생성(kind: weekly|incident, period)" },
  { name: "law_lookup", desc: "법령 조문 조회(law, article)" },
  { name: "device_config_backup", desc: "장비 설정 백업(device)" },
  { name: "knowledge_search", desc: "사내 문서·지식 검색(query)" },
];
const 지시들 = [
  { text: "KEV에 올라온 고위험 취약점만 보여줘", tool: "vuln_list" },
  { text: "10.20.1.50 새 웹서버를 자산으로 등록해줘, 담당은 김민준", tool: "asset_register" },
  { text: "지난주 보안 주간 보고서 만들어줘", tool: "report_create" },
  { text: "개인정보보호법 34조가 뭐라고 돼 있어?", tool: "law_lookup" },
  { text: "방화벽 FW-01 설정 백업해 둬", tool: "device_config_backup" },
  { text: "우리 백업 정책 문서에서 보관 기간 찾아줘", tool: "knowledge_search" },
];
export const T7 = {
  id: "tool_select", role: "orchestrator", 설명: "한국어 지시 6개 → 도구 이름 정확히 고르기",
  schema: { type: "object", properties: { picks: { type: "array", items: { type: "object", properties: { n: { type: "integer" }, tool: { type: "string" } }, required: ["n", "tool"] } } }, required: ["picks"] },
  messages: [
    { role: "system", content: "너는 지시를 받아 도구를 고르는 조율자다. 도구 목록에 있는 이름만 그대로 쓴다.\n도구:\n" + 도구들.map((t) => `- ${t.name}: ${t.desc}`).join("\n") },
    { role: "user", content: 지시들.map((d, k) => `${k + 1}. ${d.text}`).join("\n") + "\n\n각 지시에 맞는 도구를 {\"picks\":[{\"n\":번호,\"tool\":도구이름}]}로." },
  ],
  score(text) {
    const j = jsonOf(text); if (!j || !Array.isArray(j.picks)) return { score: 0, detail: "JSON 없음" };
    let ok = 0; for (const d of 지시들.map((x, k) => ({ ...x, n: k + 1 }))) { const p = j.picks.find((x) => Number(x.n) === d.n); if (p && String(p.tool) === d.tool) ok++; }
    return { score: ok / 지시들.length, detail: `도구 ${ok}/6` };
  },
};

export const TASKS = [T1, T2, T3, T4, T5, T6, T7];
