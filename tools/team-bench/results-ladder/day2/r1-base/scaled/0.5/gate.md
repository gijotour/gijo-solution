# 증류 사다리 게이트 — r1-base@0.5 · **불합격**

잰 때 2026-09-04T03:34:55.174Z · needle_64k 제외

| | 관문 | 실측 | 기준 | 왜 이 잣대인가 |
|---|---|---|---|---|
| ❌ | KEV 발표 주체 3/3 | 0/3 | 3문항 이상 전부 본문에 CISA | 본문이 CISA를 말하지 않는 답이 있다(URL만 맞는 답 포함) |
| ✅ | 인용 20자 겹침 | 1 | 기준선 1 이상 | 근거 문장을 그대로 옮겨 적는다 |
| ❌ | 1회차 7과제 무하락 | 하락 1건 | 하락 0건 · 미실시 0건 | glossary_cite 1→0.7 |
| ❌ | 13과제 평균 (needle_64k 제외 → 12과제) | 0.842 | 기준선 0.867 초과 | needle_64k는 ctx 초과라 양쪽 0 — 빼고 잰다(넣어도 순위는 안 바뀌고 평균만 낮아진다) |
| ✅ | 잘린 답 0건 | 0 | 0건 | 끊긴 답 없음 |
| ❌ | 한글 비율 평균 | 0.735 | 기준선 0.75 이상 | JSON만 뱉는 과제는 0이 정상이라 기준선도 같은 방식으로 잰다(과제 구성이 같을 때만 견줄 수 있다) |
| ✅ | 생성 속도 낙폭 | 7.1% (20.24 tok/s) | 기준선 21.78 tok/s 대비 10% 이내 | 8080 /health는 붕괴해도 200이라 속도로 본다 — 크게 느려졌으면 두뇌가 스왑에 밀린 것이다 |

참고(관문 아님)
- 원천: /home/gijohn_llm/gijo-as/tools/team-bench/results-ladder/day2/r1-base/scaled/0.5/easy/qwen3-14b+r1-base@0.5.json
- 원천: /home/gijohn_llm/gijo-as/tools/team-bench/results-ladder/day2/r1-base/scaled/0.5/hard/qwen3-14b+r1-base@0.5.json
- 원천: /home/gijohn_llm/gijo-as/tools/team-bench/results-ladder/day2/r1-base/scaled/0.5/kev.json
- 원천: 기준선 /home/gijohn_llm/gijo-as/tools/team-bench/results-ladder/baseline/r1-qwen3-14b.json
- 원천: 기준선 /home/gijohn_llm/gijo-as/tools/team-bench/results-ladder/baseline/r2-qwen3-14b.json

→ 넘지 못한 관문이 있다. **채택하지 않는다.** 「대체로 좋아 보인다」로 넘기지 않는 것이 이 자의 존재 이유다.
