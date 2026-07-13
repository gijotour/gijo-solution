package com.gijo.as.engine.service;

import com.gijo.as.domain.CtiFeedConfig;
import com.gijo.as.domain.CtiFinding;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * 딥웹 · 다크웹 CTI 피드 연동 (6.1.1절). LLM이 직접 다크웹을 크롤링하지 않고,
 * 라이선스 CTI 벤더 API만 호출한다.
 */
@Service
public class CtiService {

    private final List<CtiFeedConfig> feeds = List.of(
            new CtiFeedConfig("criminalip", "Criminal IP", "", false),
            new CtiFeedConfig("flashpoint", "Flashpoint", "", false),
            new CtiFeedConfig("spycloud", "SpyCloud", "", false)
    );

    public List<CtiFeedConfig> listFeeds() {
        return feeds;
    }

    public List<CtiFinding> listFindings() {
        // TODO: 연결된(connected=true) 각 피드의 REST API를 호출해 최근 탐지 내역 취합
        return List.of();
    }
}
