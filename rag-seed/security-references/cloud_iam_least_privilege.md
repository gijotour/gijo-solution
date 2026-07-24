# AWS IAM 과도한 권한 점검·최소권한화
- 점검 수단:
  - IAM Access Analyzer: 외부(계정 밖)로 접근 가능한 리소스, 사용되지 않은 권한·역할·키를 식별. 정책 생성 시 실제 사용 로그(CloudTrail) 기반 최소 정책 제안.
  - Access Advisor(Last Accessed): 사용자·역할이 마지막으로 사용한 서비스를 보여줘 미사용 권한 회수 근거.
  - Credential Report: 계정 전체의 미사용 액세스 키·비밀번호·MFA 미설정 현황.
- 최소권한 원칙 적용: 와일드카드("Action":"*", "Resource":"*") 지양, 필요한 액션·리소스로 좁힘. AdministratorAccess 같은 광범위 관리형 정책 남발 금지. 권한 경계(Permissions Boundary)로 상한 설정. 장기 액세스 키 대신 IAM Role·임시자격증명 사용. 루트 계정은 일상 사용 금지+MFA.
- 담당자 요약: "Access Analyzer·Access Advisor·Credential Report로 미사용/과다 권한 찾아 회수, 와일드카드 제거, Role·권한경계로 최소화."
