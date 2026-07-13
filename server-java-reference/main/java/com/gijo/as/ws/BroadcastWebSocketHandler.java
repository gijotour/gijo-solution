package com.gijo.as.ws;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.io.IOException;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 단일 /ws 엔드포인트로 모든 실시간 채널(collaboration:event, finetune:progress 등)을
 * 브로드캐스트한다 — Node 시절 ws.WebSocketServer 하나를 여러 엔진이 공유하던 것과 동일한 구조.
 */
@Component
public class BroadcastWebSocketHandler extends TextWebSocketHandler {

    private static final Logger log = LoggerFactory.getLogger(BroadcastWebSocketHandler.class);

    private final Map<String, WebSocketSession> sessions = new ConcurrentHashMap<>();
    private final ObjectMapper objectMapper;

    public BroadcastWebSocketHandler(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        sessions.put(session.getId(), session);
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        sessions.remove(session.getId());
    }

    public void broadcast(String channel, Object payload) {
        String json;
        try {
            json = objectMapper.writeValueAsString(Map.of("channel", channel, "payload", payload));
        } catch (Exception e) {
            log.warn("failed to serialize broadcast payload for channel {}", channel, e);
            return;
        }
        TextMessage message = new TextMessage(json);
        sessions.values().forEach(session -> {
            try {
                if (session.isOpen()) {
                    session.sendMessage(message);
                }
            } catch (IOException e) {
                log.warn("failed to send websocket message to session {}", session.getId(), e);
            }
        });
    }
}
