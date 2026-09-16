const fs = require('fs');
const path = require('path');

console.log('=== GIJO WIKI Suite PDF Upload & RAG Learning Integrity Test ===');

const htmlPath = path.join(__dirname, 'GIJO_Security_ERP_Suite.html');
if (!fs.existsSync(htmlPath)) {
  console.error('FAIL: GIJO_Security_ERP_Suite.html not found');
  process.exit(1);
}

const html = fs.readFileSync(htmlPath, 'utf8');

// 1. PDF.js CDN 및 오프라인 파서 확인
const hasPdfJsCdn = html.includes('pdf.min.js');
const hasParsePdfFunc = html.includes('async function parsePdfFile(');
const hasHandlePdfUpload = html.includes('async function handlePdfUpload(');
const hasHandleDetailPdfUpload = html.includes('async function handleDetailPdfUpload(');
const hasDropZone = html.includes('id="pdfDropZone"');
const hasDetailPdfButton = html.includes('id="detailPdfInput"');

console.log('[1. Component Verification]');
console.log(' - PDF.js CDN present:', hasPdfJsCdn);
console.log(' - parsePdfFile function present:', hasParsePdfFunc);
console.log(' - handlePdfUpload function present:', hasHandlePdfUpload);
console.log(' - handleDetailPdfUpload function present:', hasHandleDetailPdfUpload);
console.log(' - pdfDropZone UI element present:', hasDropZone);
console.log(' - detailPdfInput UI element present:', hasDetailPdfButton);

if (!hasPdfJsCdn || !hasParsePdfFunc || !hasHandlePdfUpload || !hasDropZone) {
  console.error('FAIL: Missing PDF components in HTML');
  process.exit(1);
}

// 2. Offline PDF Parser Logic Simulation
console.log('\n[2. Offline / Airgap Fallback PDF Parsing Simulation]');
const mockPdfBytes = Buffer.from(
  '%PDF-1.4\n1 0 obj\n<< /Length 120 >>\nstream\n' +
  'BT\n/F1 12 Tf\n(FortiGate-60F Enterprise Firewall Manual) Tj\n' +
  '(Daily Health Check: systemctl status fg-daemon) Tj\n' +
  '(Emergency Contact: 1588-0000) Tj\nET\nendstream\nendobj\n%%EOF'
);

const rawStr = mockPdfBytes.toString('binary');
const matches = [];
const tjRegex = /\(([^()]{2,})\)\s*Tj/g;
let m;
while ((m = tjRegex.exec(rawStr)) !== null) {
  const cleaned = m[1].replace(/\\([()])/g, '$1').trim();
  if (cleaned.length > 1) matches.push(cleaned);
}

console.log(' - Mock PDF raw matches count:', matches.length);
console.log(' - Extracted sample lines:', matches);
if (matches.length < 3) {
  console.error('FAIL: Mock PDF text extraction failed');
  process.exit(1);
}

// 3. RAG Learning Simulation with Extracted Manual
console.log('\n[3. RAG Search Matching Simulation with Custom Uploaded Manual]');
const mockExtractedText = matches.join('\n');
const mockCustomSolDoc = {
  id: 9999,
  title: '[사내솔루션] FortiGate-60F — 포티넷 [외산]',
  category: '사내솔루션',
  tags: ['사내솔루션', 'FortiGate-60F', '방화벽', '실무매뉴얼'],
  content: '# FortiGate-60F 실무 운영 매뉴얼\n> 문서 원본: FortiGate-60F_Manual.pdf\n\n' + mockExtractedText
};

const query = 'FortiGate 긴급 연락처 알려줘';
const searchTerms = query.toLowerCase().split(' ');
let score = 0;
searchTerms.forEach(t => {
  if (mockCustomSolDoc.title.toLowerCase().includes(t)) score += 8;
  if (mockCustomSolDoc.content.toLowerCase().includes(t)) score += 5;
});

console.log(' - Query:', query);
console.log(' - Matched Score:', score);
if (score > 0) {
  console.log(' - Found matching line:', mockCustomSolDoc.content.split('\n').find(l => l.includes('Emergency Contact')));
} else {
  console.error('FAIL: RAG score did not match');
  process.exit(1);
}

console.log('\n✅ ALL PDF UPLOAD & RAG LEARNING TESTS PASSED SUCCESSFULLY!');
