package com.gijo.as.controller;

import com.gijo.as.domain.SendReportEmailRequest;
import com.gijo.as.engine.service.EmailService;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/email")
public class EmailController {

    private final EmailService emailService;

    public EmailController(EmailService emailService) {
        this.emailService = emailService;
    }

    @PostMapping("/sendReport")
    public Map<String, Boolean> sendReport(@RequestBody SendReportEmailRequest request) {
        emailService.sendReportEmail(request);
        return Map.of("ok", true);
    }
}
