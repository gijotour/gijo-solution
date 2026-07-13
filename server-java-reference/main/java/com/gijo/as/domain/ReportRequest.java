package com.gijo.as.domain;

import java.util.List;

public record ReportRequest(ReportType type, List<String> assetIds) {
}
