// GIJO AS 클라이언트 — WebSocket 클라이언트
// 서버가 브로드캐스트하는 실시간 이벤트(collaboration:event, finetune:progress)를 구독한다.
// 과거(단일 앱) 버전의 ipcRenderer.on() 패턴을 대체한다.

import { getServerUrl } from "./apiClient";

type Listener = (payload: unknown) => void;

let socket: WebSocket | null = null;
const listeners = new Map<string, Set<Listener>>();
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function wsUrlFromHttp(httpUrl: string): string {
  return httpUrl.replace(/^http/, "ws") + "/ws";
}

export function connectWebSocket(): void {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;

  const url = wsUrlFromHttp(getServerUrl());
  socket = new WebSocket(url);

  socket.addEventListener("message", (event) => {
    try {
      const msg = JSON.parse(event.data as string) as { channel: string; payload: unknown };
      listeners.get(msg.channel)?.forEach((cb) => cb(msg.payload));
    } catch {
      // 파싱 실패한 메시지는 무시(서버 프로토콜 불일치 방어)
    }
  });

  socket.addEventListener("close", () => {
    // 서버 재시작/네트워크 단절 대비 재접속 (5초 간격, 단순 스캐폴드 수준)
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connectWebSocket, 5000);
  });

  socket.addEventListener("error", () => {
    socket?.close();
  });
}

export function onChannel(channel: string, cb: Listener): void {
  if (!listeners.has(channel)) listeners.set(channel, new Set());
  listeners.get(channel)!.add(cb);
}

export function offChannel(channel: string, cb: Listener): void {
  listeners.get(channel)?.delete(cb);
}
