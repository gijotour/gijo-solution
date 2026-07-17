# GIJO AS — AI-BOM 실현 가능성 검토 및 구현 가이드

> 작성 2026-07-17. 결론 먼저: **가능합니다.** 표준 AI-BOM(ML-BOM)을 만들 **부품이 이미 제품에 다 있습니다** —
> CycloneDX 라이브러리(v10.1.0, ML 컴포넌트 타입 지원) + AI-BOM 5영역 데이터 수집 + SBOM export 파이프라인.
> 남은 건 이 셋을 "표준 AI-BOM 문서"로 **조립**하는 소규모 작업뿐입니다.

---

## 1. AI-BOM이란 (SBOM과의 차이)

- **SBOM(Software BOM)**: 소프트웨어의 **코드 구성요소**(라이브러리·버전·라이선스) 명세. "이 앱에 log4j 2.11이 들어있다".
- **AI-BOM(AI Bill of Materials / ML-BOM)**: AI 시스템의 **AI 고유 구성요소**까지 확장한 명세 —
  **모델**(파운데이션·파인튜닝 계보·아키텍처·가중치 해시), **데이터셋**(출처·라이선스·전처리), **프롬프트·가드레일**,
  **에이전트 도구/외부 API·MCP**, **인프라**, 그리고 그 위의 **코드 SBOM**.
- 한 줄: **SBOM ⊂ AI-BOM.** AI-BOM = SBOM + (모델 카드 + 데이터 명세 + 프롬프트/도구/인프라 명세).

## 2. 왜 필요한가 (규제·거버넌스 동인)

- **EU AI Act**: 고위험 AI의 기술문서·데이터 거버넌스·투명성 의무 → 구성요소 추적 필요.
- **NIST AI RMF / US EO 14110**: AI 공급망 투명성·모델 출처(provenance) 요구.
- **공급망 보안**: 파운데이션 모델·데이터셋·오픈소스 의존성의 취약점·라이선스·오염(poisoning) 위험 추적.
- **제품 내부 연계**: GIJO AS의 **취약점 관리·거버넌스 매칭·컴플라이언스**가 "무엇을 지키는지(자산 구성)"를
  AI-BOM에서 가져오면 정확도가 올라감(예: 데이터셋 출처 → M01 학습데이터 유출, 벡터DB → M02).

## 3. 표준 지형 (2026 기준)

| 표준 | AI-BOM 지원 | 제품 적용성 |
|---|---|---|
| **CycloneDX 1.5/1.6** | ML-BOM: `machine-learning-model`·`data` 컴포넌트 타입, `modelCard`, `properties` | ✅ **1순위** — 이미 이 라이브러리 사용 중 |
| **SPDX 3.0** | AI Profile + Dataset Profile(모델·데이터셋 전용 필드) | △ 2순위 — 현재 제품은 SPDX 2.3(AI 프로필 없음). 3.0은 별도 작업 |
| **OWASP AI Exchange / MITRE ATLAS** | 위협 매핑 참조 | 참조용(거버넌스 매칭과 연계) |
| **Google Model Card / HF Model Card** | 모델 카드 서술 구조 | modelCard 필드 채움 참고 |

→ **결론: CycloneDX ML-BOM(1.5+)이 최단 경로.** 이미 쓰는 라이브러리로 표준 준수 export가 나옵니다.

## 4. 현재 제품 상태 (코드 근거)

**있는 것**
- `server/src/engine/assets.ts` — **AI-BOM 5영역** 스키마·수집(자산별 JSON):
  `model{foundationModel, finetuneHistory, architecture, weightsHash}`, `dataset{sources, vectorDbLocation}`,
  `prompt{systemPrompt, guardrails}`, `agentTool{apis, mcpServers}`, `infrastructure{compute, hostingProvider}`.
  → 보안담당자가 UI(인벤토리)에서 채워 넣는 관리 항목으로 **이미 존재**.
- `server/src/engine/sbom.ts` — `@cyclonedx/cyclonedx-library` **v10.1.0**로 **CycloneDX 1.5** export.
  루트 컴포넌트를 이미 **`MachineLearningModel`** 타입으로 생성(`bom.metadata.component`). SPDX 2.3도 export.
- 라이브러리 확인: `Enums.ComponentType.MachineLearningModel`(=`machine-learning-model`),
  `Enums.ComponentType.Data`(=`data`), `Component.properties` **모두 사용 가능**. spec 1.7까지 존재.

**빠진 것(갭)**
- CycloneDX export가 **코드 라이브러리 컴포넌트만** 담고, **AI-BOM 5영역(모델·데이터·프롬프트·도구·인프라)이
  표준 문서에 안 실림**. 즉 5영역은 화면 자유텍스트로만 있고 **표준 AI-BOM 산출물로 나오지 않음**.
- 모델 카드(고려사항·한계·성능/편향 지표) 필드 없음. `weightsHash` 수동.

## 5. 실현 가능성 매트릭스

| 필요 요소 | 상태 |
|---|---|
| ML 모델 컴포넌트 타입 | ✅ 있음(이미 루트에 사용) |
| 데이터셋(`data`) 컴포넌트 타입 | ✅ 라이브러리 지원(미사용) |
| 컴포넌트 `properties`(모델카드/프롬프트/인프라 담기) | ✅ 라이브러리 지원(미사용) |
| AI-BOM 5영역 데이터 | ✅ 이미 수집 |
| export 파이프라인·엔드포인트·UI | ✅ SBOM 것 재사용 |
| **표준 AI-BOM 조립 로직** | ⛏ **이것만 추가하면 됨(소규모)** |

→ **실현 가능성: 높음.** 신규 의존성 0, 백엔드 함수 1개 + 라우트 1개 + UI 버튼 1개 수준.

## 6. 단계별 구현 가이드

### 1단계 (핵심·소규모) — AiBom → CycloneDX ML-BOM export
`sbom.ts`에 `buildAiBomCycloneDx(assetId)` 추가:
- 루트: `MachineLearningModel` 컴포넌트 + `properties`에 `aibom.model` 4필드
  (`gijo:model:foundationModel`, `finetuneHistory`, `architecture`, `weightsHash`).
- `aibom.dataset.sources`/`vectorDbLocation` → **`Data` 타입 컴포넌트**로 추가(데이터셋 명세).
- `prompt`(시스템프롬프트는 **해시/요약만**, guardrails), `agentTool`(apis·mcpServers), `infrastructure` → 루트 `properties`.
- 기존 코드 라이브러리 컴포넌트(현행)도 그대로 포함 → SBOM + AI 메타가 **한 문서**에.
- 라우트 `POST /api/assets/:id/aibom/export?format=cyclonedx`, 인벤토리에 **"AI-BOM 내보내기"** 버튼.
- 공수: **반나절~1일**.

### 2단계 — 모델 카드 보강
- AiBom.model에 `intendedUse`, `limitations`, `ethicalConsiderations`, `performance`(정확도·편향 지표) 필드 추가.
- `weightsHash` 자동 계산(로컬 .gguf 파일 SHA-256) — 무결성·출처 추적.
- CycloneDX `modelCard` 구조로 승격(라이브러리 modelCard 미지원 시 후처리 JSON 병합).

### 3단계 — 거버넌스·취약점 연계 (제품 차별화)
- AI-BOM의 **데이터셋 출처 → KISA AI 위협(M01 학습데이터·M02 벡터DB)** 자동 매칭(온톨로지 활용).
- 파운데이션 모델·의존성 → 취약점/라이선스 리스크 연결(이미 있는 finding·거버넌스 매칭에 편입).
- 리포트의 "취약점 사례·거버넌스 매칭"에 **AI-BOM 근거** 삽입.

### 4단계 (선택) — SPDX 3.0 AI/Dataset Profile
- 표준·툴 생태계 성숙 시 SPDX 3.0 AI 프로필 export 추가(현재 2.3 → 3.0은 스키마 큰 변경이라 후순위).

## 7. 예시 산출물 (1단계 CycloneDX ML-BOM, 발췌)

```json
{
  "bomFormat": "CycloneDX", "specVersion": "1.5",
  "metadata": {
    "component": {
      "type": "machine-learning-model", "name": "fraud-detect-llm",
      "properties": [
        { "name": "gijo:model:foundationModel", "value": "Qwen2.5-7B-Instruct" },
        { "name": "gijo:model:finetuneHistory", "value": "sft v3 (사내 사고대응 QA 2.1k)" },
        { "name": "gijo:model:weightsHash", "value": "sha256:1a2b…" },
        { "name": "gijo:prompt:systemPromptHash", "value": "sha256:9f8e…" },
        { "name": "gijo:infra:hostingProvider", "value": "온프레미스 RTX 3090" }
      ]
    }
  },
  "components": [
    { "type": "data", "name": "학습 데이터셋", "properties": [
        { "name": "gijo:dataset:sources", "value": "사내 사고대응 보고서 2019–2025" },
        { "name": "gijo:dataset:vectorDbLocation", "value": "LanceDB data/memory.lancedb" } ] },
    { "type": "library", "name": "transformers", "version": "4.44.0" }
  ]
}
```

## 8. 스코프·원칙

- **온프레미스·기존 재사용**: 신규 의존성 0. `sbom.ts`·`assets.ts` 확장, `@cyclonedx/cyclonedx-library` 그대로.
- **자유텍스트 유지 + 표준 export 추가**: 담당자 입력 UX는 그대로, 버튼으로 표준 문서를 뽑음.
- **민감정보**: 시스템 프롬프트·가중치는 **원문 대신 해시/요약**만 BOM에 실어 유출 방지.
- **정직**: AI-BOM export는 담당자가 채운 값 기반 참고 산출물 — 자동 스캔이 아닌 부분은 "미기재"로 명시.

## 9. 리스크·주의

- CycloneDX JS 라이브러리 v10은 `modelCard` **전용 모델 클래스가 없을 수 있음** → 1단계는 **properties·data 컴포넌트**로
  구현(확실히 유효), 정식 `modelCard` 구조는 2단계에서 후처리 JSON 병합.
- SPDX 3.0 AI 프로필은 스키마·툴 성숙 진행 중 → 후순위.
- AI-BOM은 규제 대응의 **한 축**일 뿐 — 데이터 거버넌스·모델 평가와 함께 운영해야 함.

---

**요약**: 부품이 다 있어 **1단계(AiBom→CycloneDX ML-BOM export)는 반나절~1일**이면 표준 AI-BOM이 나옵니다.
원하시면 1단계를 바로 구현하겠습니다(엔드포인트 + 인벤토리 "AI-BOM 내보내기" 버튼 + 예시 검증).
