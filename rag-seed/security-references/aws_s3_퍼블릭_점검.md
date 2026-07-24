# AWS S3 버킷 퍼블릭 노출 점검·조치
- 점검: (1) 계정 및 버킷 단위 S3 Block Public Access 4개 설정이 모두 켜져 있는지 확인, (2) 버킷 ACL과 버킷 정책(Bucket Policy)에 Principal:"*"(전체 공개) 허용이 있는지, (3) AWS 콘솔의 버킷 목록에서 "공개(Public)" 표시, (4) IAM Access Analyzer·AWS Config 규칙(s3-bucket-public-read/write-prohibited)로 자동 탐지.
- 조치: 업무상 공개가 불필요하면 계정+버킷 Block Public Access 전부 활성화. 공개 ACL/정책 제거. 콘텐츠 배포가 필요하면 버킷은 비공개로 두고 CloudFront+OAC(원본 접근 제어)로 제공. 접근은 최소권한 IAM/프리사인드 URL로.
- 상시화: AWS Config·Security Hub로 지속 모니터링, CloudTrail로 정책 변경 추적, 신규 버킷 기본 차단(계정 수준 BPA).
- 담당자 요약: "계정·버킷 Block Public Access 켜고 공개 ACL/정책 제거. 배포는 CloudFront+OAC, Config로 상시 감시."
