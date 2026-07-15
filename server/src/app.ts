// GIJO AS 서버 — Express 앱 조립 (라우트 등록만, 리스닝은 index.ts 담당)
// 테스트(supertest)가 실제 포트 바인딩 없이 이 app을 직접 마운트해서 쓸 수 있도록 분리했다.

import express, { Express } from "express";
import cors from "cors";

import { registerAuthRoutes } from "./auth/auth";
import { registerUsersRoutes } from "./auth/users";
import { registerAgentsRoutes } from "./engine/agents";
import { registerAssetsRoutes } from "./engine/assets";
import { registerDispatcherRoutes } from "./engine/dispatcher";
import { registerMemoryRoutes } from "./engine/memory";
import { registerBridgeRoutes } from "./engine/bridge";
import { registerCollaborationRoutes } from "./engine/collaboration";
import { registerDatasetRoutes } from "./engine/dataset";
import { registerGitSyncRoutes } from "./engine/gitsync";
import { registerHfModelsRoutes } from "./engine/hfmodels";
import { registerIntentRoutes } from "./engine/intent";
import { registerLlmRoutes } from "./engine/llm";
import { registerLocalEngineRoutes } from "./engine/localengine";
import { registerFinetuneRoutes } from "./engine/finetune";
import { registerToolsRoutes } from "./engine/tools";
import { registerTasksRoutes } from "./engine/tasks";
import { registerEmailRoutes } from "./engine/email";
import { registerSbomRoutes } from "./engine/sbom";
import { registerCtiRoutes } from "./engine/cti";
import { registerReportRoutes } from "./engine/report";
import { registerUsageRoutes, usageLoggingMiddleware } from "./engine/usage";
import { registerLogsRoutes } from "./engine/logs";

// 온프레미스 배포 시 GIJO_CORS_ORIGINS(콤마 구분)로 허용 오리진을 사내망으로 제한할 수 있다.
// 미지정 시(기본 개발/단일 데스크톱 모드)는 이전과 동일하게 모든 오리진을 허용한다.
function corsOptions(): cors.CorsOptions | undefined {
  const raw = process.env.GIJO_CORS_ORIGINS;
  if (!raw) return undefined;
  const origins = raw.split(",").map((o) => o.trim()).filter(Boolean);
  return { origin: origins };
}

export function createApp(): Express {
  const app = express();
  app.use(cors(corsOptions()));
  app.use(express.json());
  app.use(usageLoggingMiddleware);

  registerAuthRoutes(app);
  registerUsersRoutes(app);
  registerAgentsRoutes(app);
  registerAssetsRoutes(app);
  registerDispatcherRoutes(app);
  registerMemoryRoutes(app);
  registerBridgeRoutes(app);
  registerCollaborationRoutes(app);
  registerDatasetRoutes(app);
  registerGitSyncRoutes(app);
  registerHfModelsRoutes(app);
  registerIntentRoutes(app);
  registerLlmRoutes(app);
  registerLocalEngineRoutes(app);
  registerFinetuneRoutes(app);
  registerToolsRoutes(app);
  registerTasksRoutes(app);
  registerEmailRoutes(app);
  registerSbomRoutes(app);
  registerCtiRoutes(app);
  registerReportRoutes(app);
  registerUsageRoutes(app);
  registerLogsRoutes(app);

  app.get("/api/health", (_req, res) => res.json({ ok: true, service: "gijo-as-server" }));

  return app;
}
