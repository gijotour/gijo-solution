const fs = require('fs');
const path = require('path');

const baseDir = fs.existsSync(path.join(__dirname, 'GIJO_AS_보안제품관리_지침.md'))
  ? __dirname
  : path.join(__dirname, '..');

// Real markdown file mapping
const realDocDefinitions = [
  {
    id: 1,
    file: 'GIJO_AS_보안제품관리_지침.md',
    title: 'GIJO AS 보안제품 관리 지침 (방화벽·EDR·DLP·WAF·SIEM)',
    category: '보안규정',
    tags: ['보안제품', '방화벽', 'EDR', 'DLP', 'WAF', 'SIEM', 'NAC', 'VPN']
  },
  {
    id: 2,
    file: 'GIJO_AS_취약점관리_지침.md',
    title: 'GIJO AS 취약점 관리 지침 (CVSS v3.1 & 5단계 대응 런북)',
    category: '취약점관리',
    tags: ['취약점', 'CVE', 'CVSS', '패치관리', 'Nessus', '긴급대응']
  },
  {
    id: 3,
    file: 'GIJO_AS_AIBOM_검토_가이드.md',
    title: 'GIJO AS AIBOM 검토 가이드 (모델 출처·공급망·라이선스)',
    category: 'AI보안',
    tags: ['AIBOM', 'AI보안', 'Safetensors', 'HuggingFace', '라이선스']
  },
  {
    id: 4,
    file: 'GIJO_AS_AI보안점검_항목표_초안.md',
    title: 'GIJO AS AI 보안점검 항목표 (프롬프트 인젝션 & 데이터 유출 통제)',
    category: 'AI보안',
    tags: ['AI보안점검', '프롬프트인젝션', 'DLP', '할루시네이션', '점검표']
  },
  {
    id: 5,
    file: 'GIJO_AS_RAG_아키텍처_LLM연동.md',
    title: 'GIJO AS 온프레미스 RAG 아키텍처 및 LLM 연동 설계서',
    category: '아키텍처설계',
    tags: ['RAG', '온프레미스', 'GB10', '에어갭', '시맨틱캐시', 'Qwen']
  },
  {
    id: 6,
    file: 'GIJO_AS_보안담당자_실무매뉴얼.md',
    title: 'GIJO AS 보안담당자 실무 매뉴얼 (일일·주간·월간 체크리스트)',
    category: '보안규정',
    tags: ['실무매뉴얼', '체크리스트', '보안관제', '침해사고전파', '로그점검']
  },
  {
    id: 7,
    file: 'GIJO_AS_고객QA_문항30.md',
    title: 'GIJO AS 고객 실전문답 30선 (에어갭·HA이중화·망분리·AIBOM)',
    category: 'QA문답집',
    tags: ['고객QA', 'FAQ', '망분리', '에어갭', 'HA이중화', 'ISMS-P']
  },
  {
    id: 8,
    file: 'GIJO_AS_아키텍처_개요.md',
    title: 'GIJO AS 아키텍처 개요 (엔진·프론트·데이터 파이프라인)',
    category: '아키텍처설계',
    tags: ['아키텍처', '시스템구성', '파이프라인', '백엔드', 'Electron']
  },
  {
    id: 9,
    file: 'GIJO_AS_3머신_개발환경_가이드.md',
    title: 'GIJO AS 3머신 개발환경 및 온프레미스 분산 운영 가이드',
    category: '솔루션매뉴얼',
    tags: ['개발환경', '3머신', '분산환경', '온프레미스', '배포가이드']
  },
  {
    id: 10,
    file: 'GIJO_AS_SBOM_추출및제출_가이드.md',
    title: 'KISA 표준 소프트웨어 공급망(SBOM) 추출 및 제출 실무 매뉴얼 (CycloneDX JSON)',
    category: '보안규정',
    tags: ['SBOM', 'CycloneDX', 'KISA', '공급망보안', 'CVE', '오픈소스', '라이선스', '점검가이드']
  }
];

const loadedRealDocs = [];

realDocDefinitions.forEach(def => {
  const filePath = path.join(baseDir, def.file);
  if (fs.existsSync(filePath)) {
    const rawContent = fs.readFileSync(filePath, 'utf8');
    loadedRealDocs.push({
      id: def.id,
      title: def.title,
      category: def.category,
      tags: def.tags,
      updatedAt: '2026-09-16',
      content: rawContent
    });
  } else {
    console.warn(`File not found: ${filePath}`);
  }
});

console.log(`Loaded ${loadedRealDocs.length} real documents from filesystem.`);

const quickQuestions = [
  "사내 에어갭 환경에서 로컬 LLM이 어떻게 동작하나요?",
  "WAF와 방화벽(NGFW)의 HA 이중화 구성 기준은?",
  "AIBOM 검토 가이드 및 3단계 보안 통제 영역 요약해줘",
  "ISMS-P 2.4 망분리 및 접근통제 핵심 요구사항은?",
  "취약점(CVE) 발생 시 5단계 긴급 조치 절차는?",
  "보안제품 10대 표준 카테고리 운영 원칙은?",
  "일일/주간/월간 보안담당자 체크리스트 요약해줘"
];

module.exports = { loadedRealDocs, quickQuestions };
