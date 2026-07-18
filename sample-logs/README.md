# 샘플 로그 — 업로드 → 자산 등록 → 분석 데모용

내부 LLM 운영 환경을 가정한 데모 입력 파일이다. GUI 업로드(스마트 업로드/드롭존) 또는 아래 API로 인입하면
자산탐색기에 자산이 등록되고 취약점/위협 분석·리포트로 이어진다. 실제 제품·CVE 형식을 본떠 만든 가상 데이터다.

| 파일 | 무엇 | 인입 경로 | 결과 |
|---|---|---|---|
| `ollama-llm-server-nessus-scan.csv` | 사내 Ollama LLM 서버(10.10.20.15) 취약점 스캔(Nessus 형식). 노출된 LLM·모델·실제 CVE 식별 | `POST /api/vulnscan/import` (format=csv) | `vuln:10.10.20.15` 호스트 자산 + finding 10건 → 우선순위(KEV/EPSS)·리포트 |
| `ai-asset-discovery-export.csv` | AI 자산 탐지 제품이 뽑은 사내 LLM 목록(비인가 외부 프록시 포함) | `POST /api/assets/import` (format=csv) | AI 모델 자산 3건 → AI-BOM 명세 → KISA 위협 분석 → CycloneDX ML-BOM |

## 빠른 재현 (서버가 localhost:4000일 때)

```bash
# 로그인 → 토큰 → import (예: 취약점 스캔)
TOKEN=$(curl -s localhost:4000/api/auth/login -H 'content-type: application/json' \
  -d '{"username":"jyh","password":"changeme"}' | node -e 'process.stdin.on("data",d=>console.log(JSON.parse(d).accessToken))')
curl -s localhost:4000/api/vulnscan/import -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d "$(node -e 'console.log(JSON.stringify({content:require("fs").readFileSync("sample-logs/ollama-llm-server-nessus-scan.csv","utf8"),format:"csv",source:"Nessus"}))')"
```

> 인입으로 만들어지는 자산·finding은 런타임 DB(`server/data/gijo-as.sqlite`, git 미추적) 상태다.
> 파일만 버전관리하고, 데모 자산이 필요하면 위 경로로 다시 인입한다.
