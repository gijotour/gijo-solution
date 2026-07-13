package com.gijo.as.controller;

import com.gijo.as.domain.ChatRequest;
import com.gijo.as.engine.service.LlmService;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/** TODO(9.2절): SSE 스트리밍 응답 지원 — 지금은 완성된 응답을 한 번에 반환. */
@RestController
@RequestMapping("/api/llm")
public class LlmController {

    private final LlmService llmService;

    public LlmController(LlmService llmService) {
        this.llmService = llmService;
    }

    @PostMapping("/chat")
    public Map<String, String> chat(@RequestBody ChatRequest request) {
        return Map.of("reply", llmService.chat(request));
    }
}
