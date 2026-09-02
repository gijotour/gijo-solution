// GB10검토.js — 2026-09-01 클라우드 세션(as-private-41)에서 만든 워크플로. 로컬에서 그대로 쓴다:
//   Workflow({ name: "GB10검토", args: { root: "<저장소 절대경로>", canRun: true } })
//   root 미지정 시 /home/user/AS-Private(클라우드 컨테이너 경로). canRun=true면 에이전트에게
//   "node_modules가 있어 실행 검증도 가능"이라고 알린다(클라우드에서는 미설치라 읽기 검증만 했다).
export const meta = {
  name: 'gb10-code-review',
  description: 'NVIDIA GB10(DGX Spark) 서버 플랫폼을 전제로 GIJO AS 코드를 병행 검토한다 — 사실 조사 → 3갈래 점검 → 반박 검증 → 종합',
  phases: [
    { title: '조사', detail: 'DGX Spark(GB10) 사실 관계를 출처와 함께 확정' },
    { title: '점검', detail: 'GPU감지·엔진 / 빌드·배포·네이티브 / 성능·용량 계획' },
    { title: '검증', detail: '갈래별 반박 검증' },
    { title: '종합', detail: '변경안·계획서 관계·사용자 결정 사항' },
  ],
}

const ROOT = (typeof args === 'object' && args && args.root) || '/home/user/AS-Private'
const CAN_RUN = !!(typeof args === 'object' && args && args.canRun)
const RUN_NOTE = CAN_RUN ? '이 머신에는 node_modules가 있어 읽기 검증에 더해 실행 검증(npm test·node 스크립트)도 가능하다 — 단 운영 서버(4000)·CDP(9223)·로그인 세션은 건드리지 않는다.' : 'node_modules가 없으면 빌드·테스트·서버 실행은 불가 — 읽어서 판단한다.'

const CTX = `
[제품] GIJO AS — 한국형 온프렘 AI 보안관리 플랫폼. Electron 클라이언트(client/) + Node/TS 서버(server/) + 로컬 LLM(llama.cpp llama-server 프로세스 풀). 저장소 ${ROOT}. **읽기 전용** — 파일 수정 금지. ${RUN_NOTE} 오늘 2026-09-01. 클라 5.14.0.
[지금 운영 환경] Windows PC(RTX 3090 24GB)의 WSL2 Ubuntu에서 systemd 서비스(gijo-as.service, /home/gijo/gijo-as/server, 포트 4000)로 서버 상주. 클라이언트(Windows NSIS 설치본)가 4000에 접속(분산 모드). Mac(M1 Max 32GB·M4 24GB)은 Metal 올인원 개발·검증용(Phase 1 크로스플랫폼 분기 완료: localengine.ts darwin 분기·preflight.ts Metal·build-server-dist.mjs prune 분기·package.json mac 타깃). 운영 모델: Qwen3-14B Q4 단일 + 전문가 어댑터(LoRA), bge-m3 임베딩 상주(8081). 티어(Lite 16GB/Standard 24GB/Pro 32GB+)는 nvidia-smi 실측 VRAM으로 자동 판정(localengine.ts GIJO_TIERS).
[검토 전제 — 사용자 요청 해석] 사용자가 「GB10을 이용해서 코드는 병행으로 보고」라고 했다. GB10 = NVIDIA DGX Spark의 Grace Blackwell GB10 슈퍼칩 데스크톱(ARM64 Linux, 통합메모리 128GB)으로 해석한다. **가장 현실적인 배치는 GB10을 RTX 3090 WSL 대신 「서버(GPU 머신)」로 쓰는 분산 모드**다(클라이언트는 그대로 Windows). 부차적으로 GB10에서 클라이언트까지 도는 올인원(Linux arm64 Electron)도 검토 대상. 이 전제는 보고서에 명시되며 사용자가 다른 뜻이었으면 바로잡는다.
[관련 문서 — 먼저 읽을 것] GIJO_AS_VRAM_티어_구동_가이드라인.md(앞 80줄), GIJO_AS_MAC_올인원_배포_가이드.md(Phase 1이 어떤 분기를 넣었는지 — GB10 이식의 본보기), GIJO_AS_배포_가이드.md §3(서버 설치·환경변수·WSL2), GIJO_AS_시장경쟁력_전중후_계획서.md 3~5절(전-1~7·중-1~8·후-1~6 — GB10 작업이 어느 항목에 붙는지 판단 근거), CLAUDE.md(작업 규칙·함정).
[현재 사실 — 2026-09-02 win 세션이 확인] 오늘 2026-09-02. 코드 기준 클라 5.83.0(hub/main 29919788). ⚠ 계획서(GIJO_AS_시장경쟁력_전중후_계획서.md 62·70·77~79행)에 **GB10 편입 완료 · 원격 GPU 선택지(전-7 하드웨어 갈래) · 실측 7.6B Q5@16K GB10 38.3 vs RTX 3090 118.5 tok/s → 「큰 기계=Pro」 길은 닫고 값어치는 용량(121GB)**이 이미 적혀 있다 — 「계획서에 없다」고 쓰지 말 것. server/src/util/unifiedmem.ts가 통합메모리([N/A]) 갈래를 이미 한 곳에서 처리하고 localengine.ts(getFreeVramMb 419행·getGpuUsage 462행·tierReason 1191행)·preflight.ts(34행)가 그것을 쓴다 — 「없다」고 지적하지 말고 **남은 틈**(스왑 미고려, 티어 표의 통합메모리 갈래 부재, 비로그인 셸 PATH에 node 없음 등)을 본다. **실측 결과를 먼저 읽는다**: ${ROOT}/tools/review-2026-09-01/결과/gb10-probe.txt — nvidia-smi 3종 [N/A], MemAvailable 26GB(모델 3개 상주), 스왑 7/15GB, 제품 서버 4000 가동(11시간+), llama-server 8080/8081/8090, 네이티브 모듈 4종 OK, node v24 ~/.local/bin.
[문서 위치 — 2026-09-02] 루트에 있던 역사·내부 문서 100개를 「_archive/」 아래로 옮겼다(git mv, 내용은 그대로). 아래에 적힌 파일이 루트에 없으면 **_archive/<파일명>** 을 보라. 없다고 단정하지 말 것.
[출력 규칙] 모든 finding은 실제로 읽은 파일·줄 번호·짧은 인용을 담는다(먼저 읽고 적을 것). 사실 관계(하드웨어 사양·OS·드라이버 동작)는 조사 단계의 facts에 있는 것만 쓰고, 없으면 「확인 필요」로 표시한다 — 지어내지 않는다. 우선순위: P0 = GB10에서 서버가 안 뜨거나 핵심 기능(LLM·임베딩·DB)이 죽음 / P1 = 동작은 하나 틀린 판정·성능 낭비·운영 도구 불가 / P2 = 다듬기·문서. findings 최대 12건, 가치 높은 순. proposal은 파일·함수·명령 수준으로 구체적으로. plan_item은 계획서 항목(전-N/중-N/후-N) 중 맞는 것, 없으면 "신규(계획서 반영 필요)" — GB10은 계획서에 없는 작업이므로 대개 신규이고, 관계가 있는 항목(후-4 에어갭 에디션·후-1 GA·중-7 커넥터 등)이 있으면 그것을 적는다. effort S(반나절)·M(1~2일)·L(그 이상). 전부 한국어.
`

const FACTS_SCHEMA = {
  type: 'object',
  required: ['facts', 'open_questions', 'searches_done'],
  properties: {
    facts: {
      type: 'array',
      items: {
        type: 'object',
        required: ['topic', 'claim', 'confidence', 'sources'],
        properties: {
          topic: { type: 'string' },
          claim: { type: 'string' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          sources: { type: 'array', items: { type: 'object', required: ['url', 'title'], properties: { url: { type: 'string' }, title: { type: 'string' }, date: { type: 'string' } } } },
        },
      },
    },
    open_questions: { type: 'array', items: { type: 'string' } },
    searches_done: { type: 'array', items: { type: 'string' } },
  },
}

const FINDINGS_SCHEMA = {
  type: 'object',
  required: ['findings', 'notes', 'scope_read'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'title', 'area', 'severity', 'impact', 'evidence', 'proposal', 'plan_item', 'effort', 'confidence', 'fact_basis'],
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          area: { type: 'string', enum: ['GPU감지·엔진', '빌드·배포·네이티브', '성능·용량', '클라이언트', '문서·운영도구'] },
          severity: { type: 'string', enum: ['P0', 'P1', 'P2'] },
          impact: { type: 'string', description: 'GB10에서 무엇이 어떻게 되나 — 운영자·담당자가 겪는 일' },
          evidence: { type: 'array', minItems: 1, items: { type: 'object', required: ['file', 'line', 'quote'], properties: { file: { type: 'string' }, line: { type: 'integer' }, quote: { type: 'string' } } } },
          proposal: { type: 'string' },
          plan_item: { type: 'string' },
          effort: { type: 'string', enum: ['S', 'M', 'L'] },
          confidence: { type: 'number' },
          fact_basis: { type: 'string', description: '근거로 삼은 facts의 topic — 코드만으로 판단했으면 "코드"' },
        },
      },
    },
    notes: { type: 'string', description: '문제 없이 그대로 되는 것(이식 부담 없는 부분) + 확인 필요 사항 + 못 본 것' },
    scope_read: { type: 'array', items: { type: 'string' } },
  },
}

const PLAN_SCHEMA = {
  type: 'object',
  required: ['memory_model', 'candidates', 'tier_proposal', 'honest_caveats', 'findings', 'notes', 'scope_read'],
  properties: {
    memory_model: { type: 'string', description: 'GB10 통합메모리 128GB에서 OS·서버·임베딩을 뺀 뒤 LLM에 쓸 수 있는 양의 산정 — 산정식과 가정을 적는다' },
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        required: ['model', 'params_b', 'quant', 'file_gb', 'ctx', 'est_tok_s', 'fits', 'basis'],
        properties: {
          model: { type: 'string' }, params_b: { type: 'number' }, quant: { type: 'string' }, file_gb: { type: 'number' }, ctx: { type: 'integer' },
          est_tok_s: { type: 'string', description: '추정 범위(예: 8~12) — 근거 없는 단정 금지' }, fits: { type: 'boolean' }, basis: { type: 'string', description: '무엇(대역폭·실측 보고·산정식)에서 나온 추정인지' },
        },
      },
    },
    tier_proposal: { type: 'string', description: 'GIJO_TIERS에 GB10을 어떻게 태울지 — 기존 Pro로 충분한지, 새 티어가 필요한지, 근거' },
    honest_caveats: { type: 'array', items: { type: 'string' }, description: '고객·사용자에게 정직하게 밝혀야 할 한계(예: 3090 대비 토큰 속도)' },
    findings: { type: 'array', items: { type: 'object', required: ['id', 'title', 'area', 'severity', 'impact', 'evidence', 'proposal', 'plan_item', 'effort', 'confidence', 'fact_basis'], properties: { id: { type: 'string' }, title: { type: 'string' }, area: { type: 'string' }, severity: { type: 'string', enum: ['P0', 'P1', 'P2'] }, impact: { type: 'string' }, evidence: { type: 'array', items: { type: 'object', required: ['file', 'line', 'quote'], properties: { file: { type: 'string' }, line: { type: 'integer' }, quote: { type: 'string' } } } }, proposal: { type: 'string' }, plan_item: { type: 'string' }, effort: { type: 'string', enum: ['S', 'M', 'L'] }, confidence: { type: 'number' }, fact_basis: { type: 'string' } } } },
    notes: { type: 'string' },
    scope_read: { type: 'array', items: { type: 'string' } },
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
        required: ['id', 'refuted', 'reason', 'severity', 'evidence_ok', 'fact_ok', 'duplicate_of'],
        properties: {
          id: { type: 'string' }, refuted: { type: 'boolean' }, reason: { type: 'string' }, severity: { type: 'string', enum: ['P0', 'P1', 'P2'] },
          evidence_ok: { type: 'boolean' }, fact_ok: { type: 'boolean', description: '근거로 삼은 하드웨어·OS 사실이 facts와 맞는가' }, duplicate_of: { type: 'string' }, corrected_proposal: { type: 'string' },
        },
      },
    },
  },
}

const SYNTH_SCHEMA = {
  type: 'object',
  required: ['verdict_summary', 'porting_effort', 'proposals', 'plan_relation', 'questions_for_user', 'facts_used'],
  properties: {
    verdict_summary: { type: 'string', description: 'GB10에 서버를 올릴 수 있는가 — 지금 코드로 되는 것·막히는 것·바꿔야 하는 것을 5~8문장' },
    porting_effort: { type: 'string', description: 'Phase 1(Mac) 이식과 비교한 총 작업량 추정과 근거' },
    proposals: {
      type: 'array',
      items: {
        type: 'object',
        required: ['key', 'title', 'priority', 'plan_item', 'finding_ids', 'problem', 'change', 'verify', 'effort', 'risk'],
        properties: { key: { type: 'string' }, title: { type: 'string' }, priority: { type: 'string', enum: ['P0', 'P1', 'P2'] }, plan_item: { type: 'string' }, finding_ids: { type: 'array', items: { type: 'string' } }, problem: { type: 'string' }, change: { type: 'string' }, verify: { type: 'string', description: 'GB10 실장비에서 무엇을 재면 확인되나 — 실측 체크리스트 형태' }, effort: { type: 'string', enum: ['S', 'M', 'L'] }, risk: { type: 'string' } },
      },
    },
    plan_relation: { type: 'string', description: 'GB10 지원이 전·중·후 계획서의 어디에 붙는지, 신규 항목이 필요한지, 왜 — 계획서 전-7에 편입이 이미 있으므로 「어느 갈래(개발·절감 기계 vs 고객 배치 서버 후보)로 다루나」를 답한다 — CLAUDE.md 규칙상 계획서에 없는 큰 작업은 관계를 먼저 물어야 한다' },
    questions_for_user: { type: 'array', items: { type: 'string' } },
    facts_used: { type: 'array', items: { type: 'object', required: ['claim', 'url'], properties: { claim: { type: 'string' }, url: { type: 'string' } } } },
  },
}

// ── 조사 ───────────────────────────────────────────────────────────────────
phase('조사')
const research = await agent(CTX + `
[역할] 사실 조사원. **인터넷 조사(WebSearch·WebFetch — 없으면 ToolSearch로 "select:WebSearch,WebFetch"를 불러 쓴다)**로 다음 사실을 출처(URL·제목·날짜)와 함께 확정한다. 확신이 없으면 confidence를 낮추고 open_questions에 적는다. 조사 주제:
 1. NVIDIA DGX Spark(GB10 Grace Blackwell 슈퍼칩) 사양 — CPU(코어 수·Arm 아키텍처), GPU(Blackwell, CUDA 코어·텐서), 메모리(용량·종류·대역폭 GB/s — 이 숫자가 토큰 속도를 결정한다), 저장장치, 전력, 폼팩터, 출시·가격대.
 2. DGX OS — 어떤 Ubuntu 기반인지(버전), 기본 탑재 CUDA·드라이버 버전, aarch64(arm64) 여부, systemd·Docker·NGC 컨테이너 사용 관행.
 3. **nvidia-smi가 DGX Spark(통합메모리)에서 memory.total / memory.used / memory.free를 어떻게 보고하는가** — N/A로 나오는지, 값이 나오는지(커뮤니티 보고·NVIDIA 포럼·문서). 이게 우리 코드의 티어 판정·VRAM 예산 로직에 직결된다. 대안 조회 방법(free -m·/proc/meminfo·nvidia-smi -q·NVML)도 조사.
 4. llama.cpp를 DGX Spark에서 CUDA로 빌드하는 방법과 알려진 문제 — cmake 플래그(GGML_CUDA=ON, CMAKE_CUDA_ARCHITECTURES 값 — sm_121/121a 등), 통합메모리에서 -ngl 동작, 알려진 성능 수치(7B·14B·32B·70B Q4 tok/s 실측 보고), NVIDIA의 DGX Spark llama.cpp 플레이북.
 5. Node 네이티브 모듈의 linux-arm64 프리빌드 존재 여부 — better-sqlite3, better-sqlite3-multiple-ciphers, @lancedb/lancedb(linux-arm64-gnu 패키지), onnxruntime-node(linux/arm64), playwright-core Chromium(Ubuntu arm64). 없으면 소스 빌드 조건.
 6. Electron/electron-builder의 Linux arm64 타깃(AppImage·deb) 지원 여부와 제약(올인원 검토용).
 7. PyTorch CUDA(aarch64/sbsa) 휠·unsloth·mergekit이 DGX Spark에서 도는지(학습 루프·모델 합성 기능용) — NVIDIA 제공 컨테이너 여부.
 8. RTX 3090(24GB, 936GB/s)과의 비교 — 같은 14B Q4 모델의 토큰 속도가 어느 쪽이 빠른가(대역폭 비례 추정 + 실측 보고). **정직한 비교**가 목적이다(GB10이 모든 면에서 낫다고 쓰지 않는다).
검색은 영어·한국어 둘 다 돌리고, searches_done에 검색어를 남긴다. facts는 topic별로 짧고 검증 가능하게. 전부 한국어(출처 제목은 원문 유지).`, { label: '조사: DGX Spark 사실', phase: '조사', schema: FACTS_SCHEMA, effort: 'high' })

const FACTS = research ? JSON.stringify(research.facts, null, 1) : '(조사 실패 — 모든 하드웨어 사실을 「확인 필요」로 표시할 것)'
const OPEN = research ? JSON.stringify(research.open_questions) : '[]'
log(`조사 완료: facts ${research ? research.facts.length : 0}건`)

// ── 점검 3갈래 ─────────────────────────────────────────────────────────────
phase('점검')
const FINDERS = [
  {
    key: 'G1', label: 'GPU 감지·엔진·티어', schema: FINDINGS_SCHEMA,
    prompt: `[이번 갈래] G1 GPU 감지·엔진·티어 — area는 "GPU감지·엔진". id는 G1-01부터.
렌즈: **GB10(ARM64 Linux, nvidia-smi 있음, 통합메모리 128GB)에서 서버를 그대로 띄우면 LLM 엔진이 어떻게 동작하는가.** 볼 것: server/src/engine/localengine.ts 전체(getFreeVramMb·getGpuUsage·makeRoom·GIJO_TIERS·recommendTier·currentTierSettings·autoStartLocalEngines·spawn 인자 -ngl -1·ctx·임베딩 서버·hang 감시·IS_MAC 분기가 GB10에는 안 걸리는 문제), server/src/engine/preflight.ts(gpuAvailable의 nvidia-smi 파싱 — memory.total이 N/A면?), server/src/util/llamabin.ts(linux 경로), server/src/engine/modelauth·hfmodels·model 파일 크기 산정 함수(modelFileSizeMb 등 grep), 티어 API(/api/localengine/tier 응답 문구 — "NVIDIA GPU를 찾지 못했습니다" 분기), tools/model-benchmark.mjs(티어 판정 기준 동일 여부). 구체적으로: nvidia-smi 출력이 N/A나 빈 값이면 parseInt/Number가 NaN이 되어 어느 분기로 가는지 코드 흐름을 줄 단위로 추적해 적는다. 통합메모리에서 「여유 VRAM」을 무엇으로 봐야 하는지(Mac darwin 분기와 같은 방식이 맞는지) 제안. 128GB에서 기존 Pro 티어 판정이 무엇을 내놓는지. 사실 관계는 facts만 근거로.`,
  },
  {
    key: 'G2', label: '빌드·배포·네이티브·운영 도구', schema: FINDINGS_SCHEMA,
    prompt: `[이번 갈래] G2 빌드·배포·네이티브 의존·운영 도구 — area는 "빌드·배포·네이티브" 또는 "문서·운영도구" 또는 "클라이언트". id는 G2-01부터.
렌즈: **GB10에 서버를 설치·상주·배포·백업하는 운영자.** 볼 것: server/package.json 의존성 중 네이티브(better-sqlite3·better-sqlite3-multiple-ciphers·@lancedb/lancedb·onnxruntime-node·playwright-core·sharp 유무) — facts의 arm64 프리빌드 여부와 대조; server/scripts/*(copy-assets·encrypt-db·migrate-data-to-mac 등 — 플랫폼 가정); server/src/util/pythonbin.ts·server/src/engine/trainenv.ts·merge.ts(학습·합성의 CUDA/x86 가정); server/src/engine/hardeningscan.ts·hardeningtargets.ts(Linux에서 bash 실행 경로·wsl.exe 가정); server/src/dbkey.ts(기계 결속 키가 무엇에 묶이는지 — 이식 시 DB가 열리는가); server/src/engine/backup.ts(경로 가정); tools/deploy-prod.ps1·.claude/commands/GIJOAS배포.md·GIJOAS서버시작.md·tools/update-dev-mac.sh(배포 도구가 WSL·Mac만 아는지 — GB10 네이티브 Linux 경로가 있는가); GIJO_AS_배포_가이드.md §3·§3.7(systemd 유닛 예시가 GB10에 그대로 쓰이는가); client/scripts/build-server-dist.mjs(linux 빌드 시 prune 분기·Electron ABI 재빌드가 arm64에서 되는가); client/package.json build(linux 타깃 없음 — 올인원 시 필요한 것); server/src/engine/clientrelease.ts(.exe만 게시 — arm64 클라 게시 불가); 에어갭 관문 airgap.ts(모델·패키지 사전 반입 절차가 arm64용으로 준비돼야 하는 것). Docker/NGC 컨테이너로 가는 길 vs 네이티브 systemd의 장단(우리 운영 관행은 systemd)도 notes에.`,
  },
  {
    key: 'G3', label: '성능·용량·모델 계획', schema: PLAN_SCHEMA,
    prompt: `[이번 갈래] G3 성능·용량·모델 계획 — findings의 area는 "성능·용량". id는 G3-01부터.
렌즈: **GB10 128GB 통합메모리에서 무엇을 어떻게 돌리는 것이 맞는가 — 정직한 숫자로.** 할 것: (1) GIJO_AS_VRAM_티어_구동_가이드라인.md의 산정식(파일 크기 + KV캐시 + 런타임 오버헤드, 임베딩 1.5~2GB)을 GB10에 적용 — OS·서버 프로세스·LanceDB·여유분을 뺀 LLM 가용량을 산정식과 가정을 밝혀 적는다(memory_model). (2) 후보 모델표(candidates): 현 운영 Qwen3-14B Q4, Qwen3-32B Q4, Qwen2.5/3 72B급 Q4, gpt-oss-120b(MXFP4)·Llama-3.3-70B Q4 등 — 파일 크기·컨텍스트별 KV·적합 여부·**토큰 속도 추정 범위**(facts의 대역폭·실측 보고에서만 도출, 근거 명시; 실측이 없으면 「추정」). (3) RTX 3090과 비교해 14B에서 GB10이 느릴 수 있음을 숫자로(대역폭 비례). (4) 동시 사용자(Pro 티어 2인스턴스) 관점에서 GB10의 실익 — 큰 모델 1개 vs 14B 여러 인스턴스. (5) tier_proposal: GIJO_TIERS(server/src/engine/localengine.ts) 구조를 읽고 GB10을 기존 Pro로 두면 무엇이 낭비되는지, 새 티어(예: 「대용량 통합메모리」)가 필요한지 근거. (6) honest_caveats: 고객·영업 문서에 밝혀야 할 것(속도·발열·ARM 생태계·가격·CUDA 13 요구). (7) 평가 게이트(중-3: 라우팅 66/66·안전 9/9·한국어 24/24)를 모델 교체 전에 돌려야 한다는 규칙과 연결 — findings로 「모델을 키우기 전에 게이트 통과」를 명시. 읽을 코드: localengine.ts(GIJO_TIERS·MODEL_VRAM_OVERHEAD_MB·DEFAULT_CTX_SIZE·modelFileSizeMb), GIJO_AS_모델_선택_가이드.md, GIJO_AS_번들_LLM_후보.md, .claude/commands/평가게이트.md. 사실 관계는 facts만 근거로 하고 없으면 「확인 필요」.`,
  },
]

function verifyPrompt(f, found) {
  const list = found.findings || []
  return CTX + `
[역할] 반박 검증관. 아래는 「${f.key} ${f.label}」 점검자가 낸 finding 목록이다. 각 finding마다 **인용된 파일·줄을 직접 다시 읽고**, 근거로 삼은 하드웨어·OS 사실이 아래 facts와 맞는지(fact_ok) 확인한다. 판정: evidence_ok(인용 정확), fact_ok(사실 정확 — facts에 없는 사실을 단정했으면 false이고 refuted), 이미 코드가 처리하고 있어 영향이 없으면 refuted, 같은 목록의 중복은 duplicate_of를 적고 refuted, severity 재판정(P0 서버·핵심 기능 불가 / P1 틀린 판정·성능 낭비·운영 도구 불가 / P2 다듬기). 확신이 없으면 refuted=true가 기본. reason은 한국어 한두 문장에 근거 파일:줄. corrected_proposal은 더 나은 길이 있을 때만.
[facts] ${FACTS}
[open_questions] ${OPEN}
[finding 목록(JSON)]
${JSON.stringify(list, null, 1)}`
}

const perFinder = await pipeline(
  FINDERS,
  f => agent(CTX + `\n[facts — 조사 결과, 이것만 사실로 쓴다] ${FACTS}\n[open_questions] ${OPEN}\n` + f.prompt + `\n[방법] Bash(cat -n·grep -n·sed -n)·Read·Grep으로 실제 파일을 읽고 인용으로 증명한다. 마지막에 StructuredOutput으로 낸다.`, { label: `점검:${f.key} ${f.label}`, phase: '점검', schema: f.schema, effort: 'high' }),
  async (found, f) => {
    if (!found) return { f, found, verdicts: [] }
    const list = found.findings || []
    if (!list.length) return { f, found, verdicts: [] }
    const v = await agent(verifyPrompt(f, found), { label: `검증:${f.key}`, phase: '검증', schema: VERDICTS_SCHEMA, effort: 'high' })
    return { f, found, verdicts: (v && v.verdicts) || [] }
  },
)

const confirmed = [], rejected = [], notes = [], scope = []
let plan = null
for (const r of perFinder.filter(Boolean)) {
  if (!r.found) { notes.push(`[${r.f.key}] 점검 결과 없음`); continue }
  if (r.f.key === 'G3') plan = { memory_model: r.found.memory_model, candidates: r.found.candidates, tier_proposal: r.found.tier_proposal, honest_caveats: r.found.honest_caveats }
  notes.push(`[${r.f.key} ${r.f.label}] ${r.found.notes || ''}`)
  scope.push(...(r.found.scope_read || []))
  const byId = new Map(r.verdicts.map(v => [v.id, v]))
  for (const fd of r.found.findings || []) {
    const v = byId.get(fd.id)
    if (!v) { rejected.push({ ...fd, reject_reason: '검증 결과 없음' }); continue }
    if (v.refuted) { rejected.push({ ...fd, reject_reason: v.reason, duplicate_of: v.duplicate_of }); continue }
    confirmed.push({ ...fd, severity: v.severity || fd.severity, verify_reason: v.reason, corrected_proposal: v.corrected_proposal || '' })
  }
}
log(`GB10: 확정 ${confirmed.length} · 기각 ${rejected.length}`)

// ── 종합 ───────────────────────────────────────────────────────────────────
phase('종합')
const synth = await agent(CTX + `
[역할] 변경안 편집자. 아래 검증 통과 finding과 용량 계획을 **GB10 서버 이식 변경안**으로 묶는다. 규칙: 같은 원인은 하나로 묶고 finding_ids에 전부. priority는 묶인 것 중 최고. plan_item은 계획서(3~5절)를 읽고 판단 — GB10은 계획서에 없으므로 대개 "신규(계획서 반영 필요)"이고 관계 항목(후-4 에어갭 에디션·후-1 GA·중-3 평가 게이트·중-7 등)이 있으면 함께 적는다. change는 파일·함수·명령 수준. verify는 **GB10 실장비 실측 체크리스트**(Mac 가이드 §4와 같은 형식: preflight → 임베딩 → 모델 로드·tok/s → RAG → 티어 API → 평가 게이트). porting_effort는 Phase 1(Mac 이식: localengine darwin 분기·preflight·prune·package.json)과 견줘 추정. plan_relation은 CLAUDE.md 규칙(계획서에 없는 큰 작업은 관계를 먼저 묻는다)에 따라 사용자에게 물을 문장으로. questions_for_user: GB10이 실제로 있는지/도입 예정인지, 서버 전용인지 올인원인지, 모델을 키울지(32B·70B) 등. facts_used에는 보고서에 실을 사실과 URL을 고른다(과장 금지 — 3090 대비 느릴 수 있음을 반드시 포함). 전부 한국어, 어려운 용어에는 괄호 풀이.
[확정 finding(JSON)] ${JSON.stringify(confirmed, null, 1)}
[용량 계획(G3)] ${JSON.stringify(plan, null, 1)}
[notes] ${notes.join('\n')}
[facts] ${FACTS}
[open_questions] ${OPEN}`, { label: 'GB10 변경안 종합', phase: '종합', schema: SYNTH_SCHEMA, effort: 'high' })

return { synth, plan, confirmed, rejected: rejected.map(r => ({ id: r.id, title: r.title, reason: r.reject_reason })), notes, facts: research ? research.facts : [], open_questions: research ? research.open_questions : [], searches: research ? research.searches_done : [] }
