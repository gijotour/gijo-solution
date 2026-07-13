package com.gijo.as.controller;

import com.gijo.as.domain.SbomDocument;
import com.gijo.as.domain.SbomFormat;
import com.gijo.as.engine.service.SbomService;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/sbom")
public class SbomController {

    private final SbomService sbomService;

    public SbomController(SbomService sbomService) {
        this.sbomService = sbomService;
    }

    public record ExportRequest(SbomFormat format) {
    }

    @PostMapping("/{assetId}/generate")
    public SbomDocument generate(@PathVariable String assetId) {
        return sbomService.generate(assetId);
    }

    @PostMapping("/{assetId}/export")
    public Map<String, String> export(@PathVariable String assetId, @RequestBody ExportRequest request) {
        return Map.of("path", sbomService.export(assetId, request.format()));
    }
}
