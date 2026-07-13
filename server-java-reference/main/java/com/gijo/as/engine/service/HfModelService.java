package com.gijo.as.engine.service;

import com.gijo.as.domain.HfModelResult;
import org.springframework.stereotype.Service;

import java.util.List;

/** 에이전트 AI 화면의 "HuggingFace 모델 검색·불러오기" (7.2절 HfModelService). */
@Service
public class HfModelService {

    private static final List<HfModelResult> KNOWN_SECURITY_MODELS = List.of(
            new HfModelResult("AlicanKiraz0/Titus-CybersecurityLLM-v1.0", "21.2GB", "GGUF Q4_K_M"),
            new HfModelResult("segolilylabs/Lily-Cybersecurity-7B-v0.2", "4.1GB", "GGUF"),
            new HfModelResult("fdtn-ai/Foundation-Sec-8B-Instruct", "4.9GB", "GGUF Q4_K_M")
    );

    public List<HfModelResult> search(String query) {
        // TODO: HuggingFace Hub API 호출로 대체
        String q = query == null ? "" : query.toLowerCase();
        if (q.isBlank()) {
            return KNOWN_SECURITY_MODELS;
        }
        return KNOWN_SECURITY_MODELS.stream()
                .filter(m -> m.id().toLowerCase().contains(q))
                .toList();
    }

    public String load(String modelId) {
        // TODO: huggingface_hub CLI/REST 다운로드 → 서버의 models/ 폴더에 저장 후 로컬 경로 반환
        throw new UnsupportedOperationException("not implemented: download " + modelId);
    }
}
