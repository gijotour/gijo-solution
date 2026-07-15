import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { scanRepositories } from "../src/engine/reposcan";
import { resetAssetsForTests, listAssets } from "../src/engine/assets";

function b64(s: string): string {
  return Buffer.from(s, "utf-8").toString("base64");
}

// URL 패턴별로 응답을 돌려주는 fetch mock 팩토리
function mockGithub(handlers: { match: RegExp; status?: number; json: unknown }[]) {
  return vi.fn(async (url: string) => {
    for (const h of handlers) {
      if (h.match.test(url)) {
        const status = h.status ?? 200;
        return { ok: status >= 200 && status < 300, status, json: async () => h.json } as Response;
      }
    }
    return { ok: false, status: 404, json: async () => ({}) } as Response;
  });
}

describe("reposcan (코드 저장소 AI 종속성 스캔)", () => {
  beforeEach(() => resetAssetsForTests());
  afterEach(() => vi.unstubAllGlobals());

  it("registers repos whose dependency files reference AI libraries, skips those that don't", async () => {
    vi.stubGlobal(
      "fetch",
      mockGithub([
        { match: /orgs\/acme\/repos/, json: [
          { name: "fraud-llm", html_url: "https://github.com/acme/fraud-llm" },
          { name: "billing-svc", html_url: "https://github.com/acme/billing-svc" },
        ] },
        { match: /repos\/acme\/fraud-llm\/contents\/requirements\.txt/, json: { content: b64("openai==1.2\nlangchain\nflask"), encoding: "base64" } },
        { match: /repos\/acme\/billing-svc\/contents\/package\.json/, json: { content: b64('{"dependencies":{"express":"4"}}'), encoding: "base64" } },
      ])
    );

    const result = await scanRepositories({ provider: "github", owner: "acme" });
    expect(result.scanned).toBe(2);
    expect(result.registered).toBe(1);

    const assets = listAssets();
    const fraud = assets.find((a) => a.id === "repo:acme/fraud-llm");
    expect(fraud).toBeDefined();
    expect(fraud!.assetType).toBe("dev-ai");
    expect(fraud!.components.map((c) => c.name).sort()).toEqual(["langchain", "openai"]);
    expect(assets.find((a) => a.id === "repo:acme/billing-svc")).toBeUndefined();
  });

  it("falls back from org to user when the org lookup 404s", async () => {
    vi.stubGlobal(
      "fetch",
      mockGithub([
        { match: /orgs\/solodev\/repos/, status: 404, json: {} },
        { match: /users\/solodev\/repos/, json: [{ name: "agent-bot", html_url: "https://github.com/solodev/agent-bot" }] },
        { match: /repos\/solodev\/agent-bot\/contents\/pyproject\.toml/, json: { content: b64("[project]\ndependencies=['crewai','httpx']"), encoding: "base64" } },
      ])
    );

    const result = await scanRepositories({ provider: "github", owner: "solodev" });
    expect(result.registered).toBe(1);
    expect(listAssets()[0].components.some((c) => c.name === "crewai")).toBe(true);
  });

  it("rejects GitLab (not yet supported) with a clear message", async () => {
    await expect(scanRepositories({ provider: "gitlab", owner: "x" })).rejects.toThrow("GitHub만 지원");
  });

  it("throws when the owner exists as neither org nor user", async () => {
    vi.stubGlobal("fetch", mockGithub([{ match: /repos/, status: 404, json: {} }]));
    await expect(scanRepositories({ provider: "github", owner: "ghost" })).rejects.toThrow("org/user");
  });
});
