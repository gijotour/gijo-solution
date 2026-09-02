// 문서통합.js — 2026-09-01 클라우드 세션(as-private-41)에서 만든 워크플로. 로컬에서 그대로 쓴다:
//   Workflow({ name: "문서통합", args: { root: "<저장소 절대경로>", canRun: true } })
//   root 미지정 시 /home/user/AS-Private(클라우드 컨테이너 경로). canRun=true면 에이전트에게
//   "node_modules가 있어 실행 검증도 가능"이라고 알린다(클라우드에서는 미설치라 읽기 검증만 했다).
export const meta = {
  name: 'docs-consolidation',
  description: '저장소의 md 문서 전부(루트 143개)를 주제별로 통독해 본문에 적힌 날짜로 연대기를 세우고, 주제별 현행 상태·문서 지도·병합 계획으로 통합한다',
  phases: [
    { title: '통독', detail: '주제별 17갈래 — 문서마다 날짜·목적·상태·겹침·모순 추출' },
    { title: '통합', detail: '연대기 · 문서 지도/병합 계획 · 주제별 현행 상태 통합본' },
    { title: '대조', detail: '통합본의 주장을 원문과 대조 — 근거 없는 문장 제거' },
  ],
}

const ROOT = (typeof args === 'object' && args && args.root) || '/home/user/AS-Private'
const CAN_RUN = !!(typeof args === 'object' && args && args.canRun)
const RUN_NOTE = CAN_RUN ? '이 머신에는 node_modules가 있어 읽기 검증에 더해 실행 검증(npm test·node 스크립트)도 가능하다 — 단 운영 서버(4000)·CDP(9223)·로그인 세션은 건드리지 않는다.' : 'node_modules가 없으면 빌드·테스트·서버 실행은 불가 — 읽어서 판단한다.'
const CTX = `
[제품] GIJO AS — 한국형 온프렘 AI 보안관리 플랫폼(Electron 클라이언트 + Node/TS 서버 + 로컬 LLM). 저장소 ${ROOT}. **읽기 전용** — 파일 수정 금지. 오늘 2026-09-02. 코드 기준 클라 5.83.0, hub/main 마지막 커밋 2026-09-01(29919788).
[왜 이 일을 하나] 사용자 요청: "md 파일들 날짜별로 다 읽고 통합도 해줬으면". 문서가 루트 md 143개로 늘어 서로 겹치고 낡은 서술이 섞였다. 2026-08-09 이전 문서의 git 첫 커밋 날짜는 전부 2026-08-09(일괄 반입)라 쓸모없고, 그 뒤 문서는 커밋 날짜가 참고가 된다(파일명 날짜가 있으면 그것이 우선) — **문서 본문에 적힌 날짜**(제목·머리말의 "확정 2026-07-25", "v2.1.0", "2026-08-04 신설", 표의 날짜 등)로 시점을 잡는다. 날짜가 없으면 "날짜 없음"이라고 적고 내용상 추정 근거(언급된 버전·기능·사고)를 한 구절 남긴다.
[판단 기준] 코드가 진실이다 — 문서가 코드(client/src·server/src)와 어긋나면 어긋난다고 적는다(고칠지는 사용자 몫). 고객에게 나가는 문서(server/docs-manifest.json의 files 목록 — 챗봇 RAG 근거)와 내부 개발 문서를 구분한다. CLAUDE.md의 확립 규칙(전·중·후 계획서 기준, 한글, 시안 1개, 정직한 구현, 문서 갱신은 요청 시만 등)은 사용자가 정한 것이라 "낡았다"고 판단하지 않는다.
[문서 위치 — 2026-09-02] 루트에 있던 역사·내부 문서 100개를 「_archive/」 아래로 옮겼다(git mv, 내용은 그대로). 아래에 적힌 파일이 루트에 없으면 **_archive/<파일명>** 을 보라. 없다고 단정하지 말 것.
[출력 규칙] 전부 한국어. 요약은 짧고 검증 가능하게 — 문서에서 뽑은 문장은 파일:줄을 남긴다. 추측으로 채우지 않는다. 읽지 못한 파일은 못 읽었다고 적는다.
`

const DOC_SCHEMA = {
  type: 'object',
  required: ['docs', 'batch_note'],
  properties: {
    docs: {
      type: 'array',
      items: {
        type: 'object',
        required: ['file', 'lines', 'dates', 'anchor_date', 'purpose', 'audience', 'customer_facing', 'status', 'status_reason', 'key_points', 'decisions', 'overlaps', 'contradictions', 'merge_into'],
        properties: {
          file: { type: 'string' },
          lines: { type: 'integer' },
          dates: { type: 'array', items: { type: 'string' }, description: '본문에 적힌 날짜 전부(YYYY-MM-DD, 발견한 순서) — 어디에 적혔는지 괄호로' },
          anchor_date: { type: 'string', description: '이 문서의 기준 시점 하나(YYYY-MM-DD). 없으면 "날짜 없음(추정: ...)"' },
          purpose: { type: 'string', description: '한 줄 — 무엇을 위해 쓴 문서인가' },
          audience: { type: 'string', enum: ['고객·담당자', '영업·경영', '개발자·운영자', '사용자(사장님)·Claude 작업 규칙', '혼합'] },
          customer_facing: { type: 'boolean', description: 'server/docs-manifest.json에 실려 고객사에 나가는가' },
          status: { type: 'string', enum: ['현행', '부분 낡음', '낡음', '역사 기록(유지)', '폐기 후보', '중복'] },
          status_reason: { type: 'string', description: '왜 그렇게 판단했나 — 코드·다른 문서와 대조한 근거(파일:줄)' },
          key_points: { type: 'array', items: { type: 'string' }, description: '통합본에 살아남아야 할 핵심 내용 3~8줄(각 줄 끝에 원문 줄 번호)' },
          decisions: { type: 'array', items: { type: 'object', required: ['date', 'decision', 'line'], properties: { date: { type: 'string' }, decision: { type: 'string' }, line: { type: 'integer' } } }, description: '날짜가 붙은 결정·사고·전환점 — 연대기 재료' },
          overlaps: { type: 'array', items: { type: 'string' }, description: '같은 내용을 다루는 다른 문서(파일명) + 무엇이 겹치나' },
          contradictions: { type: 'array', items: { type: 'string' }, description: '다른 문서·코드와 어긋나는 서술 — "이 문서 X줄 vs 저 문서/코드 Y줄: 무엇이 다른가"' },
          merge_into: { type: 'string', description: '통합 시 어느 묶음(대표 문서)으로 합치는 것이 맞나 — 유지해야 하면 "단독 유지"와 이유' },
        },
      },
    },
    batch_note: { type: 'string', description: '이 묶음 전체에서 보이는 것 — 반복되는 주제·가장 낡은 문서·가장 중요한 문서·못 읽은 것' },
  },
}

const BATCHES = [
  { key: 'D1', label: '제품·영업', files: ['GIJO_AS_제품소개.md', 'GIJO_AS_제품소개서.md', 'GIJO_AS_제품소개_시장경쟁분석.md', 'GIJO_AS_제품_라인업_판매가이드.md', 'GIJO_AS_파일럿_제안_1장.md', 'GIJO_AS_파일럿_첫날_키트.md', 'GIJO_AS_시연_패키지.md', 'GIJO_AS_시연_BYOM_두뇌교체.md', 'GIJO_AS_경쟁동향_2026-07.md', 'GIJO_AS_우리AI_구성_안내.md'] },
  { key: 'D2', label: '계획·전략 (계획서·감사·GA·해자·N2SF)', files: ['GIJO_AS_시장경쟁력_전중후_계획서.md', 'GIJO_AS_계획서_완주감사.md', 'GIJO_AS_다음단계_가이드.md', 'GIJO_AS_고객의견_반영계획_2026-08.md', 'GIJO_AS_GA_판정표.md', 'GIJO_AS_해자_축적자산_설계.md', 'GIJO_AS_N2SF_대응.md', 'GIJO_AS_오픈소스기반_업그레이드방안_ver1.md'] },
  { key: 'D3', label: '계획·설계 (지식번들·에이전트·조치검증·문서함)', files: ['GIJO_AS_지식번들_구독화_설계안.md', 'GIJO_AS_지식번들_구독_결정자료.md', 'GIJO_AS_지식번들_법무검토요청.md', 'GIJO_AS_에이전트_자동화_계획서.md', 'GIJO_AS_AI에이전트_대시보드_계획서.md', 'GIJO_AS_조치검증_계획서.md', 'GIJO_AS_문서함_계획안.md', 'GIJO_AS_IA_통합설계.md'] },
  { key: 'D4', label: '사용자 문서 (매뉴얼·지침·가이드)', files: ['GIJO_AS_사용자_매뉴얼.md', 'GIJO_AS_이렇게_쓰면_됩니다.md', 'GIJO_AS_보안담당자_실무매뉴얼.md', 'GIJO_AS_보안담당자_활용가이드.md', 'GIJO_AS_보안담당자_온보딩_체크리스트.md', 'GIJO_AS_인수인계_가이드.md', 'GIJO_AS_챗봇_명령_시나리오.md', 'GIJO_AS_화면구성_가이드.md', 'GIJO_AS_취약점관리_지침.md', 'GIJO_AS_보안제품관리_지침.md', 'GIJO_AS_AIBOM_검토_가이드.md'] },
  { key: 'D5', label: '설치·배포·머신 환경', files: ['GIJO_AS_설치_가이드_v2.1.0.md', 'GIJO_AS_클라이언트_배포_가이드.md', 'GIJO_AS_배포_가이드.md', 'GIJO_AS_PC세팅_체크리스트.md', 'GIJO_AS_WSL2_서버이전_계획서.md', 'GIJO_AS_3머신_개발환경_가이드.md', 'GIJO_AS_MAC_올인원_배포_가이드.md', 'GIJO_AS_MAC_M4_24GB_구성안.md', 'GIJO_AS_MAC_QA_계획.md'] },
  { key: 'D6', label: '개발 규칙·협업·온보딩', files: ['CLAUDE.md', 'README.md', 'client/README.md', 'GIJO_AS_버전관리_기준.md', 'GIJO_AS_공동작업_가이드.md', 'GIJO_AS_개발환경_가이드라인.md', 'GIJO_AS_개발환경_테스트_매뉴얼.md', 'GIJO_AS_개발자_온보딩_가이드.md', 'GIJO_AS_디자인·코드검토_안내.md', 'GIJO_AS_아키텍처_개요.md'] },
  { key: 'D7', label: 'AI·LLM·RAG 기반', files: ['로컬LLM_프로젝트_가이드.md', 'GIJO_AS_RAG_구성_가이드.md', 'GIJO_AS_RAG_아키텍처_LLM연동.md', 'GIJO_AS_gijo_LLM_강화_가이드.md', 'GIJO_AS_모델_선택_가이드.md', 'GIJO_AS_번들_LLM_후보.md', 'GIJO_AS_LLM_합성_안내.md', 'GIJO_AS_VRAM_티어_구동_가이드라인.md'] },
  { key: 'D8', label: 'AI 동작 규범·온톨로지·라우팅', files: ['GIJO_AS_온톨로지_강화_가이드.md', 'GIJO_AS_학습환경_분리_설계.md', 'GIJO_AS_디스패치_사전라우팅_가이드.md', 'GIJO_AS_챗봇_라우팅_정확도_리포트.md', 'GIJO_AS_대화창_말투규범.md', 'GIJO_AS_등급라벨_설계.md'] },
  { key: 'D9', label: '점검·QA·기록', files: ['GIJO_AS_QA_품질점검_보고서_2026-07-25.md', 'GIJO_AS_사용자_상황점검_2026-08.md', 'GIJO_AS_하루실전_점검_2026-08-01.md', 'GIJO_AS_실사용_UX피드백.md', 'GIJO_AS_제품_확인_v1.md', 'GIJO_AS_시험지도.md', 'GIJO_AS_세션_산출물_정리.md', '오늘업무_2026-07-13'] },
  { key: 'D10', label: '용어사전', files: ['GIJO_AS_용어사전.md'] },
  // ── 2026-09-02 추가: 08-09 이후 늘어난 문서 66개(루트 md 143개 기준) ──
  { key: 'D11', label: '라이트 에디션·3에디션 구성', files: ['GIJO_AS_Lite_계획서_2026-08-12.md', 'GIJO_AS_Lite_작업경계_2026-08-12.md', 'GIJO_AS_Lite_설치안내서_2026-08-13.md', 'GIJO_AS_라이트_사양_2026-08-10.md', 'GIJO_AS_라이트_모델후보_실측_2026-08-13.md', 'GIJO_AS_라이트_스모크_2026-08-13.md', 'GIJO_AS_라이트_출하_결정서_2026-08-13.md', 'GIJO_AS_라이트_올인원_배포_계획.md', 'GIJO_AS_제품_기능등급_가이드_2026-08-13.md', 'GIJO_AS_에디션_버전·기능_계획_2026-08-20.md', '고민_BridgeAI_SmartMD_전제품_선택연동_2026-08-13.md'] },
  { key: 'D12', label: '기계 환경 추가 — GB10·원격 GPU·하이브리드·인계 대기', files: ['GIJO_AS_GB10_VPN_자산점검_구성안.md', 'GIJO_AS_원격GPU_사용안내.md', 'GIJO_AS_하이브리드LLM_비용최적화_설계서.md', 'GIJO_AS_고객기계_실행환경_결정안_2026-08-10.md', 'GIJO_AS_폰으로_원격작업_가이드.md', 'GIJO_AS_MAC_인계_대기.md', 'GIJO_AS_모델_메모리_실측_2026-08-10.md'] },
  { key: 'D13', label: '설계·계획 추가 — 셸 재구축·3소스 상관·지식그래프·AI보안점검', files: ['GIJO_AS_셸재구축_계획서.md', 'GIJO_AS_3소스상관_설계안_2026-08-10.md', 'GIJO_AS_지식그래프_LLM위키_도입계획.md', 'GIJO_AS_AI보안점검_항목표_초안.md', 'GIJO_AS_RAG_오염_실측_2026-08-10.md', 'GIJO_AS_RAG_오염_해결_계획.md', 'GIJO_AS_문체_AI스러움_실측_2026-08-10.md', '프로셸_외부사례조사_2026-08-19.md', '점검보고_목적정렬_설계_사업성_2026-08-19.md'] },
  { key: 'D14', label: '제품·영업 추가 + 고객 문서 목록', files: ['GIJO_AS_제안자료.md', 'GIJO_AS_고객문서_정리목록.md', 'GIJO_AS_2026-08-10_하루정리.md', 'GIJO_AS_교차QA_방안.md'] },
  { key: 'D15', label: 'QA·점검 기록 2026-08-17~20', files: ['GIJO_AS_대화창중심_전수조사_2026-08-17.md', 'GIJO_AS_사용자QA_첫인상_2026-08-17.md', 'GIJO_AS_사용자행동_외부검증_2026-08-20.md', 'QA_3에디션_진행상태_2026-08-19.md', 'QA결과_라이트_2026-08-19.md', 'QA결과_표준_2026-08-19.md', 'QA결과_프로_2026-08-19.md', 'QA보고서_3에디션_2026-08-19.md', '목록밀도_실측견적_2026-08-19.md', '프로셸_사용자테스트_기록_2026-08-19.md', 'GIJO_AS_클라이언트_여정_점검_변경안_2026-09-01.md'] },
  { key: 'D16', label: '대화 시나리오 대장·실측(큰 파일 3개)', files: ['GIJO_AS_대화시나리오_대장_2026-08-19.md', 'GIJO_AS_시나리오_실측보고서_2026-08-19.md', 'GIJO_AS_시나리오_재실측_5.34_2026-08-19.md'] },
  { key: 'D17', label: '인계 기록 win↔max 2026-08-13~20', files: ['인수인계_win이관_max검증_2026-08-13.md', '인계_win_라이트미결_한장_2026-08-13.md', '인계_win_라이트앱이_본서버를_띄운다_2026-08-13.md', '인계_win_모델교체후_긴프롬프트실패_2026-08-13.md', '인계_win_법령조문_본문누락_2026-08-13.md', '인계_win_에디션포트_라이트모드옵션_2026-08-13.md', '인계_win_원격LLM_런타임설정_BridgeAI_2026-08-13.md', '인계_win_출하모델_라우팅손실_2026-08-13.md', '인계_max_라이트_메뉴재편_설계_2026-08-16.md', '인계_max_라이트_실데이터검증_2026-08-16.md', '인계_max_win_결함재현_1과2_2026-08-17.md', '인계_max_win_라이트재편_구현착수_2026-08-17.md', '인계_win_max_검증_재편⑤⑨_RAG랭킹_2026-08-17.md', '인계_win_max_표준검증_결함재현_2026-08-17.md', '인계_win_max_조합가드_보는목록배관_2026-08-18.md', '인계_max_win_LoRA어댑터착수_2026-08-19.md', '인계_max_win_datacard_라이트문구_2026-08-19.md', '인계_max_win_라이트1.1.11_키체인_통합제품_2026-08-19.md', '인계_max_win_로그인배지_타이밍_2026-08-20.md', '인계_max_win_연초록_실기검증_2026-08-20.md', '인계_max_win_연초록_완결_2026-08-20.md'] },
]
const TOTAL = BATCHES.reduce((n, b) => n + b.files.length, 0)

function readerPrompt(b) {
  return CTX + `
[이번 묶음] ${b.key} ${b.label} — 아래 파일을 **전부, 끝까지** 읽는다(긴 파일은 sed -n으로 나눠 읽되 빠뜨리지 말 것). 경로는 ${ROOT}/ 아래.
${b.files.map(f => ' · ' + f).join('\n')}
[함께 볼 것] server/docs-manifest.json(고객 문서 여부), 필요한 곳만 코드(client/package.json 버전, client/src/renderer/pages/nav.js 메뉴, server/src/engine/localengine.ts 티어 등)를 grep해 "현행/낡음" 판정 근거를 댄다. 다른 묶음의 문서와 겹치는지도 파일명 grep(제목 키워드)으로 확인해 overlaps에 적는다.
[특히] 용어사전 묶음이면: 날짜 붙은 절(## … (2026-08-0N 신설) 등)을 결정 연대기 재료로 전부 뽑고, 본문 절(1~6)은 "현행"으로 두되 코드와 어긋난 용어 정의만 골라낸다.
[마지막] StructuredOutput으로 docs·batch_note를 낸다.`
}

phase('통독')
const batches = await parallel(BATCHES.map(b => () => agent(readerPrompt(b), { label: `통독:${b.key} ${b.label}`, phase: '통독', schema: DOC_SCHEMA, effort: 'high' })))
const docs = []
const batchNotes = []
batches.forEach((r, i) => {
  if (!r) { batchNotes.push(`[${BATCHES[i].key}] 통독 실패(에이전트 결과 없음) — 파일: ${BATCHES[i].files.join(', ')}`); return }
  docs.push(...(r.docs || []))
  batchNotes.push(`[${BATCHES[i].key} ${BATCHES[i].label}] ${r.batch_note || ''}`)
})
log(`통독 완료: 문서 ${docs.length}/${TOTAL} · 묶음 ${batches.filter(Boolean).length}/${BATCHES.length}`)

// ── 통합 ────────────────────────────────────────────────────────────────────
phase('통합')
const DIGEST = JSON.stringify(docs, null, 1)
const NOTES = batchNotes.join('\n')

const TIMELINE_SCHEMA = {
  type: 'object',
  required: ['timeline_md', 'eras', 'undated'],
  properties: {
    timeline_md: { type: 'string', description: '마크다운 — 날짜순 연대기. 각 줄: `YYYY-MM-DD — 결정/사고/전환 (출처 파일:줄)`. 같은 날 여러 건은 묶는다. 2026-07 초부터 2026-09-02까지. 앞에 "시대 구분" 3~5개를 소제목으로.' },
    eras: { type: 'array', items: { type: 'object', required: ['name', 'from', 'to', 'summary'], properties: { name: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' }, summary: { type: 'string' } } } },
    undated: { type: 'array', items: { type: 'string' }, description: '날짜를 못 잡은 문서와 추정 근거' },
  },
}
const MAP_SCHEMA = {
  type: 'object',
  required: ['targets', 'doc_map', 'contradictions', 'customer_docs_note', 'plan_md'],
  properties: {
    targets: { type: 'array', items: { type: 'object', required: ['name', 'purpose', 'sources', 'audience'], properties: { name: { type: 'string', description: '통합 후 남을 대표 문서 이름(파일명 제안)' }, purpose: { type: 'string' }, sources: { type: 'array', items: { type: 'string' } }, audience: { type: 'string' } } }, description: '통합 뒤 남을 대표 문서 6~10개' },
    doc_map: { type: 'array', items: { type: 'object', required: ['file', 'anchor_date', 'status', 'fate', 'target', 'why'], properties: { file: { type: 'string' }, anchor_date: { type: 'string' }, status: { type: 'string' }, fate: { type: 'string', enum: ['유지', '병합', '역사 기록으로 이동', '폐기 후보'] }, target: { type: 'string' }, why: { type: 'string' } } }, description: '전부 한 줄씩(143개)' },
    contradictions: { type: 'array', items: { type: 'object', required: ['topic', 'a', 'b', 'truth', 'action'], properties: { topic: { type: 'string' }, a: { type: 'string' }, b: { type: 'string' }, truth: { type: 'string', description: '코드·최신 문서 기준 무엇이 맞나(모르면 "사용자 확인 필요")' }, action: { type: 'string' } } } },
    customer_docs_note: { type: 'string', description: '고객에게 나가는 문서(docs-manifest) 중 낡은 서술 — 챗봇이 틀리게 안내할 위험' },
    plan_md: { type: 'string', description: '마크다운 — 병합 계획: 순서·단계·각 단계에서 지우는 것/남기는 것·위험. 원본은 지우지 않고 _archive/ 로 옮기는 안을 기본으로.' },
  },
}
const THEME_SCHEMA = {
  type: 'object',
  required: ['theme', 'current_md', 'sources_used', 'unresolved'],
  properties: {
    theme: { type: 'string' },
    current_md: { type: 'string', description: '마크다운 — 이 주제의 「지금 사실」 통합본(2026-09-02 코드·최신 문서 기준). 낡은 서술은 빼고, 남긴 문장마다 (출처 파일:줄). 길이 60~150줄.' },
    sources_used: { type: 'array', items: { type: 'string' } },
    unresolved: { type: 'array', items: { type: 'string' }, description: '문서끼리 어긋나 사용자 결정이 필요한 것' },
  },
}

const THEMES = [
  { key: 'T1', theme: '제품 정의·영업 메시지·시연 (D1 + D2 일부)', sources: 'D1 전부 + 시장경쟁력 계획서·고객의견 반영계획·GA 판정표' },
  { key: 'T2', theme: '계획과 현재 위치 — 전·중·후 항목별 상태 (D2·D3·D13)', sources: 'D2·D3·D13 전부 + 계획서_완주감사 + 다음단계_가이드' },
  { key: 'T3', theme: '담당자 사용 안내 — 로그인·화면·절차·지침 (D4)', sources: 'D4 전부 + 화면구성 가이드 + nav.js 실제 메뉴' },
  { key: 'T4', theme: '설치·배포·머신 환경 — Windows/WSL/Mac/GB10 (D5 + D6 일부 + D12 GB10)', sources: 'D5 전부 + D12의 GB10·원격GPU 문서 + 2머신 가이드 + 공동작업 가이드 + 클라이언트 배포 가이드 + client/package.json' },
  { key: 'T5', theme: '개발 규칙·협업·버전·검토 규범 (D6)', sources: 'D6 전부(CLAUDE.md는 규칙 원본이라 요약만)' },
  { key: 'T6', theme: 'AI·LLM·RAG·티어·라우팅·말투 (D7·D8)', sources: 'D7·D8 전부 + localengine.ts GIJO_TIERS' },
  { key: 'T7', theme: '점검·QA·품질 기록과 남은 결함 (D9·D15·D16)', sources: 'D9·D15·D16 전부 + 시험지도' },
  { key: 'T8', theme: '라이트 에디션·3에디션 구성과 출하 결정 (D11)', sources: 'D11 전부 + 에디션 계획 + client/electron-builder.lite.json·lite-screens.json' },
  { key: 'T9', theme: '기계 세 대(win·max·gb10)·원격 GPU·하이브리드 절감·인계 흐름 (D12·D17)', sources: 'D12·D17 전부 + CLAUDE.md 기계 이름 절 + tools/local-digest.mjs 머리주석' },
]

const [timeline, docmap, ...themes] = await parallel([
  () => agent(CTX + `
[역할] 연대기 편집자. 아래 ${TOTAL}개 문서 요약(decisions·dates)을 재료로 **날짜순 연대기**를 쓴다. 날짜가 같은 결정은 묶고, 서로 뒤집힌 결정(예: 시안 3종→1개, 메뉴 32→11→30, 7B 2개→14B 1개)은 앞뒤를 이어 "무엇이 왜 바뀌었나"가 읽히게 한다. 시대 구분(예: 스캐폴드기·CS 구조 전환·메뉴 개편기·계획서 체제·공동작업 체제)을 3~5개 세운다. 출처 파일:줄을 각 줄에 남긴다. 원문 확인이 필요하면 ${ROOT}에서 파일을 직접 읽어도 된다.
[문서 요약(JSON)] ${DIGEST}
[묶음 메모] ${NOTES}`, { label: '통합: 연대기', phase: '통합', schema: TIMELINE_SCHEMA, effort: 'high' }),
  () => agent(CTX + `
[역할] 문서 지도·병합 계획 편집자. 아래 ${TOTAL}개 문서 요약을 바탕으로 (1) 통합 뒤 남을 대표 문서 6~10개(targets — 이름·목적·독자·어떤 원본을 흡수하나), (2) ${TOTAL}개 전부의 운명(doc_map — 유지/병합/역사 기록으로 이동/폐기 후보 + 이유), (3) 문서끼리·코드와 어긋나는 것(contradictions — 무엇이 맞는지 코드 기준으로 판단, 모르면 사용자 확인 필요), (4) 고객 문서(docs-manifest) 낡음 위험, (5) 병합 계획(plan_md — 단계·순서·위험, **원본은 지우지 않고 _archive/로 옮기는 안**이 기본, CLAUDE.md·용어사전·계획서는 사용자 규칙 문서라 손대지 않는 안). 규칙: 사용자 규칙 문서(CLAUDE.md·계획서·용어사전·버전관리 기준·공동작업 가이드)는 "유지". 고객 문서는 병합해도 docs-manifest를 같이 고쳐야 한다고 적는다. 원문 확인이 필요하면 ${ROOT}에서 직접 읽는다.
[문서 요약(JSON)] ${DIGEST}
[묶음 메모] ${NOTES}`, { label: '통합: 문서 지도·병합 계획', phase: '통합', schema: MAP_SCHEMA, effort: 'high' }),
  ...THEMES.map(t => () => agent(CTX + `
[역할] 주제 통합본 집필자 — 주제: ${t.theme}. 재료: ${t.sources}. 아래 문서 요약에서 이 주제에 속한 문서를 고르고, **원문을 ${ROOT}에서 직접 다시 읽어** 「지금 사실」만 남긴 통합본(current_md)을 마크다운으로 쓴다. 규칙: ① 낡은 서술(코드·최신 문서와 어긋남)은 빼고 필요하면 "예전엔 …였다(날짜)"로 한 줄만 ② 남긴 문장마다 (출처 파일:줄) ③ 숫자·버전·경로는 코드에서 확인(client/package.json, nav.js, localengine.ts, docs-manifest.json 등) ④ 60~150줄, 소제목 3~7개 ⑤ 어긋나서 결정이 필요한 것은 unresolved에. 전부 한국어, 어려운 용어에 괄호 풀이.
[문서 요약(JSON)] ${DIGEST}`, { label: `통합:${t.key} ${t.theme}`, phase: '통합', schema: THEME_SCHEMA, effort: 'high' })),
])
log(`통합 완료: 연대기 ${timeline ? 'ok' : '실패'} · 문서지도 ${docmap ? 'ok' : '실패'} · 주제 ${themes.filter(Boolean).length}/${THEMES.length}`)

// ── 대조: 통합본 문장을 원문과 대조 ───────────────────────────────────────────
phase('대조')
const CHECK_SCHEMA = {
  type: 'object',
  required: ['theme', 'checked', 'unsupported', 'corrected_md'],
  properties: {
    theme: { type: 'string' },
    checked: { type: 'integer', description: '대조한 문장 수' },
    unsupported: { type: 'array', items: { type: 'string' }, description: '출처가 없거나 출처와 다른 문장 — 무엇이 어떻게 다른가' },
    corrected_md: { type: 'string', description: '문제 문장을 고치거나 뺀 통합본 전문(마크다운). 문제 없으면 원문 그대로.' },
  },
}
const checked = await parallel(themes.map((t, i) => () => t ? agent(CTX + `
[역할] 대조 검증관. 아래 주제 통합본의 **모든 문장**에 대해 (출처 파일:줄)을 ${ROOT}에서 실제로 열어 확인한다. 출처가 없는 문장, 출처와 다른 문장, 코드와 어긋나는 숫자·경로·버전은 unsupported에 적고, corrected_md에서는 그 문장을 고치거나 뺀다(보고서에 틀린 문장이 실리는 것이 빠지는 것보다 나쁘다). 형식·소제목은 유지.
[주제] ${THEMES[i].theme}
[통합본]
${t.current_md}
[unresolved] ${JSON.stringify(t.unresolved)}`, { label: `대조:${THEMES[i].key}`, phase: '대조', schema: CHECK_SCHEMA, effort: 'high' }) : Promise.resolve(null)))

return {
  docs,
  batch_notes: batchNotes,
  timeline,
  docmap,
  themes: THEMES.map((t, i) => ({ key: t.key, theme: t.theme, draft: themes[i], check: checked[i] })),
}
