package com.gijo.as.controller;

import com.gijo.as.domain.ScanAdapterInfo;
import com.gijo.as.domain.StandardFinding;
import com.gijo.as.engine.service.BridgeService;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/bridge")
public class BridgeController {

    private final BridgeService bridgeService;

    public BridgeController(BridgeService bridgeService) {
        this.bridgeService = bridgeService;
    }

    public record RunRequest(String adapterId, String assetPath) {
    }

    @PostMapping("/run")
    public List<StandardFinding> run(@RequestBody RunRequest request) throws Exception {
        return bridgeService.runAdapter(request.adapterId(), request.assetPath());
    }

    @GetMapping("/adapters")
    public List<ScanAdapterInfo> adapters() {
        return bridgeService.listAdapters();
    }
}
