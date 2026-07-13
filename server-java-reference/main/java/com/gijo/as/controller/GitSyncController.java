package com.gijo.as.controller;

import com.gijo.as.domain.GitSyncConfig;
import com.gijo.as.engine.service.GitSyncService;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/gitsync")
public class GitSyncController {

    private final GitSyncService gitSyncService;

    public GitSyncController(GitSyncService gitSyncService) {
        this.gitSyncService = gitSyncService;
    }

    @PostMapping("/sync")
    public Map<String, Boolean> sync(@RequestBody GitSyncConfig config) {
        gitSyncService.syncToInternalGit(config);
        return Map.of("ok", true);
    }
}
