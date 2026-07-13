package com.gijo.as.domain;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

public enum IntentAction {
    SCAN("scan"),
    ANALYZE("analyze"),
    REPORT("report"),
    CHAT("chat");

    private final String wireValue;

    IntentAction(String wireValue) {
        this.wireValue = wireValue;
    }

    @JsonValue
    public String wireValue() {
        return wireValue;
    }

    @JsonCreator
    public static IntentAction fromWireValue(String wireValue) {
        for (IntentAction action : values()) {
            if (action.wireValue.equalsIgnoreCase(wireValue)) {
                return action;
            }
        }
        throw new IllegalArgumentException("unknown intent action: " + wireValue);
    }
}
