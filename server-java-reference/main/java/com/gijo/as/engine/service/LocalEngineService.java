package com.gijo.as.engine.service;

import com.gijo.as.domain.LocalEngineStatus;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.Path;
import java.util.concurrent.TimeUnit;

/**
 * 로컬 LLM 엔진(llama-server) 프로세스 관리.
 *
 * <p>9.5절 미결 항목: RTX 3090 24GB로는 메인 모델(Qwen3-30B-A3B)과 코딩 보조 모델
 * (Qwen2.5-Coder-32B-Instruct)을 동시에 올릴 수 없다. 그래서 {@link #start}는 요청된
 * modelId가 현재 떠 있는 모델과 다르면 기존 프로세스를 내리고 새로 띄우는 "스왑" 방식으로
 * 동작한다 — Connect AI 데스크톱 앱에서 수동으로 하던 모델 전환을 서버 쪽에서도 그대로 구현한 것.</p>
 */
@Service
public class LocalEngineService {

    private static final Logger log = LoggerFactory.getLogger(LocalEngineService.class);
    private static final int PORT = 8080;

    private final Path llamaServerPath;
    private final Path modelsDir;
    private final int defaultCtxSize;

    private Process process;
    private String currentModelId;

    public LocalEngineService(
            @Value("${gijo.local-llm.llama-server-path}") String llamaServerPath,
            @Value("${gijo.local-llm.models-dir}") String modelsDir,
            @Value("${gijo.local-llm.default-ctx-size}") int defaultCtxSize
    ) {
        this.llamaServerPath = Path.of(llamaServerPath);
        this.modelsDir = Path.of(modelsDir);
        this.defaultCtxSize = defaultCtxSize;
    }

    public synchronized LocalEngineStatus status() {
        return new LocalEngineStatus(process != null && process.isAlive(), PORT, currentModelId);
    }

    public synchronized LocalEngineStatus start(String modelId) {
        if (process != null && process.isAlive()) {
            if (modelId.equals(currentModelId)) {
                return new LocalEngineStatus(true, PORT, currentModelId);
            }
            log.info("swapping local LLM: {} -> {}", currentModelId, modelId);
            stopInternal();
        }

        Path modelPath = modelsDir.resolve(modelId).resolve(modelId + ".gguf");
        try {
            ProcessBuilder builder = new ProcessBuilder(
                    llamaServerPath.toString(),
                    "-m", modelPath.toString(),
                    "-ngl", "-1",
                    "--ctx-size", String.valueOf(defaultCtxSize),
                    "--port", String.valueOf(PORT)
            );
            builder.redirectErrorStream(true);
            builder.redirectOutput(ProcessBuilder.Redirect.DISCARD);
            process = builder.start();
            currentModelId = modelId;
            process.onExit().thenAccept(p -> {
                synchronized (this) {
                    if (p == process) {
                        process = null;
                        currentModelId = null;
                    }
                }
            });
            return new LocalEngineStatus(true, PORT, modelId);
        } catch (IOException e) {
            log.error("failed to start llama-server for model {}", modelId, e);
            process = null;
            currentModelId = null;
            return new LocalEngineStatus(false, PORT, null);
        }
    }

    public synchronized void stop() {
        stopInternal();
    }

    private void stopInternal() {
        if (process == null) {
            return;
        }
        process.destroy();
        try {
            if (!process.waitFor(10, TimeUnit.SECONDS)) {
                process.destroyForcibly();
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            process.destroyForcibly();
        }
        process = null;
        currentModelId = null;
    }
}
