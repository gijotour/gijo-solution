package com.gijo.as.engine.service;

import com.gijo.as.domain.IntentAction;
import com.gijo.as.domain.RoutedIntent;
import org.springframework.stereotype.Service;

import java.util.regex.Pattern;

/**
 * 자연어 명령 의도 파악 및 라우팅.
 * TODO(9.5절 미결 항목): 이 Regex 기반 분류기를 로컬 LLM Few-shot 의도 판별 + JSON 파싱으로 교체.
 */
@Service
public class IntentService {

    private static final Pattern SCAN = Pattern.compile("스캔|재스캔|scan", Pattern.CASE_INSENSITIVE);
    private static final Pattern REPORT = Pattern.compile("리포트|보고서|report", Pattern.CASE_INSENSITIVE);
    private static final Pattern ANALYZE = Pattern.compile("우선순위|분석|analy", Pattern.CASE_INSENSITIVE);

    public RoutedIntent routeIntent(String text) {
        if (SCAN.matcher(text).find()) {
            return new RoutedIntent("scan", IntentAction.SCAN, null);
        }
        if (REPORT.matcher(text).find()) {
            return new RoutedIntent("report", IntentAction.REPORT, null);
        }
        if (ANALYZE.matcher(text).find()) {
            return new RoutedIntent("analysis", IntentAction.ANALYZE, null);
        }
        return new RoutedIntent("orchestrator", IntentAction.CHAT, null);
    }
}
