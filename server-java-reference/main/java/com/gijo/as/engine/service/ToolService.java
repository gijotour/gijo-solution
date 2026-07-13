package com.gijo.as.engine.service;

import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 에이전트가 실행 가능한 액션(툴) 레지스트리.
 * TODO: BridgeService의 스캐너 어댑터들을 여기에도 registerTool()로 등록해 통합 인터페이스로 노출.
 */
@Service
public class ToolService {

    public interface ToolRunner {
        Object run(Map<String, Object> params) throws Exception;
    }

    public record ToolDefinition(String name, String description, ToolRunner runner) {
    }

    public record ToolSummary(String name, String description) {
    }

    private final Map<String, ToolDefinition> registry = new ConcurrentHashMap<>();

    public void registerTool(ToolDefinition tool) {
        registry.put(tool.name(), tool);
    }

    public List<ToolSummary> listTools() {
        return registry.values().stream()
                .map(t -> new ToolSummary(t.name(), t.description()))
                .toList();
    }

    public Object runTool(String name, Map<String, Object> params) throws Exception {
        ToolDefinition tool = registry.get(name);
        if (tool == null) {
            throw new IllegalArgumentException("unknown tool: " + name);
        }
        return tool.runner().run(params);
    }
}
