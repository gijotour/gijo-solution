import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { parseDiscoveryReport, importDiscoveredAssets } from "../src/engine/assetimport";
import { resetAssetsForTests, listAssets } from "../src/engine/assets";

async function login(app: ReturnType<typeof createApp>) {
  const res = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });
  return res.body.accessToken as string;
}

describe("asset import (외부 탐지 제품 결과 가져오기)", () => {
  let app: ReturnType<typeof createApp>;
  let token: string;

  beforeEach(async () => {
    resetAssetsForTests();
    app = createApp();
    token = await login(app);
  });

  it("parses a generic JSON array with varied field names via aliases", () => {
    const json = JSON.stringify([
      { name: "fraud-detect-llm", type: "dev-ai", owner: "정보보안팀", repository: "github.com/acme/fraud" },
      { asset_name: "ChatGPT (shadow)", risk_type: "shadow-ai", user: "hr-team", domain: "api.openai.com" },
    ]);
    const parsed = parseDiscoveryReport(json, "json");
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({ name: "fraud-detect-llm", assetType: "dev-ai", owner: "정보보안팀", path: "github.com/acme/fraud" });
    expect(parsed[1]).toMatchObject({ name: "ChatGPT (shadow)", assetType: "shadow-ai", owner: "hr-team", path: "api.openai.com" });
  });

  it("unwraps {agents:[...]} / {results:[...]} envelope shapes", () => {
    expect(parseDiscoveryReport('{"agents":[{"name":"a"}]}', "json")).toHaveLength(1);
    expect(parseDiscoveryReport('{"results":[{"tool":"b"},{"application":"c"}]}', "json")).toHaveLength(2);
  });

  it("parses CSV with quoted fields containing commas", () => {
    const csv = 'name,type,owner\n"model, v2",dev-ai,"팀 A, 팀 B"\ncursor,shadow-ai,dev-team\n';
    const parsed = parseDiscoveryReport(csv, "csv");
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({ name: "model, v2", owner: "팀 A, 팀 B" });
    expect(parsed[1].name).toBe("cursor");
  });

  it("matches aliases against spaced/hyphenated headers (Risk Type -> risk_type)", () => {
    const csv = 'Application,Risk Type,Department\nChatGPT,shadow-ai,마케팅팀\n';
    const parsed = parseDiscoveryReport(csv, "csv");
    expect(parsed[0]).toMatchObject({ name: "ChatGPT", assetType: "shadow-ai", owner: "마케팅팀" });
  });

  it("drops rows without a recognizable name", () => {
    const parsed = parseDiscoveryReport(JSON.stringify([{ foo: "bar" }, { name: "keep-me" }]), "json");
    expect(parsed.map((a) => a.name)).toEqual(["keep-me"]);
  });

  it("import registers assets and they appear in the inventory with deterministic ids", () => {
    const result = importDiscoveredAssets(JSON.stringify([{ name: "Copilot" }, { name: "Claude Desktop" }]), "json", "zenity-export");
    expect(result.imported).toBe(2);
    const ids = listAssets().map((a) => a.id);
    expect(ids).toContain("discovered:zenity-export:copilot");
    expect(ids).toContain("discovered:zenity-export:claude-desktop");
  });

  it("re-importing the same file updates (upserts) rather than duplicating", () => {
    const content = JSON.stringify([{ name: "Copilot", owner: "team-a" }]);
    importDiscoveredAssets(content, "json", "zenity");
    importDiscoveredAssets(JSON.stringify([{ name: "Copilot", owner: "team-b" }]), "json", "zenity");
    const copilots = listAssets().filter((a) => a.id === "discovered:zenity:copilot");
    expect(copilots).toHaveLength(1);
    expect(copilots[0].owner).toBe("team-b");
  });

  it("dedupes repeated names within one file", () => {
    const result = importDiscoveredAssets(JSON.stringify([{ name: "X" }, { name: "X" }, { name: "Y" }]), "json", "s");
    expect(result.imported).toBe(2);
    expect(result.skipped).toBe(1);
  });

  it("POST /api/assets/import works end to end and rejects bad input", async () => {
    const ok = await request(app)
      .post("/api/assets/import")
      .set("Authorization", `Bearer ${token}`)
      .send({ content: JSON.stringify([{ name: "imported-agent" }]), format: "json", source: "arthur" });
    expect(ok.status).toBe(200);
    expect(ok.body.imported).toBe(1);

    const bad = await request(app).post("/api/assets/import").set("Authorization", `Bearer ${token}`).send({ format: "json" });
    expect(bad.status).toBe(400);
  });
});
