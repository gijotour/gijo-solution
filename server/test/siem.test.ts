import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as net from "net";
import { sendToSiem, testSiem, getSiemStats, resetSiemStatsForTests, formatEvent, stopSiemForwarding } from "../src/engine/siem";
import { saveSiemConfig, getSiemConfig } from "../src/engine/siem";
import { db } from "../src/db";

describe("SIEM 커넥터 설정·포맷", () => {
  beforeEach(() => { db.prepare("DELETE FROM app_state WHERE key='siemConfig'").run(); });

  it("기본은 OFF", () => {
    expect(getSiemConfig().enabled).toBe(false);
  });
  it("설정 저장·조회 라운드트립 + 포트 범위 보정", () => {
    const c = saveSiemConfig({ enabled: true, host: "10.0.0.50", port: 99999, format: "cef" });
    expect(c.enabled).toBe(true);
    expect(c.host).toBe("10.0.0.50");
    expect(c.port).toBe(65535); // clamp
    expect(getSiemConfig().format).toBe("cef");
  });
});

// ── 중-7 확장(2026-07-31) ───────────────────────────────────────────────────
// 이번 확장의 핵심은 "전송 실패를 알 수 있다"이므로 시험도 그 지점을 겨눈다.
// **실제 TCP 수신 서버를 띄워** 진짜 도착하는지 본다 — 모의로는 증명이 안 된다.
const EV = { category: "audit", severity: "info" as const, action: "시험 이벤트", actor: "김담당", target: "web-01" };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 진짜 TCP 서버 — 받은 줄을 모아 둔다. */
function startSink(): Promise<{ port: number; lines: string[]; close: () => Promise<void> }> {
  const lines: string[] = [];
  // ⚠ 제품이 연결을 **재사용**하므로 소켓이 살아 있다 — 그대로 srv.close()하면 서버가 안 닫혀
  //   시험이 타임아웃한다(첫 시도에서 실제로 겪었다). 붙은 소켓을 들고 있다가 함께 끊는다.
  const socks: net.Socket[] = [];
  return new Promise((resolve) => {
    const srv = net.createServer((sock) => {
      socks.push(sock);
      let buf = "";
      sock.on("data", (d) => {
        buf += d.toString("utf8");
        let i: number;
        while ((i = buf.indexOf("\n")) >= 0) { lines.push(buf.slice(0, i)); buf = buf.slice(i + 1); }
      });
      sock.on("error", () => { /* 끊을 때 나는 소리는 무시 */ });
    });
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as net.AddressInfo).port;
      resolve({
        port,
        lines,
        close: () => new Promise((r) => {
          stopSiemForwarding();                 // 제품 쪽 연결부터 닫는다
          socks.forEach((s) => s.destroy());
          srv.close(() => r());
        }),
      });
    });
  });
}

describe("SIEM 확장 — 포맷", () => {
  beforeEach(() => { db.prepare("DELETE FROM app_state WHERE key='siemConfig'").run(); resetSiemStatsForTests(); });

  it("JSON은 ECS 필드명을 쓴다 — 고객사가 매핑을 새로 짜지 않게", () => {
    const j = JSON.parse(formatEvent(EV, { ...getSiemConfig(), format: "json" }));
    expect(j["@timestamp"]).toBeTruthy();
    expect(j["event.action"]).toBe("시험 이벤트");
    expect(j["event.category"]).toBe("audit");
    expect(j["user.name"]).toBe("김담당");
    expect(j["observer.product"]).toBe("GIJO AS");
  });

  it("CEF에서 파이프·역슬래시를 이스케이프한다 — 필드가 밀리면 파싱이 깨진다", () => {
    expect(formatEvent({ ...EV, action: "a|b\\c" }, { ...getSiemConfig(), format: "cef" })).toContain("a\\|b\\\\c");
  });
});

describe("SIEM 확장 — TCP로 실제 도착하는가", () => {
  beforeEach(() => { db.prepare("DELETE FROM app_state WHERE key='siemConfig'").run(); resetSiemStatsForTests(); });
  afterEach(() => { stopSiemForwarding(); saveSiemConfig({ enabled: false, host: "" }); });

  it("보낸 이벤트가 수신 서버에 그대로 들어온다", async () => {
    const sink = await startSink();
    try {
      saveSiemConfig({ enabled: true, host: "127.0.0.1", port: sink.port, transport: "tcp", format: "json" });
      resetSiemStatsForTests();
      await sendToSiem(EV);
      await wait(700);
      expect(sink.lines.length).toBe(1);
      expect(JSON.parse(sink.lines[0])["event.action"]).toBe("시험 이벤트");
      const st = getSiemStats();
      expect(st.sent).toBe(1);
      expect(st.failed).toBe(0);
      expect(st.deliveryConfirmed, "TCP는 전달 확인이 된다").toBe(true);
    } finally {
      await sink.close();
    }
  });

  it("연결을 재사용해 여러 건을 보낸다 — 이벤트마다 새로 붙으면 SIEM 세션이 폭증한다", async () => {
    const sink = await startSink();
    try {
      saveSiemConfig({ enabled: true, host: "127.0.0.1", port: sink.port, transport: "tcp", format: "rfc5424" });
      resetSiemStatsForTests();
      for (let i = 0; i < 5; i++) await sendToSiem({ ...EV, action: `건 ${i}` });
      await wait(1200);
      expect(sink.lines.length).toBe(5);
      expect(getSiemStats().sent).toBe(5);
    } finally {
      await sink.close();
    }
  });
});

describe("SIEM 확장 — 실패를 숨기지 않는다(이번 확장의 이유)", () => {
  beforeEach(() => { db.prepare("DELETE FROM app_state WHERE key='siemConfig'").run(); resetSiemStatsForTests(); });
  afterEach(() => { stopSiemForwarding(); saveSiemConfig({ enabled: false, host: "" }); });

  it("SIEM이 죽어 있으면 실패로 세고 큐에 남긴다", async () => {
    saveSiemConfig({ enabled: true, host: "127.0.0.1", port: 59999, transport: "tcp" });
    resetSiemStatsForTests();
    await sendToSiem(EV);
    await wait(1200);
    const st = getSiemStats();
    expect(st.failed, "실패가 세어져야 한다").toBeGreaterThan(0);
    expect(st.sent).toBe(0);
    expect(st.queued, "보내지 못한 것은 큐에 남는다").toBeGreaterThan(0);
    expect(st.lastError, "왜 실패했는지 남아야 한다").toBeTruthy();
  });

  it("연결 시험이 실패를 그대로 알려준다 — '보냈습니다'라고 거짓말하지 않는다", async () => {
    saveSiemConfig({ enabled: true, host: "127.0.0.1", port: 59999, transport: "tcp" });
    const r = await testSiem();
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  });

  it("큐 상한을 넘으면 유실을 센다 — 조용히 버리지 않는다", async () => {
    saveSiemConfig({ enabled: true, host: "127.0.0.1", port: 59999, transport: "tcp" });
    resetSiemStatsForTests();
    for (let i = 0; i < 1200; i++) await sendToSiem({ ...EV, action: `건 ${i}` });
    await wait(400);
    const st = getSiemStats();
    expect(st.queued).toBeLessThanOrEqual(1000);
    expect(st.dropped, "상한을 넘으면 유실이 세어져야 한다").toBeGreaterThan(0);
  });
});

describe("SIEM 확장 — UDP의 정직한 표기", () => {
  beforeEach(() => { db.prepare("DELETE FROM app_state WHERE key='siemConfig'").run(); });

  it("UDP는 '보냄≠도착'이라고 상태에 적는다", () => {
    saveSiemConfig({ enabled: true, host: "127.0.0.1", port: 59998, transport: "udp" });
    expect(getSiemStats().deliveryConfirmed).toBe(false);
  });

  it("TCP·TLS·HEC는 확인이 된다고 적는다", () => {
    for (const t of ["tcp", "tls", "hec"] as const) {
      saveSiemConfig({ transport: t, host: "127.0.0.1", hecToken: "x" });
      expect(getSiemStats().deliveryConfirmed).toBe(true);
    }
  });
});

describe("SIEM 확장 — 설정 경계", () => {
  beforeEach(() => { db.prepare("DELETE FROM app_state WHERE key='siemConfig'").run(); resetSiemStatsForTests(); });
  afterEach(() => { saveSiemConfig({ enabled: false, host: "" }); });

  it("꺼져 있으면 아무것도 안 보낸다", async () => {
    saveSiemConfig({ enabled: false, host: "127.0.0.1", port: 1 });
    resetSiemStatsForTests();
    expect(await sendToSiem(EV)).toBe(false);
    expect(getSiemStats().queued).toBe(0);
  });

  it("최소 심각도보다 낮으면 안 보낸다 — 잡음 억제", async () => {
    saveSiemConfig({ enabled: true, host: "127.0.0.1", port: 59999, transport: "tcp", minSeverity: "critical" });
    resetSiemStatsForTests();
    expect(await sendToSiem({ ...EV, severity: "info" })).toBe(false);
    expect(await sendToSiem({ ...EV, severity: "critical" })).toBe(true);
  });

  it("HEC 토큰은 저장돼도 조회에서 통째로 돌려주지 않는다", () => {
    const c = saveSiemConfig({ transport: "hec", host: "splunk.local", port: 8088, hecToken: "abcd1234SECRET" });
    expect(c.hecToken).toBe("abcd1234SECRET"); // 서버 내부에는 있다
    // 라우트가 마스킹하는지는 아래 API 시험에서 본다
  });
});
