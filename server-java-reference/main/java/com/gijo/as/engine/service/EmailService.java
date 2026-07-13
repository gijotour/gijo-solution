package com.gijo.as.engine.service;

import com.gijo.as.domain.SendReportEmailRequest;
import jakarta.mail.MessagingException;
import jakarta.mail.internet.MimeMessage;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.stereotype.Service;

import java.io.File;

/** 내부 리포트 이메일 발송 (6.4.1절) — Spring @Scheduled 정기 리포트와 함께 쓰인다. */
@Service
public class EmailService {

    private static final Logger log = LoggerFactory.getLogger(EmailService.class);

    private final JavaMailSender mailSender;

    public EmailService(JavaMailSender mailSender) {
        this.mailSender = mailSender;
    }

    public void sendReportEmail(SendReportEmailRequest request) {
        try {
            MimeMessage message = mailSender.createMimeMessage();
            MimeMessageHelper helper = new MimeMessageHelper(message, request.attachmentPath() != null);
            helper.setTo(request.to().toArray(new String[0]));
            helper.setSubject(request.subject());
            helper.setText("첨부된 리포트를 확인해주세요.");
            if (request.attachmentPath() != null && !request.attachmentPath().isBlank()) {
                helper.addAttachment(new File(request.attachmentPath()).getName(), new File(request.attachmentPath()));
            }
            mailSender.send(message);
        } catch (MessagingException e) {
            log.error("failed to send report email to {}", request.to(), e);
            throw new IllegalStateException("이메일 발송 실패: " + e.getMessage(), e);
        }
    }
}
