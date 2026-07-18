// GIJO AS 서버 — 부트스트랩 (HTTP 리스닝 + WebSocket)
// 이 프로세스가 RTX 3090 GPU 머신에서 상시 실행되며, 로컬 LLM·자산DB·SBOM 등
// 상태를 가진 모든 엔진을 단독 소유한다. 클라이언트(Electron 앱)는 여러 대가
// 이 서버 하나에 REST/WebSocket으로 접속한다.

import { createServer } from "http";
import { createServer as createHttpsServer } from "https";
import * as fs from "fs";
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
import { refreshKev } from "./engine/kev";

// 가능한 한 이른 시점에 설치해야 이후의 console.log/warn/error가 전부 캡처된다.
installConsoleCapture();

const PORT = Number(process.env.GIJO_SERVER_PORT ?? 4000);

const app = createApp();

// TLS(HTTPS) 선택 지원 — GIJO_TLS_CERT_PATH + GIJO_TLS_KEY_PATH가 둘 다 있으면 HTTPS로 서빙한다.
// 폐쇄망 단일 서버라 평문 HTTP도 동작하지만, 사내망 스니핑 방지를 위해 운영은 TLS 권장.
const TLS_CERT = process.env.GIJO_TLS_CERT_PATH;
const TLS_KEY = process.env.GIJO_TLS_KEY_PATH;
const tlsEnabled = Boolean(TLS_CERT && TLS_KEY);
const httpServer = tlsEnabled
  ? createHttpsServer({ cert: fs.readFileSync(TLS_CERT as string), key: fs.readFileSync(TLS_KEY as string) }, app)
  : createServer(app);

// 실시간 채널: collaboration:event, finetune:progress, asset:updated, log:event, hf-download:progress 등을 모든 접속 클라이언트에 브로드캐스트
const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
attachCollaborationSocket(wss);
attachFinetuneSocket(wss);
attachAssetsSocket(wss);
attachLogsSocket(wss);
attachLlmActivitySocket(wss);
attachHfModelsSocket(wss);
attachLearnloopSocket(wss);

const scheme = tlsEnabled ? "https" : "http";
httpServer.listen(PORT, () => {
  console.log(`GIJO AS 서버 기동 — ${scheme}://localhost:${PORT} (WebSocket: /ws)${tlsEnabled ? " [TLS 활성]" : ""}`);
  console.log(`standalone 모드: 클라이언트 GIJO_SERVER_URL을 ${scheme}://localhost:${PORT} 로 설정하면 같은 머신에서 붙습니다.`);
  // 모델 파일이 있으면 채팅 LLM + 임베딩 서버를 자동 기동 — 실패해도 서버 자체는 계속 뜬다.
  void autoStartLocalEngines().catch((err) => console.error("[index] 로컬 LLM 자동 시작 실패:", err));
  // CISA KEV 목록을 백그라운드로 최신화(공개 피드 다운로드 — 실패해도 캐시로 동작).
  void refreshKev()
    .then((s) => console.log(`[kev] KEV 목록 ${s.count}건 (${s.source})`))
    .catch((err) => console.error("[kev] KEV 갱신 실패(캐시 유지):", err));
});

// 서버 프로세스 종료 시 자식으로 띄운 llama-server가 고아 프로세스로 남지 않도록 함께 정리한다.
async function shutdown(signal: string): Promise<void> {
  console.log(`[index] ${signal} 수신 — 로컬 LLM 엔진 정리 후 종료`);
  await Promise.all([stopLocalEngine(), stopEmbeddingEngine()]);
  httpServer.close(() => process.exit(0));
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
