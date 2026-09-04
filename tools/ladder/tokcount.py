# -*- coding: utf-8 -*-
# tools/ladder/tokcount.py — 학습 재료의 **토큰 길이 분포**를 센다(글자수가 아니라 토큰이다).
#
# 왜 필요한가: max_seq 를 정할 때 보는 것은 토큰인데, 재료 보고서가 주는 것은 **글자수**다.
#   한국어는 글자 1개가 토큰 1~2개라 글자수로 어림하면 틀린다 — 그래서 실제 토크나이저로 센다.
#   결과의 「max_seq N: 길이 초과 M행」이 곧 「그 설정으로 구우면 M행의 뒤(=답)가 잘린다」는 뜻이다.
#
# ⚠ 이 숫자는 **확정이 아니라 미리보기**다. 확정은 학습 로그의 「[finetune] 토큰화 — 사용 N쌍(길이 초과 제외 M)」이다.
#   까닭: finetune_qlora14b.py 의 render() 는 main() 안의 중첩 함수라 불러올 수 없어, 그 안의
#   apply_chat_template 두 번 호출을 **글자 그대로 옮겨 적었다**(enable_thinking=False 포함).
#   즉 「같은 식을 다시 적어」 낸 값이라, 학습기가 바뀌면 여기가 조용히 낡는다.
#
# ★ 이 파일의 내력(2026-09-04 승격): 회전 2 때 gb10의 `~/bench/ladder/tokcount.py` 에만 있었다.
#   저장소로 올리면서 박혀 있던 홈 경로(/home/gijohn_llm/...)를 `~` 기준으로 폈다 — 그 밖은 원본 그대로다.
#
# 쓰는 법(gb10, 학습용 파이썬으로):
#   ~/venv-train/bin/python tools/ladder/tokcount.py ~/bench/lora-vuln/data/datasets/raft-vuln-v2.json
#   BASE=~/hf/Qwen3-14B ~/venv-train/bin/python tools/ladder/tokcount.py <재료.json>
import json, sys, os
from transformers import AutoTokenizer

# 베이스 모델(HF 폴더). 사다리 셸들과 같은 env 이름을 먼저 본다 — 두 자리가 갈리지 않게.
BASE = os.environ.get("BASE") or os.environ.get("LADDER_HF_BASE_DIR") or os.path.expanduser("~/hf/Qwen3-14B")
if len(sys.argv) < 2:
    print("쓰는 법: python tools/ladder/tokcount.py <재료.json>   (BASE 또는 LADDER_HF_BASE_DIR 로 베이스 지정)")
    raise SystemExit(2)
DS = sys.argv[1]
SYS_DEFAULT = "당신은 GIJO AS의 취약점 전문 보안 분석가다. 사내 근거를 우선하고, 모르는 것은 모른다고 말하며, 한국어로 정확하고 간결하게 답한다."

tok = AutoTokenizer.from_pretrained(BASE)
if tok.pad_token is None:
    tok.pad_token = tok.eos_token


def ids_of(x):
    if isinstance(x, dict):
        x = x["input_ids"]
    elif hasattr(x, "input_ids"):
        x = x.input_ids
    if x and isinstance(x[0], list):
        x = x[0]
    return list(x)


rows = json.load(open(DS, encoding="utf-8"))
if isinstance(rows, dict):
    rows = rows.get("rows") or rows.get("행") or []

lens = []
for r in rows:
    system = str(r.get("system") or "") or SYS_DEFAULT
    msgs = [{"role": "system", "content": system}, {"role": "user", "content": r["question"]}]
    kw = {}
    try:
        tok.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True, enable_thinking=False)
        kw["enable_thinking"] = False
    except (TypeError, ValueError):
        pass
    full = ids_of(tok.apply_chat_template(
        msgs + [{"role": "assistant", "content": r["answer"]}], tokenize=True, add_generation_prompt=False, **kw))
    lens.append(len(full))

lens.sort()
n = len(lens)
if not n:
    print(f"행이 0개입니다: {DS}")
    raise SystemExit(2)


def pct(p):
    return lens[min(n - 1, int(round(p * (n - 1))))]


print(f"베이스 {BASE}")
print(f"행 {n} · 평균 {sum(lens)/n:.0f} · p50 {pct(0.5)} · p90 {pct(0.9)} · p95 {pct(0.95)} · p99 {pct(0.99)} · 최대 {lens[-1]}")
for cap in (2048, 3072, 3584, 4096):
    over = sum(1 for L in lens if L > cap)
    print(f"  max_seq {cap}: 길이 초과 {over}행 ({over/n*100:.1f}%)")
