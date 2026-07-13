package com.gijo.as.config;

import com.gijo.as.security.JwtService;
import com.gijo.as.security.WsAuthHandshakeInterceptor;
import com.gijo.as.ws.BroadcastWebSocketHandler;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

@Configuration
@EnableWebSocket
public class WebSocketConfig implements WebSocketConfigurer {

    private final BroadcastWebSocketHandler broadcastWebSocketHandler;
    private final JwtService jwtService;

    public WebSocketConfig(BroadcastWebSocketHandler broadcastWebSocketHandler, JwtService jwtService) {
        this.broadcastWebSocketHandler = broadcastWebSocketHandler;
        this.jwtService = jwtService;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(broadcastWebSocketHandler, "/ws")
                .addInterceptors(new WsAuthHandshakeInterceptor(jwtService))
                .setAllowedOriginPatterns("*"); // TODO(운영 전): 사내망 오리진으로 제한
    }
}
