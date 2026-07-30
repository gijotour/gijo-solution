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

  // [2026-07-30 실사고로 우선순위 뒤집음] 예전엔 "마지막 로드 모델"이 최우선이었다. 그런데
  // 그 값은 채택 검토(adopt.mjs)가 후보를 시험 삼아 올려도 갱신돼서, 게이트가 **탈락시킨**
  // 합성 모델이 부팅 기본값으로 굳었다 — 재시작마다 운영이 탈락 모델로 조용히 돌아갔다.
  // 이제 기본값은 **사람이 고른 것(defaultModelId)** 만이고, 마지막 로드는 최후의 폴백이다.
  it("운영자가 고른 모델이 최우선 — 시험용으로 올린 모델에 밀리지 않는다", () => {
    placeModel("lily-cybersecurity-7b-v0.2");
    placeModel("qwythos-9b");
    placeModel("merged-candidate");
    db.prepare("INSERT INTO app_state (key, value) VALUES ('defaultModelId', 'qwythos-9b')").run();
    db.prepare("INSERT INTO app_state (key, value) VALUES ('lastModelId', 'merged-candidate')").run();
    expect(pickAutoStartModelId()).toBe("qwythos-9b");
  });

  it("고른 것이 없으면 제품 기본 모델 — 마지막 로드 모델보다 앞선다", () => {
    placeModel("lily-cybersecurity-7b-v0.2");
    placeModel("merged-candidate");
    db.prepare("INSERT INTO app_state (key, value) VALUES ('lastModelId', 'merged-candidate')").run();
    expect(pickAutoStartModelId()).toBe("lily-cybersecurity-7b-v0.2");
  });

  it("제품 기본 모델 파일이 없으면 그때만 마지막 로드 모델로 폴백한다", () => {
    placeModel("merged-candidate"); // 제품 기본(lily) 파일 없음
    db.prepare("INSERT INTO app_state (key, value) VALUES ('lastModelId', 'merged-candidate')").run();
    expect(pickAutoStartModelId()).toBe("merged-candidate");
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
