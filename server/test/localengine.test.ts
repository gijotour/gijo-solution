import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// GIJO_MODELS_DIR은 모듈 로드 시점에 읽히므로, import 전에 임시 디렉터리로 고정한다.
const tmpModels = fs.mkdtempSync(path.join(os.tmpdir(), "gijo-models-"));
process.env.GIJO_MODELS_DIR = tmpModels;
process.env.GIJO_DEFAULT_MODEL_ID = "lily-cybersecurity-7b-v0.2";

const { pickAutoStartModelId, getLocalEngineStatus } = await import("../src/engine/localengine");
const { db } = await import("../src/db");

function placeModel(modelId: string): void {
  fs.mkdirSync(path.join(tmpModels, modelId), { recursive: true });
  fs.writeFileSync(path.join(tmpModels, modelId, `${modelId}.gguf`), "stub");
}

describe("local engine auto-start candidate selection", () => {
  beforeEach(() => {
    db.exec("DELETE FROM app_state");
    fs.rmSync(tmpModels, { recursive: true, force: true });
    fs.mkdirSync(tmpModels, { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(tmpModels, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it("returns null when no model files exist (auto-start must be skipped, not error)", () => {
    expect(pickAutoStartModelId()).toBeNull();
  });

  it("falls back to the product default model when its file exists", () => {
    placeModel("lily-cybersecurity-7b-v0.2");
    expect(pickAutoStartModelId()).toBe("lily-cybersecurity-7b-v0.2");
  });

  it("prefers the last-used model over the default", () => {
    placeModel("lily-cybersecurity-7b-v0.2");
    placeModel("qwythos-9b");
    db.prepare("INSERT INTO app_state (key, value) VALUES ('lastModelId', 'qwythos-9b')").run();
    expect(pickAutoStartModelId()).toBe("qwythos-9b");
  });

  it("ignores a last-used model whose file is gone and falls back to the default", () => {
    placeModel("lily-cybersecurity-7b-v0.2");
    db.prepare("INSERT INTO app_state (key, value) VALUES ('lastModelId', 'deleted-model')").run();
    expect(pickAutoStartModelId()).toBe("lily-cybersecurity-7b-v0.2");
  });

  it("status exposes the embedding engine state alongside the chat engine", () => {
    const status = getLocalEngineStatus();
    expect(status.embedding).toMatchObject({ running: false, port: 8081, modelId: null });
    expect(status.running).toBe(false);
  });
});
