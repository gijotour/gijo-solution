# GIJO AS 챗봇 명령 시나리오 (메뉴별)

> 각 메뉴에서 챗봇(지휘 콘솔)에 이렇게 지시하면 해당 기능이 실행됩니다. 표현은 예시이며, **비슷한 말로 해도** 의미가 같으면 같은 기능으로 처리됩니다(LLM 의미 매칭). 화면 맥락도 함께 쓰이므로, 그 메뉴를 보고 있으면 동사가 없어도("정리해줘") 그 메뉴 기준으로 해석됩니다.


## 취약점  `(vulnscan.html)`
- **취약점 현황 조회** → `finding_status / analyze(액션)`
    - "지금 열린 취약점 뭐 있어?"
    - "취약점 현황 정리해서 보여줘"
- **취약점 승인/반려** → `review_finding / update_finding_status`
    - "웹서버-01의 critical 취약점 승인 처리해줘"
    - "이건 오탐이야 반려해줘"
- **담당자/기한 배정** → `assign_finding / assign_owner`
    - "가장 급한 취약점 담당자랑 기한 배정해줘"

## 자산 목록  `(inventory.html)`
- **자산 목록** → `list_assets`
    - "등록된 자산 목록 보여줘"
    - "자산 몇 개나 돼?"
- **커버리지 결손** → `asset_coverage`
    - "담당부서 없는 자산 찾아줘"
    - "관리 결손 있는 자산 정리해줘"
- **자산 등록** → `register_asset`
    - "새 자산 등록해줘. 이름은 사내챗봇, 경로는 models/chat.gguf"

## AI-BOM 구성  `(sbom.html)`
- **AI-BOM 현황** → `aibom_status`
    - "AI-BOM 현황 보여줘"
    - "자산별 구성요소 정리해줘"
- **SBOM 생성** → `generate_sbom`
    - "웹서버-01 SBOM 만들어줘"

## 조치·승인  `(approvals.html)`
- **미검토 항목** → `finding_status`
    - "아직 검토 안 한 항목 보여줘"
- **승인 처리** → `review_finding / update_finding_status`
    - "이 항목 승인해줘"

## 보안제품  `(products.html)`
- **제품 현황** → `product_status`
    - "등록된 보안제품 보여줘"
    - "우리 방화벽 뭐 쓰고 있지?"
- **제품 등록** → `register_product`
    - "보안제품 등록해줘. 이름 팔로알토, 종류 방화벽"

## 유지보수  `(opsguide.html)`
- **점검 일정 현황** → `maintenance_status`
    - "정기 점검 일정 보여줘"
    - "이번 달 점검 뭐 있어?"
- **점검 예약** → `schedule_maintenance`
    - "다음주 월요일에 방화벽 정기점검 잡아줘"

## 컴플라이언스  `(compliance.html)`
- **대응 현황** → `compliance_status`
    - "KISA 위협 대응 현황 보여줘"
    - "컴플라이언스 정리해줘"
- **대응 상태 갱신** → `set_compliance_status`
    - "M06 위협 대응완료로 표시해줘"

## 리포트  `(report.html)`
- **리포트 작성** → `report(액션)`
    - "주간 보안 리포트 작성해줘"
    - "임원 보고서 뽑아줘"

## 기억·학습  `(memory.html)`
- **지식 현황** → `knowledge_status`
    - "장기기억에 문서 얼마나 쌓였어?"

## AI 견고성  `(redteam.html)`
- **레드팀 점검** → `run_redteam`
    - "사내챗봇 레드팀 점검 돌려줘"
    - "이 AI 인젝션 안전한지 봐줘"

## 위협 인텔리전스  `(threat.html)`
- **위협×자산** → `threats`
    - "최근 위협 중 우리 자산에 영향 있는 거 있어?"

## 대시보드(공용)  `(dashboard.html)`
- **오늘 브리핑** → `briefing / today`
    - "오늘 브리핑 해줘"
    - "지금 상황 요약해줘"
- **하드닝 점검** → `run_hardening_scan`
    - "방화벽 하드닝 점검해줘"
    - "보안장비 설정 점검 돌려줘"
- **통합 검색** → `search`
    - "log4j 관련된 거 다 찾아줘"

> 새 명령/기능이 늘면 `server/tools/menu-scenarios.mjs`에 추가하고 정확도를 다시 측정하세요(`menu-dispatch-accuracy.mjs`).
