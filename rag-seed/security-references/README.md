# 보안담당자 참고자료 (RAG 시드)

실제 보안담당자가 지휘 콘솔/챗봇에 자주 던지는 질문에 **표준 근거로 정확히** 답하도록, 지식베이스(RAG)에 인입하는 참고자료 원본이다. 각 파일은 운영 서버의 `POST /api/memory/ingest-file`(scope `global`)로 인입되어 bge-m3 임베딩 → LanceDB에 저장된다.

## 왜 있나
디스패치 실측(2026-07-25)에서 개념·표준 질문이 사실 오류/환각으로 답하는 사례를 다수 확인했다(예: Log4Shell을 "정보유출"로, 접속기록 보관을 "제34조 3년"으로). 관련 없는 온톨로지 조각이 검색되어 `internalMiss=false`여도 근거가 틀릴 수 있었다. **권위 있는 문서를 넣어 올바른 청크가 검색되게 하는 것**이 근본 해법이라 이 시드를 마련했다.

## 수록 항목
- 취약점/위협: `log4shell_CVE-2021-44228`, `epss_vs_vpr`, `kev_bod_22-01_조치기한`
- 하드닝/설정: `kisa_u시리즈_ssh_root_U-01`, `방화벽_any_any_규칙`
- 로그/탐지: `smb_445_outbound`, `ips_오탐_튜닝`, `waf_sqli_실공격_판단`
- 컴플라이언스: `ismsp_접근권한_검토`, `개인정보_유출_통지_신고`, `개인정보_접속기록_보관`
- 사고대응/클라우드/인증: `랜섬웨어_초동_대응`, `aws_s3_퍼블릭_점검`, `mfa_우선적용_대상`
- AI 보안: `owasp_llm_top10_2025`

근거 표준: CISA(KEV·BOD 22-01), FIRST(EPSS), Tenable(VPR), KISA U-시리즈, ISMS-P, 개인정보 보호법·시행령·안전성 확보조치 기준 고시, OWASP LLM Top 10(2025).

## 재시드(재인입) 방법
운영 서버가 떠 있는 상태에서, 관리자 자격증명을 환경변수로 주고 실행:

```bash
GIJO_SERVER_URL=http://localhost:4000 GIJO_ADMIN_USER=<계정> GIJO_ADMIN_PASSWORD=<비번> \
  node rag-seed/ingest.mjs
```

`ingest.mjs`는 이 폴더의 모든 `.md`를 읽어 인입한다. `ingestText`는 documentId(=파일명) 기준 upsert라 여러 번 실행해도 중복되지 않고 최신 내용으로 갱신된다.

> ⚠ 비밀번호는 코드/리포에 절대 하드코딩하지 말 것(환경변수로만). 인입 대상은 운영 지식베이스이므로 내용 정확성을 항상 검증하고 갱신할 것.
