package com.gijo.as.domain;

public record DispatchResult(TaskItem task, RoutedIntent route, String output) {
}
