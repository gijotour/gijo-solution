import { describe, it, expect, afterEach } from "vitest";
import { createServer, get, Agent, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { closeHttpServer } from "../src/util/gracefulClose";

// 종료가 걸리던 버그의 회귀 테스트.
// server.close()는 기존 연결이 전부 끊길 때까지 콜백을 부르지 않는다 —
// WebSocket과 keep-alive는 스스로 끊기지 않으므로 영영 안 끝났다.
const PORT = 45997;
const open: { server?: Server; wss?: WebSocketServer; ws?: WebSocket; agent?: Agent }[] = [];

async function setup() {
  const server = createServer((_req, res) => res.end("ok"));
  const wss = new WebSocketServer({ server, path: "/ws" });
  await new Promise<void>((r) => server.listen(PORT, r));

  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
  await new Promise<void>((r) => ws.once("open", () => r()));

  // keep-alive 연결 하나 — 운영에서 클라이언트가 남기는 것과 같다
  const agent = new Agent({ keepAlive: true });
  await new Promise<void>((resolve) => {
    get({ port: PORT, path: "/", agent }, (res) => {
      res.resume();
      res.once("end", () => resolve());
    });
  });

  const handles = { server, wss, ws, agent };
  open.push(handles);
  return handles;
}

afterEach(() => {
  for (const h of open.splice(0)) {
    try { h.ws?.terminate(); } catch { /* 이미 끊김 */ }
    try { h.wss?.close(); } catch { /* 이미 닫힘 */ }
    try { h.server?.closeAllConnections?.(); h.server?.close(); } catch { /* 이미 닫힘 */ }
    h.agent?.destroy();
  }
});

describe("종료 시 HTTP 서버 닫기", () => {
  it("WebSocket·keep-alive가 열려 있어도 닫힌다", async () => {
    const { server, wss } = await setup();
    const t0 = Date.now();
    const result = await closeHttpServer(server, wss, 3000);
    expect(result).toBe("closed");
    // 연결이 끊기기를 기다리지 않으므로 즉시 끝나야 한다
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it("연결을 정리하지 않으면 실제로 걸린다 — 버그가 있었다는 증거", async () => {
    const { server } = await setup();
    // wss를 넘기지 않고 closeAllConnections도 안 하는, 예전 코드와 같은 상황
    const stuck = await new Promise<string>((resolve) => {
      const timer = setTimeout(() => resolve("timeout"), 800);
      server.close(() => {
        clearTimeout(timer);
        resolve("closed");
      });
    });
    expect(stuck).toBe("timeout");
  });

  it("연결이 하나도 없으면 그냥 닫힌다", async () => {
    const server = createServer((_req, res) => res.end("ok"));
    await new Promise<void>((r) => server.listen(PORT + 1, r));
    expect(await closeHttpServer(server, null, 3000)).toBe("closed");
  });

  it("이미 닫힌 서버에 다시 불러도 예외를 던지지 않는다", async () => {
    const server = createServer((_req, res) => res.end("ok"));
    await new Promise<void>((r) => server.listen(PORT + 2, r));
    await closeHttpServer(server, null, 1000);
    // 두 번째 호출은 close()가 에러를 주지만 결과만 돌려주고 던지지 않아야 한다
    await expect(closeHttpServer(server, null, 500)).resolves.toBeDefined();
  });
});
