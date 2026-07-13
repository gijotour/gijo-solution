package com.gijo.as.engine.service;

import com.gijo.as.domain.GijoUser;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

import java.util.Optional;

@Service
public class AuthService {

    private final UserStore userStore;
    private final PasswordEncoder passwordEncoder;

    public AuthService(UserStore userStore, PasswordEncoder passwordEncoder) {
        this.userStore = userStore;
        this.passwordEncoder = passwordEncoder;
    }

    public Optional<GijoUser> authenticate(String username, String rawPassword) {
        return userStore.findByUsername(username)
                .filter(user -> passwordEncoder.matches(rawPassword, user.passwordHash()));
    }
}
