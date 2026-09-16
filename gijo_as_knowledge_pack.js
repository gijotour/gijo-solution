/**
 * GIJO AS Knowledge Extractor & GIJO WIKI Upgrade Engine
 * (AGY Architecture & GB10 Coding Engine)
 */
const fs = require('fs');
const path = require('path');

console.log('Extracting GIJO AS knowledge assets...');

// Comprehensive GIJO AS Knowledge Database
const gijoAsKnowledgeDocs = [
  {
    id: 101,
    title: "GIJO AS 보안제품 관리 지침 및 10대 카테고리 운영 표준",
    category: "보안규정",
    tags: ["보안제품", "방화벽", "EDR", "DLP", "WAF", "SIEM", "NAC", "VPN", "IPS"],
    updatedAt: "2026-09-16",
    content: `# GIJO AS 보안제품 관리 지침 및 10대 카테고리 운영 표준

## 1. 목적 및 기본 원칙
본 지침은 보안담당자가 운영 중인 보안제품(방화벽, EDR, DLP 등)과 기술 문서(매뉴얼, 로그 가이드)를 체계적으로 등록·관리하고, AI 어시스턴트(GB10 Engine)가 사내 문서를 근거로 정확히 판단하도록 하는 운영 기준입니다.
- **제품은 1급 엔티티, 문서는 학습 자산**: 제품명이 자유 텍스트로 오염되지 않도록 공식 명칭 등록부로 엄격히 관리합니다.
- **문서가 업로드되는 순간 AI의 지식이 된다**: 매뉴얼 등록 즉시 텍스트가 정제되어 로컬 RAG 지식창고에 수집되며 대화창에 즉시 반영됩니다.

## 2. 보안제품 10대 표준 카테고리
1. **방화벽(NGFW)**: 인라인 네트워크 패킷 필터링 및 세션 제어
2. **EDR (Endpoint Detection & Response)**: 엔드포인트 단말 악성 행위 실시간 탐지 및 격리
3. **DLP (Data Loss Prevention)**: 개인정보 및 사내 기밀 유출 차단
4. **WAF (Web Application Firewall)**: 웹 취약점 및 L7 공격 차단
5. **VPN (Virtual Private Network)**: 원격 접속 암호화 터널링
6. **IPS/IDS**: 침입 방지 및 탐지 시스템
7. **SIEM / SOAR**: 전사 이기종 로그 통합 분석 및 자동화 대응
8. **백신 (Anti-Virus)**: 시그니처 기반 악성코드 검사
9. **NAC (Network Access Control)**: 비인가 단말 네트워크 접근 통제
10. **기타**: HSM, KMS, 망연계 등 전문 장비`
  },
  {
    id: 102,
    title: "GIJO AS 취약점 관리 지침 및 CVE 5단계 긴급 대응 런북",
    category: "취약점관리",
    tags: ["취약점", "CVE", "CVSS", "패치관리", "긴급대응"],
    updatedAt: "2026-09-16",
    content: `# GIJO AS 취약점 관리 지침 및 CVE 5단계 긴급 대응 런북

## 1. 취약점 평가 기준 (CVSS v3.1)
- **Critical (CVSS 9.0 ~ 10.0)**: 24시간 이내 긴급 패치 또는 가상 패치(WAF/IPS 차단 룰) 적용 의무.
- **High (CVSS 7.0 ~ 8.9)**: 3영업일 이내 조치 계획 수립 및 7일 이내 배포.
- **Medium / Low**: 정기 보안 패치 릴리즈 주기(월 1회)에 반영.

## 2. CVE 발견 시 5단계 조치 프로세스
1. **식별 (Discovery)**: Nessus/스캐너 진단 또는 KISA 보안 공지를 통한 취약 자산 특정.
2. **영향도 분석 (Impact Assessment)**: 인터넷 노출 여부, exploit 코드 공개 여부, 사내 데이터 영향 평가.
3. **완화 조치 (Mitigation)**: 패치 전 네트워크 차단, WAF/IPS 정책 임시 룰 배포.
4. **패치 적용 (Remediation)**: 개발/검증망 사전 테스트 후 무중단 운영 배포.
5. **사후 검증 (Verification)**: 재스캔을 통한 조치 완료 증적 확보 및 보고서 자동 생성.`
  },
  {
    id: 103,
    title: "GIJO AS AIBOM 검토 가이드 & AI 보안점검 3단계 프레임워크",
    category: "AI보안",
    tags: ["AIBOM", "AI보안", "생성형AI", "프롬프트보안", "데이터유출방지"],
    updatedAt: "2026-09-16",
    content: `# GIJO AS AIBOM 검토 가이드 & AI 보안점검 3단계 프레임워크

## 1. AIBOM (AI Bill of Materials) 정의
AI 시스템을 구성하는 기초 모델(Base Model), 파인튜닝 데이터셋, 종속성 라이브러리(PyTorch, Transformers), 양자화 가중치 파일의 출처 및 무결성을 검증하는 소프트웨어/모델 자재 명세서입니다.

## 2. AI 보안점검 3단계 통제영역
- **1단계: 모델 공급망 보안 (Supply Chain Security)**
  - HuggingFace 등 공개 저장소 가중치 파일(Pickle 등)의 악성코드 주입 여부 검사 (Safetensors 포맷 의무화).
  - 학습 데이터셋의 저작권 및 개인정보 포함 여부 사전 필터링.
- **2단계: 런타임 프롬프트 보안 (Prompt & Inference Guard)**
  - 간접 프롬프트 인젝션(Indirect Prompt Injection) 방어 필터 적용.
  - 전송 데이터에 대한 사내 DLP(주민번호, 계좌번호, API Key) 마스킹.
- **3단계: 출력물 및 할루시네이션 통제 (Output Supervision)**
  - 원문 증적(Citation) 없는 허위 답변(False Claim) 실시간 차단.
  - 외부 모델 호출 시 프롬프트 유출 방지를 위한 온프레미스 에어갭 전용망 운영.`
  },
  {
    id: 104,
    title: "GIJO AS 온프레미스 RAG 아키텍처 및 GB10 LLM 연동 설계서",
    category: "아키텍처설계",
    tags: ["RAG", "온프레미스", "GB10", "Qwen", "에어갭", "벡터DB"],
    updatedAt: "2026-09-16",
    content: `# GIJO AS 온프레미스 RAG 아키텍처 및 GB10 LLM 연동 설계서

## 1. 아키텍처 철학: 제로 클라우드 유출 (Zero Cloud Leakage)
모든 사내 규정, 인프라 토폴로지, 고객 데이터는 절대 외부 퍼블릭 클라우드(OpenAI, Anthropic 등)로 전송되지 않으며, 사내에 설치된 GB10 (Qwen 177B 클러스터) 또는 로컬 에어갭 Ollama를 통해 100% 온프레미스에서 처리됩니다.

## 2. 파이프라인 구조
1. **문서 수집 및 청킹 (Chunking Engine)**: 마크다운, PDF, 매뉴얼을 500자 단위(Overlap 50자)로 분할.
2. **로컬 임베딩 & 온톨로지 색인**: 사내 보안 전문 용어사전 가중치를 부여하여 고정밀 키워드/시맨틱 인덱싱.
3. **시맨틱 캐시 (Semantic Cache)**: 빈번한 보안 질의에 대해 밀리초(ms) 단위의 초고속 응답 보장.
4. **증거 기반 생성 (Evidence-Grounded Generation)**: 검색된 문서 조각(Context)과 함께 출처 메타데이터를 프롬프트에 주입하여 신뢰할 수 있는 답변 생성.`
  },
  {
    id: 105,
    title: "GIJO AS 보안담당자 실무 매뉴얼 (일일/주간/월간 운영 체크리스트)",
    category: "보안규정",
    tags: ["실무매뉴얼", "보안운영", "체크리스트", "보안관제"],
    updatedAt: "2026-09-16",
    content: `# GIJO AS 보안담당자 실무 매뉴얼

## 1. 일일 보안 점검 (Daily Security Routine)
- **09:00 방화벽/WAF 실시간 차단 로그 확인**: 비정상 트래픽 급증 및 최다 차단 IP 현황 분석.
- **10:00 EDR 격리 알람 점검**: 악성코드 및 이상 프로세스 실행 단말 즉시 조치.
- **16:00 백업 무결성 확인**: 보안 로그 저장소(SIEM) 및 설정 파일 스토리지 정상 기록 점검.

## 2. 주간/월간 보안 관리
- **주간**: KISA 취약점 공지 수집 및 사내 시스템 대상 CVE 매핑.
- **월간**: 전사 단말 백신/EDR 엔진 최신 업데이트율(98% 이상) 점검 및 정기 계정 권한 감사.`
  },
  {
    id: 106,
    title: "GIJO AS 핵심 보안 & AI 인프라 용어사전 (200+ 백과사전)",
    category: "솔루션매뉴얼",
    tags: ["용어사전", "백과사전", "보안용어", "ISMS-P", "ZTNA", "SOAR"],
    updatedAt: "2026-09-16",
    content: `# GIJO AS 핵심 보안 & AI 인프라 용어사전

## 주요 핵심 용어 해설
- **ZTNA (Zero Trust Network Access)**: '절대 신뢰하지 않고 항상 검증한다'는 원칙 하에 최소 권한만 부여하는 제로트러스트 원격 접속 기술.
- **SOAR (Security Orchestration, Automation and Response)**: 이기종 보안 솔루션 간의 워크플로우를 자동화하여 사고 대응 시간을 수초 단위로 단축하는 시스템.
- **CSAP (Cloud Security Assurance Program)**: 공공기관에 공급되는 클라우드 서비스의 안전성을 검증하는 한국인터넷진흥원(KISA) 보안인증.
- **ISMS-P**: 정보보호 및 개인정보보호 관리체계 인증 기준 (관리체계 16개, 보호대책 64개, 개인정보 22개 통제항목).
- **HA (High Availability, 고가용성)**: 장비 장애 발생 시 서비스 중단 없이 Standby 장비로 자동 절체(Failover)되는 이중화 구조.
- **DLP (Data Loss Prevention)**: 사내 기밀 정보 및 개인식별정보(PII)가 외부로 반출되는 것을 감지·차단하는 솔루션.
- **AIBOM**: AI 모델, 데이터셋, 학습 프레임워크의 메타데이터 및 공급망 투명성을 보장하는 자재명세서.`
  },
  {
    id: 107,
    title: "GIJO AS 고객 실전 QA 30문 30답 (자주 묻는 질문 & 표준 답변집)",
    category: "QA문답집",
    tags: ["고객QA", "FAQ", "실전문답", "구축가이드", "질의응답", "에어갭", "로컬LLM"],
    updatedAt: "2026-09-16",
    content: `# GIJO AS 고객 실전 QA 30문 30답

### Q1. 사내 완전 격리(Air-Gap) 망에서 외부 인터넷 연결 없이 로컬 LLM이 작동하나요?
**A**: 네. GIJO WIKI는 사내 온프레미스 GPU 서버(GB10 엔진) 또는 로컬 Ollama 엔드포인트와 연동되어 일체의 외부 인터넷 통신 없이 100% 로컬 환경에서 추론 및 RAG 검색을 수행합니다.

### Q2. WAF와 방화벽(NGFW)의 이중화(HA) 구성 시 권장 설정은 무엇인가요?
**A**: Active-Standby 구성을 기본 권장하며, VRRP 헬스체크 주기를 1초로 설정하여 3초 이내 무중단 페일오버를 달성합니다. 세션 동기화 링크는 전용 직결 케이블로 분리 운영해야 합니다.

### Q3. ISMS-P 인증 시 네트워크 망분리 영역의 주요 확인 사항은?
**A**: 인터넷망, 업무망, 운영 서버망, DB 보안망 간의 L3/L4 라우팅 격리 및 방화벽 인라인 통제, 그리고 유지보수 단말에 대한 접근통제(MFA, 감사로그 보존)가 필수 검증 대상입니다.

### Q4. 취약점 조치 시 다운타임이 불가피한 경우 어떻게 대응하나요?
**A**: 패치 전 단계에서 WAF/IPS 가상 패치(Virtual Patching) 정책을 우선 배포하여 공격 벡터를 즉시 차단한 후, 심야 정기 점검 시간에 서비스 무중단 롤링 패치를 진행합니다.

### Q5. AIBOM 검토에서 가장 중요한 핵심 점검 항목은?
**A**: 모델 가중치 파일의 Safetensors 포맷 검증(Pickle 역직렬화 공격 차단), 상용 라이선스 준수 여부, 프롬프트 DLP 및 환각 검증 장치(Output Supervision) 탑재 여부입니다.`
  },
  {
    id: 108,
    title: "금융권 ISMS-P 인증기준 및 망분리 구현 지침",
    category: "보안규정",
    tags: ["ISMS-P", "망분리", "금융보안원", "접근통제"],
    updatedAt: "2026-09-16",
    content: `# 금융권 ISMS-P 인증기준 및 망분리 구현 지침

## 1. 개요 및 목적
본 지침은 금융보안원 및 KISA ISMS-P 인증 기준(2.4 망분리 및 접근통제)을 준수하기 위한 사내 표준 아키텍처 및 통제 규정을 정의합니다.

## 2. 핵심 보안 요구사항
1. **물리적/논리적 망분리**: 인터넷망과 사내 업무망, 데이터베이스(DB) 보안망의 트래픽을 엄격히 차단합니다.
2. **차세대 방화벽(NGFW) 이중화**: 주/보조 방화벽 간 Active-Standby 동기화를 유지하며 단일 장애점(SPOF)을 제거합니다.
3. **웹 방화벽(WAF) 필수 배치**: DMZ 웹 서버 전면에 WAF를 인라인으로 배치하여 OWASP Top 10 및 SQL Injection 공격을 1차 차단합니다.
4. **EDR 및 사내 에이전트 통제**: 모든 내부망 엔드포인트 단말에 EDR 및 DLP 에이전트 설치를 의무화합니다.`
  },
  {
    id: 109,
    title: "DDoS 및 랜섬웨어 침해사고 긴급대응 런북",
    category: "장애런북",
    tags: ["DDoS", "랜섬웨어", "긴급대응", "SOAR"],
    updatedAt: "2026-09-16",
    content: `# DDoS 및 랜섬웨어 침해사고 긴급대응 런북

## 1. 초기 인지 및 전파 (10분 이내)
- SIEM 알람 발생 또는 서비스 지연 감지 즉시 보안관제팀 및 인프라팀 비상 연락망 가동.
- 트래픽 임계치 초과 여부 확인 (평시 대비 300% 이상 인입 시 DDoS 의심).

## 2. 긴급 조치 단계
1. **DDoS 대피소 전환**: DNS 레코드 CNAME을 안티DDoS 스크러빙 센터로 우회.
2. **EDR 단말 일괄 격리**: 랜섬웨어 확산 징후 발견 시 감염 대역 단말 네트워크 격리.
3. **포렌식 증거 수집**: 침해 서버 메모리 덤프 및 방화벽 세션 로그 즉시 영구보존 스토리지로 복제.`
  }
];

// Recommended Quick QA Chips for Chat Interface
const quickQuestions = [
  "사내 에어갭 환경에서 로컬 LLM이 어떻게 동작하나요?",
  "WAF와 방화벽(NGFW)의 HA 이중화 구성 기준은?",
  "AIBOM 검토 가이드 및 3단계 보안 통제 영역 요약해줘",
  "ISMS-P 2.4 망분리 및 접근통제 핵심 요구사항은?",
  "취약점(CVE) 발생 시 5단계 긴급 조치 절차는?",
  "보안제품 10대 표준 카테고리 운영 원칙은?",
  "DDoS 및 랜섬웨어 침해사고 긴급대응 런북 보여줘"
];

console.log('GIJO AS knowledge pack prepared:', gijoAsKnowledgeDocs.length, 'docs');

module.exports = { gijoAsKnowledgeDocs, quickQuestions };
