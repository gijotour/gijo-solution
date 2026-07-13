package com.gijo.as.controller;

import com.gijo.as.engine.service.MemoryService;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/memory")
public class MemoryController {

    private final MemoryService memoryService;

    public MemoryController(MemoryService memoryService) {
        this.memoryService = memoryService;
    }

    public record IngestRequest(String path) {
    }

    public record QueryRequest(String question) {
    }

    @PostMapping("/ingest")
    public MemoryService.IngestResult ingest(@RequestBody IngestRequest request) {
        return memoryService.ingestDocument(request.path());
    }

    @PostMapping("/query")
    public List<String> query(@RequestBody QueryRequest request) {
        return memoryService.queryMemory(request.question(), 5);
    }
}
