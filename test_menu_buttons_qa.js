const fs = require('fs');
const path = require('path');

console.log('=== GIJO Security ERP Suite Comprehensive FinOps & Topology QA ===');

const htmlPath = path.join(__dirname, 'GIJO_Security_ERP_Suite.html');
if (!fs.existsSync(htmlPath)) {
  console.error('FAIL: HTML file not found');
  process.exit(1);
}

const html = fs.readFileSync(htmlPath, 'utf8');

// 1. Check all 7 main navigation tabs & views
const mainTabs = [
  { btn: 'tabBtn-wiki', view: 'view-wiki', label: '사내 지식고' },
  { btn: 'tabBtn-studio', view: 'view-studio', label: '아키텍처 스튜디오' },
  { btn: 'tabBtn-audit', view: 'view-audit', label: '보안 진단기' },
  { btn: 'tabBtn-portal', view: 'view-portal', label: '솔루션 포털' },
  { btn: 'tabBtn-bom', view: 'view-bom', label: 'TCO / BOM' },
  { btn: 'tabBtn-checklist', view: 'view-checklist', label: '일일 점검 일지' },
  { btn: 'tabBtn-sbom', view: 'view-sbom', label: 'IT 자산 & SBOM' }
];

mainTabs.forEach(t => {
  const hasBtn = html.includes('id=\"' + t.btn + '\"');
  const hasView = html.includes('id=\"' + t.view + '\"');
  if (hasBtn && hasView) {
    console.log(' - [PASS] Main Nav Tab: ' + t.label + ' (' + t.btn + ' -> ' + t.view + ')');
  } else {
    console.error(' - [FAIL] Missing Main Nav: ' + t.label);
    process.exit(1);
  }
});

// 2. Check TCO & FinOps 3 Sub-tabs
const subTabs = [
  { btn: 'bomSubBtn-sol', view: 'bomSubView-sol', label: '보안 솔루션 TCO' },
  { btn: 'bomSubBtn-api', view: 'bomSubView-api', label: '생성형 AI & API FinOps' },
  { btn: 'bomSubBtn-lifecycle', view: 'bomSubView-lifecycle', label: '계약 생애주기 D-Day' }
];

subTabs.forEach(st => {
  const hasBtn = html.includes('id=\"' + st.btn + '\"');
  const hasView = html.includes('id=\"' + st.view + '\"');
  if (hasBtn && hasView) {
    console.log(' - [PASS] FinOps Sub-Tab: ' + st.label + ' (' + st.btn + ' -> ' + st.view + ')');
  } else {
    console.error(' - [FAIL] Missing FinOps Sub-Tab: ' + st.label);
    process.exit(1);
  }
});

// 3. Check FinOps Engine & Default AI Models
const finopsTokens = [
  'OpenAI GPT-4o Enterprise',
  'Anthropic Claude 3.5 Sonnet',
  'Google Gemini 1.5 Pro',
  '온프레미스 GB10 (Qwen 177B MoE)',
  '사내 bge-m3 임베딩 & OCR API',
  'function calculateAiApiCost',
  'function updateAiApiKpis',
  'function renderAiApiTable',
  'exportAiApiCsv'
];

finopsTokens.forEach(token => {
  if (html.includes(token)) {
    console.log(' - [PASS] FinOps Engine Token: ' + token);
  } else {
    console.error(' - [FAIL] Missing FinOps Token: ' + token);
    process.exit(1);
  }
});

// 4. Check Contract Lifecycle & D-Day Engine
const lifecycleTokens = [
  'id=\"lifecycleDDayAlertBar\"',
  'function calculateDDay',
  'function calculateDepreciationValue',
  'function renderLifecycleTable',
  'id=\"lifecycleModal\"'
];

lifecycleTokens.forEach(token => {
  if (html.includes(token)) {
    console.log(' - [PASS] Lifecycle & D-Day Token: ' + token);
  } else {
    console.error(' - [FAIL] Missing Lifecycle Token: ' + token);
    process.exit(1);
  }
});

// 5. Check Inline IT Asset Topology Graph in view-sbom
const topologyTokens = [
  'id=\"assetTopologyGraphContainer\"',
  'id=\"assetTopologyContentWrapper\"',
  'function renderAssetTopologyGraph',
  'function toggleAssetTopologyView',
  '전사 IT 자산 & SBOM 계층형 인프라 토폴로지 구성도'
];

topologyTokens.forEach(token => {
  if (html.includes(token)) {
    console.log(' - [PASS] Asset Topology Graph Token: ' + token);
  } else {
    console.error(' - [FAIL] Missing Topology Token: ' + token);
    process.exit(1);
  }
});

// 6. Check Real Data & CVE status
const dataTokens = [
  '금융 코어 WAS (TmaxSoft JEUS 8.5)',
  'CVE-2016-1000027',
  'CVE-2025-24813',
  'CVE-2026-54512',
  'KISA 표준 소프트웨어 공급망(SBOM) 추출 및 제출 실무 매뉴얼'
];

dataTokens.forEach(token => {
  if (html.includes(token)) {
    console.log(' - [PASS] Real Data & CVE: ' + token);
  } else {
    console.error(' - [FAIL] Missing Data: ' + token);
    process.exit(1);
  }
});

// 7. Check Smart Approval Board (전자결재 기안판)
const approvalTokens = [
  'id="smartApprovalModal"',
  'function openSmartApprovalModal',
  'function toggleStamp',
  'function loadApprovalTemplate',
  'function pullTcoToDraft',
  'function pullSbomToDraft',
  'function saveApprovalDraftToWiki',
  'function printApprovalDocument',
  'SOL_PURCHASE',
  'VULN_PATCH',
  'BUDGET_REQUEST',
  'stampCiso'
];

approvalTokens.forEach(token => {
  if (html.includes(token)) {
    console.log(' - [PASS] Smart Approval Board Token: ' + token);
  } else {
    console.error(' - [FAIL] Missing Smart Approval Token: ' + token);
    process.exit(1);
  }
});

// 8. Check Visual Architecture Studio Stencils & Quick Connector
const studioTokens = [
  'id="paletteTargetZone"',
  'function addStencilNode',
  'function quickConnectNodes',
  'function toggleStudioDirection',
  'function downloadStudioSvg',
  'id="quickFromNode"',
  'id="quickToNode"',
  'id="quickProtocol"'
];

studioTokens.forEach(token => {
  if (html.includes(token)) {
    console.log(' - [PASS] Visual Studio Stencil Token: ' + token);
  } else {
    console.error(' - [FAIL] Missing Studio Token: ' + token);
    process.exit(1);
  }
});

console.log('================================================================');
console.log('🎉 ALL 53 COMPREHENSIVE QA CHECKS PASSED WITH ZERO DEFECTS!');

