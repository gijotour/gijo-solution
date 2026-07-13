package com.gijo.as.engine.service;

import com.gijo.as.domain.ChatRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

import java.util.List;
import java.util.Map;

/**
 * llama-server(OpenAI 호환 API)에 요청을 보내는 얇은 클라이언트.
 * LocalEngineService가 같은 머신에 띄운 프로세스를 localhost로 호출한다.
 */
@Service
public class LlmService {

    private static final Logger log = LoggerFactory.getLogger(LlmService.class);

    private final RestClient restClient;

    public LlmService(@Value("${gijo.local-llm.base-url}") String baseUrl) {
        this.restClient = RestClient.builder().baseUrl(baseUrl).build();
    }

    @SuppressWarnings("unchecked")
    public String chat(ChatRequest request) {
        try {
            Map<String, Object> body = Map.of(
                    "model", "local",
                    "messages", List.of(Map.of("role", "user", "content", request.message()))
            );
            Map<String, Object> response = restClient.post()
                    .uri("/chat/completions")
                    .body(body)
                    .retrieve()
                    .body(Map.class);
            if (response == null) {
                return "[로컬 LLM 서버 응답이 비어 있습니다.]";
            }
            List<Map<String, Object>> choices = (List<Map<String, Object>>) response.get("choices");
            if (choices == null || choices.isEmpty()) {
                return "";
            }
            Map<String, Object> message = (Map<String, Object>) choices.get(0).get("message");
            return message == null ? "" : String.valueOf(message.getOrDefault("content", ""));
        } catch (RestClientException e) {
            log.warn("local llm call failed", e);
            return "[로컬 LLM 서버에 연결할 수 없습니다. /api/localengine/start 로 먼저 기동하세요.]";
        }
    }
}
