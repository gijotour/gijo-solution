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
- 보안장비 로그 포맷: `logformat_syslog_pri`, `logformat_cef`, `logformat_leef`, `logformat_fortigate`, `logformat_paloalto_panos`, `logformat_cisco_asa`, `logformat_suricata_eve`, `logformat_snort_alert` (국산 장비 SECUI·윈스·펜타 등은 샘플 로그 확보 시 추가)
- 클라우드: `cloud_cspm`, `cloud_iam_least_privilege`, `cloud_cis_benchmark`
- 금융권 규제: `fin_ciso_전자금융`, `fin_망분리_전자금융`, `fin_금융보안원`
- SIEM/탐지: `siem_correlation_rule`, `siem_bruteforce_detection`, `siem_mitre_attack_mapping`

> ⚠ 알려진 한계: 인입된 근거가 정확·최상위로 검색돼도, 온프렘 7B 모델이 강한 오답 prior를 가진 일부 주제(예: 금융권 망분리 근거)에서는 RAG를 무시하고 틀린 답을 낼 수 있다. 문서 문구로는 교정되지 않으며, 모델 교정·검증 하네스가 필요한 영역이다.

근거 표준: CISA(KEV·BOD 22-01), FIRST(EPSS), Tenable(VPR), KISA U-시리즈, ISMS-P, 개인정보 보호법·시행령·안전성 확보조치 기준 고시, OWASP LLM Top 10(2025).

## 재시드(재인입) 방법
운영 서버가 떠 있는 상태에서, 관리자 자격증명을 환경변수로 주고 실행:

```bash
GIJO_SERVER_URL=http://localhost:4000 GIJO_ADMIN_USER=<계정> GIJO_ADMIN_PASSWORD=<비번> \
  node rag-seed/ingest.mjs
```

`ingest.mjs`는 이 폴더의 모든 `.md`를 읽어 인입한다. `ingestText`는 documentId(=파일명) 기준 upsert라 여러 번 실행해도 중복되지 않고 최신 내용으로 갱신된다.

> ⚠ 비밀번호는 코드/리포에 절대 하드코딩하지 말 것(환경변수로만). 인입 대상은 운영 지식베이스이므로 내용 정확성을 항상 검증하고 갱신할 것.
