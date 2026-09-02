# GIJO AS 취약점 관리 지침

> **목적**: SBOM/취약 자산관리 화면과 관련 메뉴를 만들 때 따르는 기본 지침.
> Tenable Vulnerability Management 사용자 가이드(2026-07 기준)의 방법론을 GIJO AS 규모
> (한국 중소기업 보안팀, 온프레미스, 단일~소수 호스트)에 맞춰 요약·채택한 것.
> 원문: `D:\AS 탐색\제품 문서\Tenable_Vulnerability_Management-User_Guide.pdf`

---

## 1. 핵심 원칙 — "목록"이 아니라 "생애주기"

취약점 관리는 끝나는 직선이 아니라 **반복되는 루프**다. 4단계로 돈다:

1. **발견·평가 (Discover & Assess)** — 자산을 찾고 스캔한다.
2. **우선순위 (Prioritization)** — VPR·EPSS·자산 중요도로 "먼저 고칠 것"을 정한다.
3. **조치 (Remediation)** — 담당자·기한(SLA)을 붙여 패치/완화한다.
4. **측정 (Measurement)** — 재스캔으로 수정을 검증하고 위험 감소를 추적한다.

→ GIJO AS의 메뉴도 이 4단계에 맵핑되어야 한다. "취약점 285건" 같은 **정적 목록만 보여주면 실패**다.
담당자가 "그래서 뭘 먼저, 누가, 언제까지" 답할 수 있어야 한다.

---

## 2. 심각도의 두 축 — CVSS Severity vs VPR (반드시 구분)

| | **CVSS 기반 Severity/Risk** | **VPR (Vulnerability Priority Rating)** |
|---|---|---|
| 근거 | NVD의 정적 CVSS 점수 | Tenable이 매일 갱신하는 동적 위협 점수 |
| 의미 | "이론적으로 얼마나 심각한가" | "지금 실제로 얼마나 위험한가(악용 가능성)" |
| 범위 | Info/Low/Medium/High/Critical | 0.1 ~ 10.0 |
| 특성 | 스캔할 때 고정 | 위협 환경 반영해 **매일 변함** |

**Tenable 권고: VPR 높은 것부터 고쳐라.** CVSS Severity만 보면 "Critical인데 실제 악용은 거의 안 되는 것"을
먼저 고치고, "Medium인데 활발히 악용되는 것"을 놓친다. (우리 oracle 리포트에서 실증됨:
심각도 순 1위 Critical의 EPSS 1.0% vs Medium인데 EPSS 94.4%짜리.)

### CVSS → Severity 매핑 (v3 기준)
- Critical: 9.0–10.0 · High: 7.0–8.9 · Medium: 4.0–6.9 · Low: 0.1–3.9 · Info: 0
- **주의**: 가장 심각한 CVE가 DoS면, 전체 점수는 **DoS를 제외한 최고 non-DoS 취약점** 기준으로 매긴다
  (혼동의 흔한 원인).

### VPR 등급
- Critical 9.0–10.0 · High 7.0–8.9 · Medium 4.0–6.9 · Low 0.1–3.9
- **CVE 없는 취약점(대부분 Info)은 VPR을 받지 못한다** → 이때는 CVSS Severity로 판단.

### VPR Key Drivers (VPR을 설명하는 요인 — 화면에 보여주면 좋음)
`exploitCodeMaturity`(익스플로잇 성숙도), `exploitProbability`(악용확률 %, ≈EPSS),
`onCisaKev`(CISA KEV 등재 여부 — **실제 악용 중이라는 강력한 신호**), `inTheNews*`(언론·다크웹 언급),
`malwareObservations*`(악성코드 관찰), `targetedIndustries/Regions`, `vprPercentile`.

→ **GIJO AS 채택**: EPSS·VPR을 저장·표시하고 "악용확률 순" 정렬을 제공한다(구현됨).
KEV 여부는 향후 추가 가치가 큰 지표.

---

## 3. 취약점 상태 (Vulnerability States) — 추적의 핵심

| 상태 | 의미 |
|---|---|
| **New** | 처음 1회 탐지 |
| **Active** | 2회 이상 탐지(계속 존재). *필터상 New는 Active의 하위* |
| **Fixed** | 탐지됐다가 재스캔에서 사라짐(= 조치 완료 검증됨) |
| **Resurfaced** | Fixed 였는데 다시 나타남(재발) |

- **핵심**: "고쳤다"는 담당자 선언이 아니라 **재스캔에서 안 보이는 것으로 검증**된다(Active → Fixed).
- **Accepted / Recasted**: 위험을 수용(Accept)하거나 심각도를 재조정(Recast)한 상태. 아이콘으로 구분.

→ **GIJO AS 채택**: 현재는 스캔 스냅샷만 저장. 향후 이전 스캔과 비교해 New/Fixed/Resurfaced를
자동 판정하면 "이번에 새로 생긴 것"·"고쳐진 것"을 보여줄 수 있다(=측정 단계).

---

## 4. 조치 검증 요건 (Mitigation Requirements) — 오탐 방지

취약점을 "Fixed"로 옮기려면 **재스캔이 조건을 충족**해야 한다. 그냥 재스캔한다고 되는 게 아니다:

| 발견 방식 | Fixed 판정 요건 |
|---|---|
| **Local Check**(인증 스캔, 파일/레지스트리 검사) | 반드시 **인증된 재스캔**으로만 해소 |
| **Remote Check**(비인증 네트워크) | 포트/서비스가 닫히거나 패치된 걸 확인하면 해소 |
| **Combined**(포트 0/445 보고) | 반드시 **인증된 재스캔** |
| **Netstat 확장**(플러그인 14272 SSH / 34220 WMI / 14274 SNMP) | 반드시 인증 스캔(모든 포트 확장하므로) |

→ **시사점**: 대부분의 로컬 취약점(패키지 버전 등)은 **인증 스캔이 아니면 "고쳐졌다" 확인 불가**.
리포트 임포트 시 인증 여부/발견 방식을 알 수 있으면 검증 신뢰도를 표시할 수 있다.

→ **GIJO AS 채택(구현됨)**: 리포트의 플러그인 19506("Nessus Scan Information") 출력
`Credentialed checks : yes/no`(또는 .nessus의 `Credentialed_Scan` 호스트 속성)로 인증 스캔 여부를
판별한다. 비인증 재스캔에서 사라진 취약점은 `fixedVerified=false`로 표시("✓ 고쳐짐(미검증)")하고,
이후 **인증 재스캔에서도 없으면 "검증됨"으로 승격**한다. 업로드 시 비인증 스캔 호스트는 경고로
알려 "로컬 취약점 누락·조치검증 신뢰도 낮음"을 드러낸다.

---

## 5. 조치 운영 모델 (Operationalize) — 목록 → 프로젝트

Tenable의 "Exposure Response"는 **원시 취약점 데이터를 Initiative(기한·담당자 있는 프로젝트)로** 바꾼다.
5단계 워크플로:

1. **위협 정의 (Define the Threat)** — 필터로 대응할 위험 묶음 정의(예: "랜섬웨어 악용 가능 벡터",
   Exploit Available = True).
2. **자산 범위 지정 (Scope with Tags)** — 태그로 담당 팀/자산 묶기(예: `OS:RHEL`, 부서별).
   → **알림 피로(alert fatigue) 방지**: 담당자는 자기 자산 티켓만 받게.
3. **이니셔티브 생성** — 이름 + **SLA(예: 7일 내 조치)** + 담당자(Owner) 지정. 티켓 자동 생성.
4. **조치 검증** — 시간대별 "번다운(burn-down)" 추적. 하향 곡선=성공, 평평=기술적 블로커(재부팅 창 등).
5. **대시보드 보고** — 진행률·SLA 준수(In SLA / Near SLA / Out of SLA) 위젯으로 경영진 보고.

→ **GIJO AS 채택 방향**: "오늘 확인할 항목"·유지보수/승인 워크플로우가 이미 이 방향.
취약점을 **SLA·담당자 붙은 조치 항목으로** 전환하는 흐름을 강화한다. 우리 규모에선 티켓 연동
(Jira/ServiceNow)까진 과하고, **내부 조치 항목 + 기한 + 담당자**면 충분(스코프 절제 원칙).

---

## 6. 조치 목표·측정 (Remediation Goals & Measurement)

- **Remediation Goal 유형**: ① 고정 기한(by fixed date) ② N일 이내(within days) ③ 상시(ongoing,
  해당 범위 전부 Fixed 될 때까지 열려 있음).
- **측정 지표**: `Percentage of Findings Remediated`, `New Findings vs. Remediations` 추세 그래프,
  자산 수/발견 수 20%↑ 변동 이벤트, Resurfaced 발생.

→ **GIJO AS 채택**: 재스캔 임포트 시 이전과 비교해 "고쳐진 %/새로 생긴 것"을 보여주면
측정 단계가 완성된다. KPI 화면과 연결.

---

## 7. 집계 규칙 (우리가 실데이터로 검증한 것)

- **취약점 = 플러그인 단위로 센다.** 스캐너는 CVE마다·포트마다 행을 복제한다
  (우리 실측: 1,171행 = 실제 282건). 그대로 세면 4배 부풀려진다. → Plugin ID 기준 병합(구현됨).
- **플러그인당 지표는 "최고값"을 쓴다.** VPR/EPSS/Severity는 그 플러그인에 묶인 취약점 중 **가장
  높은 값**으로 대표한다(Tenable 규정: "highest value assigned or calculated").
- **포트는 조치 맥락으로 보존한다.** 같은 플러그인이 여러 포트에서 잡히면 1건으로 합치되 포트 목록은
  남긴다(구현됨).

---

## 8. 메뉴 설계 체크리스트 (신규 취약점 관리 기능 만들 때)

- [ ] 정적 목록이 아니라 **생애주기 4단계** 중 어디에 기여하는가?
- [ ] **VPR/EPSS(악용확률)**로도 우선순위를 낼 수 있는가? CVSS Severity만 강요하지 않는가?
- [ ] KEV·exploit 가용성 같은 **"실제 악용 중" 신호**를 드러내는가?
- [ ] 조치에 **담당자·SLA(기한)**를 붙일 수 있는가?
- [ ] 재스캔으로 **Fixed 검증**이 되는가? New/Resurfaced를 구분하는가?
- [ ] 집계는 **플러그인 단위**인가(행 부풀림 방지)?
- [ ] 우리 규모에 맞는가? (티켓 연동·복잡한 룰 엔진 등 과한 엔터프라이즈 기능은 지양 — 스코프 절제)

---

## 부록: 구현 현황 (2026-09-02 코드 기준 확인)

| 지침 항목 | GIJO AS 상태 |
|---|---|
| 플러그인 단위 집계 | ✅ 구현 (Plugin ID 병합, CVE/포트 수집) |
| EPSS/VPR 저장·표시 | ✅ 구현 (배지 + "악용확률 순" 정렬 + "등급↓ 악용↑" 경고) |
| 호스트 정보(OS/DNS) | ✅ 구현 (Nessus HTML·.nessus 임포트 → 자산 이름·구성요소) |
| 임포트 포맷 | ✅ CSV · JSON · Nessus HTML · **.nessus(원본 XML)** · 국내 웹취약점 점검 결과보고서 |
| 호스트 → 취약점 드릴다운 | ✅ 구현 (심각도 필터·검색·상세) |
| SLA·담당자 붙은 조치 | ✅ 구현 (드릴다운 "＋조치 등록" → 담당자·기한이 붙은 조치 항목. 기한은 심각도와 KEV 여부로 자동 산출되며, 등록하면 화면에 남은 날짜(D-n)로 표시된다) |
| New/Fixed/Resurfaced 상태 추적 | ✅ 구현 (재스캔 스냅샷 대조, 상태 배지) |
| 조치 검증(인증 스캔) | ✅ 구현 (credentialed 판별 → fixedVerified, "고쳐짐(미검증)"·비인증 경고) |
| KEV 등재 여부 | ✅ 구현 (CISA KEV 매칭, 🔴 배지·필터, 리포트/KPI 반영) |
| 조치 진행률/번다운 측정 | ✅ 구현 (KPI "번다운·SLA 준수율·기한초과" 타일 + 추세) |
| 경영진 보고 | ✅ 구현 (DOCX 리포트 "취약점 조치 현황" 섹션 — 열린/KEV/SLA·상위 조치) |

**남은 여지(스코프 절제상 보류)**: 발견방식별(Local/Remote/Combined) 세분화된 Fixed 검증 요건,
Remediation Goal 유형(고정기한/N일/상시)의 명시적 구분, 티켓 시스템(Jira/ServiceNow) 연동.
