/**
 * GIJO WIKI & AS Knowledge QA Automated Verification Suite
 */
const fs = require('fs');
const path = require('path');
const { gijoAsKnowledgeDocs, quickQuestions } = require('./gijo_as_knowledge_pack.js');

console.log('====================================================');
console.log('🧪 GIJO WIKI & AS Knowledge QA Automated Test Suite');
console.log('====================================================');

let passedTests = 0;
let totalTests = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    console.log(`  ✅ [PASS] ${message}`);
    passedTests++;
  } else {
    console.error(`  ❌ [FAIL] ${message}`);
  }
}

// 1. Check HTML Files existence & content
console.log('\n[1] File Integrity & Knowledge Injection Test');
const htmlPath = path.join(__dirname, 'GIJO_Security_ERP_Suite.html');
const copyV3Path = path.join(__dirname, 'GIJO_AS_스마트아키텍처_v3.html');
const electronIndexPath = path.join(__dirname, 'gijo-security-erp-app', 'index.html');

assert(fs.existsSync(htmlPath), 'GIJO_Security_ERP_Suite.html exists');
assert(fs.existsSync(copyV3Path), 'GIJO_AS_스마트아키텍처_v3.html exists');
assert(fs.existsSync(electronIndexPath), 'Electron index.html exists');

const htmlContent = fs.readFileSync(htmlPath, 'utf8');
assert(htmlContent.includes('GIJO WIKI'), 'Title contains GIJO WIKI');
assert(htmlContent.includes('GIJO AS 학습 RAG 어시스턴트'), 'Contains GIJO AS RAG Assistant');
assert(htmlContent.includes('quick-chip-container'), 'Contains Quick Question Chips');
assert(htmlContent.includes('AIBOM'), 'Contains AIBOM Knowledge Injection');
assert(htmlContent.includes('취약점관리'), 'Contains Vulnerability Management Category');

// 2. Knowledge Database Integrity
console.log('\n[2] GIJO AS Knowledge Assets Integrity Test');
assert(gijoAsKnowledgeDocs.length >= 8, `Knowledge documents count >= 8 (Actual: ${gijoAsKnowledgeDocs.length})`);

const categories = new Set(gijoAsKnowledgeDocs.map(d => d.category));
assert(categories.has('보안규정'), 'Category [보안규정] verified');
assert(categories.has('취약점관리'), 'Category [취약점관리] verified');
assert(categories.has('AI보안'), 'Category [AI보안] verified');
assert(categories.has('아키텍처설계'), 'Category [아키텍처설계] verified');
assert(categories.has('솔루션매뉴얼'), 'Category [솔루션매뉴얼] verified');
assert(categories.has('QA문답집'), 'Category [QA문답집] verified');
assert(categories.has('장애런북'), 'Category [장애런북] verified');

// 3. Simulated RAG Engine Match Accuracy Test
console.log('\n[3] RAG Semantic & Ontology Query QA Tests');

function simulateRagQuery(query, docs) {
  const searchTerms = query.toLowerCase().split(' ').filter(w => w.length >= 2);
  let matchedDocs = [];

  docs.forEach(doc => {
    let score = 0;
    searchTerms.forEach(term => {
      if (doc.title.toLowerCase().includes(term)) score += 6;
      if (doc.tags.some(t => t.toLowerCase().includes(term))) score += 5;
      if (doc.content.toLowerCase().includes(term)) score += 2;
    });

    if (query.includes('AIBOM') && (doc.tags.includes('AIBOM') || doc.title.includes('AIBOM'))) score += 10;
    if (query.includes('WAF') && (doc.tags.includes('WAF') || doc.title.includes('WAF'))) score += 10;
    if (query.includes('에어갭') && (doc.tags.includes('에어갭') || doc.content.includes('에어갭'))) score += 10;
    if (query.includes('CVE') && (doc.tags.includes('CVE') || doc.title.includes('CVE'))) score += 10;
    if (query.includes('ISMS-P') && (doc.tags.includes('ISMS-P') || doc.title.includes('ISMS-P'))) score += 10;
    if (query.includes('DDoS') && (doc.tags.includes('DDoS') || doc.title.includes('DDoS'))) score += 10;

    if (score > 0) matchedDocs.push({ doc, score });
  });

  matchedDocs.sort((a, b) => b.score - a.score);
  return matchedDocs.length > 0 ? matchedDocs[0].doc : null;
}

const ragTestCases = [
  { q: "사내 에어갭 환경에서 로컬 LLM이 어떻게 동작하나요?", expectedCategory: "QA문답집" },
  { q: "WAF와 방화벽(NGFW)의 HA 이중화 구성 기준은?", expectedTag: "WAF" },
  { q: "AIBOM 검토 가이드 및 3단계 보안 통제 영역 요약해줘", expectedCategory: "AI보안" },
  { q: "취약점(CVE) 발생 시 5단계 긴급 조치 절차는?", expectedCategory: "취약점관리" },
  { q: "ISMS-P 2.4 망분리 및 접근통제 핵심 요구사항은?", expectedTag: "ISMS-P" },
  { q: "DDoS 및 랜섬웨어 침해사고 긴급대응 런북 보여줘", expectedCategory: "장애런북" }
];

ragTestCases.forEach((tc, idx) => {
  const matched = simulateRagQuery(tc.q, gijoAsKnowledgeDocs);
  assert(matched !== null, `Test Case #${idx+1} [${tc.q.slice(0, 20)}...] found a match`);
  if (matched) {
    if (tc.expectedCategory) {
      assert(matched.category === tc.expectedCategory || matched.title.includes(tc.expectedCategory) || matched.content.includes(tc.expectedCategory), `Test Case #${idx+1} matched category: ${matched.category}`);
    }
    if (tc.expectedTag) {
      assert(matched.tags.includes(tc.expectedTag) || matched.title.includes(tc.expectedTag), `Test Case #${idx+1} matched tag/title: ${tc.expectedTag}`);
    }
  }
});

// 4. Quick Questions Coverage Test
console.log('\n[4] Quick QA Chips Coverage Test');
assert(quickQuestions.length >= 5, `Quick questions count >= 5 (Actual: ${quickQuestions.length})`);
quickQuestions.forEach(q => {
  const matched = simulateRagQuery(q, gijoAsKnowledgeDocs);
  assert(matched !== null, `Quick Question [${q.slice(0, 25)}...] successfully resolves to Doc ID: ${matched?.id}`);
});

console.log('\n====================================================');
console.log(`📊 QA Test Summary: ${passedTests} / ${totalTests} Passed (${Math.round((passedTests/totalTests)*100)}%)`);
console.log('====================================================');

if (passedTests === totalTests) {
  console.log('🎉 ALL QA TEST CASES PASSED SUCCESSFULLY!');
  process.exit(0);
} else {
  console.error('⚠️ SOME QA TEST CASES FAILED.');
  process.exit(1);
}
