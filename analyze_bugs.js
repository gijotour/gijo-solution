const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, 'GIJO_Security_ERP_Suite.html');
const html = fs.readFileSync(htmlPath, 'utf8');

const issues = [];

// 1. 실제 LLM fetch 호출 부재 여부
if (!html.includes('fetch(')) {
  issues.push({
    severity: 'HIGH',
    type: 'FEATURE_GAP',
    issue: '로컬 Ollama/GB10 API 실제 fetch 호출 부재',
    detail: '현재 RAG 질의가 로컬 JS 키워드 시뮬레이션으로만 동작하며, 설정된 http://localhost:11434 (Ollama) 또는 GB10 API로의 실제 비동기 fetch 통신 및 스트리밍 응답 처리가 미구현됨.'
  });
}

// 2. 마크다운 파서 XSS 취약점
if (!html.includes('DOMPurify') && !html.includes('sanitizeHtml')) {
  issues.push({
    severity: 'CRITICAL',
    type: 'SECURITY_VULNERABILITY',
    issue: '마크다운 렌더링 시 XSS (크로스 사이트 스크립팅) 취약점',
    detail: '사내 지식고에 <img src=x onerror=...> 또는 <script> 태그가 포함된 마크다운 입력 시 이스케이프 없이 innerHTML로 렌더링되어 악성 스크립트 실행 위험 존재.'
  });
}

// 3. LocalStorage 용량 초과 및 예외 처리
if (!html.includes('QuotaExceededError')) {
  issues.push({
    severity: 'MEDIUM',
    type: 'DATA_STABILITY',
    issue: 'LocalStorage 용량 제한(약 5MB) 및 QuotaExceeded 예외 처리 미흡',
    detail: '대용량 보안 매뉴얼이나 PDF 추출 텍스트를 대량 등록할 경우 브라우저 LocalStorage 용량을 초과하여 데이터 저장이 실패할 수 있음.'
  });
}

// 4. 모달창 UX 및 키보드 접근성 (ESC 닫기, 백드롭 클릭)
if (!html.includes('keydown') || !html.includes('Escape')) {
  issues.push({
    severity: 'LOW',
    type: 'UX_ACCESSIBILITY',
    issue: '모달창 ESC 키 및 백드롭 클릭 닫기 이벤트 미구현',
    detail: 'LLM 설정 모달창 등이 ESC 키나 모달 바깥 영역을 클릭했을 때 닫히지 않고 오직 X 버튼으로만 닫힘.'
  });
}

// 5. BOM 계산기 동적 수량 편집
if (!html.includes('type="number"') && !html.includes('onchange="updateBomQty')) {
  issues.push({
    severity: 'MEDIUM',
    type: 'BUSINESS_LOGIC',
    issue: 'BOM 장비 수량 고정 (동적 수량 변경 불가)',
    detail: 'BOM 계산서에서 수량이 2식(HA)으로 하드코딩되어 사용자가 엔터프라이즈 규모에 맞게 수량(1~10대)을 직접 변경하여 TCO를 재계산할 수 없음.'
  });
}

// 6. 스튜디오 캔버스 노드 클릭 시 사내 위키 자동 연동 팝업
if (!html.includes('showWikiForNode')) {
  issues.push({
    severity: 'LOW',
    type: 'INTEGRATION',
    issue: '스튜디오 노드 클릭 시 해당 위키 문서 직접 팝업 액션 부재',
    detail: '아키텍처 스튜디오의 다이어그램 노드(WAF, NGFW 등)를 클릭했을 때 관련 사내 규정/매뉴얼을 바로 띄워주는 인터랙션이 연결되어 있지 않음.'
  });
}

console.log('=== 발견된 실무 버그 및 기술적 개선점 ===');
console.log(JSON.stringify(issues, null, 2));
console.log(`\n총 ${issues.length}건의 개선 필요 사항 식별`);
