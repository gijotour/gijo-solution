// GIJO AS 클라이언트 — WebSocket 클라이언트
// 서버가 브로드캐스트하는 실시간 이벤트(collaboration:event, finetune:progress, asset:updated, log:event)를 구독한다.
// 과거(단일 앱) 버전의 ipcRenderer.on() 패턴을 대체한다.

import { getServerUrl } from "./apiClient";

type Listener = (payload: unknown) => void;

let socket: WebSocket | null = null;
const listeners = new Map<string, Set<Listener>>();
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

// ── 연결 상태 알림(2026-09-02 F6-11) ────────────────────────────────────────
// 왜: 끊기면 5초마다 조용히 다시 붙기만 해서, **실시간 판이 멈춘 것을 담당자가 모른다.**
//     화면이 멈춘 줄 모르고 옛 숫자를 보고 판단하는 것이 이 결함의 실제 피해다.
// ⚠ 상시 배지를 만들지 않는다(2026-08-08에 없앤 결정) — 상태만 알리고, **언제 보일지는 화면이 정한다.**
type 연결상태 = { 연결됨: boolean; 끊긴시각: number | null };
let 상태: 연결상태 = { 연결됨: false, 끊긴시각: null };
const 상태구독 = new Set<(s: 연결상태) => void>();

function 상태알림(연결됨: boolean): void {
  // 끊긴 시각은 **처음 끊긴 때**를 유지한다 — 5초마다 재시도가 실패해도 시각이 밀리면
  // 「15초 넘게 끊겼나」를 영영 못 센다(재시도가 타이머를 계속 되감는 함정).
  if (연결됨) 상태 = { 연결됨: true, 끊긴시각: null };
  else 상태 = { 연결됨: false, 끊긴시각: 상태.끊긴시각 ?? Date.now() };
  상태구독.forEach((cb) => { try { cb(상태); } catch { /* 구독자 오류가 재접속을 막지 않는다 */ } });
}

/** 연결 상태가 바뀔 때마다 부른다. 붙는 즉시 현재 상태로 한 번 부른다(화면이 늦게 떠도 안 놓친다). */
export function onWsState(cb: (s: 연결상태) => void): void {
  상태구독.add(cb);
  try { cb(상태); } catch { /* 무시 */ }
}

function wsUrlFromHttp(httpUrl: string): string {
  return httpUrl.replace(/^http/, "ws") + "/ws";
}

export function connectWebSocket(): void {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;

  const url = wsUrlFromHttp(getServerUrl());
  socket = new WebSocket(url);

  socket.addEventListener("open", () => 상태알림(true));

  socket.addEventListener("message", (event) => {
    try {
      const msg = JSON.parse(event.data as string) as { channel: string; payload: unknown };
      listeners.get(msg.channel)?.forEach((cb) => cb(msg.payload));
    } catch {
      // 파싱 실패한 메시지는 무시(서버 프로토콜 불일치 방어)
    }
  });

  socket.addEventListener("close", () => {
    상태알림(false);
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
