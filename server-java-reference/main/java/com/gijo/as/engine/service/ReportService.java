package com.gijo.as.engine.service;

import com.gijo.as.domain.ChatRequest;
import com.gijo.as.domain.ReportRequest;
import com.gijo.as.domain.ReportResult;
import org.springframework.stereotype.Service;

/** 내부 SBOM 기반 내부보고용 리포트 (6.4.1절). */
@Service
public class ReportService {

    private final LlmService llmService;

    public ReportService(LlmService llmService) {
        this.llmService = llmService;
    }

    public ReportResult generate(ReportRequest request) {
        String prompt = "다음 보안 현황 데이터를 바탕으로 경영진용 1페이지 요약을 작성해줘: " + request;
        String executiveSummary = llmService.chat(new ChatRequest("report", prompt));
        // TODO: Apache POI(Word) / OpenPDF·iText(PDF) 템플릿 엔진 연결
        String filePath = "reports/" + request.type().wireValue() + "-" + System.currentTimeMillis() + ".docx";
        return new ReportResult(filePath, executiveSummary);
    }
}
