package com.gijo.as.controller;

import com.gijo.as.domain.DispatchResult;
import com.gijo.as.engine.service.DispatcherService;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/dispatch")
public class DispatchController {

    private final DispatcherService dispatcherService;

    public DispatchController(DispatcherService dispatcherService) {
        this.dispatcherService = dispatcherService;
    }

    public record DispatchRequest(String text) {
    }

    @PostMapping
    public DispatchResult dispatch(@RequestBody DispatchRequest request) {
        return dispatcherService.dispatch(request.text());
    }
}
