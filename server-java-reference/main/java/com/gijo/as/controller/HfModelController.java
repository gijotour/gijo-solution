package com.gijo.as.controller;

import com.gijo.as.domain.HfModelResult;
import com.gijo.as.engine.service.HfModelService;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/hfmodels")
public class HfModelController {

    private final HfModelService hfModelService;

    public HfModelController(HfModelService hfModelService) {
        this.hfModelService = hfModelService;
    }

    public record LoadRequest(String modelId) {
    }

    @GetMapping("/search")
    public List<HfModelResult> search(@RequestParam(name = "q", defaultValue = "") String query) {
        return hfModelService.search(query);
    }

    @PostMapping("/load")
    public Map<String, String> load(@RequestBody LoadRequest request) {
        return Map.of("localPath", hfModelService.load(request.modelId()));
    }
}
