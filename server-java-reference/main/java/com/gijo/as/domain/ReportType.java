package com.gijo.as.domain;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

public enum ReportType {
    WEEKLY("weekly"),
    QUARTERLY("quarterly"),
    ONDEMAND("ondemand");

    private final String wireValue;

    ReportType(String wireValue) {
        this.wireValue = wireValue;
    }

    @JsonValue
    public String wireValue() {
        return wireValue;
    }

    @JsonCreator
    public static ReportType fromWireValue(String wireValue) {
        for (ReportType type : values()) {
            if (type.wireValue.equalsIgnoreCase(wireValue)) {
                return type;
            }
        }
        throw new IllegalArgumentException("unknown report type: " + wireValue);
    }
}
