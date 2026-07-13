package com.gijo.as.domain;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

public enum AgentStatus {
    IDLE("idle"),
    WORKING("working"),
    WATCHING("watching");

    private final String wireValue;

    AgentStatus(String wireValue) {
        this.wireValue = wireValue;
    }

    @JsonValue
    public String wireValue() {
        return wireValue;
    }

    @JsonCreator
    public static AgentStatus fromWireValue(String wireValue) {
        for (AgentStatus status : values()) {
            if (status.wireValue.equalsIgnoreCase(wireValue)) {
                return status;
            }
        }
        throw new IllegalArgumentException("unknown agent status: " + wireValue);
    }
}
