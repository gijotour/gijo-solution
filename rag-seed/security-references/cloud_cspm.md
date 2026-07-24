# CSPM(Cloud Security Posture Management)
- 정의: 클라우드(IaaS/PaaS) 환경의 설정 오류(misconfiguration)와 컴플라이언스 위반을 지속적으로 점검·시각화·조치하는 도구/프로세스.
- 주로 잡는 설정 오류: 퍼블릭 노출 스토리지(S3 버킷·Blob), 과도한 IAM 권한(와일드카드·미사용 권한), 0.0.0.0/0 로 열린 보안그룹/방화벽, 미암호화 저장소·전송, MFA 미적용(특히 루트/관리자), 로깅·감사(CloudTrail/Config) 비활성, 공개 스냅샷·AMI, 키 관리 미흡.
- 기준: CIS Benchmarks(AWS/Azure/GCP Foundations), 각 CSP 모범사례(Well-Architected), 규제(ISMS-P 등)와 매핑.
- 대표 수단: AWS Security Hub·Config, Azure Defender for Cloud, GCP Security Command Center, 상용 CSPM(Prisma Cloud·Wiz 등).
- 담당자 요약: "클라우드 설정 오류(공개 스토리지·과다권한·개방 보안그룹·미암호화·로깅off)를 표준(CIS)과 대조해 상시 점검·조치하는 것."
