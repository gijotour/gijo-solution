package com.gijo.as.engine.service;

import com.gijo.as.domain.CollaborationEvent;
import com.gijo.as.ws.BroadcastWebSocketHandler;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

/** 에이전트 간 협업 로그 + /ws 채널("collaboration:event") 실시간 브로드캐스트. */
@Service
public class CollaborationService {

    private static final int HISTORY_LIMIT = 100;

    private final List<CollaborationEvent> log = new CopyOnWriteArrayList<>();
    private final BroadcastWebSocketHandler socketHandler;

    public CollaborationService(BroadcastWebSocketHandler socketHandler) {
        this.socketHandler = socketHandler;
    }

    public void emit(String from, String to, String message) {
        CollaborationEvent event = new CollaborationEvent(from, to, message, System.currentTimeMillis());
        log.add(event);
        socketHandler.broadcast("collaboration:event", event);
    }

    public List<CollaborationEvent> recentHistory() {
        int size = log.size();
        int from = Math.max(0, size - HISTORY_LIMIT);
        return log.subList(from, size);
    }
}
