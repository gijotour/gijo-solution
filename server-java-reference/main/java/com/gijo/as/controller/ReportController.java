package com.gijo.as.controller;

import com.gijo.as.domain.ReportRequest;
import com.gijo.as.domain.ReportResult;
import com.gijo.as.engine.service.ReportService;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/report")
public class ReportController {

    private final ReportService reportService;

    public ReportController(ReportService reportService) {
        this.reportService = reportService;
    }

    @PostMapping("/generate")
    public ReportResult generate(@RequestBody ReportRequest request) {
        return reportService.generate(request);
    }
}
