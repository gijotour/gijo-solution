package com.gijo.as.engine.service;

import com.gijo.as.domain.SbomDocument;
import com.gijo.as.domain.SbomFormat;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.List;

/** SBOM 생성 · 정리 (CycloneDX / SPDX, 6.4절). */
@Service
public class SbomService {

    public SbomDocument generate(String assetId) {
        // TODO: 자산 레지스트리에서 의존성 조회 후 org.cyclonedx:cyclonedx-core-java로 문서 생성
        return new SbomDocument(assetId, SbomFormat.CYCLONEDX, List.of(), Instant.now().toString());
    }

    public String export(String assetId, SbomFormat format) {
        // TODO: 생성된 SBOM을 JSON/XML로 저장하고 실제 파일 경로 반환
        return "exports/" + assetId + "." + format.wireValue() + ".json";
    }
}
