package com.gijo.as.engine.service;

import com.gijo.as.domain.FinetuneArgs;
import com.gijo.as.domain.FinetuneProgress;
import com.gijo.as.ws.BroadcastWebSocketHandler;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * QLoRA 파인튜닝 파이프라인 (Unsloth 기반, 6.2절 ③단계).
 * 진행률은 /ws 채널("finetune:progress")로 브로드캐스트한다.
 */
@Service
public class FineTuneService {

    private static final Logger log = LoggerFactory.getLogger(FineTuneService.class);
    private static final Pattern STEP_PATTERN = Pattern.compile("step\\s+(\\d+)/(\\d+)\\s+loss=([\\d.]+)");

    private final BroadcastWebSocketHandler socketHandler;
    private final java.util.concurrent.ExecutorService executor = Executors.newCachedThreadPool();

    public FineTuneService(BroadcastWebSocketHandler socketHandler) {
        this.socketHandler = socketHandler;
    }

    /** 오래 걸리는 작업이라 백그라운드 스레드에서 실행하고 즉시 리턴한다 (TS의 fire-and-forget spawn과 동일). */
    public void startFinetune(FinetuneArgs args) {
        executor.submit(() -> runFinetuneProcess(args));
    }

    private void runFinetuneProcess(FinetuneArgs args) {
        ProcessBuilder builder = new ProcessBuilder("python", "scripts/finetune_unsloth.py", "--dataset", args.datasetId());
        builder.redirectErrorStream(true);
        try {
            Process process = builder.start();
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    Matcher matcher = STEP_PATTERN.matcher(line);
                    if (matcher.find()) {
                        FinetuneProgress progress = new FinetuneProgress(
                                Integer.parseInt(matcher.group(1)),
                                Integer.parseInt(matcher.group(2)),
                                Double.parseDouble(matcher.group(3))
                        );
                        socketHandler.broadcast("finetune:progress", progress);
                    }
                }
            }
            process.waitFor();
        } catch (IOException e) {
            log.error("finetune process failed for agent {}", args.agentId(), e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
