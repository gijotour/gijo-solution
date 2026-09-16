# [지침] KISA 표준 소프트웨어 공급망(SBOM) 추출 및 제출 실무 매뉴얼 (CycloneDX JSON)

> **문서분류**: 보안운영지침 | **표준규격**: CycloneDX v1.5 / v1.6 JSON | **적용대상**: 전사 IT 개발/운영팀 및 외부 납품 협력사

---

## 1. SBOM 제출 개요 및 필수 요건

### 1.1 제출 목적
- **소프트웨어 공급망 보안 체계 강화**: 사내 운영 및 외주 개발 애플리케이션에 탑재된 오픈소스 및 제3자 라이브러리의 투명성 확보.
- **알려진 보안 취약점(CVE) 신속 식별 및 선제적 패치**: Log4j, Spring RCE, Tomcat 취약점 등 공급망 보안 위협에 대한 실시간 영향도 분석 및 긴급 대응.

### 1.2 핵심 제출 요건
| 구분 | 필수 수검 및 제출 기준 | 비고 |
|:---|:---|:---|
| **표준 포맷** | **CycloneDX 규격 준수** (v1.5 또는 v1.6 권장) | 국제 표준 (OWASP / CISA / KISA) |
| **파일 형식** | **JSON 형식만 접수** (`.json`) | **XML 형식 불가** (자동 파싱 엔진 호환성) |
| **의존성 범위** | **직접(Direct) 및 간접(Transitive) 의존성 전체 포함** | 런타임에 로드되는 모든 하위 패키지 포함 |
| **파일명 규칙** | `[시스템명]_[서브모듈명]_SBOM_YYYYMMDD.json` | 예: `KISA_JEUS_CoreWAS_SBOM_20260916.json` |

### 1.3 작성 시 유의사항
1. **잠금 파일 기반 생성**: 반드시 운영 빌드/배포 시점의 잠금 파일(`package-lock.json`, `pom.xml`, `poetry.lock` 등)을 기반으로 생성해야 합니다.
2. **수기 작성 절대 금지**: 임의 수기 작성(Dummy Data)을 엄격히 금지하며, 반드시 공식 CycloneDX CLI/플러그인 도구를 통해 자동 추출해야 합니다.
3. **개발 의존성 분리**: 개발/테스트 전용 라이브러리(`devDependencies`, `testScope`) 분리가 가능한 경우, **운영 배포본(Production) 기준**으로 추출합니다.

---

## 2. 개발 환경별 CycloneDX 공식 도구 및 다운로드

| 개발 환경 | 공식 플러그인 / CLI | 상세 다운로드 및 공식 안내 URL |
|:---|:---|:---|
| **Java (Maven)** | `CycloneDX Maven Plugin` | [Sonatype Central](https://central.sonatype.com/artifact/org.cyclonedx/cyclonedx-maven-plugin) · [GitHub](https://github.com/CycloneDX/cyclonedx-maven-plugin) |
| **Java (Gradle)** | `CycloneDX Gradle Plugin` | [Gradle Plugin Portal](https://plugins.gradle.org/plugin/org.cyclonedx.bom) · [GitHub](https://github.com/CycloneDX/cyclonedx-gradle-plugin) |
| **Node.js (npm/yarn)** | `@cyclonedx/cyclonedx-npm` | [npm Registry](https://www.npmjs.com/package/@cyclonedx/cyclonedx-npm) · [GitHub](https://github.com/CycloneDX/cyclonedx-node-npm) |
| **Python** | `cyclonedx-bom` | [PyPI](https://pypi.org/project/cyclonedx-bom/) · [GitHub](https://github.com/CycloneDX/cyclonedx-python) |
| **독립 실행 바이너리** | `CycloneDX CLI` (검증/변환용) | [GitHub Releases](https://github.com/CycloneDX/cyclonedx-cli/releases) |

---

## 3. 언어 및 프레임워크별 실행 방법

### 3.1 Java 환경 (Maven / Gradle)

#### [Maven 프로젝트]
- `pom.xml`을 수정하지 않고 명령어로 1회성 추출이 가능합니다. 멀티 모듈인 경우 최상위 디렉터리에서 실행합니다:
```bash
# 출력 결과: target/bom.json
$ mvn org.cyclonedx:cyclonedx-maven-plugin:makeAggregateBom \
    -DoutputFormat=json \
    -DoutputName=bom
```

#### [Gradle 프로젝트]
- `build.gradle`에 플러그인 선언 후 태스크를 실행합니다:
```groovy
// build.gradle 플러그인 추가
plugins {
    id 'org.cyclonedx.bom' version '1.8.2'
}
```
```bash
# SBOM 생성 명령 실행 (출력 결과: build/reports/bom.json)
$ ./gradlew cyclonedxBom
```

---

### 3.2 JavaScript & Node.js 환경 (npm / yarn)
- 별도의 전역 설치 없이 `npx`로 즉시 실행할 수 있습니다. `package-lock.json`이 위치한 경로에서 실행합니다:
```bash
# 운영 배포 라이브러리만 추출할 경우 (--production 권장)
$ npx @cyclonedx/cyclonedx-npm \
    --output-format JSON \
    --output-file bom.json \
    --production
```

---

### 3.3 Python 환경 (pip / Poetry / Pipenv)
- `cyclonedx-bom` 패키지를 설치한 후 가상환경 또는 `requirements.txt` 기준으로 추출합니다:
```bash
$ pip install cyclonedx-bom

# 1) 활성화된 가상환경 기준 추출
$ cyclonedx-py -e -o bom.json --format json

# 2) 또는 requirements.txt 기준 추출
$ cyclonedx-py -r requirements.txt -o bom.json --format json
```

---

## 4. 제출 전 필수 체크리스트 및 자체 검증

### 4.1 제출 전 5대 점검표
- [x] **파일 확장자 확인**: 파일이 `.json` 확장자이며 정상적인 JSON 텍스트 구조인가?
- [x] **포맷 표준 확인**: 최상단에 `"bomFormat": "CycloneDX"` 필드가 선언되어 있는가?
- [x] **컴포넌트 목록 확인**: `"components"` 배열 내에 라이브러리명, 버전, `purl`이 포함되었는가?
- [x] **운영 의존성 확인**: 개발/테스트 전용 라이브러리가 제외되었는가? (해당 시)
- [x] **파일명 규칙 준수**: `[시스템명]_[서브모듈명]_SBOM_YYYYMMDD.json` 규칙을 준수하였는가?

### 4.2 CycloneDX CLI를 통한 자체 유효성 검증
생성된 `bom.json` 파일의 스키마 오류 여부를 사전에 검증합니다. 검증 통과 시 에러 없이 유효성 완료 메시지가 출력됩니다:
```bash
# CycloneDX CLI 실행 위치에서 검증 실행
$ cyclonedx validate \
    --input-file bom.json \
    --input-format json
```

---

## 5. GIJO AS 워크스페이스 등록 및 아키텍처 스튜디오 연동 절차
1. **웹앱/데스크톱 접속**: 상단 `[📦 IT 자산 & SBOM]` 탭으로 이동.
2. **CycloneDX 파일 가져오기**: 상단 `[CycloneDX 가져오기]` 버튼을 누르고 위에서 생성된 `bom.json` 파일 선택.
3. **자산 매핑 및 CVE 검증**: 사내 자산(WAS/웹서버/DB)에 패키지 및 취약점(CVE)이 자동 바인딩됨을 확인.
4. **아키텍처 스튜디오 반영**: `[아키텍처 스튜디오 반영]`을 클릭하여 계층형 인프라 구성도 및 위험 노드 자동 렌더링.
5. **수검 대장 인쇄**: `[수검 대장 인쇄]` 버튼으로 결재란이 포함된 A4 공식 관리대장을 출력하여 보안감사 제출.
