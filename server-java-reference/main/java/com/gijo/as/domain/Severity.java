package com.gijo.as.domain;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

public enum Severity {
    LOW("low"),
    MEDIUM("medium"),
    HIGH("high"),
    CRITICAL("critical");

    private final String wireValue;

    Severity(String wireValue) {
        this.wireValue = wireValue;
    }

    @JsonValue
    public String wireValue() {
        return wireValue;
    }

    @JsonCreator
    public static Severity fromWireValue(String wireValue) {
        for (Severity severity : values()) {
            if (severity.wireValue.equalsIgnoreCase(wireValue)) {
                return severity;
            }
        }
        throw new IllegalArgumentException("unknown severity: " + wireValue);
    }
}
