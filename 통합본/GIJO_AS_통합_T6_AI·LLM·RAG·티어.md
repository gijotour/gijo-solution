# AI·LLM·RAG·티어·라우팅·말투 (D7·D8)

> **통합본** — 문서통합 워크플로(2026-09-02)가 루트 md 143개를 통독해 만든 「지금 사실」 정리본.
> 기준: 코드가 진실(클라 5.83.0 · hub/main 29919788). 문장마다 (출처 파일:줄).
> **원문 대조 완료** — 검증관이 출처를 실제로 열어 확인했고, 근거 없는 문장은 고치거나 뺐다 (대조 문장 74개).
>
> **대조에서 걸러 낸 것 10건**:
> - 【숫자 오류】 「라이트 에디션은 허용목록으로 21개만 켠다」 — 실제는 **16개**입니다. `server/src/lite/lite-tools.json`의 `tools` 배열이 16건이고, `server/src/lite/index.ts:26`이 그것을 그대로 `setToolAllowlist`에 넘깁니다(같은 파일 36~37줄). 21이라는 숫자의 출처를 어디서도 찾지 못했습니다.
> - 【출처 불일치】 「7B 여러 개 병렬은 접었다 … (GIJO_AS_모델_선택_가이드.md:52~62)」 — 52~62줄은 BYOM 안내와 「속도에 관해 알아 둘 것」입니다. 해당 내용은 **20~29줄**(「## 왜 「7B 여러 개 병렬」을 접었나」와 그 아래 세 가지 근거)에 있습니다.
> - 【출처 불일치】 「모델 합성(SLERP) … (GIJO_AS_LLM_합성_안내.md:104·113)」 — 이 파일은 **전체 17줄**이라 104·113줄이 존재하지 않습니다. 해당 내용은 3~4줄(SLERP·「메뉴에는 없으며」)과 11~13줄(「## 지금은 왜 접혀 있나」)입니다.
> - 【날짜 어긋남】 머리말 「hub/main 2026-09-01」 — 실제 HEAD 커밋 29919788의 author·committer 날짜는 **2026-09-02 04:39 (+0900)**입니다(현재 브랜치 main). 커밋 해시는 맞습니다.
> - 【출처 불일치】 「GIJO Agent(normaltic)는 자료 0건이면 LLM을 아예 부르지 않는다 (llm.ts:723·734)」 — 723줄은 **지식 검색 배선 자체가 없을 때**의 다른 갈래입니다. 0건 갈래는 **729줄**(`if (relevant && relevant.length === 0)`)과 734줄입니다. 주장 내용 자체는 코드·문서(GIJO_AS_RAG_구성_가이드.md:193~194) 모두와 맞습니다.
> - 【출처 불일치】 「FORCED_INTENTS 79개 (agentloop.ts:831·1709)」 — 개수 79는 맞습니다(831~1647줄 배열 안 `re:` 항목 79건). 다만 1709줄은 배열이 아니라 이를 소비하는 `forcedToolFor` 함수 정의입니다. 정확한 자리는 **831~1647(배열)·1709(forcedToolFor)**입니다.
> - 【과장】 「랭킹 기반 사전 라우팅(rankToolsFor)은 … 저장소 검색 0건」 — 저장소 검색은 0건이 아닙니다. `GIJO_AS_디스패치_사전라우팅_가이드.md:49`에 함수 이름이 설계로 적혀 있고 `.claude/worktrees/` 사본 2곳에도 같은 줄이 있습니다. **제품 코드(.ts)에 0건**이 정확한 표현입니다.
> - 【unresolved 항목의 출처 불일치】 「모델 선택 가이드 등급표(… GIJO_AS_모델_선택_가이드.md:44~48)」 — 등급표는 **14~16줄**입니다(44~48줄은 「큰 모델보다 사내 근거」 단락). 표 내용(Lite 12GB급 / Standard 24GB급 / Pro 32GB급 이상)과 코드와의 불일치 지적 자체는 맞습니다.
> - 【unresolved 항목의 숫자 오류】 「라이트 허용목록 … 실제는 전체 100개·라이트 21개」 — 라이트는 **16개**입니다. 파일 자기 기록이 「전체 78개 중 13개」로 낡았다는 지적과 registry.ts:2132 주석이 같은 옛 숫자라는 지적은 맞습니다.
> - 【참고 — 지적을 보강함】 「2,000자를 강제하는 상수·검사를 찾지 못했다」는 맞습니다. 다만 코드에 있는 유일한 길이 장치는 **글자 수가 아니라 토큰 상한** `DEFAULT_MAX_TOKENS = 800`(server/src/engine/llm.ts:317)이고, `server/test/tone.test.ts`에도 2,000 관련 검사가 없습니다. 규범의 「2,000자」와 코드의 「800토큰」은 단위가 달라 서로를 강제하지 못합니다.
>
> **결정이 필요한 것 8건**:
> - 고객이 읽는 「모델 선택 가이드」 등급표(Lite 12GB급 / Standard 24GB / Pro 32GB+ · GIJO_AS_모델_선택_가이드.md:44~48)가 코드 GIJO_TIERS(10 / 24 / 48GB급 · server/src/engine/localengine.ts:127~136)와 다릅니다. 이 문서는 챗봇 RAG 근거로 실려 있어(server/docs-manifest.json:97) 고객 답변에 그대로 인용됩니다 — 코드 값으로 고칠지, 등급 이름 자체를 바꿀지 결정이 필요합니다.
> - 말투규범 문서의 🤖 뜻(「챗봇이 안내하는 글」 · GIJO_AS_대화창_말투규범.md:79)이 코드가 2026-08-04에 좁힌 뜻(「AI가 쓴 글 — 사람이 확인할 것」 · server/src/engine/tone.ts:43~47)과 다릅니다. 문서가 단일 출처라고 스스로 선언했으므로(같은 문서 3줄) 어느 쪽을 정본으로 삼을지 결정이 필요합니다. 문서 꼬리 갱신일도 2026-08-03에 멈춰 있는데 코드는 08-31까지 표식을 추가했습니다(tone.ts:36~42).
> - 말투규범의 「화면 답은 2,000자 넘지 않는다」(GIJO_AS_대화창_말투규범.md:37)를 강제하는 상수·검사를 코드에서 찾지 못했습니다. 규범만 있고 장치가 없는 상태인지, 다른 이름으로 있는지 확인이 필요합니다.
> - 사전 라우팅(rankToolsFor) 착수 트리거인 「도구 20개 초과」(GIJO_AS_디스패치_사전라우팅_가이드.md:21)는 이미 넘었습니다(도구 100개 · registry.ts:216). 실제로는 에디션별 허용목록(라이트 21개)으로 대신했는데, 가이드를 착수할지 폐기할지 결정이 필요합니다.
> - 라이트 허용목록 파일의 자기 기록이 낡았습니다 — 「전체 78개 중 13개」(server/src/lite/lite-tools.json `_설명`·`_측정`)인데 실제는 전체 100개·라이트 21개입니다. registry.ts:2132 주석도 같은 옛 숫자입니다.
> - 「이 문서는 계속 갱신합니다」라고 선언한 RAG 아키텍처 문서가 낡았습니다 — 머리말 마지막 갱신 2026-07-27, 도구 「37종」(GIJO_AS_RAG_아키텍처_LLM연동.md:6·173), 적재 현황 문서 77건·조각 5,427개(같은 문서 244~252). 실제 도구는 100개이고 적재 수치는 운영 서버에서 재실측해야 압니다(이번에 서버를 띄우지 않아 확인 못 했습니다).
> - VRAM 티어 가이드가 「Mac·AMD·CPU 미지원, NVIDIA CUDA 전용」이라고 못 박았지만(GIJO_AS_VRAM_티어_구동_가이드라인.md:165~172) 코드는 Metal을 정식 플랫폼으로 다룹니다(server/src/engine/localengine.ts:170·185~191). 영업 화법(같은 문서 174~175)까지 딸려 있어 정정 여부 결정이 필요합니다.
> - 학습 구역이 문서와 코드가 다릅니다 — 설계는 「학습은 Mac에서, 운영엔 gguf만 반입」(GIJO_AS_학습환경_분리_설계.md:32~46)인데 코드는 같은 서버의 별도 파이썬 방(venv-train)에서 학습이 돌게 돼 있습니다(server/src/engine/trainenv.ts:1~11). 어느 쪽이 현행 방침인지 확인이 필요합니다.

---

# AI·LLM·RAG·티어·라우팅·말투 — 지금 사실 (2026-09-02, 코드 기준)

기준: 저장소 `D:/Connect AI` (main HEAD 29919788 · 2026-09-02) · 클라 5.83.0 (client/package.json:4).
숫자·경로는 전부 코드에서 다시 확인했고, 문서와 어긋난 곳은 그렇다고 적었다.

## 1. 두뇌 — 기본 모델 · BYOM · 전문가 어댑터

- 기본 채팅 모델은 **qwen3-14b** 하나다 — `DEFAULT_MODEL_ID = … ?? "qwen3-14b"` (server/src/engine/localengine.ts:41). 2026-08-09에 7.6B(gijo-main-orchestrator)에서 승격했고, 승격 근거는 평가 게이트 통과(routing 66/66·korean 24/24·맨몸 견고성 29→71)다 (server/src/engine/localengine.ts:33~40).
- 검색용 임베딩 모델 **bge-m3**는 스왑 대상이 아니라 포트 8081에 상주한다 (server/src/engine/localengine.ts:45~46). 띄울 때 `--ctx-size/--batch-size/--ubatch-size`를 전부 8192로 명시한다 — 안 하면 512토큰 넘는 한글에서 HTTP 500이 나고 인입이 조용히 실패한다 (server/src/engine/localengine.ts:845~852).
- 부팅 때 임베딩을 **먼저** 올린다 (server/src/engine/localengine.ts:775·790). 상주를 없애면 첫 RAG 질문이 최대 60초가 되기 때문이다 (server/src/engine/localengine.ts:122).
- BYOM(고객이 자기 모델을 가져오는 것)은 코드가 자동으로 맞춘다 — GGUF 대화 템플릿에서 thinking(생각 과정을 뱉는) 모델을 판별하고, 실제 문맥은 `min(티어 ctx, 모델 native)`로 줄여 띄운다 (server/src/engine/modelquirks.ts:112~113·145·165).
- 전문가 어댑터(LoRA — 베이스 모델은 그대로 두고 얇게 덧입히는 파일)는 **등록 ≠ 채택**이다. 평가 게이트를 통과해 채택된 것만 서빙에 얹는다 (server/src/engine/adapters.ts:4~5·35·172). 어댑터 1호가 반복 루프·설정 키 날조로 불채택된 실측(2026-08-08)이 이 관문의 이유다 (server/src/engine/adapters.ts:4~5).
- 주제별 승인 문답 **300건이 학습 개시선**이다 — `TOPIC_TRAIN_TARGET = 300` (server/src/engine/learnloop.ts:332). 고객 안내도 같은 숫자로 적혀 있다 (GIJO_AS_우리AI_구성_안내.md:15).
- 어댑터가 실린 모델은 요청마다 `cache_prompt:false` — 어댑터가 다른 요청끼리 프롬프트 캐시를 재사용해 답이 오염되는 llama.cpp 이슈 방어다 (server/src/engine/localengine.ts:1150·1166).
- 에이전트는 **6종**이다(orchestrator·scan·analysis·report·ti·normaltic) — server/src/engine/agents.ts:51~93. 총괄(오케스트레이터)에는 어댑터를 장착하지 않는다(라우팅 결정성) (GIJO_AS_RAG_아키텍처_LLM연동.md:218, GIJO_AS_우리AI_구성_안내.md:16).
- 고객이 읽는 AI 설명 3종(우리AI 구성 안내·모델 선택 가이드·LLM 합성 안내)은 챗봇 RAG 근거 목록에 실려 있다 (server/docs-manifest.json:93·97·101).
- 「7B 여러 개 병렬」은 접었다 — GPU 하나면 병렬이 아니고, 스왑 비용이 수십 초이며, 역할 분리는 어댑터로 된다 (GIJO_AS_모델_선택_가이드.md:20~29). 모델 합성(SLERP)도 14B 단일 채택 뒤 「고급 기능」으로만 남았고 메뉴에는 없다 (GIJO_AS_LLM_합성_안내.md:3~4·11~13).

## 2. 구동 티어 — 코드가 진실이다

`GIJO_TIERS`가 등급의 단일 출처다 (server/src/engine/localengine.ts:110~145).

| 등급 | 최소 VRAM | 동시 모델 | 문맥(ctx) | 비고 |
|---|---|---|---|---|
| Lite | 10GB급 | 1 | 8,192 | 7.6B급 전제·「일부 기능 제약」 (localengine.ts:127) |
| Standard | 24GB급 | 1 | 32,768 | 14B 기준 15.7GB 점유 (localengine.ts:128) |
| Pro | 48GB급 | 2 | 32,768 | **지금은 스탠다드와 엔진 동작이 같다**(정직 표기) (localengine.ts:136) |
| Max | 미확정 | 3 | 32,768 | 관제용 **예정** — 고를 수 없음(planned) (localengine.ts:137~144) |

- 라이트가 8GB가 아니라 10GB인 이유: `tierFits`가 임베딩을 **등급과 무관하게 항상** 더하기 때문에 8GB에선 산수가 안 맞는다(CUDA 6.5+2.5=9.0GB > 쓸 수 있는 7.60GB) (server/src/engine/localengine.ts:113~127).
- 등급 판정은 손으로 적은 문턱이 아니라 **플랫폼별 실측 점유표**로 계산한다 — `TIER_COST`(lite cuda 5.9·metal 5.8 / standard·pro cuda 13.2·metal 16.0)와 `EMBED_COST`(cuda 2.5·metal 1.55), 여유계수 0.95 (server/src/engine/localengine.ts:171~197). 판정 함수는 `tierFits`·`recommendTier` 하나뿐이다 (server/src/engine/localengine.ts:200·211).
- ⚠ **동시 모델 수는 사실상 티어가 정하지 않는다.** `maxLoadedModels`가 쓰이는 곳은 `makeRoomFor`의 nvidia-smi 실패 갈래 하나뿐이고, 지원 플랫폼 전부에서 숫자가 나오므로 실제로는 **남은 VRAM**이 정한다 (server/src/engine/localengine.ts:132~134).
- 문맥은 두 칸으로 나눠 쓴다(`--parallel 2`) — 90초마다 도는 상태 점검 ping이 프롬프트 캐시를 밀어내 첫 질문이 40초 걸리던 사고(2026-08-09)의 처방이다. 칸당 최소 12,288 토큰이 안 되면 나누지 않는다 (server/src/engine/localengine.ts:989~1018).
- Mac(Metal)은 지원 플랫폼이다 — `EnginePlatform = "cuda" | "metal"` (server/src/engine/localengine.ts:170).

## 3. RAG — 넣는 길, 찾는 길, 근거 게이트

- 저장소는 둘이다: 조각·임베딩은 LanceDB(`data/memory.lancedb`), 문서별 메타는 SQLite `memory_documents` (GIJO_AS_RAG_아키텍처_LLM연동.md:42~50, server/src/engine/memory.ts:332).
- 조각은 **800자·겹침 100자**, 임베딩은 **8개씩** 묶어 보낸다 (server/src/engine/memory.ts:334·348·803). 배치 64로 보내면 임베딩 서버가 무응답에 빠진 실사고가 이 값의 근거다 (GIJO_AS_RAG_아키텍처_LLM연동.md:90~91).
- 문서가 들어오는 길 셋(업로드·서버 경로·부팅 번들)은 같은 관문 둘을 지난다 — 관문 A 글자 꺼내기(추출기 필수), 관문 B 인입 품질 판정(버린 비율 80% 초과면 오류) (GIJO_AS_RAG_아키텍처_LLM연동.md:57~73).
- 관문이 생긴 이유: 2026-08-08에 조각 5,631개 중 4,113개(73%)가 읽을 수 없는 PDF 바이트였다 — 운영 WSL에 `python` 명령이 없어 추출이 한 번도 성공한 적이 없었다 (GIJO_AS_RAG_아키텍처_LLM연동.md:75~86).
- 검색은 두 갈래를 합친다: 의미 검색(벡터)과 글자 검색(BM25)을 **RRF**(순위 융합, k=60)로 섞는다 (server/src/engine/hybridsearch.ts:319, GIJO_AS_RAG_아키텍처_LLM연동.md:100~111).
- 순위 손질 세 가지는 전부 **밀어줄 뿐 밀어내지 않는** 세기다 — 화면 맥락 `CATEGORY_BOOST 0.008`, 역할 `ROLE_BOOST 0.02`, 내장 문서 `ORIGIN_BOOST 0.012` (server/src/engine/hybridsearch.ts:187·201·219). 업무영역은 5종(취약점·장비운영·사내규정·위협대응·일반) (server/src/engine/hybridsearch.ts:148).
- 후보 폭은 `max(topK×4, 16)`이다 — 타사 PDF 조각이 10칸을 채워 우리 문서가 후보에 못 들던 오염(2026-08-10 실측)을 이 값과 origin 신호로 고쳤다 (server/src/engine/memory.ts:1186·1243).
- 답변에 넣는 근거는 **4개**다 (server/src/engine/llm.ts:183).
- 근거 판정은 거리 **0.95**를 넘으면 버리고, 0.85 이하(또는 질문의 코드가 조각에 글자 그대로 있는 `lexicalHit`)면 「강한 근거」로 본다 (server/src/engine/memory.ts:976·982·1297·1304).
- 근거가 약하거나 없으면 지어내지 않고 배너로 말한다 — 「이 PC의 사내 자료에는 이 내용이 없습니다」·「지정하신 문서 범위에서는 검색되지 않았습니다」·「근거 약함」 (server/src/engine/llm.ts:109·114·1062). GIJO Agent(normaltic)는 한 단계 더 강해서 자료 0건이면 LLM을 아예 부르지 않는다 (server/src/engine/llm.ts:729·734, GIJO_AS_RAG_구성_가이드.md:193~194).
- 그라운딩 지시문 한 줄(「사전지식과 달라도 사내 자료 우선」)이 7B의 오답을 정답으로 바꿨다 — **14B로 교체하는 것보다 효과적이었고 비용은 0**이었다 (GIJO_AS_RAG_구성_가이드.md:191).
- 검색된 조각과 붙여넣은 자료는 모델에 닿기 전에 살균한다. `ragsanitize.ts`는 문서 안에 숨은 지시문을 걷어내고(2026-07-30 실측으로 뚫렸다) (server/src/engine/ragsanitize.ts:1~9), `pasteddata.ts`는 대화창에 붙여넣은 **자료 구간**만 갈라 같은 규칙을 적용한다 — 입구에서 전부 막으면 정상 업무가 오탐으로 막히기 때문이다 (server/src/engine/pasteddata.ts:1~16).
- 방어를 프롬프트로 하지 않는 것이 이 저장소의 확립 원칙이다 — 「모델에 닿기 전에 지시문 문장을 들어낸다. 안 본 문장은 따를 수 없다」 (server/src/engine/pasteddata.ts:19~23, GIJO_AS_RAG_아키텍처_LLM연동.md:33~34).

## 4. 온톨로지 — RAG의 짝

- 표준 코드 사이의 관계망을 9출처·약 2,000 트리플로 갖고 있다(KISA·ATLAS·OWASP LLM·NIST AI RMF·CWE·ATT&CK 등) (GIJO_AS_온톨로지_강화_가이드.md:6~19).
- 모든 시드는 출처 태그별로 **멱등** 적재된다(그 출처만 지우고 다시 넣어 수동 입력분은 보존) (GIJO_AS_온톨로지_강화_가이드.md:20~22).
- 적재 라우트 `POST /api/ontology/seed`는 2026-08-27에 `ontology-seed.ts`로 이사했다 (server/src/engine/ontology-seed.ts:156~159, server/src/engine/ontology.ts:342).
- 새 표준을 넣을 때 규칙: 노드 이름을 기존 참조 코드와 **글자 그대로** 맞춰야 자동으로 이어진다 (GIJO_AS_온톨로지_강화_가이드.md:26~30).

## 5. 라우팅 — 도구 100개 위의 세 겹 장치

- 지금 도구는 **100개**다 (server/src/engine/agenttools/registry.ts:216 `TOOLS`, `domain:` 항목 100건). 라이트 에디션은 허용목록으로 **16개**만 켠다 (server/src/lite/lite-tools.json의 `tools` 16건 → server/src/lite/index.ts:26·36, `setToolAllowlist` server/src/engine/agenttools/registry.ts:2149).
- 세 겹으로 라우팅을 좁힌다: ① 화면 업무영역으로 후보 축소(`listToolsFor(domains, role)`) (registry.ts:2173) ② 대표 문구는 LLM 판단을 건너뛰는 강제 분기 `FORCED_INTENTS` **79개** (server/src/engine/agentloop.ts:831~1647, 소비는 `forcedToolFor` 1709) ③ 실행 문턱에서 권한·허용 여부 재검사 (registry.ts:2316~2317).
- 설계해 둔 **랭킹 기반 사전 라우팅(`rankToolsFor`)은 아직 없다** — 제품 코드(.ts) 검색 0건이고, 이름은 설계 가이드에만 있다(GIJO_AS_디스패치_사전라우팅_가이드.md:49). 가이드도 「지금 구현하지 않는다」로 시작한다 (같은 문서 3줄).
- 하지 말 것으로 못 박은 것: 키워드 하드 필터로 후보 제외(정답 도구를 빼면 회복 불가)·7B에 라우팅 규칙 프롬프트 추가·측정 없이 켜기 (GIJO_AS_디스패치_사전라우팅_가이드.md:61~64).
- 도구 설명을 넓게 쓰면 라우팅이 흔들린다 — `ontology_query` 설명을 넓혔더니 회귀가 11/11 → 9/11로 떨어졌다. 도구를 더하면 반드시 `tools/regress`를 돌린다 (GIJO_AS_RAG_아키텍처_LLM연동.md:187~190).
- 7B 시절 실측이 남긴 원칙: 「프롬프트·설명 규칙만으로는 모델의 실행별 변동을 못 잡는다 — 명백한 문구는 결정적 후처리로 못박는다」 (GIJO_AS_챗봇_라우팅_정확도_리포트.md:39~49).
- 라우팅 측정은 서버 재시작이 없는 구간에서만 유효하다(워밍 중 모델이 도구 선택을 흔든다) (GIJO_AS_챗봇_라우팅_정확도_리포트.md:51~53).

## 6. 평가 게이트 — 채택 전에 반드시 지나는 관문

- 모델 교체·프롬프트 변경·합성·파인튜닝 후보는 3축(라우팅·안전·한국어) 고정 문항을 실서버에 돌려 **기준선보다 하나라도 떨어지면 채택 보류**한다 (tools/evalgate/run.mjs:1~8).
- 채점은 결정적으로만 한다 — 정규식·디스패치 신호·한글 비율이며 LLM 심판을 쓰지 않는다(비결정 채점기가 끼면 게이트 자체를 믿을 수 없다) (tools/evalgate/run.mjs:10~11). 레드팀 견고성은 **9회 중앙값**으로 재고, 1회 측정은 폭이 43점이라 쓰지 않는다 (tools/evalgate/run.mjs:16~19).
- 승인된 기준선(2026-08-20, gitRev f0c2207c): 라우팅 66/66 · 안전 48/48 · 한국어 24/24 · 음성(하면 안 되는 것) 14/14 (tools/evalgate/baseline.json:2~41).
- 견고성 두 숫자는 뜻이 다르다 — **맨몸 67점**(가드레일 없이 모델만: 30개 중 10개 뚫림)과 **제품 경로 100점**(입구 차단 13·모델 버팀 17·뚫림 0) (tools/evalgate/baseline.json:43~68).
- 공격 세트는 `redteam.ts`의 PAYLOADS이고 한국어 간접 주입(`ko-*`) 문항이 포함돼 있다 (server/src/engine/redteam.ts:134·191~233).
- 문항은 전부 `qa:true`로 보내 학습 후보함·작업내역을 오염시키지 않는다 (tools/evalgate/run.mjs:20~21).

## 7. 말투 — 목소리는 하나, 어조만 다섯

- 규범 문서가 단일 출처이고, 코드가 어기면 `server/test/tone.test.ts`가 막는다 (GIJO_AS_대화창_말투규범.md:3~4). 코드 쪽 짝은 `tone.ts`다 (server/src/engine/tone.ts:1~3).
- 목소리는 「일 잘하는 보안 실무 동료」 — 합쇼체 통일·숫자와 사실 먼저·가르치지 않기·화면 답은 2,000자 이내 (GIJO_AS_대화창_말투규범.md:31~37). 어조는 조회·경고·거절·못 찾음·다음 걸음 다섯 가지다 (GIJO_AS_대화창_말투규범.md:43~51).
- 상태 표식은 뜻을 하나로 고정한다(🔴🟠🟡🟢☐⚠▸📍🛡🔎✓✗🛠🤖❔🧭💡📋🧹) — 사전에 없는 기호는 새로 쓰지 않고 사전에 먼저 올린다 (server/src/engine/tone.ts:21~56, GIJO_AS_대화창_말투규범.md:64~87).
- 뜻이 겹치는 기호는 금지다(✅→✓, ❌→✗, ⚠️→⚠, ➖→—) — 한 화면에서 ✅와 ✓를 같이 쓰던 실측이 근거다 (server/src/engine/tone.ts:63~70, GIJO_AS_대화창_말투규범.md:92~99).
- 🤖의 뜻은 **좁혔다(2026-08-04)** — 지금 뜻은 「AI가 쓴 글 — 사람이 확인할 것」이고, 코드가 결정적으로 만든 답에는 붙이지 않는다 (server/src/engine/tone.ts:43~48). ※ 규범 문서 표는 아직 옛 뜻(「챗봇이 안내하는 글」)으로 남아 있다 (GIJO_AS_대화창_말투규범.md:79).
- 금지 목록: 예고(~해 드리겠습니다)·반복 사과·자기소개·내부 사정·소스 경로·내부 식별자·영문 상태값·숫자만 주고 끝·잘라 놓고 안 밝히기·지어내기 (GIJO_AS_대화창_말투규범.md:105~117). 못 구한 값은 0이 아니라 빈칸(—)으로 적는다 (GIJO_AS_대화창_말투규범.md:122).
- 「AI 문체 같다」는 인상은 재보니 병목이 아니었다 — 우리 답 중앙값 0.153 vs 사람이 쓴 우리 문서 0.052·GPT-4o 0.934. 그래서 윤문 LoRA는 뒤로 미뤘다(문체를 먼저 다듬으면 틀린 답이 더 그럴듯해진다) (GIJO_AS_문체_AI스러움_실측_2026-08-10.md:37~40·85~87).

## 8. 예전엔 이랬다 (한 줄로만)

- 예전엔 기본 모델이 gijo-main-orchestrator(7.6B)였다 — 2026-08-09에 qwen3-14b로 승격 (server/src/engine/localengine.ts:33~41).
- 예전엔 티어를 「동시 모델 수」로 갈랐다 — 2026-08-12 실측 뒤 주 변수는 **문맥(ctx)**이 됐다 (server/src/engine/localengine.ts:104~109).
- 예전엔 라이트 등급이 8GB·16K였다 — 2026-08-12 사장님 결정으로 10GB·8K가 됐다 (server/src/engine/localengine.ts:113~127).
- 예전엔 Pro desc가 「채팅 LLM 2개 · A/B·검증 병행」이었다 — 코드에 없는 기능이라 2026-08-18에 정직 표기로 고쳤다 (server/src/engine/localengine.ts:129~136).
- 예전엔 학습 준비물 안내가 「pip install unsloth」였다 — 지금 학습 스크립트는 unsloth 없이 transformers+peft로 돈다 (server/src/engine/trainenv.ts:1~9).
