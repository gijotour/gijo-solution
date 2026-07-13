package com.gijo.as.domain;

import java.util.List;

public record SbomComponent(String name, String version, String license, List<String> knownVulns) {
}
