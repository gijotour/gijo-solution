const fs = require('fs');
const path = require('path');
const { loadedRealDocs: gijoDocs, quickQuestions: baseQuestions } = require('./load_real_gijo_docs.js');
const solutionsCatalog = require('./solutions_catalog_data.js');

const allWikiDocs = [...gijoDocs];

// Convert each solution into a full Markdown Wiki document
solutionsCatalog.forEach((sol, idx) => {
  const docId = 20 + idx; // IDs 20 through 39
  
  const markdownContent = [
    `# ${sol.name} (${sol.vendor})`,
    ``,
    `> **분류**: ${sol.category || sol.sheetCategory || '보안 솔루션'} | **공급사**: ${sol.vendor} | **도입대상**: ${sol.target || '전사 보안'}`,
    ``,
    `## 1. 솔루션 개요 (Overview)`,
    sol.overview || '상세 정보 없음',
    ``,
    `## 2. 도입 목적 및 필요성 (Purpose & Necessity)`,
    sol.purpose || '상세 정보 없음',
    ``,
    `## 3. 핵심 기능 (Key Features)`,
    sol.features || '상세 정보 없음',
    ``,
    `## 4. 특장점 및 차별성 (Highlights)`,
    sol.highlights || '상세 정보 없음',
    ``,
    `## 5. 컴플라이언스 및 규제 준수 (Regulation)`,
    sol.regulation || '관련 규정 준수',
    ``,
    `## 6. 도입 기대 효과 (Expected Effects)`,
    sol.effects || '보안성 및 운영 효율 강화',
    ``,
    sol.competitor ? `## 7. 대체재 및 경쟁 솔루션 비교 (Competitor Analysis)\n${sol.competitor}\n` : '',
    sol.architectureDiagram ? `## 8. 권장 아키텍처 다이어그램\n\`\`\`mermaid\n${sol.architectureDiagram}\n\`\`\`\n` : ''
  ].filter(Boolean).join('\n');

  const tags = [
    '솔루션',
    sol.name,
    sol.vendor.replace(/\[.*?\]/g, '').trim(),
    sol.vendorType || (sol.vendor.includes('국산') ? '국산' : '외산'),
    sol.category || sol.sheetCategory || '보안제품'
  ];

  if (sol.name.includes('AI') || (sol.category && sol.category.includes('AI'))) tags.push('AI보안');
  if (sol.name.includes('SBOM') || (sol.overview && sol.overview.includes('SBOM'))) tags.push('SBOM');
  if (sol.name.includes('EDR') || (sol.category && sol.category.includes('EDR'))) tags.push('EDR');
  if (sol.name.includes('DLP') || (sol.category && sol.category.includes('DLP'))) tags.push('DLP');
  if (sol.name.includes('WAAP') || (sol.name.includes('WAF'))) tags.push('WAF', 'WAAP');
  if (sol.name.includes('방화벽') || (sol.name.includes('FOCS'))) tags.push('방화벽');
  if (sol.name.includes('접근제어') || (sol.name.includes('SecureIM'))) tags.push('접근제어');
  if (sol.name.includes('인증서') || (sol.name.includes('WizCLM'))) tags.push('인증서');
  if (sol.name.includes('암호화') || (sol.name.includes('CipherTrust'))) tags.push('암호화');

  allWikiDocs.push({
    id: docId,
    title: `[솔루션] ${sol.name} — ${sol.vendor} (${sol.category || sol.sheetCategory})`,
    category: '보안솔루션',
    tags: Array.from(new Set(tags)),
    updatedAt: '2026-09-16',
    content: markdownContent,
    solData: sol
  });
});

const enhancedQuickQuestions = [
  ...baseQuestions,
  "WizCLM 인증서 수명주기 자동화 솔루션 개요 및 규제 준수는?",
  "SAFESQUARE SBOM 공급망 보안과 CycloneDX 지원 사양은?",
  "FOCS 이기종 방화벽 정책 관리 자동화의 도입 효과는?",
  "Tenable AI Exposure 섀도우 AI 탐지 및 통제 방안은?",
  "SecureIM 서버 접근제어 및 감사 추적 기능은?",
  "CipherTrust 투명 DB 암호화(구 Vormetric) 아키텍처는?",
  "Imperva WAAP 및 GenAI 보안 모듈 기능 요약해줘",
  "Falcon Insight EDR과 GRADIUS DLP의 엔드포인트 보안 통제는?",
  "국산 보안 솔루션과 외산 보안 솔루션 라인업 비교해줘"
];

console.log(`✅ Loaded total ${allWikiDocs.length} Wiki documents (9 Internal Guides + 20 Solutions).`);
console.log(`✅ Loaded ${enhancedQuickQuestions.length} Quick RAG questions.`);

module.exports = {
  allWikiDocs,
  enhancedQuickQuestions,
  solutionsCatalog
};
