package com.gijo.as.domain;

public record GijoUser(String id, String username, String passwordHash, String displayName, Role role) {
}
