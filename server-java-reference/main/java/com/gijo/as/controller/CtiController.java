package com.gijo.as.controller;

import com.gijo.as.domain.CtiFeedConfig;
import com.gijo.as.domain.CtiFinding;
import com.gijo.as.engine.service.CtiService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/cti")
public class CtiController {

    private final CtiService ctiService;

    public CtiController(CtiService ctiService) {
        this.ctiService = ctiService;
    }

    @GetMapping("/feeds")
    public List<CtiFeedConfig> feeds() {
        return ctiService.listFeeds();
    }

    @GetMapping("/findings")
    public List<CtiFinding> findings() {
        return ctiService.listFindings();
    }
}
