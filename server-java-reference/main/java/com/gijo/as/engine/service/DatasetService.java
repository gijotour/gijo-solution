package com.gijo.as.engine.service;

import com.gijo.as.domain.ConversationExample;
import org.springframework.stereotype.Service;

import java.util.List;

/** 파인튜닝용 대화형(Q&A) 데이터셋 변환 · 증폭 (6.2절 ②단계). */
@Service
public class DatasetService {

    public List<ConversationExample> convertToConversationFormat(String rawText) {
        // TODO: LlmService.chat()을 프롬프트 템플릿과 함께 호출해 Q&A 쌍으로 변환
        return List.of();
    }

    public List<ConversationExample> amplify(List<ConversationExample> examples, int factor) {
        // TODO: paraphrase augmentation
        return examples;
    }
}
