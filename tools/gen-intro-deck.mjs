// tools/gen-intro-deck.mjs — 제품소개 덱(NotebookLM 14장)에 "실제 화면 + 부연설명" 페이지를 끼워 넣는다.
//
// 원본 덱은 전부 통이미지(텍스트 레이어 없음)라 원본 장은 손대지 않고, 해당 슬라이드 바로 뒤에
// 같은 규격(1376x768pt)의 화면 설명 페이지를 삽입한다. 화면은 screenshots/deck/(뷰포트 캡처)를 쓴다.
//   ① `GIJO_SHOT_DECK=1 node tools/gen-screenshots.mjs` 로 화면 캡처
//   ② `node tools/gen-intro-deck.mjs`                    → 이 스크립트가 삽입 페이지 PDF 생성
//   ③ `python tools/merge-intro-deck.py`                 → 원본과 병합
//
// 디자인은 원본 덱(어두운 차콜 + 주황 강조 + 얇은 프레임)에 맞춘다.

import * as fs from "fs";
import * as path from "path";
import { createRequire } from "module";
import { fileURLToPath, pathToFileURL } from "url";

const ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const require = createRequire(pathToFileURL(path.join(ROOT, "client", "package.json")));
const { chromium } = require("playwright-core");

const SHOT_DIR = path.join(ROOT, "screenshots", "deck");
const OUT_DIR = path.join(ROOT, "release-docs");
fs.mkdirSync(OUT_DIR, { recursive: true });

// after: 원본 덱에서 이 슬라이드(1-based) 바로 뒤에 삽입한다.
// shot: screenshots/deck/ 파일명(확장자 제외). menu: 제품 내 위치. points: 부연설명 항목.
const SLIDES = [
  {
    after: 3, shot: "13-메인대시보드-지휘콘솔",
    title: "보안 지휘 콘솔 — 제품의 첫 화면",
    menu: "모니터링 › 대시보드",
    lead: "로그인 직후 담당자가 만나는 화면. 좌측은 자산, 가운데는 에이전트 지휘, 우측은 오늘 할 일이다.",
    points: [
      ["좌측 자산 탐색기", "AI 자산·SBOM·보안제품을 한 트리에서 펼쳐 보고, 취약점 건수를 배지로 바로 표시."],
      ["가운데 지휘 콘솔", "팀원 카드를 눌러 지시 대상을 고르고 자연어로 지시. 아래 협업 독에 처리 과정이 실시간으로 흐른다."],
      ["우측 오늘 확인할 항목", "P0~P2 우선순위 할 일과 KEV 등재 취약점 조치 순위를 함께 노출."],
    ],
  },
  {
    after: 4, shot: "14-통합관제-보안분석",
    title: "통합 관제 — 3대 소스를 한 줄로 세운다",
    menu: "① 발견·수집 › 통합 관제",
    lead: "취약점 스캐너·보안 로그·보안제품 운영 리포트를 같은 규격의 이벤트로 정규화해 한 화면에 모은다.",
    points: [
      ["드롭존 인입", "파일을 올리면 서버가 로그인지 리포트인지 자동 판별해 알맞은 파서로 라우팅."],
      ["종합 위험도", "3소스를 합산해 현재 위험 수준과 소스별 건수를 상단에 요약."],
      ["통합 우선순위", "KEV·EPSS 점수를 붙여 P0부터 정렬. 항목을 고르면 우측에 상세와 조치가 열린다."],
    ],
  },
  {
    after: 5, shot: "02-CTI위협-자산매칭",
    title: "위협 인텔리전스 — 외부 위협을 내부 자산에 붙인다",
    menu: "① 발견·수집 › 위협 인텔",
    lead: "수집한 CTI 항목을 사내 자산 식별자와 대조해 '우리에게 해당되는 위협'만 남긴다.",
    points: [
      ["자동 매칭", "위협 본문의 모델명·컴포넌트명·CVE를 자산 인벤토리와 대조해 영향 자산을 지목."],
      ["영향 자산 표기", "각 위협 카드에 어떤 사내 자산이 걸리는지, 매칭 근거가 무엇인지 함께 표시."],
      ["피드 관리", "연동된 피드 수와 탐지 내역, 긴급 탐지 건수를 상단 지표로 관리."],
    ],
  },
  {
    after: 5, shot: "03-AI자산-서비스영향도",
    title: "AI 자산 인벤토리 — 서비스 영향도까지",
    menu: "① 발견·수집 › 자산 목록",
    lead: "코드 저장소를 스캔해 AI 자산을 자동 등록하고, 각 자산이 어떤 업무 서비스에 물려 있는지 추적한다.",
    points: [
      ["코드 저장소 스캔", "리포지터리를 훑어 모델·프레임워크 의존성을 찾아 자산 후보로 올린다."],
      ["서비스 영향도", "자산이 연결된 업무 서비스를 표로 묶어, 장애 시 무엇이 멈추는지 즉시 파악."],
      ["상태 배지", "자산별 취약점 건수와 SBOM 작성 여부를 목록에서 바로 확인."],
    ],
  },
  {
    after: 6, shot: "11-취약자산관리-생애주기",
    title: "취약 자산 관리 — 목록이 아니라 생애주기",
    menu: "② 우선순위 › 취약점",
    lead: "Nessus 원본을 올리면 중복을 걷어내고 KEV·EPSS를 붙여 실제 조치 순서를 만든다.",
    points: [
      ["원본 업로드", ".nessus XML·CSV·HTML을 그대로 올리면 호스트와 플러그인 단위로 정규화."],
      ["조치 우선순위", "CVSS만 보지 않고 KEV 등재 여부와 EPSS 악용 확률을 함께 매겨 상단에 노출."],
      ["심각도 분포", "Critical/High/Medium/Low 건수를 요약해 현재 부채 규모를 한눈에."],
    ],
  },
  {
    after: 6, shot: "05-승인워크플로우",
    title: "조치·승인 — 판단에 근거를 남긴다",
    menu: "③ 조치 › 조치·승인",
    lead: "AI가 올린 Finding을 사람이 확인·오탐·반려로 판정하고, 그 이력이 그대로 증적이 된다.",
    points: [
      ["결재판", "전체 Finding과 미검토·승인·반려 건수를 한 줄로 관리."],
      ["판정 기록", "각 항목에 담당자와 기한을 붙이고 승인/반려 사유를 남긴다."],
      ["근거 보존", "취약점 원문 설명을 함께 보관해 나중에 판단 근거를 다시 확인할 수 있다."],
    ],
  },
  {
    after: 7, shot: "12-보안제품관리-매뉴얼",
    title: "보안제품 관리 — 장비 등록부와 매뉴얼 지식화",
    menu: "등록부 › 보안제품",
    lead: "방화벽·EDR·DLP·WAF 등 카테고리별 제품 등록부를 두고, 제품 매뉴얼을 올리면 지식베이스로 들어간다.",
    points: [
      ["카테고리 등록부", "10종 고정 카테고리로 사내 보안제품을 등록하고 담당자·연결 자산을 묶는다."],
      ["매뉴얼 자동 분류", "파일명의 제품 코드와 키워드를 읽어 올바른 제품에 자동 매핑."],
      ["로그 매뉴얼 분리", "파일명에 로그가 들어가면 로그 매뉴얼로 따로 분류해 섞이지 않게 한다."],
    ],
  },
  {
    after: 7, shot: "04-정기점검-승인거버넌스",
    title: "정기 점검 — 점검 주기와 거버넌스",
    menu: "③ 조치 › 정기 점검",
    lead: "제품별 정기 점검 일정을 등록해 두고, 지연·임박 건을 자동으로 띄운다.",
    points: [
      ["점검 일정", "제품별 주기를 등록하면 다음 점검일과 지연 여부를 자동 계산."],
      ["이행률", "완료·대기·지연 건수와 이행률을 지표로 관리."],
      ["지식 검색", "등록된 매뉴얼을 대상으로 질문해 장애 처리 절차를 근거와 함께 받는다."],
    ],
  },
  {
    after: 8, shot: "08-에이전트AI",
    title: "에이전트 AI — 팀 편성과 모델 배정",
    menu: "AI 운영 › 에이전트 AI",
    lead: "역할별 에이전트에 어떤 로컬 모델을 물릴지 담당자가 직접 고른다.",
    points: [
      ["역할별 로스터", "오케스트레이터·스캔·분석·리포트·CTI 등 역할마다 카드로 구성."],
      ["모델 배정", "각 카드의 드롭다운에서 로드된 로컬 모델을 골라 붙인다."],
      ["작업 현황", "오늘 생성된 작업 수와 진행 중 건수를 상단에 표시."],
    ],
  },
  // [2026-08-06] 옛 「LLM 가이드」·「사용량·요금」 두 장을 뺐다. 두 기능은 설정 > 서버·AI 탭
  //   한 곳으로 흡수됐는데, 그 탭은 구역이 접혀 있어 **한 장의 사진으로 정직하게 담기지 않는다**
  //   (실측: 캡처 환경이 GPU를 못 봐 "NVIDIA GPU 없음"이 찍혔다 — 고객 자료에 사실과 다른
  //   문구가 들어가면 안 된다). 모델 이야기는 바로 앞 「에이전트 AI」 장이 이미 다룬다.
  {
    after: 9, shot: "17-기억학습-문서관리",
    title: "지식 관계도 — 표준 사이의 연결을 그린다",
    menu: "AI 운영 › AI 지식(같은 화면의 지식 관계도)",
    lead: "벡터 검색만으로는 잡히지 않는 표준 간 관계를 트리플로 저장해 교차 조회한다.",
    points: [
      ["표준 임포트", "KISA·ATLAS·OWASP·NIST·CWE·ATT&CK 코드를 오프라인 번들로 적재."],
      ["관계 그래프", "주어·서술어·목적어 트리플을 그래프로 그려 연결을 눈으로 확인."],
      ["규칙 추가", "필요한 규칙을 직접 문장으로 넣어 조직 고유의 관계를 보탠다."],
    ],
  },
  {
    after: 9, shot: "17-기억학습-문서관리",
    title: "기억·학습 — 올린 문서가 곧 지식",
    menu: "AI 운영 › AI 지식",
    lead: "PDF·HWPX·텍스트를 올리면 임베딩해 장기 기억에 넣고, 어떤 에이전트가 쓸지 지정한다.",
    points: [
      ["문서 올리기", "여러 형식을 그대로 올리면 조각내어 벡터화."],
      ["대상 에이전트", "문서를 전체 공유할지 특정 에이전트에만 붙일지 선택."],
      ["문서 관리", "올린 문서와 조각 수를 목록으로 관리하고 필요하면 삭제."],
    ],
  },
  {
    after: 10, shot: "06-헤르메스학습루프",
    title: "헤르메스 학습 루프 — 폐쇄망 자가학습",
    menu: "AI 운영 › 학습 루프",
    lead: "담당자가 좋게 평가한 대화만 모아 QLoRA로 학습하고 GGUF로 바꿔 다시 배포한다.",
    points: [
      ["수집·정제", "좋아요 표시된 대화만 학습 후보로 쌓는다."],
      ["사전 점검", "Python·unsloth·gguf·llama.cpp·베이스 모델 캐시를 실행 전에 검사해 실패를 막는다."],
      ["학습·배포", "단일 GPU에서 추론을 잠시 멈추고 학습한 뒤 양자화해 지정 에이전트에 배포."],
    ],
  },
  // LLM 합성 슬라이드는 뺐다(2026-08-19) — 화면이 08-08 메뉴에서 내려가(고아)
  // 고객 덱이 없는 메뉴 경로(AI 운영 › 모델 합치기)를 인쇄하고 있었다.
  {
    after: 11, shot: "15-레드팀-가드레일",
    title: "AI 견고성 — 가드레일과 레드팀",
    menu: "AI 운영 › AI 공격 시험·차단",
    lead: "실시간 입력을 감시해 막고, 별도로 공격 페이로드를 직접 던져 견고성을 실측한다.",
    points: [
      ["런타임 가드레일", "끄기·탐지·차단 세 모드. 프롬프트 인젝션·탈옥 시도를 잡아낸 누적 건수를 표시."],
      ["레드팀 실행", "점검 대상을 고른 뒤 표준 페이로드 전량를 자동으로 던져 뚫림·방어를 가리고 견고성 점수를 매긴다."],
      ["카테고리별 취약", "시스템 프롬프트 유출·역할 탈취 등 항목별로 성공률을 막대로 보여준다."],
    ],
  },
  {
    after: 12, shot: "10-AI-BOM-SBOM",
    title: "AI-BOM — 소프트웨어를 넘어선 자재명세서",
    menu: "② 우선순위 › AI-BOM",
    lead: "코드 의존성만이 아니라 모델·데이터·프롬프트·에이전트 도구·인프라까지 명세로 묶는다.",
    points: [
      ["5대 수집 영역", "AI 모델, 데이터 출처, 프롬프트, 에이전트 도구, 인프라를 한 명세로."],
      ["표준 출력", "CycloneDX와 SPDX 형식으로 내보내 외부 제출에 그대로 쓴다."],
      ["일괄 생성", "SBOM이 없는 자산을 찾아 한 번에 생성."],
    ],
  },
  {
    after: 12, shot: "09-컴플라이언스",
    title: "컴플라이언스 — 기준별 대응 현황",
    menu: "⑤ 보고 › 컴플라이언스",
    lead: "KISA AI 보안 위협 대응 매뉴얼을 축으로 OWASP·NIST·MITRE 코드를 함께 걸어 대응 상태를 관리한다.",
    points: [
      ["위협 항목", "데이터 위협·모델 위협 등 분류별로 항목을 펼쳐 관리."],
      ["표준 교차 표기", "각 항목에 OWASP·NIST·MITRE 대응 코드를 함께 붙여 보여준다."],
      ["AI 초안", "항목별 대응 방안 초안을 로컬 LLM이 작성해 검토 시간을 줄인다."],
    ],
  },
  {
    after: 12, shot: "01-보안KPI대시보드",
    title: "보안 KPI — 임원 보고용 숫자",
    menu: "⑤ 보고 › 보안 KPI",
    lead: "자산·취약점·점검·CTI·조치 현황을 한 판에 모아 보고서에 그대로 옮길 수 있게 정리한다.",
    points: [
      ["영역별 지표", "자산 위험도, 취약점 승인, 유지보수 거버넌스, CTI 영향, 조치 현황을 구획으로 구분."],
      ["반기 기준", "지연·미조치 건을 별도로 세어 관리 공백을 드러낸다."],
      ["보고 연결", "여기 숫자가 내부 리포트 자동 생성의 입력이 된다."],
    ],
  },
  {
    after: 13, shot: "21-설정-사용자관리",
    title: "설정 — 서버 연결과 계정 관리",
    menu: "설정 › 내 설정 · 관리자",
    lead: "단일 데스크톱 모드와 분산 온프레미스 모드를 이 화면 하나로 전환한다.",
    points: [
      ["서버 연결", "접속할 서버 주소를 바꾸고 연결 테스트로 확인. 같은 PC면 기본값 그대로."],
      ["계정 관리", "관리자·담당자 역할로 계정을 만들고 초기 비밀번호를 지정."],
      ["비밀번호 변경", "본인 비밀번호를 직접 바꾸도록 분리."],
    ],
  },
  {
    after: 13, shot: "20-시스템로그",
    title: "로그 — 제품이 무슨 일을 했는지",
    menu: "설정 › 시스템 로그",
    lead: "서버 콘솔과 제품이 실행한 자식 프로세스의 출력을 한 곳에 모아 실시간으로 흘린다.",
    points: [
      ["소스별 필터", "서버 콘솔·모델 스캔·저장소 스캔·문서 추출·파인튜닝·모델 다운로드를 나눠서 본다."],
      ["실시간 스트리밍", "WebSocket으로 새 로그가 즉시 밀려 들어온다."],
      ["최근 500건", "링버퍼로 최근 기록을 유지해 별도 터미널 없이 확인."],
    ],
  },
];

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function pageHtml(s, idx) {
  const img = pathToFileURL(path.join(SHOT_DIR, `${s.shot}.png`)).href;
  const pts = s.points
    .map(
      ([h, b]) =>
        `<div class="pt"><div class="pt-h">${esc(h)}</div><div class="pt-b">${esc(b)}</div></div>`
    )
    .join("");
  return `<section class="page">
  <div class="frame"></div>
  <div class="kicker">실제 화면 · ${esc(s.menu)}</div>
  <h1>${esc(s.title)}</h1>
  <div class="body">
    <div class="shot"><img src="${img}" alt=""></div>
    <div class="side">
      <div class="lead">${esc(s.lead)}</div>
      ${pts}
    </div>
  </div>
  <div class="foot">GIJO AS v2.0.0 — 온프레미스 AI 보안 관리 플랫폼</div>
</section>`;
}

const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>
  @page { size: 1376px 768px; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #1b1e24; font-family: "Malgun Gothic","맑은 고딕",system-ui,sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .page { position: relative; width: 1376px; height: 768px; background: #1b1e24; color: #e9ecf1;
          padding: 44px 52px 40px; page-break-after: always; overflow: hidden; }
  .page:last-child { page-break-after: auto; }
  .frame { position: absolute; inset: 18px; border: 1px solid #c9922f; opacity: .45; pointer-events: none; }
  .kicker { font-size: 15px; font-weight: 700; color: #e0a53f; letter-spacing: .2px; margin-bottom: 8px; }
  h1 { font-size: 36px; font-weight: 800; letter-spacing: -.5px; line-height: 1.2; margin-bottom: 20px; }
  .body { display: flex; gap: 28px; align-items: flex-start; }
  .shot { width: 818px; border: 1px solid #39414f; border-radius: 6px; overflow: hidden; background: #0f1116;
          box-shadow: 0 10px 30px rgba(0,0,0,.45); }
  .shot img { display: block; width: 100%; }
  .side { flex: 1; padding-top: 2px; }
  .lead { font-size: 15.5px; line-height: 1.65; color: #cdd4de; padding-bottom: 14px; margin-bottom: 14px;
          border-bottom: 1px solid #333b47; }
  .pt { margin-bottom: 14px; }
  .pt-h { font-size: 15px; font-weight: 800; color: #e0a53f; margin-bottom: 4px; }
  .pt-b { font-size: 14px; line-height: 1.6; color: #b9c1cd; }
  .foot { position: absolute; left: 52px; bottom: 26px; font-size: 11.5px; color: #6d7684; letter-spacing: .3px; }
</style></head><body>
${SLIDES.map(pageHtml).join("\n")}
</body></html>`;

const htmlPath = path.join(OUT_DIR, "intro-inserts.html");
fs.writeFileSync(htmlPath, html, "utf8");

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage();
await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
await page.waitForTimeout(1500);
const pdfPath = path.join(OUT_DIR, "intro-inserts.pdf");
await page.pdf({ path: pdfPath, width: "1376px", height: "768px", printBackground: true, pageRanges: `1-${SLIDES.length}` });
await browser.close();

// 병합 스크립트가 읽을 삽입 위치 정보.
fs.writeFileSync(
  path.join(OUT_DIR, "intro-inserts.json"),
  JSON.stringify(SLIDES.map((s, i) => ({ index: i, after: s.after, shot: s.shot, title: s.title })), null, 2),
  "utf8"
);

console.log(`삽입 페이지 ${SLIDES.length}장 → ${pdfPath}`);
