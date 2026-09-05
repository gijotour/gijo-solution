# 팀원 역할별 모델 시험 — 2026-09-05 00:43:40 (gb10, ctx 32768, temperature 0, json_schema 강제)

| 모델 | 라이선스 | 적재 | scan_extract | needle_16k | priority_rank | report_draft | ti_match | glossary_cite | tool_select | 평균 | 프리필 tok/s | 생성 tok/s | 한글 | 한자 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| qwen3-14b+r4-v4-ep2 | Apache-2.0 | 4s | 1.00 | 1.00 | 0.00 | 1.00 | 1.00 | 1.00 | 1.00 | **0.86** | 1154 | 20 | 57% | 0 |

- **scan_extract**(scan): 리포트 발췌 → 취약점 목록 JSON(자산·취약점·심각도·근거)
- **needle_16k**(scan): 약 25,000자(≈16K 토큰) 한국어 문서에서 사실 5개 회수
- **priority_rank**(analysis): KEV·노출·중요도를 함께 보아 조치 순서 정하기
- **report_draft**(report): 조치 요청서 6절 서식·한국어·한자 누출
- **ti_match**(ti): CTI 4건 중 우리 자산에 해당하는 것만 고르기(절제 포함)
- **glossary_cite**(normaltic): 근거 조각만으로 용어 해설 + 인용
- **tool_select**(orchestrator): 한국어 지시 6개 → 도구 이름 정확히 고르기

점수는 0~1(결정적 채점기). 프리필/생성 tok/s는 llama.cpp timings 실측의 중앙값. 한글=답의 한글 비율 평균, 한자=답에 섞인 한자 글자 수 합.
