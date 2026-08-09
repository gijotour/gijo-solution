# GIJO AS — 시험 지도

`node tools/test-map.mjs` 로 만듭니다. **손으로 고치지 마세요** — 다시 만들면 덮어씁니다.

시험 파일 **275개**. 분류 근거는 파일 이름이 아니라 **그 시험이 실제로 import하는 소스**입니다.

```
server/test/
├── ★ 감시 — 약속을 지키는지 본다/  (33)
│   ├── answerlength.test.ts
│   ├── auditactor.test.ts
│   ├── backup.test.ts
│   ├── clientglobals.test.ts
│   ├── consoledrawer.test.ts
│   ├── corpusleak.test.ts
│   ├── deadelements.test.ts
│   ├── dispatchentrances.test.ts
│   ├── docs-exclusion.test.ts
│   ├── docsbundle.test.ts
│   ├── evalgateeffective.test.ts
│   ├── findingcount.test.ts
│   ├── ga-readiness.test.ts
│   ├── guidance-routing.test.ts
│   ├── guidecard.test.ts
│   ├── learnhygiene.test.ts
│   ├── listformat.test.ts
│   ├── longanswer.test.ts
│   ├── longnotice.test.ts
│   ├── modelscan-wrapper.test.ts
│   ├── navwiring.test.ts
│   ├── no-hardcoded-credentials.test.ts
│   ├── promptcache.test.ts
│   ├── reportactivity.test.ts
│   ├── screencontextlink.test.ts
│   ├── seedintake.test.ts
│   ├── sessionarchive.test.ts
│   ├── shelllayout.test.ts
│   ├── shotlist.test.ts
│   ├── silentbuttons.test.ts
│   ├── streamdispatch.test.ts
│   ├── uireadability.test.ts
│   └── vizpromise.test.ts
├── 보안·인증/  (34)
│   ├── airgap.test.ts
│   ├── auth.test.ts
│   ├── auth-secret-guard.test.ts
│   ├── cloudegress.test.ts
│   ├── cors.test.ts
│   ├── cryptopack.test.ts
│   ├── dbcrypt.test.ts
│   ├── dbencrypt.test.ts
│   ├── effectiverobustness.test.ts
│   ├── gateway.test.ts
│   ├── gatewaypii.test.ts
│   ├── gradeblock.test.ts
│   ├── guardrail.test.ts
│   ├── hardening.test.ts
│   ├── harmfulrequest.test.ts
│   ├── injectionrules.test.ts
│   ├── innerkeymask.test.ts
│   ├── inputvalidation.test.ts
│   ├── internalprompt.test.ts
│   ├── maintenance.test.ts
│   ├── mfa.test.ts
│   ├── promptleak.test.ts
│   ├── promptleak-overlap.test.ts
│   ├── promptleak-retry.test.ts
│   ├── ragsanitize.test.ts
│   ├── redteam.test.ts
│   ├── routing-leak.test.ts
│   ├── scopeguard.test.ts
│   ├── secretscan.test.ts
│   ├── selfinstall.test.ts
│   ├── sessionmgmt.test.ts
│   ├── totp.test.ts
│   ├── users.test.ts
│   └── verifyaccess.test.ts
├── 대화·라우팅/  (63)
│   ├── adapters.test.ts
│   ├── adaptertools.test.ts
│   ├── agentapproval.test.ts
│   ├── agentfinding.test.ts
│   ├── agentloop.test.ts
│   ├── agents.test.ts
│   ├── agenttools-cross.test.ts
│   ├── anaphora-reask.test.ts
│   ├── approvals.test.ts
│   ├── asset-search-reason.test.ts
│   ├── assetanaphora.test.ts
│   ├── assetcoveragetool.test.ts
│   ├── assignroute.test.ts
│   ├── cmdsuggest.test.ts
│   ├── consoleguide.test.ts
│   ├── demo-disclosure.test.ts
│   ├── demoscript.test.ts
│   ├── dispatchcollect.test.ts
│   ├── dispatcher.test.ts
│   ├── docdigest.test.ts
│   ├── docdupe.test.ts
│   ├── domaintools.test.ts
│   ├── exposed-assets.test.ts
│   ├── falseclaim.test.ts
│   ├── forced-write-approval.test.ts
│   ├── fppattern.test.ts
│   ├── gaptools.test.ts
│   ├── intent.test.ts
│   ├── interpretline.test.ts
│   ├── knowledge-bundle-inbox.test.ts
│   ├── lawlookup-screen.test.ts
│   ├── listassets-filter.test.ts
│   ├── map-view.test.ts
│   ├── moatslices.test.ts
│   ├── modeldex.test.ts
│   ├── modelsmoke.test.ts
│   ├── mytasks.test.ts
│   ├── nextstep.test.ts
│   ├── ops147-regress.test.ts
│   ├── orchestrator-dataset.test.ts
│   ├── orchestrator-fewshot.test.ts
│   ├── picklist.test.ts
│   ├── policyroute.test.ts
│   ├── productintro.test.ts
│   ├── reportactivity-tool.test.ts
│   ├── routes.test.ts
│   ├── routingfixes.test.ts
│   ├── sbomtools.test.ts
│   ├── scope-resolve.test.ts
│   ├── screen-where.test.ts
│   ├── screencontext.test.ts
│   ├── screenguide.test.ts
│   ├── selectioncontext.test.ts
│   ├── smalltalk.test.ts
│   ├── stepdisambiguate.test.ts
│   ├── tooldomain.test.ts
│   ├── tools.test.ts
│   ├── undo.test.ts
│   ├── urgentroute.test.ts
│   ├── vulntools.test.ts
│   ├── workflow.test.ts
│   ├── worklockroute.test.ts
│   └── worksteps.test.ts
├── 말투·표기/  (8)
│   ├── findingplain.test.ts
│   ├── report-preamble.test.ts
│   ├── severity-korean.test.ts
│   ├── statuswords.test.ts
│   ├── statuswords-attrs.test.ts
│   ├── tone.test.ts
│   ├── tone-realanswers.test.ts
│   └── tonewatch.test.ts
├── 모델·엔진/  (22)
│   ├── adapterimport.test.ts
│   ├── candidatehygiene.test.ts
│   ├── dataset.test.ts
│   ├── datasethygiene.test.ts
│   ├── examquestions.test.ts
│   ├── finetune.test.ts
│   ├── hfmodels.test.ts
│   ├── hfmodels-queue.test.ts
│   ├── hygiene-real-measure.test.ts
│   ├── llamabin.test.ts
│   ├── llm.test.ts
│   ├── llmactivity.test.ts
│   ├── localengine.test.ts
│   ├── localengine-tier.test.ts
│   ├── merge.test.ts
│   ├── modeladoption.test.ts
│   ├── modelauth.test.ts
│   ├── modellicense.test.ts
│   ├── modelquirks.test.ts
│   ├── observability-model.test.ts
│   ├── pythonbin.test.ts
│   └── trainenv.test.ts
├── 지식·RAG/  (30)
│   ├── answerfeedback.test.ts
│   ├── bundleimport.test.ts
│   ├── bundleverify.test.ts
│   ├── categoryreject.test.ts
│   ├── docbox.test.ts
│   ├── docenrich.test.ts
│   ├── docgraph.test.ts
│   ├── docrequest.test.ts
│   ├── glossary.test.ts
│   ├── grounding.test.ts
│   ├── howto.test.ts
│   ├── hybridsearch.test.ts
│   ├── ingestquality.test.ts
│   ├── kbhygiene.test.ts
│   ├── kbhygiene-demo.test.ts
│   ├── knowledgebundle.test.ts
│   ├── learncandidates.test.ts
│   ├── learnloop.test.ts
│   ├── learnlooptopic.test.ts
│   ├── learnpolicy.test.ts
│   ├── memory.test.ts
│   ├── ontology.test.ts
│   ├── ontology-atlas.test.ts
│   ├── ontology.routes.test.ts
│   ├── productfaq.test.ts
│   ├── productmanualcleanup.test.ts
│   ├── rag-weak-evidence.test.ts
│   ├── rolesearch.test.ts
│   ├── terms.test.ts
│   └── topictag.test.ts
├── 취약점·자산/  (31)
│   ├── assetbyname.test.ts
│   ├── assetcoverage.test.ts
│   ├── assetcoverage.routes.test.ts
│   ├── assetdocsearch.test.ts
│   ├── assethub.test.ts
│   ├── assethub-source.test.ts
│   ├── assetimport.test.ts
│   ├── assets.test.ts
│   ├── attackpath.test.ts
│   ├── audit.test.ts
│   ├── autoassign.test.ts
│   ├── autoupload.test.ts
│   ├── briefing.test.ts
│   ├── cloudllm.test.ts
│   ├── compliance.test.ts
│   ├── crosscorrelation.test.ts
│   ├── ctimatch.test.ts
│   ├── eol-seed.test.ts
│   ├── findingsrestore.test.ts
│   ├── kpi.test.ts
│   ├── packagescan.test.ts
│   ├── reposcan.test.ts
│   ├── sbom.test.ts
│   ├── scanoverwrite.test.ts
│   ├── serviceimpact.test.ts
│   ├── shadowai.test.ts
│   ├── today.test.ts
│   ├── vexexport.test.ts
│   ├── vulnimport-owner.test.ts
│   ├── vulnscan.test.ts
│   └── webreport.test.ts
├── 규정·법령/  (4)
│   ├── actioncheck.test.ts
│   ├── actioncheck-verbs.test.ts
│   ├── lawarticle.test.ts
│   └── lawinfo.test.ts
├── 점검·하드닝/  (10)
│   ├── hardeningscan.test.ts
│   ├── hardeningtargets.test.ts
│   ├── incidentsteps.test.ts
│   ├── netmikorunner.test.ts
│   ├── playbook.test.ts
│   ├── report.test.ts
│   ├── securityproducts.test.ts
│   ├── verifyengine.test.ts
│   ├── verifyrag.test.ts
│   └── verifyroutes.test.ts
├── 로그·분석/  (13)
│   ├── activityaudit.test.ts
│   ├── analysis.test.ts
│   ├── analysishub.test.ts
│   ├── clientdownloadlog.test.ts
│   ├── cti.test.ts
│   ├── eventlifecycle.test.ts
│   ├── logguide.test.ts
│   ├── logs.test.ts
│   ├── observability.test.ts
│   ├── siem.test.ts
│   ├── slowanswers.test.ts
│   ├── threesourceingest.test.ts
│   └── workprogress.test.ts
├── 보고·리포트/  (6)
│   ├── progress.test.ts
│   ├── qalongwait.test.ts
│   ├── reporthandoff.test.ts
│   ├── reportschedule.test.ts
│   ├── timesaved.test.ts
│   └── usage.test.ts
├── 업무·세션/  (11)
│   ├── alertschedule.test.ts
│   ├── collaboration.test.ts
│   ├── datacleanup.test.ts
│   ├── handover.test.ts
│   ├── handoverhistory.test.ts
│   ├── mywork.test.ts
│   ├── sessionpatterns.test.ts
│   ├── task-dedupe.test.ts
│   ├── tasks.test.ts
│   ├── teamview.test.ts
│   └── worksessions.test.ts
├── 화면·클라이언트/  (4)
│   ├── clientrelease.test.ts
│   ├── personaldocs.test.ts
│   ├── viewerctx.test.ts
│   └── windowlayout.test.ts
├── 기반(DB·유틸)/  (6)
│   ├── date.test.ts
│   ├── db.test.ts
│   ├── dbkey.test.ts
│   ├── email.test.ts
│   ├── gracefulclose.test.ts
│   └── versioncmp.test.ts
```

## 영역별 근거

| 영역 | 개수 | 대표 시험 → 무엇을 부르나 |
| --- | ---: | --- |
| ★ 감시 — 약속을 지키는지 본다 | 33 | `answerlength` → 소스·문서를 직접 읽어 검사 · `auditactor` → 소스·문서를 직접 읽어 검사 |
| 보안·인증 | 34 | `airgap` → src/engine/airgap · `auth` → src/app |
| 대화·라우팅 | 63 | `adapters` → src/engine/adapters · `adaptertools` → src/engine/agentloop |
| 말투·표기 | 8 | `findingplain` → src/engine/findingplain · `report-preamble` → src/engine/llm |
| 모델·엔진 | 22 | `adapterimport` → (제품 소스 import 없음) · `candidatehygiene` → src/engine/datasethygiene |
| 지식·RAG | 30 | `answerfeedback` → src/engine/answerfeedback · `bundleimport` → src/engine/ontology |
| 취약점·자산 | 31 | `assetbyname` → src/engine/assets · `assetcoverage` → src/engine/assetcoverage |
| 규정·법령 | 4 | `actioncheck` → src/engine/actioncheck · `actioncheck-verbs` → src/engine/actioncheck |
| 점검·하드닝 | 10 | `hardeningscan` → src/app · `hardeningtargets` → src/app |
| 로그·분석 | 13 | `activityaudit` → src/engine/activityaudit · `analysis` → src/engine/analysis |
| 보고·리포트 | 6 | `progress` → src/engine/progress · `qalongwait` → src/engine/longanswer |
| 업무·세션 | 11 | `alertschedule` → src/db · `collaboration` → src/app |
| 화면·클라이언트 | 4 | `clientrelease` → (제품 소스 import 없음) · `personaldocs` → src/db |
| 기반(DB·유틸) | 6 | `date` → src/util/date · `db` → (제품 소스 import 없음) |

> 분류 못 한 시험은 없습니다.

## ★ 감시 시험이란

제품 코드를 부르는 대신 **소스와 문서를 직접 읽어** 약속이 지켜지는지 보는 시험입니다(33개). 예: 제품이 "이렇게 물어보세요"라고 적어 준 말이 정말 그 기능으로 가는가(`guidance-routing`), 비밀번호가 코드에 적혀 있지 않은가(`no-hardcoded-credentials`), 눌러도 말없는 버튼이 없는가(`silentbuttons`).

> ⚠ **헛통과 주의.** 감시 시험은 대상을 하나도 못 읽으면 「0건 발견」으로 **항상 통과**합니다. 그래서 각 시험은 「대상을 실제로 읽었는가」를 함께 확인합니다. 그 확인을 지우지 마세요.
