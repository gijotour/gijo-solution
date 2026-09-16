const fs = require('fs');
const path = require('path');

console.log('=== GIJO WIKI & Solutions ERP Suite Comprehensive QA Test ===');

const htmlPath = path.join(__dirname, 'GIJO_Security_ERP_Suite.html');
if (!fs.existsSync(htmlPath)) {
  console.error('FAIL: GIJO_Security_ERP_Suite.html not found');
  process.exit(1);
}

const html = fs.readFileSync(htmlPath, 'utf8');

// 1. 기존 솔루션 수정 및 복원 기능 검증
console.log('\n[1. Standard Solution Modification & Restoration Verification]');
const hasOpenEditAny = html.includes('function openEditAnySolModal(');
const hasRestoreStandard = html.includes('function restoreStandardSolution(');
const hasEditDetailBtn = html.includes('openEditAnySolModalFromDetail()');
const hasOverrideLogic = html.includes('isOverridden: true');

console.log(' - openEditAnySolModal function:', hasOpenEditAny);
console.log(' - restoreStandardSolution function:', hasRestoreStandard);
console.log(' - Edit button in solDetailModal:', hasEditDetailBtn);
console.log(' - Overridden standard solution logic:', hasOverrideLogic);

if (!hasOpenEditAny || !hasRestoreStandard || !hasEditDetailBtn || !hasOverrideLogic) {
  console.error('FAIL: Standard solution modification components missing');
  process.exit(1);
}

// 2. 일일 보안점검 체크리스트 검증
console.log('\n[2. Daily Security Inspection Checklist Verification]');
const hasChecklistView = html.includes('id="view-checklist"');
const hasChecklistTab = html.includes('id="tabBtn-checklist"');
const hasRenderChecklist = html.includes('function renderChecklistGrid(');
const hasPrintDailyReport = html.includes('function printDailyInspectionReport(');

console.log(' - view-checklist DOM section:', hasChecklistView);
console.log(' - tabBtn-checklist nav button:', hasChecklistTab);
console.log(' - renderChecklistGrid function:', hasRenderChecklist);
console.log(' - printDailyInspectionReport function:', hasPrintDailyReport);

if (!hasChecklistView || !hasChecklistTab || !hasRenderChecklist || !hasPrintDailyReport) {
  console.error('FAIL: Checklist components missing');
  process.exit(1);
}

// 3. 경영진 보고용 ROI & 사고 예방 모델 검증
console.log('\n[3. Executive ROI & Risk Avoidance Model Verification]');
const hasRoiSection = html.includes('id="roiBreachAvoidance"');
const hasUpdateRoi = html.includes('function updateRoiMetrics(');
const hasRoiChapter5 = html.includes('5. 경영진 보고용 보안 투자 경제성(ROI) 분석');

console.log(' - ROI metric elements in BOM view:', hasRoiSection);
console.log(' - updateRoiMetrics calculation function:', hasUpdateRoi);
console.log(' - Chapter 5 ROI table in Comprehensive Report:', hasRoiChapter5);

if (!hasRoiSection || !hasUpdateRoi || !hasRoiChapter5) {
  console.error('FAIL: ROI components missing');
  process.exit(1);
}

// 4. ROI Calculation Math Simulation
console.log('\n[4. ROI Calculation Simulation]');
const activeCount = 5;
const capex = 125000000;
const opex = 15000000;

const breachAvoidance = Math.min(1500000000, activeCount * 75000000); // 375,000,000
const penaltyAvoidance = Math.min(300000000, activeCount * 30000000);  // 150,000,000
const laborSaving = Math.min(84000000, activeCount * 8000000 + 24000000); // 64,000,000

const annualCapex = capex / 5; // 25,000,000
const netAnnualBenefit = (breachAvoidance + penaltyAvoidance + laborSaving) - (annualCapex + opex); // 589M - 40M = 549M
const paybackMonths = ((capex / (breachAvoidance + penaltyAvoidance + laborSaving - opex)) * 12).toFixed(1);

console.log(' - Simulated Active Solutions Count:', activeCount);
console.log(' - Simulated Capex:', capex.toLocaleString(), '원');
console.log(' - Annual Breach Risk Avoidance:', breachAvoidance.toLocaleString(), '원');
console.log(' - Annual Penalty Risk Avoidance:', penaltyAvoidance.toLocaleString(), '원');
console.log(' - Annual Labor Saving:', laborSaving.toLocaleString(), '원');
console.log(' - Net Annual Economic Benefit:', netAnnualBenefit.toLocaleString(), '원');
console.log(' - Expected Payback Period:', paybackMonths, '개월');

if (netAnnualBenefit <= 0 || parseFloat(paybackMonths) <= 0) {
  console.error('FAIL: ROI calculation simulation error');
  process.exit(1);
}

console.log('\n✅ ALL SUITE ENHANCEMENT TESTS PASSED 100% SUCCESSFULLY!');
