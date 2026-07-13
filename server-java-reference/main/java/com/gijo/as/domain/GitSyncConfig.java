package com.gijo.as.domain;

/** 온프레미스 내부 Git 서버 대상 — 공개 GitHub 대신 사용 (6.2절 참고). */
public record GitSyncConfig(String remoteUrl, String branch) {
}
