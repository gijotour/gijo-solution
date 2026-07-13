package com.gijo.as.domain;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

public enum Role {
    SECURITY_OFFICER("security_officer"),
    ADMIN("admin");

    private final String wireValue;

    Role(String wireValue) {
        this.wireValue = wireValue;
    }

    @JsonValue
    public String wireValue() {
        return wireValue;
    }

    @JsonCreator
    public static Role fromWireValue(String wireValue) {
        for (Role role : values()) {
            if (role.wireValue.equalsIgnoreCase(wireValue)) {
                return role;
            }
        }
        throw new IllegalArgumentException("unknown role: " + wireValue);
    }
}
