package com.gijo.as.controller;

import com.gijo.as.domain.LocalEngineStatus;
import com.gijo.as.engine.service.LocalEngineService;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/localengine")
public class LocalEngineController {

    private final LocalEngineService localEngineService;

    public LocalEngineController(LocalEngineService localEngineService) {
        this.localEngineService = localEngineService;
    }

    public record StartRequest(String modelId) {
    }

    @GetMapping("/status")
    public LocalEngineStatus status() {
        return localEngineService.status();
    }

    @PostMapping("/start")
    public LocalEngineStatus start(@RequestBody StartRequest request) {
        return localEngineService.start(request.modelId());
    }

    @PostMapping("/stop")
    public void stop() {
        localEngineService.stop();
    }
}
