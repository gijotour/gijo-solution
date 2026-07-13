package com.gijo.as.domain;

public record RoutedIntent(String agentId, IntentAction action, String targetAssetId) {
}
