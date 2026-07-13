package com.gijo.as.engine.service;

import com.gijo.as.domain.GijoUser;
import com.gijo.as.domain.Role;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Optional;

/**
 * 보안담당자 계정 저장소 — TODO(9.5절): SQLite 등으로 영속화하고, 초기 배포 시
 * 설치 마법사에서 관리자 계정을 직접 생성하도록 변경 (하드코딩 금지).
 * 지금은 스캐폴딩 단계라 인메모리 시드 하나만 둔다.
 */
@Component
public class UserStore {

    private final List<GijoUser> users;

    public UserStore(PasswordEncoder passwordEncoder) {
        this.users = List.of(
                new GijoUser("u1", "jyh", passwordEncoder.encode("changeme"), "정요한", Role.ADMIN)
        );
    }

    public Optional<GijoUser> findByUsername(String username) {
        return users.stream().filter(u -> u.username().equals(username)).findFirst();
    }

    public Optional<GijoUser> findById(String id) {
        return users.stream().filter(u -> u.id().equals(id)).findFirst();
    }
}
