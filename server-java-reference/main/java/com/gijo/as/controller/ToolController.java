package com.gijo.as.controller;

import com.gijo.as.engine.service.ToolService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/tools")
public class ToolController {

    private final ToolService toolService;

    public ToolController(ToolService toolService) {
        this.toolService = toolService;
    }

    public record RunRequest(String name, Map<String, Object> params) {
    }

    @GetMapping
    public List<ToolService.ToolSummary> list() {
        return toolService.listTools();
    }

    @PostMapping("/run")
    public Object run(@RequestBody RunRequest request) throws Exception {
        return toolService.runTool(request.name(), request.params());
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<Map<String, String>> handleUnknownTool(IllegalArgumentException e) {
        return ResponseEntity.status(404).body(Map.of("error", e.getMessage()));
    }
}
