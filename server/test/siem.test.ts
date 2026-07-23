import { describe, it, expect, beforeEach } from "vitest";
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
