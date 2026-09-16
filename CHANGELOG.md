# GIJO WIKI 버전 관리 대장 (Changelog)

## [v5.1.0] - 2026-09-16
### 🎨 디자인 리뉴얼 (Clean & Minimalist Overhaul)
- **Linear / Modern Slate 미니멀 디자인 시스템 적용**:
  - 과도한 광택과 네온 그라데이션을 절제하고, 얇고 정교한 1px 서브틀 보더와 정갈한 타이포그래피 적용.
  - 가독성을 극대화한 슬레이트 차콜(Slate Charcoal) 배경 톤과 통일감 있는 컴포넌트 여백.
  - 탭 네비게이션, 사내 지식고 카드, RAG 대화창, BOM 테이블을 군더더기 없는 미니멀 플랫 스타일로 정돈.

### 🛡️ 실무 버그 패치 및 안정화
- XSS 방어 새니타이저(`sanitizeHtml`) 전면 적용.
- 로컬 LLM(Ollama/GB10) 실제 비동기 `fetch()` 통신 및 오프라인 자동 Fallback 듀얼 엔진 탑재.
- 스마트 아키텍처 스튜디오 노드 클릭 시 사내 보안 가이드 팝업 연계.
- 실시간 TCO & BOM 계산기 수량 동적 입력 필드 제공.
- 키보드 단축키 지원 (<kbd>ESC</kbd> 모달 닫기, <kbd>Ctrl + S</kbd> 문서 즉시 저장).

---

## [v5.0.0] - 2026-09-16
### 🚀 GIJO WIKI 공식 리브랜딩 & GIJO AS 지식 통합
- 사내 지식고 (My Docs Vault) 구축 및 브라우저 영구 보존 / JSON 백업 지원.
- GIJO AS 학습 지식(보안제품 관리 지침, CVE 대응 런북, AIBOM 가이드, ISMS-P 망분리 규정, 용어사전, 고객 실전 QA 30선) 전량 주입.
- 증거 기반(Citation) RAG 어시스턴트 및 추천 질문 칩 탑재.
- 스마트 아키텍처 Pro 스튜디오(4대 템플릿, 실시간 트래픽 애니메이션, SPOF 진단) 결합.
- Electron 데스크톱 인스톨러 배포.
