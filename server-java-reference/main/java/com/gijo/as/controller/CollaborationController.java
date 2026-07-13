package com.gijo.as.controller;

import com.gijo.as.domain.CollaborationEvent;
import com.gijo.as.engine.service.CollaborationService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/** 실시간 브로드캐스트는 /ws("collaboration:event") 병행 — 이 엔드포인트는 최근 이력 조회용. */
@RestController
@RequestMapping("/api/collaboration")
public class CollaborationController {

    private final CollaborationService collaborationService;

    public CollaborationController(CollaborationService collaborationService) {
        this.collaborationService = collaborationService;
    }

    @GetMapping("/history")
    public List<CollaborationEvent> history() {
        return collaborationService.recentHistory();
    }
}
