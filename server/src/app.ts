// GIJO AS 서버 — Express 앱 조립 (라우트 등록만, 리스닝은 index.ts 담당)
// 테스트(supertest)가 실제 포트 바인딩 없이 이 app을 직접 마운트해서 쓸 수 있도록 분리했다.

import express, { Express } from "express";
import cors from "cors";
import { schemaVersion } from "./db";

import { registerAuthRoutes } from "./auth/auth";
import { registerUsersRoutes } from "./auth/users";
import { registerAgentsRoutes } from "./engine/agents";
import { registerAssetsRoutes } from "./engine/assets";
import { registerAssetImportRoutes } from "./engine/assetimport";
import { registerRepoScanRoutes } from "./engine/reposcan";
import { registerVulnScanRoutes } from "./engine/vulnscan";
import { registerAutoUploadRoutes } from "./engine/autoupload";
import { registerComplianceRoutes } from "./engine/compliance";
import { registerModelDexRoutes } from "./engine/modeldex";
import { registerMergeRoutes } from "./engine/merge";
import { registerDispatcherRoutes } from "./engine/dispatcher";
import { registerMemoryRoutes } from "./engine/memory";
import { registerBridgeRoutes } from "./engine/bridge";
import { registerCollaborationRoutes } from "./engine/collaboration";
import { registerDatasetRoutes } from "./engine/dataset";
import { registerOrchestratorDatasetRoutes } from "./engine/orchestrator-dataset";
import { registerBriefingRoutes } from "./engine/briefing";
import { registerUndoRoutes } from "./engine/undo";
import { registerRedteamRoutes } from "./engine/redteam";
import { registerGuardrailRoutes } from "./engine/guardrail";
import { registerAnalysisHubRoutes } from "./engine/analysishub";
import { registerModelLicenseRoutes } from "./engine/modellicense";
import { registerPreflightRoutes } from "./engine/preflight";
import { registerBackupRoutes } from "./engine/backup";
import { registerGitSyncRoutes } from "./engine/gitsync";
import { registerHfModelsRoutes } from "./engine/hfmodels";
import { registerIntentRoutes } from "./engine/intent";
import { registerLlmRoutes } from "./engine/llm";
import { registerLocalEngineRoutes } from "./engine/localengine";
import { registerFinetuneRoutes } from "./engine/finetune";
import { registerLearnloopRoutes } from "./engine/learnloop";
import { registerToolsRoutes } from "./engine/tools";
import { registerTasksRoutes } from "./engine/tasks";
import { registerMaintenanceRoutes } from "./engine/maintenance";
import { registerTodayRoutes } from "./engine/today";
import { registerSecurityProductRoutes } from "./engine/securityproducts";
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
import { registerAuditRoutes } from "./engine/audit";
import { registerCmdSuggestRoutes } from "./engine/cmdsuggest";
import { registerHardeningRoutes } from "./engine/hardeningscan";
import { registerHardeningTargetRoutes } from "./engine/hardeningtargets";
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
import { registerWorkSessionRoutes } from "./engine/worksessions";

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
  app.use(express.json({ limit: "200mb" }));
  app.use(usageLoggingMiddleware);

  registerAuthRoutes(app);
  registerUsersRoutes(app);
  registerAgentsRoutes(app);
  registerAssetsRoutes(app);
  registerAssetImportRoutes(app);
  registerRepoScanRoutes(app);
  registerVulnScanRoutes(app);
  registerAutoUploadRoutes(app);
  registerComplianceRoutes(app);
  registerModelDexRoutes(app);
  registerMergeRoutes(app);
  registerDispatcherRoutes(app);
  registerMemoryRoutes(app);
  registerBridgeRoutes(app);
  registerCollaborationRoutes(app);
  registerDatasetRoutes(app);
  registerOrchestratorDatasetRoutes(app);
  registerBriefingRoutes(app);
  registerUndoRoutes(app);
  registerRedteamRoutes(app);
  registerGuardrailRoutes(app);
  registerAnalysisHubRoutes(app);
  registerModelLicenseRoutes(app);
  registerPreflightRoutes(app);
  registerBackupRoutes(app);
  registerGitSyncRoutes(app);
  registerHfModelsRoutes(app);
  registerIntentRoutes(app);
  registerLlmRoutes(app);
  registerLocalEngineRoutes(app);
  registerFinetuneRoutes(app);
  registerLearnloopRoutes(app);
  registerToolsRoutes(app);
  registerTasksRoutes(app);
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
  registerLlmActivityRoutes(app);
  registerKevRoutes(app);
  registerPlaybookRoutes(app);
  registerShadowAiRoutes(app);
  registerSiemRoutes(app);
  registerKbHygieneRoutes(app);
  registerOntologyRoutes(app);
  registerWorkSessionRoutes(app);

  app.get("/api/health", (_req, res) => res.json({ ok: true, service: "gijo-as-server", schema: schemaVersion() }));

  return app;
}
