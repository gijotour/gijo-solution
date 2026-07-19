// HTTP 서버를 확실히 닫는다.
//
// server.close()는 "새 연결만 안 받고, 기존 연결이 전부 끊길 때까지" 콜백을 부르지 않는다.
// WebSocket(/ws)과 keep-alive 연결은 스스로 끊기지 않으므로 콜백이 영영 오지 않는다.
// 실측(2026-07-19): 연결 1개만 있어도 무한 대기 → systemd가 90초 뒤 SIGKILL.
// 그래서 닫기 전에 열린 연결을 먼저 정리하고, 그래도 안 끝나면 시간을 끊는다.
import type { Server } from "http";
import type { WebSocketServer } from "ws";

export type CloseResult = "closed" | "timeout";

export async function closeHttpServer(
  server: Server,
  wss: WebSocketServer | null,
  timeoutMs = 5000
): Promise<CloseResult> {
  if (wss) {
    for (const client of wss.clients) {
      try {
        client.terminate(); // close()가 아니라 terminate() — 상대의 응답을 기다리지 않는다
      } catch {
        /* 이미 끊긴 소켓 */
      }
    }
    try {
      wss.close();
    } catch {
      /* 이미 닫힘 */
    }
  }

  // Node 18.2+ — keep-alive로 남아 있는 소켓을 끊는다.
  server.closeAllConnections?.();

  return await new Promise<CloseResult>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve("timeout");
    }, timeoutMs);
    timer.unref?.();

    server.close(() => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve("closed");
    });
  });
}
