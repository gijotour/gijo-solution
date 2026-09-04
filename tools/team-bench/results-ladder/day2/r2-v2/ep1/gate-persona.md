# 증류 사다리 게이트 — r2-v2-ep1 · **불합격**

잰 때 2026-09-04T15:24:09.466Z · needle_64k 제외

⚠ **⑧(근거 인용)은 통째 복사로도 100%가 된다 — ⑫(베낀 글자 비율)와 함께 읽는다.**

| | 관문 | 실측 | 기준 | 왜 이 잣대인가 |
|---|---|---|---|---|
| ❌ | KEV 발표 주체 (베이스 대비 하락 0) | 하락 1건 (절대 2/3, 베이스 2/3) | 3문항 이상 · 베이스가 맞힌 문항을 하나도 안 틀린다 | KEV 목록은 누가 발표해?… 베이스 O→이번 O · 보안에서 말하는 KEV가 뭐야… 베이스 O→이번 X · 우리 취약점 목록에 KEV 표… 베이스 X→이번 O — 절대 3/3은 베이스도 못 넘는 기준이라 참고값으로 내렸다(늘 빨강인 관문은 회귀를 못 알린다) |
| ❌ | 인용(20자겹침 · 인용) | 20자겹침 1 · 인용 0 | 기준선 20자겹침 1 · 인용 1 이상 | 인용 자체를 덜 한다(겹침만 보면 안 보이는 회귀) |
| ❌ | 1회차 7과제 무하락 | 하락 1건 | 하락 0건 · 미실시 0건 | glossary_cite 1→0.7 |
| ❌ | 13과제 평균 (needle_64k 제외 → 12과제) | 0.854 | 기준선 0.867 초과 | needle_64k는 ctx 초과라 양쪽 0 — 빼고 잰다(넣어도 순위는 안 바뀌고 평균만 낮아진다) |
| ✅ | 잘린 답(베이스 대비 증가 0) | 증가 -3건 (이번 2건 · 베이스 5건) | 베이스보다 늘지 않는다 | 자리별 이번/베이스 — easy 0/0 · hard 0/0 · grounded 0/0 · distractor-only 0/0 · bare 2/5. 절대 0건은 **베이스가 못 넘는 기준**이었다(bare 5건 — 시스템 프롬프트 없이 900토큰 상한). 그 기준은 답이 짧아질수록 초록이 되어 ⑪의 표적에 상을 준다 |
| ❌ | 한글 비율 평균 | 0.722 | 기준선 0.75 이상 | JSON만 뱉는 과제는 0이 정상이라 기준선도 같은 방식으로 잰다(과제 구성이 같을 때만 견줄 수 있다) |
| ✅ | 생성 속도 낙폭 | 7.5% (20.15 tok/s) | 기준선 21.78 tok/s 대비 10% 이내 | 8080 /health는 붕괴해도 200이라 속도로 본다 — 크게 느려졌으면 두뇌가 스왑에 밀린 것이다 |
| ✅ | 근거 인용(정답 조각 20자 겹침) | 8/8 (100%) · 건너뜀 4 | 베이스 4/8 (50%) 이상 | RAFT가 가르치려는 바로 그것 — 근거를 줬을 때 그 문장을 옮겨 적는가. 건너뛴 문항은 근거 ref를 회수 못 한 것이고 셈에서 뺐다(0으로 세지 않는다) |
| ❌ | 인용 창작 0건(persona+KEV) | 5건 / 대상 15 | 0건 | 모집단: persona 표본 12행 + KEV 3행(대조군 noprompt 제외 — 관문 ①과 같은 자리) / [persona] 기본 관리자 계정명을 그대로 두면 어떤 보안 위협이 발생하나요?… 「원문:」 꼬리표(근거를 안 준 자리) · [persona] SMTP 서버의 릴레이 기능을 제한하지 않으면 어떤 보안 위협이 발생하나… 「원문:」 꼬리표(근거를 안 준 자리) · [persona] CVE-2021-44228 Log4Shell은 정보유출 취약점이야 원격코… 「원문:」 꼬리표(근거를 안 준 자리) / bare 창작 9건/12(참고값 — **제품 조건이 아니다**: 시스템 프롬프트 없이 던진 자리) |
| ✅ | 자료 없음이라 말함 | 8/8 (100%) · 건너뜀 4 | 75% 이상 | 판정 잣대는 제품의 자료없음중복가드 그 정규식이고, 제품과 같이 앞 60자만 본다. 학습 재료에 「모른다」 시연 행이 0건이라 여기가 먼저 무너진다 |
| ✅ | 서술 답 길이 낙폭 (report_draft·report_fix·glossary_cite) | -80.5% (중앙값 462 토큰) | 기준선 256 토큰 대비 40% 이내 | 점수는 그대로인데 답만 짧아지는 회귀가 실제로 났다(34~72%). 스키마 강제 과제는 길이가 스키마에 눌려 안 드러나므로 뺐다: priority_rank·priority_6·scan_messy |
| ❌ | 베낀 글자 비율(통째 복사 아님) | 평균 84% · 통째 복사 1건 / 8 | 평균 60% 이하 · 통째 복사 0건 | 베이스 평균 20% · 통째 0건 / ⑧은 20자 창이 하나만 남아도 100%가 되므로 **통째 복사로도 만점**이다 — 그래서 둘을 함께 읽는다 / 통째 복사는 근거를 그대로 게워 낸 것이라, 답이 아니라 붙여넣기다 |

참고(관문 아님)
- 표본 12건 · 한글 95%
- 표본 인용(교사 답 대비 overlap20) 1/12 (8%) — 참고값이다(관문 ⑧은 **교사 답이 아니라 정답 조각**과 견준다)
- 표본[grounded] 8건 던짐 · 건너뜀 4 · 프롬프트 지문 c6e06ae202c5,904aff0e5edd,acd0c8701b11,ebedf8f5624b,a6d64183c78b,1378e93397d9,5e7d04fed276 — 관문 ⑧·⑫의 모집단
- 표본[distractor-only] 8건 던짐 · 건너뜀 4 · 프롬프트 지문 c899c93315e5,77bf7c6cbadf,b31598dbbe82,f6ceee098ea4,7cbf2a690be9,4143a223bf54,dae34922cf18 — 관문 ⑩의 모집단
- 표본[bare] 12건 던짐 · 건너뜀 0 · 프롬프트 지문 - — **참고값** — 관문 ⑨의 모집단에서 뺐다(제품이 안 쓰는 조건: 시스템 프롬프트 없음). ⑤에는 그대로 들어간다
- 표본[persona] 12건 던짐 · 건너뜀 0 · 프롬프트 지문 3452677d58b7 — 관문 ⑨의 모집단(제품 조건: 팀원 프롬프트만). **⑤에는 안 들어간다** — 베이스에 짝지을 자리가 없어 ⑤가 통째로 미측정이 된다
- 원천: /home/gijohn_llm/gijo-as/tools/team-bench/results-ladder/day2/r2-v2/ep1/easy/qwen3-14b+r2-v2-ep1.json
- 원천: /home/gijohn_llm/gijo-as/tools/team-bench/results-ladder/day2/r2-v2/ep1/hard/qwen3-14b+r2-v2-ep1.json
- 원천: /home/gijohn_llm/gijo-as/tools/team-bench/results-ladder/day2/r2-v2/ep1/samples-grounded.json
- 원천: /home/gijohn_llm/gijo-as/tools/team-bench/results-ladder/day2/r2-v2/ep1/samples-distractor-only.json
- 원천: /home/gijohn_llm/gijo-as/tools/team-bench/results-ladder/day2/r2-v2/ep1/samples-bare.json
- 원천: /home/gijohn_llm/gijo-as/tools/team-bench/results-ladder/day2/r2-v2/ep1/samples-persona.json
- 원천: /home/gijohn_llm/gijo-as/tools/team-bench/results-ladder/day2/r2-v2/ep1/kev.json
- 원천: 베이스 kev /home/gijohn_llm/gijo-as/tools/team-bench/results-ladder/baseline/kev.json
- 원천: 베이스 표본[grounded] /home/gijohn_llm/gijo-as/tools/team-bench/results-ladder/baseline/samples-grounded.json
- 원천: 베이스 표본[distractor-only] /home/gijohn_llm/gijo-as/tools/team-bench/results-ladder/baseline/samples-distractor-only.json
- 원천: 베이스 표본[bare] /home/gijohn_llm/gijo-as/tools/team-bench/results-ladder/baseline/samples-bare.json
- 원천: 베이스 표본[persona] /home/gijohn_llm/gijo-as/tools/team-bench/results-ladder/baseline/samples-persona.json(참고 — 관문 ⑨는 절대 0건 기준이라 대조 없이 판정한다)
- 원천: 기준선 /home/gijohn_llm/gijo-as/tools/team-bench/results-ladder/baseline/r1-qwen3-14b.json
- 원천: 기준선 /home/gijohn_llm/gijo-as/tools/team-bench/results-ladder/baseline/r2-qwen3-14b.json

→ 넘지 못한 관문이 있다. **채택하지 않는다.** 「대체로 좋아 보인다」로 넘기지 않는 것이 이 자의 존재 이유다.
