## 파싱 A/B 실측 결과 (지어냄 1건 = 탈락)

| 엔진 | 샘플 | 자산 | 취약점 일치 | 불일치 | 누락 | 과추출 | ★지어냄 | 자체합계 | 소요 | 판정 |
|---|---|---|---|---|---|---|---|---|---|---|
| A(규칙 파서 webreport.ts) | ajsafe-sample | 2/2 | 5/5 | 0 | 0 | 0 | 0 | ✓ | 1ms | 통과 |
| A(규칙 파서 webreport.ts) | nurihosting | 1/1 | 0/16 | 0 | 16 | 30 | 0 | ✗(없음≠19) | 5ms | 부분 |
| A(규칙 파서 webreport.ts) | twigfarm | 1/1 | 0/0 | 0 | 0 | 0 | 0 | ✗(없음≠0) | 0ms | 부분 |
| B(LLM qwen2.5-14b) | ajsafe-sample | 2/2 | 5/5 | 0 | 0 | 0 | 0 | ✓ | 20s | 통과 |
| B(LLM qwen2.5-14b)+원문가드 | ajsafe-sample | 2/2 | 5/5 | 0 | 0 | 0 | 0 | ✓ | 20s | 통과 |
| B(LLM qwen2.5-14b) | nurihosting | 1/1 | 0/16 | 0 | 0 | 0 | 16 | ✓ | 76s | ★탈락 |
| B(LLM qwen2.5-14b)+원문가드 | nurihosting | 1/1 | 16/16 | 0 | 0 | 0 | 0 | ✓ | 76s | 통과 |
| B(LLM qwen2.5-14b) | twigfarm | 1/1 | 0/0 | 0 | 0 | 0 | 0 | ✓ | 6s | 통과 |
| B(LLM qwen2.5-14b)+원문가드 | twigfarm | 1/1 | 0/0 | 0 | 0 | 0 | 0 | ✓ | 6s | 통과 |
| B(LLM qwen3-32b) | ajsafe-sample | 2/2 | 0/5 | 0 | 0 | 0 | 5 | ✓ | 176s | ★탈락 |
| B(LLM qwen3-32b)+원문가드 | ajsafe-sample | 2/2 | 5/5 | 0 | 0 | 0 | 0 | ✓ | 176s | 통과 |
| B(LLM qwen3-32b) | nurihosting | 1/1 | 0/16 | 16 | 0 | 0 | 0 | ✓ | 209s | 부분 |
| B(LLM qwen3-32b)+원문가드 | nurihosting | 1/1 | 16/16 | 0 | 0 | 0 | 0 | ✓ | 209s | 통과 |
| B(LLM qwen3-32b) | twigfarm | 1/1 | 0/0 | 0 | 0 | 0 | 0 | ✓ | 72s | 통과 |
| B(LLM qwen3-32b)+원문가드 | twigfarm | 1/1 | 0/0 | 0 | 0 | 0 | 0 | ✓ | 72s | 통과 |