package com.gijo.as.controller;

import com.gijo.as.domain.GijoUser;
import com.gijo.as.engine.service.AuthService;
import com.gijo.as.security.JwtService;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final AuthService authService;
    private final JwtService jwtService;

    public AuthController(AuthService authService, JwtService jwtService) {
        this.authService = authService;
        this.jwtService = jwtService;
    }

    public record LoginRequest(String username, String password) {
    }

    @PostMapping("/login")
    public ResponseEntity<?> login(@RequestBody LoginRequest request) {
        return authService.authenticate(request.username(), request.password())
                .<ResponseEntity<?>>map(user -> ResponseEntity.ok(Map.of(
                        "token", jwtService.issueToken(user),
                        "user", Map.of("id", user.id(), "displayName", user.displayName(), "role", user.role())
                )))
                .orElseGet(() -> ResponseEntity.status(401).body(Map.of("error", "invalid credentials")));
    }

    @PostMapping("/logout")
    public ResponseEntity<?> logout() {
        // TODO: JWT는 서버 상태가 없어 즉시 폐기가 안 됨 — 조기 무효화가 필요하면 토큰 블록리스트 도입
        return ResponseEntity.ok(Map.of("ok", true));
    }

    @GetMapping("/me")
    public ResponseEntity<?> me(@AuthenticationPrincipal JwtService.JwtPrincipal principal) {
        return ResponseEntity.ok(Map.of(
                "id", principal.userId(),
                "username", principal.username(),
                "displayName", principal.displayName(),
                "role", principal.role()
        ));
    }
}
