package com.gijo.as.engine.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.gijo.as.domain.ScanAdapterInfo;
import com.gijo.as.domain.StandardFinding;
import org.springframework.stereotype.Service;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;

/**
 * 오케스트레이터 ↔ 스캐너 어댑터 브릿지. 표준 finding 배열
 * ({@code finding_type}/{@code severity}/{@code evidence}/{@code source_tool})을 반환한다.
 *
 * TODO(로드맵 Phase 5): Penligent 어댑터 추가.
 */
@Service
public class BridgeService {

    private static final List<ScanAdapterInfo> ADAPTERS = List.of(
            new ScanAdapterInfo("modelscan", "ModelScan")
    );

    private final ObjectMapper objectMapper;

    public BridgeService(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public List<ScanAdapterInfo> listAdapters() {
        return ADAPTERS;
    }

    public List<StandardFinding> runAdapter(String adapterId, String assetPath) throws IOException, InterruptedException {
        if (!"modelscan".equals(adapterId)) {
            throw new IllegalArgumentException("unknown adapter: " + adapterId);
        }
        ProcessBuilder builder = new ProcessBuilder("python", "modelscan_wrapper.py", assetPath);
        builder.redirectErrorStream(false);
        Process process = builder.start();

        String stdout;
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8))) {
            stdout = reader.lines().collect(Collectors.joining("\n"));
        }
        boolean finished = process.waitFor(2, TimeUnit.MINUTES);
        if (!finished) {
            process.destroyForcibly();
            throw new IllegalStateException("modelscan adapter timed out for " + assetPath);
        }
        if (process.exitValue() != 0) {
            throw new IllegalStateException("modelscan adapter exited with code " + process.exitValue());
        }
        return objectMapper.readValue(stdout, new com.fasterxml.jackson.core.type.TypeReference<List<StandardFinding>>() {
        });
    }
}
