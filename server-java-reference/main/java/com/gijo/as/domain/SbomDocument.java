package com.gijo.as.domain;

import java.util.List;

public record SbomDocument(String assetId, SbomFormat format, List<SbomComponent> components, String generatedAt) {
}
