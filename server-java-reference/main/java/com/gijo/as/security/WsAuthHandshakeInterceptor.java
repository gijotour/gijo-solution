package com.gijo.as.security;

import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.http.server.ServletServerHttpRequest;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.server.HandshakeInterceptor;
import org.springframework.web.util.UriComponentsBuilder;

import java.util.Map;

/**
 * 브라우저 네이티브 WebSocket API는 커스텀 Authorization 헤더를 못 붙이므로,
 * 핸드셰이크 시 {@code ?token=<JWT>} 쿼리 파라미터로 인증한다.
 */
public class WsAuthHandshakeInterceptor implements HandshakeInterceptor {

    private final JwtService jwtService;

    public WsAuthHandshakeInterceptor(JwtService jwtService) {
        this.jwtService = jwtService;
    }

    @Override
    public boolean beforeHandshake(
            ServerHttpRequest request,
            ServerHttpResponse response,
            WebSocketHandler wsHandler,
            Map<String, Object> attributes
    ) {
        if (request instanceof ServletServerHttpRequest servletRequest) {
            String token = UriComponentsBuilder.fromUri(servletRequest.getURI())
                    .build()
                    .getQueryParams()
                    .getFirst("token");
            if (token != null && jwtService.parse(token).isPresent()) {
                return true;
            }
        }
        response.setStatusCode(org.springframework.http.HttpStatus.UNAUTHORIZED);
        return false;
    }

    @Override
    public void afterHandshake(
            ServerHttpRequest request,
            ServerHttpResponse response,
            WebSocketHandler wsHandler,
            Exception exception
    ) {
        // no-op
    }
}
