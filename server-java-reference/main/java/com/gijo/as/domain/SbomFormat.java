package com.gijo.as.domain;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

public enum SbomFormat {
    CYCLONEDX("cyclonedx"),
    SPDX("spdx");

    private final String wireValue;

    SbomFormat(String wireValue) {
        this.wireValue = wireValue;
    }

    @JsonValue
    public String wireValue() {
        return wireValue;
    }

    @JsonCreator
    public static SbomFormat fromWireValue(String wireValue) {
        for (SbomFormat format : values()) {
            if (format.wireValue.equalsIgnoreCase(wireValue)) {
                return format;
            }
        }
        throw new IllegalArgumentException("unknown sbom format: " + wireValue);
    }
}
