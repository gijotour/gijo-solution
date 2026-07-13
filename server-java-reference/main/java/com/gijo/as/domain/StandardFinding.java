package com.gijo.as.domain;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Wire shape must stay {@code finding_type} / {@code source_tool} — this is the
 * standard finding schema Python scanner adapters (ModelScan 등) already emit.
 */
public record StandardFinding(
        @JsonProperty("finding_type") String findingType,
        Severity severity,
        String evidence,
        @JsonProperty("source_tool") String sourceTool
) {
}
