package com.gijo.as.engine.service;

import org.springframework.stereotype.Service;

import java.util.List;

/**
 * 단기 기억(RAG) — 로컬LLM_프로젝트_가이드.md 6.2절 "1차: RAG" 구현체.
 * TODO: 청크 분할 → BGE-M3/multilingual-e5 임베딩 → LanceDB upsert/검색 연결.
 */
@Service
public class MemoryService {

    public record IngestResult(String documentId, int chunks, String embeddingModel) {
    }

    public IngestResult ingestDocument(String filePath) {
        throw new UnsupportedOperationException("not implemented: connect LanceDB client here (" + filePath + ")");
    }

    public List<String> queryMemory(String question, int topK) {
        return List.of();
    }
}
