package com.gijo.as.controller;

import com.gijo.as.domain.FinetuneArgs;
import com.gijo.as.engine.service.FineTuneService;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/** 진척률은 /ws("finetune:progress")로 전파된다. */
@RestController
@RequestMapping("/api/finetune")
public class FineTuneController {

    private final FineTuneService fineTuneService;

    public FineTuneController(FineTuneService fineTuneService) {
        this.fineTuneService = fineTuneService;
    }

    @PostMapping("/start")
    public Map<String, Boolean> start(@RequestBody FinetuneArgs args) {
        fineTuneService.startFinetune(args);
        return Map.of("started", true);
    }
}
