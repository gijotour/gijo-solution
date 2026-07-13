package com.gijo.as.domain;

import java.util.List;

public record SendReportEmailRequest(List<String> to, String subject, String attachmentPath) {
}
