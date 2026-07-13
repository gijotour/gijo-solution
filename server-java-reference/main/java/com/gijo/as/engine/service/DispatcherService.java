package com.gijo.as.engine.service;

import com.gijo.as.domain.*;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * 지시 → 의도분석 → 작업할당 → 실행 → 협업로그까지 잇는 조율 로직 (8단계 파이프라인 구현체).
 */
@Service
public class DispatcherService {

    private final IntentService intentService;
    private final TaskService taskService;
    private final AgentService agentService;
    private final CollaborationService collaborationService;
    private final BridgeService bridgeService;
    private final LlmService llmService;

    public DispatcherService(
            IntentService intentService,
            TaskService taskService,
            AgentService agentService,
            CollaborationService collaborationService,
            BridgeService bridgeService,
            LlmService llmService
    ) {
        this.intentService = intentService;
        this.taskService = taskService;
        this.agentService = agentService;
        this.collaborationService = collaborationService;
        this.bridgeService = bridgeService;
        this.llmService = llmService;
    }

    public DispatchResult dispatch(String instructionText) {
        RoutedIntent route = intentService.routeIntent(instructionText);
        TaskItem task = taskService.createTask(instructionText, route.agentId(), priorityFor(route.action()));

        agentService.setAgentStatus(route.agentId(), AgentStatus.WORKING);
        collaborationService.emit("orchestrator", route.agentId(), "작업 할당: \"" + instructionText + "\"");

        String output;
        try {
            output = executeRoutedAction(route, instructionText);
        } catch (Exception e) {
            output = "실행 실패: " + e.getMessage();
        }

        collaborationService.emit(route.agentId(), "orchestrator", "작업 완료: " + output);
        agentService.resetAgentToDefault(route.agentId());
        taskService.completeTask(task.getId());

        return new DispatchResult(task, route, output);
    }

    private TaskPriority priorityFor(IntentAction action) {
        return switch (action) {
            case SCAN, ANALYZE -> TaskPriority.P1;
            default -> TaskPriority.P2;
        };
    }

    private String executeRoutedAction(RoutedIntent route, String instructionText) {
        return switch (route.action()) {
            case SCAN -> {
                String assetPath = route.targetAssetId() != null ? route.targetAssetId() : "unknown-asset";
                List<StandardFinding> findings;
                try {
                    findings = bridgeService.runAdapter("modelscan", assetPath);
                } catch (Exception e) {
                    findings = List.of(new StandardFinding("scan_error", Severity.LOW, String.valueOf(e.getMessage()), "modelscan"));
                }
                yield "스캔 완료 — " + findings.size() + "건 발견";
            }
            case ANALYZE, REPORT, CHAT -> llmService.chat(new ChatRequest(route.agentId(), instructionText));
        };
    }
}
