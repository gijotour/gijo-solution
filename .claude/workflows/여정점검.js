// 여정점검.js — 2026-09-01 클라우드 세션(as-private-41)에서 만든 워크플로. 로컬에서 그대로 쓴다:
//   Workflow({ name: "여정점검", args: { root: "<저장소 절대경로>", canRun: true } })
//   root 미지정 시 /home/user/AS-Private(클라우드 컨테이너 경로). canRun=true면 에이전트에게
//   "node_modules가 있어 실행 검증도 가능"이라고 알린다(클라우드에서는 미설치라 읽기 검증만 했다).
export const meta = {
  name: 'user-journey-review',
  description: '클라이언트 설치→로그인→제품 UI 여정을 사용자 관점으로 점검하고, 반박 검증을 거쳐 변경안으로 종합한다',
  phases: [
    { title: '점검', detail: '여정 구간별 점검 8갈래(설치·로그인·셸·허브·설정·업데이트·문서·페르소나)' },
    { title: '검증', detail: '구간별 반박 검증 — 근거·의도된 설계·사용자 영향' },
    { title: '누락', detail: '빠진 구간 찾기 + 보충 점검·검증' },
    { title: '종합', detail: '변경안 묶기·우선순위·계획서(전·중·후) 매핑' },
  ],
}

const ROOT = (typeof args === 'object' && args && args.root) || '/home/user/AS-Private'
const CAN_RUN = !!(typeof args === 'object' && args && args.canRun)
const RUN_NOTE = CAN_RUN ? '이 머신에는 node_modules가 있어 읽기 검증에 더해 실행 검증(npm test·node 스크립트)도 가능하다 — 단 운영 서버(4000)·CDP(9223)·로그인 세션은 건드리지 않는다.' : 'node_modules가 없으면 빌드·테스트·서버 실행은 불가 — 읽어서 판단한다.'

const CTX = `
[제품] GIJO AS — 한국형 온프렘 AI 보안관리 플랫폼. Electron 클라이언트(client/) + Node/TS 서버(server/) + 로컬 LLM(llama.cpp). 저장소 경로: ${ROOT}. **읽기 전용 조사** — 어떤 파일도 고치지 말 것. ${RUN_NOTE}
[현재 상태] 클라이언트 버전 5.83.0(client/package.json, hub/main 29919788 · 2026-09-01). 이미 손으로 확인된 10건(GIJO_AS_클라이언트_여정_점검_변경안_2026-09-01.md §1-1: 로그인 자체 팔레트·「/ aria-label」·오류 문구 미분기·enrollRequired 미처리·oneClick 문구 불일치·게시 저장소 .exe만·설치 가이드 v2.1.0 낡음·코드 서명 없음 등)은 **다시 발견하지 말고** 그 밖을 찾는다(같은 것을 찾으면 id에 「기존#N」을 붙여 한 줄만). 오늘은 2026-09-02. 화면 = client/src/renderer/pages/*.html (순수 HTML/CSS/JS, 빌드 단계 없음). app.html이 탭 셸이며 각 화면을 ?embed=1 iframe으로 품는다(#tabBar·#screens). nav.js = 공용 사이드바(메뉴 IA), titlebar.js = 상단 조작줄·세션 칩·⚙ 메뉴·업데이트 배지, footbar.js = 하단 고정바, gijo-ui.css = 디자인 시스템 토큰. 메인 프로세스 client/src/main.ts, preload client/src/preload.ts, API client/src/api/*.ts. 서버 진입 server/src/index.ts·app.ts, 인증 server/src/auth/*.ts, 엔진 server/src/engine/*.ts, 챗봇 화면 안내 server/src/engine/screenguide.ts. 설치본 = NSIS(client/build/installer.nsh, client/package.json의 build 항목), 배포처 = GIJO 서버 자신(server/src/engine/clientrelease.ts). 운영 모드 2종: 분산 모드(사내 GPU 서버 4000에 접속, 표준) · 단일 데스크톱 모드(설치본에 동봉된 서버를 localhost로 자동 기동).
[제품 원칙 — 위반 여부를 볼 기준] ① 사용자 대상 텍스트는 전부 한글, 어려운 말엔 쉬운 풀이 ② 화면에는 「정체성 한 줄 + ⚠경고」만 두고 사용법·용어 풀이는 챗봇(screenguide panels + ⓘ gijo-info)으로 ③ 정직한 구현 — 가짜 UI·폴백 문구 금지, 못 받은 값은 못 받았다고 보인다 ④ 온프렘·완전 오프라인(CDN·외부 링크 금지) ⑤ 다크 팔레트 고정·gijo-ui.css 토큰 사용 ⑥ 지시는 대화창에서, 자료 변경은 결재판(승인 창)을 거친다 ⑦ 눌러도 아무 일 없는 자리·막막한 빈 화면·날것 오류(HTTP 상태·스택·영문 시스템 오류) 금지 ⑧ 되돌릴 수 없는 동작은 확인을 받는다.
[이미 알려진 것 — 다시 지적하지 말 것] (a) 디자인 토큰이 화면 39개 중 13개만 gijo-ui.css를 링크하고 나머지는 :root 팔레트를 복붙한 상태(알려진 약점, GIJO_AS_디자인·코드검토_안내.md §4-①) (b) 화면 수가 많고 IA 통합이 진행 중 (c) HTML 인라인 스크립트가 tsc 타입검사 밖 (d) 2026-08-01 「사용자 상황점검 1,133개」에서 고친 4건(온톨로지 삭제 확인·[undefined] 노출·ML 용어·빈 화면 4곳). 코드 주석에 「사용자 결정/지시(날짜)」로 기록된 상태는 **의도된 설계**다 — 그것을 뒤집자는 제안은 근거가 특별히 강할 때만 내고, 낼 때는 그 결정을 알고 있음을 명시한다.
[문서 위치 — 2026-09-02] 루트에 있던 역사·내부 문서 100개를 「_archive/」 아래로 옮겼다(git mv, 내용은 그대로). 아래에 적힌 파일이 루트에 없으면 **_archive/<파일명>** 을 보라. 없다고 단정하지 말 것.
[출력 규칙] 근거 없는 추측 금지 — 모든 finding은 실제로 읽은 파일·줄 번호·짧은 인용을 담는다(먼저 읽고 적을 것. 줄 번호는 nl/grep -n 등으로 실확인). 우선순위: P0 = 담당자가 막히거나 잘못 판단하게 됨(설치 실패·로그인 못 함·틀린 안내·데이터 오해) / P1 = 자주 겪는 불편·신뢰 훼손·원칙 위반 / P2 = 다듬기. P3(사소한 것)는 findings에 넣지 말고 notes에 한 줄씩만 적는다. findings는 가치 높은 순으로 **최대 12건**. 각 finding의 user_impact는 「담당자가 실제로 겪는 일」을 한 문장으로, proposal은 「무엇을 어떻게 바꾸자」를 한두 문장으로 구체적으로(파일·문구 수준). plan_item은 GIJO_AS_시장경쟁력_전중후_계획서.md의 항목(전-1~전-7 · 중-1~중-8 · 후-1~후-6) 중 맞는 것을 고르고 없으면 "신규"라고 적는다 — 이 문서를 먼저 읽고 판단할 것(3~5절만 읽으면 된다). needs_mockup은 화면 모양이 바뀌는 제안이면 true(이 저장소는 UI 변경 전 시안 승인이 필수다). effort는 S(반나절)·M(1~2일)·L(그 이상). 모든 글은 한국어로 쓴다.
`

const FINDINGS_SCHEMA = {
  type: 'object',
  required: ['findings', 'notes', 'scope_read'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'title', 'area', 'severity', 'user_impact', 'evidence', 'proposal', 'plan_item', 'needs_mockup', 'effort', 'confidence'],
        properties: {
          id: { type: 'string', description: '갈래 접두어 + 번호, 예: F2-03' },
          title: { type: 'string' },
          area: { type: 'string', enum: ['설치', '로그인', '셸·첫화면', '절차허브', '설정·기록·부가', '업데이트·세션', '문서', '여정전반'] },
          severity: { type: 'string', enum: ['P0', 'P1', 'P2'] },
          user_impact: { type: 'string' },
          evidence: { type: 'array', minItems: 1, items: { type: 'object', required: ['file', 'line', 'quote'], properties: { file: { type: 'string' }, line: { type: 'integer' }, quote: { type: 'string' } } } },
          proposal: { type: 'string' },
          plan_item: { type: 'string' },
          needs_mockup: { type: 'boolean' },
          effort: { type: 'string', enum: ['S', 'M', 'L'] },
          confidence: { type: 'number' },
        },
      },
    },
    notes: { type: 'string', description: 'P3 사소한 것 목록 + 잘 되고 있는 점(강점) 2~3개 + 못 본 것' },
    scope_read: { type: 'array', items: { type: 'string' }, description: '실제로 읽은 파일 목록' },
  },
}

const VERDICTS_SCHEMA = {
  type: 'object',
  required: ['verdicts'],
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'refuted', 'reason', 'severity', 'evidence_ok', 'intended_design', 'duplicate_of'],
        properties: {
          id: { type: 'string' },
          refuted: { type: 'boolean' },
          reason: { type: 'string' },
          severity: { type: 'string', enum: ['P0', 'P1', 'P2'] },
          evidence_ok: { type: 'boolean' },
          intended_design: { type: 'boolean' },
          duplicate_of: { type: 'string', description: '같은 갈래 안의 다른 finding과 중복이면 그 id, 아니면 빈 문자열' },
          corrected_proposal: { type: 'string' },
        },
      },
    },
  },
}

const CRITIC_SCHEMA = {
  type: 'object',
  required: ['gaps'],
  properties: {
    gaps: {
      type: 'array',
      maxItems: 3,
      items: { type: 'object', required: ['title', 'prompt'], properties: { title: { type: 'string' }, prompt: { type: 'string', description: '보충 점검 에이전트에게 줄 완전한 지시문 — 렌즈·읽을 파일 경로·무엇을 볼지' } } },
    },
    coverage_note: { type: 'string' },
  },
}

const SYNTH_SCHEMA = {
  type: 'object',
  required: ['journey_summary', 'strengths', 'proposals', 'top5', 'questions_for_user'],
  properties: {
    journey_summary: { type: 'string', description: '설치→로그인→첫 화면→업무 화면 여정을 담당자 눈으로 5~8문장' },
    strengths: { type: 'array', items: { type: 'string' } },
    proposals: {
      type: 'array',
      items: {
        type: 'object',
        required: ['key', 'title', 'priority', 'plan_item', 'finding_ids', 'problem', 'change', 'verify', 'effort', 'needs_mockup', 'risk'],
        properties: {
          key: { type: 'string', description: '변경안 번호, 예: C01' },
          title: { type: 'string' },
          priority: { type: 'string', enum: ['P0', 'P1', 'P2'] },
          plan_item: { type: 'string' },
          finding_ids: { type: 'array', items: { type: 'string' } },
          problem: { type: 'string', description: '담당자가 겪는 일 — 근거 파일:줄 포함' },
          change: { type: 'string', description: '구체적으로 무엇을 어떻게 바꾸나 — 파일·문구·동작 수준' },
          verify: { type: 'string', description: '바꾼 뒤 무엇으로 확인하나(실화면·시험·문서 대조)' },
          effort: { type: 'string', enum: ['S', 'M', 'L'] },
          needs_mockup: { type: 'boolean' },
          risk: { type: 'string', description: '바꿀 때 포기하는 것·깨질 수 있는 것' },
        },
      },
    },
    top5: { type: 'array', items: { type: 'string' } },
    questions_for_user: { type: 'array', items: { type: 'string' }, description: '사용자 결정이 필요한 것' },
  },
}

const FINDERS = [
  {
    key: 'F1', label: '설치 여정', area: '설치',
    lens: `렌즈: **헬프데스크(배포자)와 담당자가 설치본 exe를 받아 실행하는 순간부터 첫 실행까지.** 서명 없는 exe(EDR·SmartScreen 차단)에 대한 안내, 설치 마법사 문구(환영·완료 페이지 — installer.nsh)와 실제 동작(oneClick:false·perMachine:false·allowToChangeInstallationDirectory:false·runAfterFinish), 설치 경로 안내의 정확성, 완료 페이지의 WireGuard 인터넷 링크가 폐쇄망·온프렘 원칙과 맞는가, 업그레이드 덮어쓰기·실행 중 앱 감지, 단일 데스크톱 모드에서 번들 서버가 실제로 뜨는가(모델·llama-server 없을 때 담당자가 보는 것), GIJO_SERVER_URL 환경변수 요구가 담당자에게 현실적인가(설치 시 서버 주소를 받는 길이 있는가), mac dmg 배포 경로(서버 게시가 .exe만 받는가), 설치본 크기·소요 시간 안내. 문서(GIJO_AS_클라이언트_배포_가이드.md, GIJO_AS_설치_가이드_v2.1.0.md, GIJO_AS_배포_가이드.md의 클라이언트 절)가 5.83.0 실제와 맞는지도 이 갈래에서 본다(문서 갈래 F6과 겹쳐도 설치 관련은 여기서).`,
    files: 'client/package.json, client/build/installer.nsh, client/build/make-installer-bitmaps.mjs, client/build/fix-welcome-text.mjs, client/scripts/build-server-dist.mjs, client/scripts/publish-release.mjs, client/scripts/manual-update.ps1, client/scripts/rebuild-server-native.mjs, client/scripts/create-deploy-account.mjs, client/src/main.ts(maybeStartBundledServer·createMainWindow·update:install), server/src/engine/clientrelease.ts, server/src/engine/preflight.ts, GIJO_AS_클라이언트_배포_가이드.md, GIJO_AS_설치_가이드_v2.1.0.md, GIJO_AS_배포_가이드.md, release-docs/ 폴더, .claude/commands/GIJOAS게시.md',
  },
  {
    key: 'F2', label: '로그인 화면', area: '로그인',
    lens: `렌즈: **첫 로그인.** 서버 주소 입력(placeholder·기본값 localhost:4000이 분산 모드 표준과 맞는가·연결 확인 수단이 있는가), 오류 메시지가 원인을 구분하는가(서버 연결 실패 vs 아이디·비밀번호 오류 vs 잠금 — api/auth.ts의 code 값이 login.html에서 어떻게 쓰이는가), 잠금(429) 안내, 중복 로그인(409) 흐름, 2차 인증(MFA) 흐름·복구 코드, enrollRequired(관리자 2차 인증 필수 정책) 결과를 화면이 처리하는가(grep enrollRequired), 최초 비밀번호 변경 유도, 「이 PC에 로그인 정보 저장」 기본 체크(보안 제품에서 비밀번호 저장 기본값이 적절한가·safeStorage 미지원 시 문구), 최근 로그인 목록, 키보드 흐름(Enter·포커스·autocomplete), 접근성(label·aria), HTML 결함(login.html의 input 태그 속성 오타 등 실제로 확인), 하단 힌트 문구(단일 데스크톱 모드 안내가 먼저 나오는 것이 표준 분산 모드와 맞는가), 버전 표시, 디자인 일관성(login.html은 gijo-ui.css를 안 쓰고 자체 팔레트·카드 색 rgba(14,20,36)을 쓴다 — 앱 본체 팔레트 #262624·#30302e와 어긋나는지), 로그인 화면의 titlebar 스트립·footbar. 서버 쪽 auth.ts의 응답 메시지가 한글인지, 실패 응답이 원인을 노출하지 않으면서도 담당자에게 쓸모 있는지.`,
    files: 'client/src/renderer/pages/login.html, client/src/api/auth.ts, client/src/api/core.ts, client/src/preload.ts(login·loginMfa·creds·checkServerHealth·getServerUrl 부분을 grep으로 찾아 읽기), client/src/main.ts(creds:* 핸들러·authState), client/src/renderer/pages/titlebar.js(로그인 스트립·authed 분기), client/src/renderer/pages/footbar.js, server/src/auth/auth.ts, server/src/auth/users.ts, server/src/auth/mfaroutes.ts, server/src/app.ts(health·mfa 제한 미들웨어 grep), GIJO_AS_사용자_매뉴얼.md §0.2 로그인, server/src/engine/screenguide.ts(로그인·2차 인증 항목 grep)',
  },
  {
    key: 'F3', label: '셸·첫 화면', area: '셸·첫화면',
    lens: `렌즈: **로그인 직후 첫 5분.** 로그인 성공 뒤 무엇이 보이나(app.html 초기 탭 — 대시보드 자동 열림 여부·빈 화면 문구), 대시보드의 인사·3단계 안내·상태판이 신규 담당자에게 무엇을 하라고 말하는가, 왼쪽 메뉴 IA(① 발견·수집 ~ ⑤ 보고 + 등록부 + AI + 추가 기능 + 설정)가 첫 방문자에게 이해되는가(라벨·아이콘·그룹 접힘), 탭 개념(탭이 곧 경로·고정·닫기)을 배우게 하는 장치, 상단 조작줄(⚙ ▣ 🔍 ← →)·시계·세션 칩(남은 유휴 시간)·업데이트 배지, 대화창(콘솔) 위치와 첫 안내(빈 콘솔이 무엇을 하라고 말하는가), 화면 찾기(Ctrl+K), 창 조작(끌기·최대화·닫기 확인), 세로 모니터·좁은 창 대응, 키보드 접근성, 사용자 영역(아바타·이름·📚·⚙)의 발견 가능성. 특히 「지시는 대화창에서, 보는 일은 화면에서」라는 핵심 개념을 첫 화면이 전달하는가.`,
    files: 'client/src/renderer/pages/app.html, client/src/renderer/pages/titlebar.js, client/src/renderer/pages/footbar.js, client/src/renderer/pages/nav.js, client/src/renderer/pages/console.js(앞 200줄·빈 상태·첫 안내 grep), client/src/renderer/pages/chatwidget.js(앞 120줄), client/src/renderer/pages/dashboard.html, client/src/renderer/pages/workflowrail.js, client/src/renderer/pages/dialog.js(앞 60줄), client/src/main.ts(createMainWindow·mainWindowBounds·bindZoom), GIJO_AS_이렇게_쓰면_됩니다.md, GIJO_AS_사용자_매뉴얼.md §0.3·§1',
  },
  {
    key: 'F4', label: '절차 허브 5단계', area: '절차허브',
    lens: `렌즈: **취약점 한 바퀴(① 발견·수집 → ② 우선순위 → ③ 조치 → ④ 검증 → ⑤ 보고)를 도는 담당자.** 각 허브의 「한눈에 띠」 숫자가 안쪽 화면 숫자와 같은 기준인가(grouppanels.js의 요약 로더 vs 각 화면 API), 판을 눌렀을 때 약속-동작 일치, 허브 안 iframe이 다시 iframe을 여는 3중 겹(셸→허브→화면)에서 생기는 문제(스크롤·높이·포커스·titlebar/footbar 중복·nav 중복·embed 파라미터 전달), 빈 상태 문구가 다음 행동을 말하는가, 정체성 한 줄·ⓘ 유무, 영어·개발자 용어 노출, 날것 오류, 되돌릴 수 없는 동작의 확인, 단계 사이 이동(예: 우선순위에서 조치로 넘어갈 때 맥락 유지), 절차 5단계와 화면 이름의 정합(workflowrail.js). 안쪽 화면(analysis·threat·inventory·vulnscan·approvals·report·kpi·compliance 등 — grouppanels.js에서 실제 매핑을 확인)은 허브 맥락에서만 본다(전수 점검이 아니라 여정 관점).`,
    files: 'client/src/renderer/pages/discover.html, triage.html, fix.html, verify.html, reporting.html, grouphub.js, grouppanels.js, workflowrail.js, nav.js(GROUPS·TAB_REDIRECT), 그리고 grouppanels.js가 여는 안쪽 화면들의 상단(정체성 한 줄·인증 가드·embed 처리 부분) 및 빈 상태 문구(grep "없습니다"), server/src/engine/screenguide.ts(허브 5개 항목 grep)',
  },
  {
    key: 'F5', label: '등록부·AI·설정·기록·부가·별도 창', area: '설정·기록·부가',
    lens: `렌즈: **절차 밖 화면을 처음 여는 담당자.** 등록부(products·maintenance), AI 허브(aihub → agent·memory·learnloop·redteam), 설정(settings.html?s=my/ai/integration/admin — 5구역이 「결정권자」 기준으로 나뉜 것이 담당자에게 읽히는가, 관리자 전용 항목이 담당자에게 어떻게 보이는가), 기록(records → audit·syslog), 추가 기능(loganalysis·lawlookup·intro·handover — lawlookup은 연동이 꺼져 있을 때 무엇을 보여주는가), 별도 창(office·docbox·console — 창을 열었을 때 로그인 상태 공유·닫기·중복 열기), 작업 내역(sessions). 각 화면에서: 정체성 한 줄·ⓘ, 빈 상태, 영어·개발자 용어(step/loss/embedding 등), 날것 오류, 권한 없을 때의 표시(403이 어떻게 보이나), 자유 입력칸이 화면에 있는지(원칙 ⑥), 되돌릴 수 없는 동작 확인, 설정 저장 피드백(저장됐다는 표시). 전수 점검이 아니라 「처음 연 사람이 막히는 곳」 위주.`,
    files: 'client/src/renderer/pages/products.html, maintenance.html, aihub.html, agent.html, memory.html(앞 300줄·빈 상태·용어 grep), learnloop.html, redteam.html, settings.html(구역 구조·저장 피드백·권한 분기 grep), records.html, audit.html, syslog.html, loganalysis.html, lawlookup.html, intro.html, handover.html, office.html(앞 200줄), docbox.html(앞 150줄), console.html, sessions.html(앞 200줄), client/src/main.ts(office:open·docbox:open·console 창 부분), server/src/engine/screenguide.ts(해당 항목)',
  },
  {
    key: 'F6', label: '업데이트·세션·종료', area: '업데이트·세션',
    lens: `렌즈: **쓰던 중에 겪는 시스템 사건.** ① 새 버전: 배지 → 설정 > 업데이트 → 지금 업데이트 → 다운로드 진행률 → 설치 창 → 재기동(main.ts update:install의 실제 동작과 화면 문구·문서 서술이 일치하는가; 실패 시 문구; 다운로드 중 앱을 닫으면; 관리자 전용 구역에 있어 담당자는 어떻게 업데이트하는가 — settings.html?s=admin 접근 권한 확인) ② 세션: access token 만료·refresh 실패 시 화면이 어디로 튕기는가(각 화면의 isAuthenticated 가드 → login.html) — 작성 중 내용 유실·안내, 세션 칩의 남은 시간·연장, 서버 재시작(운영은 재시작 시 전 사용자 세션이 끊긴다)·네트워크 끊김 시 담당자가 보는 것(WebSocket 재연결·오류 문구) ③ 중복 로그인으로 밀려났을 때 원래 세션이 보는 것 ④ 앱 닫기 확인·두 번 실행·종료 시 로그아웃 ⑤ 비밀번호 변경 후 흐름(실사용 UX피드백 5절 「셀프 잠김」이 지금도 그런가).`,
    files: 'client/src/renderer/pages/settings.html(업데이트 구역 370~400줄·1895~1970줄·비밀번호 변경 부분 grep), client/src/main.ts(update:*·downloadToFile·close·second-instance·logoutOnQuit·before-quit), client/src/api/core.ts(request·tryRefresh·requestStream), client/src/wsClient.ts, client/src/renderer/pages/titlebar.js(세션 칩·gtb-sess·연장 grep), client/src/renderer/pages/app.html(인증 가드·세션 만료 처리 grep), server/src/auth/auth.ts(세션·refresh·유휴 만료·terminate), server/src/engine/clientrelease.ts, client/scripts/manual-update.ps1, GIJO_AS_클라이언트_배포_가이드.md §6, GIJO_AS_실사용_UX피드백.md 5절',
  },
  {
    key: 'F7', label: '문서↔코드 대조', area: '문서',
    lens: `렌즈: **설치·로그인·첫 화면·업데이트에 대한 문서 서술이 5.83.0 실제와 맞는가.** 코드가 진실이다. 특히 (1) 고객사에 나가는 문서(server/docs-manifest.json의 files 목록 — 챗봇 RAG 근거가 된다)에 낡은 서술이 있으면 챗봇이 틀린 안내를 하므로 P0/P1로 (2) 내부 문서(클라이언트 배포 가이드 v2.5.0·설치 가이드 v2.1.0·client/README.md·README.md)의 낡은 서술은 P1/P2로. 대조 항목 예: 버전 표기, 설치 경로(%LOCALAPPDATA%\\Programs\\gijo-as vs gijo-as-client), oneClick 여부(manual-update.ps1 주석 vs package.json), 우상단 「● 운영중 LIVE」 배지(2026-08-08에 없앴다는 주석이 app.html에 있다), 대시보드 구성 설명(파일 탐색기·내 업무·AI 팀 — 지금 대시보드와 맞는가), 메뉴 이름(「내 업무」 삭제·「작업 내역」 등), 업데이트 메뉴 위치(설정 → 업데이트가 admin 구역), 기본 계정 jyh/changeme 서술, 서버 주소 환경변수, 로그인 절차(MFA·중복 로그인), 화면·메뉴 지도(사용자 매뉴얼 §8). screenguide.ts의 설정·업데이트·2차 인증 항목도 코드와 대조. 어긋난 곳마다 문서 파일:줄과 코드 파일:줄을 둘 다 인용한다. ⚠ 이 저장소 규칙: 문서 갱신은 요청받을 때만 한다 — 그래서 여기서는 고치지 말고 「어디가 어긋났고 고객에게 나가는 문서인가」만 정확히 보고한다.`,
    files: 'server/docs-manifest.json, GIJO_AS_사용자_매뉴얼.md(§0·§1·§5·§7·§8), GIJO_AS_이렇게_쓰면_됩니다.md, GIJO_AS_보안담당자_실무매뉴얼.md(로그인·설치 언급 grep), GIJO_AS_제품소개.md(설치·로그인 언급 grep), GIJO_AS_클라이언트_배포_가이드.md, GIJO_AS_설치_가이드_v2.1.0.md, GIJO_AS_배포_가이드.md §4, client/README.md, README.md, server/src/engine/screenguide.ts(설정·업데이트·2차 인증·계정 항목), 대조 대상 코드: client/package.json, client/src/main.ts, client/src/renderer/pages/login.html, app.html, nav.js, titlebar.js, dashboard.html, settings.html, client/scripts/manual-update.ps1, server/src/auth/users.ts',
  },
  {
    key: 'F8', label: '페르소나 워크스루', area: '여정전반',
    lens: `렌즈: **정적 감사가 아니라 두 사람의 하루를 코드로 따라간다.** 페르소나 A「김대리」= 보안팀에 온 지 2주, 헬프데스크에서 설치본 exe·서버 주소 메모(http://10.20.30.40:4000)·초기 비밀번호를 받았다. 관리자가 2차 인증 필수 정책을 켜 둔 상태일 수도 있다. 페르소나 B「박주임」= 헬프데스크, PC 10대에 설치·업그레이드하고 첫 로그인까지 도와줘야 한다. 각 페르소나로 ① 설치본 실행 ② 첫 실행 ③ 로그인 ④ 첫 화면 ⑤ 첫 업무(김대리: 「오늘 뭐부터 볼까?」를 대화창에 치고 ② 우선순위 화면을 연다 / 박주임: 10대 배포·GIJO_SERVER_URL 고정·업데이트 일괄) ⑥ 문제 발생(서버 주소 오타·비밀번호 오류 5회·서버 꺼짐·창을 잘못 닫음)까지 **단계마다** 「지금 화면에 무엇이 보이고, 무엇을 눌러야 하고, 무엇을 모르면 막히는가」를 코드(HTML 문구·main.ts 동작·서버 응답)로 확인해 적는다. 막히는 곳·헤매는 곳·문서를 찾아야 하는 곳·헬프데스크에 전화하게 되는 곳을 finding으로 낸다. 잘 흘러가는 구간은 notes의 강점에 적는다.`,
    files: 'client/build/installer.nsh, client/package.json, client/src/main.ts, client/src/renderer/pages/login.html, app.html, nav.js, titlebar.js, console.js(앞 200줄), dashboard.html, triage.html, grouppanels.js, settings.html(업데이트·비밀번호·계정 구역 grep), client/src/api/auth.ts, client/src/api/core.ts, server/src/auth/auth.ts, server/src/auth/users.ts, server/src/auth/mfaroutes.ts, server/src/app.ts(enrollRequired 제한 grep), client/scripts/manual-update.ps1, GIJO_AS_클라이언트_배포_가이드.md',
  },
]

function finderPrompt(f) {
  return CTX + `
[이번 갈래] ${f.key} ${f.label} — area 값은 "${f.area}"로 고정한다. finding id는 "${f.key}-01"부터.
${f.lens}
[먼저 읽을 파일] ${f.files}
[방법] Bash(cat -n·grep -n·sed -n)·Read·Grep으로 실제 파일을 읽는다. 문구·동작은 인용으로 증명한다. 다른 갈래가 볼 영역은 깊이 파지 말고 이 렌즈에 집중한다. 마지막에 StructuredOutput으로 findings·notes·scope_read를 낸다.`
}

function verifyPrompt(f, found) {
  return CTXShort() + `
[역할] 반박 검증관. 아래는 「${f.key} ${f.label}」 점검자가 낸 finding 목록이다. **각 finding마다 인용된 파일·줄을 직접 다시 읽고** 다음을 판정한다:
 (1) evidence_ok — 인용이 실제 코드·문서와 맞는가(줄 번호 오차 ±5는 허용, 내용이 다르면 false).
 (2) intended_design — 그 상태가 주석·문서에 「사용자 결정/지시(날짜)」로 기록된 의도된 설계인가. 의도된 설계인데 finding이 그 사실을 모른 채 뒤집자고 하면 refuted=true. 알고도 더 강한 근거를 대면 살린다.
 (3) 사용자 영향이 실제인가 — 다른 코드(예: app.html·titlebar.js·서버 미들웨어)가 이미 그 문제를 처리하고 있으면 refuted=true. 이미 고쳐진 것(2026-08-01 상황점검 4건 등)도 refuted.
 (4) 중복 — 같은 목록 안에서 같은 문제를 두 번 냈으면 뒤의 것에 duplicate_of를 적고 refuted=true.
 (5) severity 재판정 — 기준: P0 담당자가 막히거나 잘못 판단 / P1 자주 겪는 불편·신뢰 훼손·원칙 위반 / P2 다듬기. 과장·축소를 바로잡는다.
 확신이 없으면 refuted=true가 기본이다(보고서에 틀린 지적이 실리는 것이 빠진 것보다 나쁘다). reason은 한국어로 한두 문장, 근거 파일:줄 포함. corrected_proposal은 제안이 틀렸거나 더 나은 길이 있을 때만 적는다(없으면 빈 문자열).
[finding 목록(JSON)]
${JSON.stringify(found.findings, null, 1)}`
}

function CTXShort() {
  return `[제품] GIJO AS — 온프렘 AI 보안관리 플랫폼. Electron 클라이언트(client/) + Node/TS 서버(server/). 저장소 ${ROOT}, 읽기 전용(파일 수정 금지, ${RUN_NOTE}). 클라 5.83.0, 오늘 2026-09-02. app.html = 탭 셸(각 화면 ?embed=1 iframe), nav.js 사이드바, titlebar.js 상단·세션·업데이트 배지, gijo-ui.css 토큰. 제품 원칙: 한글 텍스트 / 화면엔 정체성 한 줄+⚠만(설명은 챗봇 screenguide+ⓘ) / 정직한 구현 / 오프라인 / 다크 팔레트 / 지시는 대화창·변경은 결재판 / 죽은 조작·막막한 빈 화면·날것 오류 금지. 코드 주석의 「사용자 결정/지시(날짜)」는 의도된 설계다.
`
}

// ── 점검 → 검증 (갈래마다 독립 파이프라인: 끝난 갈래부터 바로 검증) ─────────────
phase('점검')
const perFinder = await pipeline(
  FINDERS,
  f => agent(finderPrompt(f), { label: `점검:${f.key} ${f.label}`, phase: '점검', schema: FINDINGS_SCHEMA, effort: 'high' }),
  async (found, f) => {
    if (!found || !found.findings || !found.findings.length) return { f, found, verdicts: [] }
    const v = await agent(verifyPrompt(f, found), { label: `검증:${f.key} ${f.label}`, phase: '검증', schema: VERDICTS_SCHEMA, effort: 'high' })
    return { f, found, verdicts: (v && v.verdicts) || [] }
  },
)

function merge(results) {
  const confirmed = [], rejected = [], notes = [], scope = []
  for (const r of results.filter(Boolean)) {
    if (!r.found) { notes.push(`[${r.f.key}] 점검 결과 없음(에이전트 실패 또는 건너뜀)`); continue }
    notes.push(`[${r.f.key} ${r.f.label}] ${r.found.notes || ''}`)
    scope.push(...(r.found.scope_read || []))
    const byId = new Map(r.verdicts.map(v => [v.id, v]))
    for (const fd of r.found.findings || []) {
      const v = byId.get(fd.id)
      if (!v) { rejected.push({ ...fd, reject_reason: '검증 결과 없음(미판정은 싣지 않는다)' }); continue }
      if (v.refuted) { rejected.push({ ...fd, reject_reason: v.reason, duplicate_of: v.duplicate_of }); continue }
      confirmed.push({ ...fd, severity: v.severity || fd.severity, verify_reason: v.reason, corrected_proposal: v.corrected_proposal || '' })
    }
  }
  return { confirmed, rejected, notes, scope }
}

let merged = merge(perFinder)
log(`1차: 확정 ${merged.confirmed.length} · 기각 ${merged.rejected.length} (갈래 ${perFinder.filter(Boolean).length}/${FINDERS.length})`)

// ── 누락 점검: 무엇을 안 봤나 → 보충 점검·검증 ───────────────────────────────
phase('누락')
const critic = await agent(CTXShort() + `
[역할] 완결성 비평가. 아래는 설치→로그인→첫 화면→업무 화면→업데이트·세션 여정을 8갈래(설치·로그인·셸·절차허브·설정등·업데이트세션·문서대조·페르소나)로 점검해 **검증을 통과한 finding 목록**과 각 갈래가 실제로 읽은 파일 목록이다. 질문은 하나다 — **사용자 관점 여정에서 아직 안 본 곳, 또는 얕게 본 곳은 어디인가?** 예: 읽지 않은 화면 파일, 전혀 안 다룬 상황(권한 없는 담당자·세로 모니터·느린 서버·한글 IME·고DPI 배율·단독 모드에서 모델 없음·mac 클라이언트), 서버 응답 메시지의 한글·유용성, 챗봇 첫 대화 경험 등. 저장소를 직접 grep/ls해 「있는데 안 읽은 파일」을 확인하고, 가장 값진 보충 점검 최대 3개를 고른다. 각 gap의 prompt는 보충 점검 에이전트에게 그대로 줄 **완전한 지시문**(렌즈·읽을 파일 절대경로 목록·무엇을 finding으로 낼지)이어야 한다. 이미 확정된 finding을 다시 찾게 하지 말 것.
[확정 finding 요약] ${JSON.stringify(merged.confirmed.map(c => ({ id: c.id, area: c.area, sev: c.severity, title: c.title })))}
[읽은 파일] ${JSON.stringify(Array.from(new Set(merged.scope)))}
[갈래별 notes] ${merged.notes.join('\n')}`, { label: '누락 점검', phase: '누락', schema: CRITIC_SCHEMA, effort: 'high' })

const gaps = (critic && critic.gaps) || []
log(`누락 보충 ${gaps.length}건: ${gaps.map(g => g.title).join(' / ')}`)
const GAP_FINDERS = gaps.map((g, i) => ({ key: `G${i + 1}`, label: g.title, area: '여정전반', prompt: g.prompt }))
const perGap = await pipeline(
  GAP_FINDERS,
  g => agent(CTX + `
[이번 갈래] ${g.key} ${g.label} — area 값은 상황에 맞는 것을 고르되 애매하면 "여정전반". finding id는 "${g.key}-01"부터.
${g.prompt}
[방법] 실제 파일을 읽고 인용으로 증명한다. 마지막에 StructuredOutput으로 findings·notes·scope_read를 낸다.`, { label: `보충:${g.key} ${g.label}`, phase: '누락', schema: FINDINGS_SCHEMA, effort: 'high' }),
  async (found, g) => {
    if (!found || !found.findings || !found.findings.length) return { f: g, found, verdicts: [] }
    const v = await agent(verifyPrompt(g, found), { label: `보충검증:${g.key}`, phase: '누락', schema: VERDICTS_SCHEMA, effort: 'high' })
    return { f: g, found, verdicts: (v && v.verdicts) || [] }
  },
)
const merged2 = merge(perGap)
merged = {
  confirmed: merged.confirmed.concat(merged2.confirmed),
  rejected: merged.rejected.concat(merged2.rejected),
  notes: merged.notes.concat(merged2.notes),
  scope: merged.scope.concat(merged2.scope),
}
log(`최종: 확정 ${merged.confirmed.length} · 기각 ${merged.rejected.length}`)

// ── 종합: 변경안 묶기 ───────────────────────────────────────────────────────
phase('종합')
const synth = await agent(CTXShort() + `
[역할] 변경안 편집자. 아래 **검증 통과 finding**들을 담당자 관점 여정(설치→로그인→첫 화면→업무 화면→업데이트·세션)에 따라 **변경안(proposal)**으로 묶는다. 규칙:
 · 같은 원인·같은 화면의 finding은 하나의 변경안으로 묶고 finding_ids에 전부 적는다. 서로 다른 화면이라도 「한 번에 고치는 것이 맞는 것」(예: 오류 문구 통일)은 묶는다.
 · priority는 묶인 finding 중 가장 높은 것. plan_item은 GIJO_AS_시장경쟁력_전중후_계획서.md(${ROOT})를 읽고 전-N/중-N/후-N 중 가장 맞는 것을 고른다 — 첫인상·문구·화면은 대개 전-7(보여 주기), 시연 자료는 전-1, 파일럿 실사용 불편은 중-1, GA 관문(설치·운영 안정)은 후-1, 문서 낡음은 전-6(정직 경계)·후-1 — 판단 근거를 problem 끝에 한 구절로. 어디에도 안 맞으면 "신규(계획서 반영 필요)".
 · change는 구현자가 바로 착수할 수 있게 파일·문구·동작 수준으로. verify는 「무엇으로 확인하나」(실화면 절차·기존 시험 파일·문서 대조). needs_mockup은 화면 모양이 바뀌면 true(이 저장소는 시안 승인이 먼저다). risk는 포기하는 것·깨질 수 있는 것.
 · journey_summary는 여정을 담당자 눈으로 5~8문장(잘 되는 것과 막히는 것 둘 다). strengths는 finding 갈래들이 notes에 적은 강점을 3~5개로. top5는 「지금 당장 고칠 5개」를 한 줄씩(변경안 key 포함). questions_for_user는 사용자 결정이 필요한 것(예: 비밀번호 저장 기본값·로그인 화면 재디자인 여부·문서 갱신 착수 여부).
 · 전부 한국어. 어려운 용어에는 괄호로 쉬운 풀이.
[확정 finding(JSON)]
${JSON.stringify(merged.confirmed, null, 1)}
[갈래별 notes(강점·사소한 것)]
${merged.notes.join('\n')}`, { label: '변경안 종합', phase: '종합', schema: SYNTH_SCHEMA, effort: 'high' })

return {
  synth,
  confirmed: merged.confirmed,
  rejected: merged.rejected.map(r => ({ id: r.id, title: r.title, reason: r.reject_reason, duplicate_of: r.duplicate_of || '' })),
  notes: merged.notes,
  gaps: gaps.map(g => g.title),
  coverage_note: critic && critic.coverage_note,
}
