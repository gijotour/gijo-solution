package com.gijo.as.controller;

import com.gijo.as.domain.RoutedIntent;
import com.gijo.as.engine.service.IntentService;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/intent")
public class IntentController {

    private final IntentService intentService;

    public IntentController(IntentService intentService) {
        this.intentService = intentService;
    }

    public record RouteRequest(String text) {
    }

    @PostMapping("/route")
    public RoutedIntent route(@RequestBody RouteRequest request) {
        return intentService.routeIntent(request.text());
    }
}
