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
import { stopLocalEngine, stopEmbeddingEngine, autoStartLocalEngines, startEmbeddingMonitor, stopEmbeddingMonitor, startChatMonitor, stopChatMonitor } from "./engine/localengine";
import { startHardeningScheduler, stopHardeningScheduler } from "./engine/hardeningtargets";
import { startReportScheduler, stopReportScheduler } from "./engine/reportschedule";
import { startBackupScheduler, stopBackupScheduler } from "./engine/backup";
import { startEventLifecycleScheduler, stopEventLifecycleScheduler } from "./engine/analysishub";
import { startSiemForwarding } from "./engine/siem";
import { startKbHygieneScheduler } from "./engine/kbhygiene";
import { refreshKev } from "./engine/kev";
import { bootstrapDocsBundleWithRetry } from "./engine/docsbundle";
import { ensureKnowledgeBundle } from "./engine/knowledgebundle";
import { bootSmtpInboundIfEnabled, stopSmtpInbound } from "./engine/smtpinbound";
import { closeHttpServer } from "./util/gracefulClose";

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
  // 이어서 임베딩 서버 hang 감시를 켠다 — 프로세스는 살아있어도 임베딩이 무응답이 되는 상태를
  // 실제 임베딩 요청으로 감지해 자동 재기동한다(실측 2026-07-19: GPU 경합으로 임베딩 hang).
  void autoStartLocalEngines()
    .catch((err) => console.error("[index] 로컬 LLM 자동 시작 실패:", err))
    .finally(() => {
      startEmbeddingMonitor();
      startChatMonitor(); // 채팅 모델도 hang(무응답) 감지·자동 재기동 — 임베딩과 동일 패턴
    });
  void bootSmtpInboundIfEnabled(); // 인바운드 SMTP(알림 집수) — 설정에서 켜져 있으면 자동 기동
  startHardeningScheduler(); // 원격 SSH 정기점검 — 만기된 스케줄을 주기적으로 실행(LLM 무관·경량)
  startReportScheduler(); // 정기 리포트(주간/분기) 자동 생성 — 만기된 스케줄을 주기적으로 실행
  startBackupScheduler(); // 자동 백업(하루 1회 + 최근 7개 보관) — 재해복구 시점 상시 확보
  startEventLifecycleScheduler(); // 이벤트 생애주기 — 해결 후 90일 지난 이벤트 자동 정리
  startSiemForwarding(); // SIEM 아웃바운드 — 감사 이벤트를 고객 SIEM으로 전달(설정 켜진 경우만)
  startKbHygieneScheduler(); // 지식베이스 위생 — 주 1회 상충·중복 점검(삭제 없이 리포트만)
  // CISA KEV 목록을 백그라운드로 최신화(공개 피드 다운로드 — 실패해도 캐시로 동작).
  void refreshKev()
    .then((s) => console.log(`[kev] KEV 목록 ${s.count}건 (${s.source})`))
    .catch((err) => console.error("[kev] KEV 갱신 실패(캐시 유지):", err));
  // 제품 문서 기본 코퍼스를 지식베이스에 인입 — 이게 있어야 "이 화면 뭐예요"에 근거를 갖고
  // 답한다(비어 있으면 지어내거나 '자료 없음'만 답한다). 임베딩 서버 기동을 기다려 재시도한다.
  void bootstrapDocsBundleWithRetry();
  void ensureKnowledgeBundle(); // 기본 지식 번들 버전 확인·자동 적용(멱등, 전-4)
});

// 서버 프로세스 종료 시 자식으로 띄운 llama-server가 고아 프로세스로 남지 않도록 함께 정리한다.
//
// 종료는 어떤 경우에도 끝나야 한다. 예전엔 httpServer.close()가 열린 연결을 기다리다
// 영영 안 끝나서 systemd가 90초 뒤 SIGKILL로 죽였다(2026-07-19 실측·재현).
// 강제 종료가 매 재시작마다 일어나면 언젠가 쓰기 도중에 걸린다.
const SHUTDOWN_DEADLINE_MS = 15_000;
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return; // 신호가 두 번 올 수 있다
  shuttingDown = true;
  console.log(`[index] ${signal} 수신 — 로컬 LLM 엔진 정리 후 종료`);

  // 무슨 일이 있어도 이 시간 안에는 프로세스가 사라진다.
  // 엔진 정리 단계가 걸려도 여기서 빠져나오도록 가장 먼저 건다.
  const deadline = setTimeout(() => {
    console.error(`[index] 종료가 ${SHUTDOWN_DEADLINE_MS}ms 안에 끝나지 않아 강제 종료합니다.`);
    process.exit(1);
  }, SHUTDOWN_DEADLINE_MS);
  deadline.unref();

  try {
    stopEmbeddingMonitor();
    stopChatMonitor();
    stopHardeningScheduler();
    stopReportScheduler();
    await Promise.all([stopLocalEngine(), stopEmbeddingEngine(), stopSmtpInbound()]);
  } catch (err) {
    // 엔진 정리에 실패해도 종료는 계속한다 — 안 끝나는 것보다 낫다.
    console.error("[index] 로컬 LLM 엔진 정리 실패(종료는 계속):", err);
  }

  const result = await closeHttpServer(httpServer, wss);
  if (result === "timeout") console.error("[index] 연결 정리 후에도 서버가 닫히지 않아 그대로 종료합니다.");
  clearTimeout(deadline);
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
