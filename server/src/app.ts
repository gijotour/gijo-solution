// GIJO AS 서버 — Express 앱 조립 (라우트 등록만, 리스닝은 index.ts 담당)
// 테스트(supertest)가 실제 포트 바인딩 없이 이 app을 직접 마운트해서 쓸 수 있도록 분리했다.

import express, { Express } from "express";
import cors from "cors";
import { schemaVersion } from "./db";

import { registerAuthRoutes } from "./auth/auth";
import { registerMfaRoutes } from "./auth/mfaroutes";
import { registerUsersRoutes } from "./auth/users";
import { isAirgapOn, EGRESS_POINTS } from "./engine/airgap";
import { registerAgentsRoutes } from "./engine/agents";
import { registerTeamViewRoutes } from "./engine/teamview";
import { registerAdapterRoutes } from "./engine/adapters";
import { registerAssetsRoutes } from "./engine/assets";
import { 자동배정_배선 } from "./engine/autoassign"; // 화살 #7 — 자산 층에 결재 층을 꽂는다(등록 없으면 자동배정이 죽는다)
import { registerAssetImportRoutes } from "./engine/assetimport";
import { registerRepoScanRoutes } from "./engine/reposcan";
import { registerVulnScanRoutes } from "./engine/vulnscan";
import { registerAutoUploadRoutes } from "./engine/autoupload";
import { registerComplianceRoutes } from "./engine/compliance";
import { registerModelDexRoutes } from "./engine/modeldex";
import { registerMergeRoutes } from "./engine/merge";
import { registerDispatcherRoutes, dispatchInstruction } from "./engine/dispatcher";
import { registerRemRequestRoutes } from "./engine/remrequest";
import { registerMemoryRoutes, 지식제공_배선 } from "./engine/memory"; // 화살 #14
import { registerHandoverRoutes } from "./engine/handover";
import { registerDataCleanupRoutes } from "./engine/datacleanup";
import { registerIngestReportRoutes } from "./engine/ingestreport";
import { registerLongAnswerRoutes, reapStaleRunning } from "./engine/longanswer";
import { registerScreenGuideRoutes } from "./engine/screenguide";
import { registerModelAuthRoutes } from "./engine/modelauth";
import { registerLawRoutes } from "./engine/lawinfo";
import { registerActivityAudit } from "./engine/activityaudit";
import { registerBridgeRoutes } from "./engine/bridge";
import { registerCollaborationRoutes } from "./engine/collaboration";
import { registerDatasetRoutes } from "./engine/dataset";
import { registerSbomReviewRoutes } from "./engine/sbomreview";
import { registerOrchestratorDatasetRoutes } from "./engine/orchestrator-dataset";
import { registerBriefingRoutes } from "./engine/briefing";
import { registerUndoRoutes } from "./engine/undo";
import { registerRedteamRoutes } from "./engine/redteam";
import { registerInspectionRoutes } from "./engine/inspectionreport";
import { registerGuardrailRoutes } from "./engine/guardrail";
import { registerWorkflowRoutes } from "./engine/workflow";
import { registerAnalysisHubRoutes } from "./engine/analysishub";
import { registerLogGuideRoutes } from "./engine/logguide";
import { registerProductIntroRoutes } from "./engine/productintro";
import { registerModelLicenseRoutes } from "./engine/modellicense";
import { registerPreflightRoutes } from "./engine/preflight";
import { registerBackupRoutes } from "./engine/backup";
import { registerDbCryptRoutes } from "./engine/dbcrypt";
import { registerDocboxRoutes } from "./engine/docbox";
import { registerRemoteLlmRoutes } from "./engine/remotellm";
import { registerLlmServeRoutes, registerLlmServeGateway } from "./engine/llmserve";
import { registerDocRequestRoutes } from "./engine/docrequest";
import { registerGitSyncRoutes } from "./engine/gitsync";
import { registerHfModelsRoutes } from "./engine/hfmodels";
import { registerIntentRoutes } from "./engine/intent";
import { registerLlmRoutes } from "./engine/llm";
import { registerLocalEngineRoutes } from "./engine/localengine";
import { registerFinetuneRoutes } from "./engine/finetune";
import { registerLearnloopRoutes, 대화수집_배선 } from "./engine/learnloop"; // 화살 #15
import { 기억성장_배선 } from "./engine/learnmemory"; // 겹 1 — 승인 문답을 그 주제 지식영역에 바로 반입(증류학습 계획서 §6-1)
import { registerLearnCandidateRoutes } from "./engine/learncandidates";
import { registerKnowledgeBundleRoutes } from "./engine/knowledgebundle";
import { registerWorkLogRoutes } from "./engine/worklog";
import { registerTimeSavedRoutes } from "./engine/timesaved";
import { registerAnswerFeedbackRoutes } from "./engine/answerfeedback";
import { registerModelAdoptionRoutes } from "./engine/modeladoption";
import { registerObservabilityRoutes } from "./engine/observability";
import { registerAlertScheduleRoutes } from "./engine/alertschedule";
import { registerWatchFolderRoutes } from "./engine/watchfolder";
import { registerToolsRoutes } from "./engine/tools";
import { registerTasksRoutes } from "./engine/tasks";
import { registerMyWorkRoutes } from "./engine/mywork";
import { registerPersonalDocsRoutes } from "./engine/personaldocs";
import { registerMaintenanceRoutes } from "./engine/maintenance";
import { registerTodayRoutes } from "./engine/today";
import { registerSecurityProductRoutes, 매뉴얼연결_배선 } from "./engine/securityproducts"; // 화살 #13 — 지식 층에 업무 층을 꽂는다
import { registerEmailRoutes } from "./engine/email";
import { registerSmtpInboundRoutes } from "./engine/smtpinbound";
import { registerCloudLlmRoutes } from "./engine/cloudllm";
import { registerDocEnrichRoutes } from "./engine/docenrich";
import { registerSbomRoutes } from "./engine/sbom";
import { registerApprovalsRoutes } from "./engine/approvals";
import { registerCtiRoutes } from "./engine/cti";
import { registerCtiMatchRoutes } from "./engine/ctimatch";
import { registerServiceImpactRoutes } from "./engine/serviceimpact";
import { registerReportRoutes } from "./engine/report";
import { registerKpiRoutes } from "./engine/kpi";
import { registerUsageRoutes, usageLoggingMiddleware } from "./engine/usage";
import { registerLogsRoutes } from "./engine/logs";
import { registerAuditRoutes } from "./engine/auditroutes"; // 화살 #3 — audit.ts는 잎이 됐다
import { registerCmdSuggestRoutes } from "./engine/cmdsuggest";
import { registerHardeningRoutes } from "./engine/hardeningscan";
import { registerHardeningTargetRoutes } from "./engine/hardeningtargets";
import { registerVerifyRoutes } from "./engine/verifyroutes";
import { registerScreenCardRoute } from "./engine/datacard";
import { registerVexRoutes } from "./engine/vexexport";
import { registerReportScheduleRoutes } from "./engine/reportschedule";
import { registerClientReleaseRoutes } from "./engine/clientrelease";
import { registerAssetHubRoutes } from "./engine/assethub";
import { registerLlmActivityRoutes } from "./engine/llmactivity";
import { registerKevRoutes } from "./engine/kev";
import { registerPlaybookRoutes } from "./engine/playbook";
import { registerShadowAiRoutes } from "./engine/shadowai";
import { registerSiemRoutes } from "./engine/siem";
import { registerKbHygieneRoutes } from "./engine/kbhygiene";
import { registerOntologyRoutes } from "./engine/ontology";
import { registerOntologySeedRoutes } from "./engine/ontology-seed"; // 화살 #4 — 씨앗 라우트는 씨앗 곁에
import { registerWorkSessionRoutes } from "./engine/worksessions";
import { registerSessionPatternRoutes } from "./engine/sessionpatterns";

// 온프레미스 배포 시 GIJO_CORS_ORIGINS(콤마 구분)로 허용 오리진을 사내망으로 제한할 수 있다.
// 미지정 시(기본 개발/단일 데스크톱 모드)는 이전과 동일하게 모든 오리진을 허용한다.
function corsOptions(): cors.CorsOptions | undefined {
  const raw = process.env.GIJO_CORS_ORIGINS;
  if (!raw) return undefined;
  const origins = raw.split(",").map((o) => o.trim()).filter(Boolean);
  return { origin: origins };
}

// 보안 응답 헤더 — 외부 의존성(helmet) 없이 핵심만. 보안 제품 자체의 최소 하드닝.
// HSTS는 TLS로 서빙할 때만(평문 HTTP에 붙이면 무의미·오해 소지).
function securityHeaders(req: express.Request, res: express.Response, next: express.NextFunction): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-XSS-Protection", "0");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  if (req.secure || process.env.GIJO_TLS_CERT_PATH) {
    res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  }
  next();
}

export function createApp(): Express {
  const app = express();
  app.disable("x-powered-by"); // 서버 스택 노출 최소화
  app.use(cors(corsOptions()));
  app.use(securityHeaders);
  // 자산 탐지 결과·Nessus 스캔·매뉴얼(base64) 업로드가 클 수 있어 기본 100kb 제한을 올린다.
  // 50mb = 스캔 텍스트 ~49MB / base64 문서 원본 ~36MB까지. 폐쇄망 단일 서버라 메모리만 유의.
  // 200mb: 대용량 보안운영 매뉴얼 PDF(base64로 약 1.33배 부풀음 — 실파일 ~150MB까지) 업로드 허용.
  // ⚠ 원격 GPU **창구**는 전역 파서보다 **먼저** 등록한다(2026-08-14 검토관 지적 M5).
  //   전역 200mb를 인증 없는 경로에 그대로 열어 두면 사설망의 아무 장치가 200MB를 메모리에
  //   밀어넣을 수 있다. 이 창구는 자기 파서(8mb)를 들고 있어, 등록 순서가 그 상한을 정한다.
  //   ⚠ 순서가 뒤집히면 상한이 조용히 200mb로 돌아간다 — llmserve.test가 이 순서를 지킨다.
  registerLlmServeGateway(app);
  app.use(express.json({ limit: "200mb" }));
  app.use(usageLoggingMiddleware);
  // 담당자가 화면에서 한 "바꾸는 행위"를 전 메뉴에서 자동으로 남긴다(2026-07-26 사용자 지시).
  // 라우트마다 손으로 붙이면 반드시 빠진다 — 실제로 보안제품 화면 전체에 감사가 없었다.
  registerActivityAudit(app);

  registerAuthRoutes(app);
  registerMfaRoutes(app);
  registerUsersRoutes(app);
  registerAgentsRoutes(app);
  registerTeamViewRoutes(app); // AI팀 구성 한눈에(2026-08-09) — 설정·팀 사무실이 같은 그림을 본다
  registerAdapterRoutes(app);
  자동배정_배선();
  매뉴얼연결_배선(); // ⚠ 등록 없으면 매뉴얼 자동 연결이 소리 없이 안 된다
  지식제공_배선();   // ⚠ 등록 없으면 RAG가 조용히 꺼진다(근거 없는 답)
  대화수집_배선();   // ⚠ 등록 없으면 학습 후보가 안 쌓인다 // ⚠ 등록 없으면 매뉴얼 자동 연결이 소리 없이 안 된다 //
  기억성장_배선();   // ⚠ 등록 없으면 승인해도 기억이 안 자란다(학습 재료로만 쌓인다) ⚠ 라우트 등록보다 먼저 — 부팅 중 들어온 스캔도 배정되게
  registerAssetsRoutes(app);
  registerAssetImportRoutes(app);
  registerRepoScanRoutes(app);
  registerVulnScanRoutes(app);
  registerAutoUploadRoutes(app);
  registerComplianceRoutes(app);
  registerModelDexRoutes(app);
  registerMergeRoutes(app);
  registerDispatcherRoutes(app);
  registerRemRequestRoutes(app); // 조치·수정 요청 등록부(2026-08-21)
  registerMemoryRoutes(app);
  registerModelAuthRoutes(app);
  registerHandoverRoutes(app);
  registerDataCleanupRoutes(app);
  registerIngestReportRoutes(app);
  registerLongAnswerRoutes(app);
  registerScreenGuideRoutes(app);
  registerLawRoutes(app);
  reapStaleRunning(); // 서버가 죽었다 살아나면 진행 중이던 건 정리한다(영원히 대기 방지)
  registerBridgeRoutes(app);
  registerCollaborationRoutes(app);
  registerDatasetRoutes(app);
  registerSbomReviewRoutes(app);
  registerOrchestratorDatasetRoutes(app);
  registerBriefingRoutes(app);
  registerUndoRoutes(app);
  // ★ dispatch 주입(화살 #1) — 레드팀이 dispatcher를 직접 물면 61개 순환 덩어리의 목줄이 된다.
  //   조립 층인 여기가 넣어 준다(redteam.ts 머리주석). qa 플래그까지의 인자만 쓴다.
  registerRedteamRoutes(app, { dispatch: (text, sessionId, screen, agent, qa) => dispatchInstruction(text, sessionId, screen, agent, qa) });
  registerInspectionRoutes(app);  // 고객사 AI 보안 점검 결과보고서(점검 상품화 4단계)
  registerGuardrailRoutes(app);
  registerWorkflowRoutes(app);   // 업무 절차 5단계 현황(절차 띠가 읽는다)
  registerAnalysisHubRoutes(app);
  registerLogGuideRoutes(app);
  registerProductIntroRoutes(app);
  registerModelLicenseRoutes(app);
  registerPreflightRoutes(app);
  registerBackupRoutes(app);
  registerDbCryptRoutes(app); // 저장 암호화 상태·복구 열쇠 재발급
  registerDocboxRoutes(app); // 문서함 — 출하 문서를 담당자가 직접 읽는 통로
  registerRemoteLlmRoutes(app); // 원격 LLM(BridgeAI 1단계) — VPN 전용, 사장님 결정 2026-08-13
  registerLlmServeRoutes(app); // 원격 GPU **내주는 쪽** — 붙을 상대가 없던 구멍을 메운다(2026-08-14)
  registerDocRequestRoutes(app); // 문서함 — 제품 요청 문서 만들기(파일 저장은 클라이언트가)
  registerGitSyncRoutes(app);
  registerHfModelsRoutes(app);
  registerIntentRoutes(app);
  registerLlmRoutes(app);
  registerLocalEngineRoutes(app);
  registerFinetuneRoutes(app);
  registerLearnloopRoutes(app);
  registerLearnCandidateRoutes(app); // 학습 후보함(환류 1단계, 2026-07-29)
  registerKnowledgeBundleRoutes(app); // 기본 지식 번들(전-4, 2026-07-29)
  registerWorkLogRoutes(app); // 자동화 작업 원장(중-2, 2026-07-29)
  registerTimeSavedRoutes(app); // "AI가 아낀 시간" KPI(중-2)
  registerAnswerFeedbackRoutes(app); // 답변 지적 → 회귀셋 흡수(중-1)
  registerModelAdoptionRoutes(app); // 모델 채택 원장 — 게이트 통과분만 배포(중-4)
  registerObservabilityRoutes(app); // 자가 진단(후-1 관측성)
  registerAlertScheduleRoutes(app); // 정기 알림(후-1 알림 스케줄)
  registerWatchFolderRoutes(app); // 📂 지켜보는 폴더 조회(내 문서 판) — 등록·해제는 대화창 결재판만(2026-08-31)
  registerToolsRoutes(app);
  registerTasksRoutes(app);
  registerMyWorkRoutes(app);
  registerPersonalDocsRoutes(app);
  registerMaintenanceRoutes(app);
  registerTodayRoutes(app);
  registerSecurityProductRoutes(app);
  registerEmailRoutes(app);
  registerSmtpInboundRoutes(app);
  registerCloudLlmRoutes(app);
  registerDocEnrichRoutes(app);
  registerSbomRoutes(app);
  registerApprovalsRoutes(app);
  registerCtiRoutes(app);
  registerCtiMatchRoutes(app);
  registerServiceImpactRoutes(app);
  registerReportRoutes(app);
  registerReportScheduleRoutes(app);
  registerClientReleaseRoutes(app);
  registerAssetHubRoutes(app);
  registerKpiRoutes(app);
  registerUsageRoutes(app);
  registerLogsRoutes(app);
  registerAuditRoutes(app);
  registerCmdSuggestRoutes(app);
  registerHardeningRoutes(app);
  registerHardeningTargetRoutes(app);
  registerVerifyRoutes(app); // 조치 검증(찾은 취약점이 닫혔는지 확인) — 하드닝과 수집 계층 공유
  registerScreenCardRoute(app); // 화면 열기 → 현황 카드(2026-08-20 — 메뉴를 누르면 대화창에 상위 카드)
  registerVexRoutes(app);    // VEX 내보내기 — 승인 상태를 국제 표준(CycloneDX VEX)으로
  registerLlmActivityRoutes(app);
  registerKevRoutes(app);
  registerPlaybookRoutes(app);
  registerShadowAiRoutes(app);
  registerSiemRoutes(app);
  registerKbHygieneRoutes(app);
  registerOntologyRoutes(app);
  registerOntologySeedRoutes(app);
  registerWorkSessionRoutes(app);
  registerSessionPatternRoutes(app);

  // serverTime: 2차 인증 6자리는 **시계**로 만들어진다 — 휴대폰과 서버 시각이 어긋나면 아무도
  // 못 들어온다. 로그인 화면이 아직 인증 전이라 이 무인증 응답으로 서버 시각을 비교해 보여준다.
  app.get("/api/health", (_req, res) =>
    // 에어갭 봉인 상태를 헬스에 실어 **보이게** 한다(후-4) — 기밀 배치 관리자가 "봉인됐나"를
    //   설정을 믿지 않고 확인할 수 있게. 상세(대체 안내)는 대화창 「에어갭 상태」가 답한다.
    res.json({ ok: true, service: "gijo-as-server", schema: schemaVersion(), serverTime: Date.now(), airgap: { on: isAirgapOn(), egressPoints: EGRESS_POINTS.length } })
  );

  return app;
}
