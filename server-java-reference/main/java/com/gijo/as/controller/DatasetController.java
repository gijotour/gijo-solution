package com.gijo.as.controller;

import com.gijo.as.domain.ConversationExample;
import com.gijo.as.engine.service.DatasetService;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/dataset")
public class DatasetController {

    private final DatasetService datasetService;

    public DatasetController(DatasetService datasetService) {
        this.datasetService = datasetService;
    }

    public record ConvertRequest(String rawText) {
    }

    public record AmplifyRequest(List<ConversationExample> examples, Integer factor) {
    }

    @PostMapping("/convert")
    public List<ConversationExample> convert(@RequestBody ConvertRequest request) {
        return datasetService.convertToConversationFormat(request.rawText());
    }

    @PostMapping("/amplify")
    public List<ConversationExample> amplify(@RequestBody AmplifyRequest request) {
        return datasetService.amplify(request.examples(), request.factor() == null ? 3 : request.factor());
    }
}
