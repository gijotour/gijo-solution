package com.gijo.as.domain;

public record CtiFinding(String id, String detectedAt, String type, String target, String source, CtiSeverity severity) {
}
