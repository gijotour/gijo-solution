// GIJO AS 서버 — 부트스트랩 (HTTP 리스닝 + WebSocket)
// 이 프로세스가 RTX 3090 GPU 머신에서 상시 실행되며, 로컬 LLM·자산DB·SBOM 등
// 상태를 가진 모든 엔진을 단독 소유한다. 클라이언트(Electron 앱)는 여러 대가
// 이 서버 하나에 REST/WebSocket으로 접속한다.

import { createServer } from "http";
import { WebSocketServer } from "ws";

import { createApp } from "./app";
import { attachCollaborationSocket } from "./engine/collaboration";
import { attachFinetuneSocket } from "./engine/finetune";
import { attachAssetsSocket } from "./engine/assets";
import { attachLogsSocket, installConsoleCapture } from "./engine/logs";
import { attachLlmActivitySocket } from "./engine/llmactivity";
import { attachHfModelsSocket } from "./engine/hfmodels";
import { attachLearnloopSocket } from "./engine/learnloop";
import { stopLocalEngine, stopEmbeddingEngine, autoStartLocalEngines } from "./engine/localengine";

// 가능한 한 이른 시점에 설치해야 이후의 console.log/warn/error가 전부 캡처된다.
installConsoleCapture();

const PORT = Number(process.env.GIJO_SERVER_PORT ?? 4000);

const app = createApp();
const httpServer = createServer(app);

// 실시간 채널: collaboration:event, finetune:progress, asset:updated, log:event, hf-download:progress 등을 모든 접속 클라이언트에 브로드캐스트
const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
attachCollaborationSocket(wss);
attachFinetuneSocket(wss);
attachAssetsSocket(wss);
attachLogsSocket(wss);
attachLlmActivitySocket(wss);
attachHfModelsSocket(wss);
attachLearnloopSocket(wss);

httpServer.listen(PORT, () => {
  console.log(`GIJO AS 서버 기동 — http://localhost:${PORT} (WebSocket: /ws)`);
  console.log("standalone 모드: 클라이언트 GIJO_SERVER_URL을 http://localhost:" + PORT + " 로 설정하면 같은 머신에서 붙습니다.");
  // 모델 파일이 있으면 채팅 LLM + 임베딩 서버를 자동 기동 — 실패해도 서버 자체는 계속 뜬다.
  void autoStartLocalEngines().catch((err) => console.error("[index] 로컬 LLM 자동 시작 실패:", err));
});

// 서버 프로세스 종료 시 자식으로 띄운 llama-server가 고아 프로세스로 남지 않도록 함께 정리한다.
async function shutdown(signal: string): Promise<void> {
  console.log(`[index] ${signal} 수신 — 로컬 LLM 엔진 정리 후 종료`);
  await Promise.all([stopLocalEngine(), stopEmbeddingEngine()]);
  httpServer.close(() => process.exit(0));
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
