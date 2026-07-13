package com.gijo.as.engine.service;

import com.gijo.as.domain.AgentDefinition;
import com.gijo.as.domain.AgentStatus;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Optional;

/**
 * 에이전트 정의·상태 관리 — 서버가 단독 소유하는 공유 상태(CS 전환의 핵심 이점: 모든
 * 보안담당자 클라이언트가 같은 에이전트 상태를 본다). TODO(9.5절): SQLite 영속화.
 */
@Service
public class AgentService {

    private final List<AgentDefinition> agents = List.of(
            new AgentDefinition("orchestrator", "오케스트레이터", "작업 분배 · 결과 취합", "qwen3-30b-a3b", AgentStatus.WATCHING),
            new AgentDefinition("scan", "스캔 에이전트", "정적분석 실행 (ModelScan)", "qwen3-30b-a3b", AgentStatus.IDLE),
            new AgentDefinition("pentest", "침투테스트 에이전트", "익스플로잇 검증 (Penligent)", "deephat-v1-7b", AgentStatus.IDLE),
            new AgentDefinition("analysis", "분석 에이전트", "우선순위 판단 · 설명", "foundation-sec-8b", AgentStatus.IDLE),
            new AgentDefinition("sbom", "SBOM 에이전트", "SBOM 생성 · 정리", "qwen3-30b-a3b", AgentStatus.IDLE),
            new AgentDefinition("cti", "CTI 에이전트", "딥웹 · 다크웹 감시", "qwen3-30b-a3b", AgentStatus.WATCHING),
            new AgentDefinition("report", "리포트 에이전트", "내부 보고서 작성", "qwen3-30b-a3b", AgentStatus.IDLE),
            new AgentDefinition("model-evolution", "모델 진화 에이전트", "보안 특화 LLM 병합", "merge-experiment", AgentStatus.IDLE)
    );

    public List<AgentDefinition> listAgents() {
        return agents;
    }

    public Optional<AgentDefinition> getAgentById(String id) {
        return agents.stream().filter(a -> a.getId().equals(id)).findFirst();
    }

    public void setAgentStatus(String id, AgentStatus status) {
        getAgentById(id).ifPresent(a -> a.setStatus(status));
    }

    public void resetAgentToDefault(String id) {
        getAgentById(id).ifPresent(a -> a.setStatus(a.getDefaultStatus()));
    }
}
