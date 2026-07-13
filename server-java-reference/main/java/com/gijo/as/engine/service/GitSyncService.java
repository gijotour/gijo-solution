package com.gijo.as.engine.service;

import com.gijo.as.domain.GitSyncConfig;
import org.springframework.stereotype.Service;

/** 단기 기억(문서)을 고객사 내부 Git 서버로 동기화 (공개 GitHub 대신, 6.2절 참고). */
@Service
public class GitSyncService {

    public void syncToInternalGit(GitSyncConfig config) {
        // TODO: JGit 또는 셸 git 호출로 init → add → commit → push
        throw new UnsupportedOperationException("not implemented: sync to " + config.remoteUrl());
    }
}
