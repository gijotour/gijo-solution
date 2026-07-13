package com.gijo.as.domain;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

public enum CtiSeverity {
    INFO("info"),
    WARNING("warning"),
    CRITICAL("critical");

    private final String wireValue;

    CtiSeverity(String wireValue) {
        this.wireValue = wireValue;
    }

    @JsonValue
    public String wireValue() {
        return wireValue;
    }

    @JsonCreator
    public static CtiSeverity fromWireValue(String wireValue) {
        for (CtiSeverity severity : values()) {
            if (severity.wireValue.equalsIgnoreCase(wireValue)) {
                return severity;
            }
        }
        throw new IllegalArgumentException("unknown cti severity: " + wireValue);
    }
}
