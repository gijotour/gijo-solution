package com.gijo.as.domain;

public record CollaborationEvent(String from, String to, String message, long timestamp) {
}
