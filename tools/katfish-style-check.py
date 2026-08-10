# KatFishNet 방식(쉼표 5특징 + 로지스틱)을 이 Mac에서 재현해 GIJO 답변에 돌린다.
#
# ⚠ 원본과 다른 점 하나: 형태소 분석기가 Kkma(konlpy·Java)가 아니라 Kiwi다.
#   이 Mac에 Java가 없다. 태그셋이 달라 논문 수치와 그대로 비교하면 안 된다.
#   그래서 **같은 파이프라인으로 그들 데이터도 함께 채점**해 눈금을 맞춘다.
#
# 음성 대조군이 핵심이다: 우리 답이 "AI답다"고 나와도, 우리가 사람이 쓴 문서도 같이
# "AI답다"면 그 지표는 저자를 재는 게 아니라 **장르**를 재는 것이다.
import json, re, sys, random, statistics as st
import numpy as np
from kiwipiepy import Kiwi
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import roc_auc_score

KIWI = Kiwi()
BASE = "/private/tmp/claude-501/-Users-t-Desktop-GIJO-AS/e4d53e53-f309-4868-9e6d-acb1a77ee077/scratchpad"

def 문장형태소(text):
    """글 1건 → (문장들, 문장별 형태소, 문장별 품사). 원본 pos_tagging.py와 같은 모양."""
    sents, morphs, poss = [], [], []
    for s in KIWI.split_into_sents(text):
        toks = KIWI.tokenize(s.text)
        if not toks:
            continue
        sents.append(s.text)
        morphs.append([t.form for t in toks])
        poss.append([t.tag for t in toks])
    return sents, morphs, poss

def 쉼표특징(sentences, morphs, pos):
    """comma_feature_analysis.py:analyze_comma_usage 중 ML에 쓰이는 5개만 그대로 옮김."""
    n_sent = len(sentences)
    if n_sent == 0:
        return None
    n_comma_sent = 0
    usage_rate, avg_rel, avg_seg, div_score = [], [], [], []
    for morp, p in zip(morphs, pos):
        if "," in morp:
            n_comma_sent += 1
        commas = [i for i, m in enumerate(morp) if m == ","]
        if commas:
            rel = [c / len(morp) for c in commas]
            seg = [len(morp[a + 1 : b]) if a in commas else len(morp[a:b])
                   for a, b in zip([0] + commas, commas + [len(morp)])]
            pats = [(p[i - 1], p[i + 1]) for i in commas if 0 < i < len(p) - 1]
            div_score.append(len(set(pats)) / len(pats) if pats else 0)
            usage_rate.append(len(commas) / len(morp))
            avg_rel.append(float(np.mean(rel)))
            avg_seg.append(float(np.mean(seg)))
        else:
            div_score.append(0); usage_rate.append(0); avg_rel.append(0); avg_seg.append(0)
    return [
        n_comma_sent / n_sent,          # comma_include_sentence_rate
        float(np.mean(usage_rate)),     # avg_comma_usage_rate
        float(np.mean(avg_rel)),        # avg_relative_position
        float(np.mean(avg_seg)),        # avg_segment_length
        float(np.mean(div_score)),      # pos diversity before/after comma
    ]

def 특징들(texts):
    out = []
    for t in texts:
        s, m, p = 문장형태소(t)
        f = 쉼표특징(s, m, p)
        if f is not None:
            out.append(f)
    return out

# ── 1. 그들 데이터로 분류기 학습 (사람 80% + GPT-4o) ─────────────────────────
data = [json.loads(l) for l in open(f"{BASE}/katfishnet/katfish_dataset/essay.jsonl")]
human = [d["text"] for d in data if d["written_by"] == "human"]
gpt   = [d["text"] for d in data if d["written_by"] == "gpt-4o-2024-05-13"]
qwen  = [d["text"] for d in data if d["written_by"] == "qwen2:72b-instruct"]
llama = [d["text"] for d in data if d["written_by"] == "llama3.1:70b"]

random.seed(42); random.shuffle(human)
cut = int(len(human) * 0.8)
tr_human, te_human = human[:cut], human[cut:]

F_tr_h, F_gpt = 특징들(tr_human), 특징들(gpt)
F_te_h, F_qwen, F_llama = 특징들(te_human), 특징들(qwen), 특징들(llama)

X = np.array(F_tr_h + F_gpt); y = np.array([0] * len(F_tr_h) + [1] * len(F_gpt))
sc = StandardScaler().fit(X)
clf = LogisticRegression(random_state=42, max_iter=1000).fit(sc.transform(X), y)

def auc(a, b):
    Xt = np.array(a + b); yt = np.array([0] * len(a) + [1] * len(b))
    return roc_auc_score(yt, clf.predict_proba(sc.transform(Xt))[:, 1])

def 점수(F):
    if not F: return None
    return clf.predict_proba(sc.transform(np.array(F)))[:, 1]

print("═" * 66)
print(" 1. 이식 검증 — 그들 데이터에서 이 구현이 논문만큼 도나")
print("═" * 66)
print(f"   학습: 사람 {len(F_tr_h)} + GPT-4o {len(F_gpt)}")
print(f"   AUC  사람 vs qwen2-72b (OOD)   {auc(F_te_h, F_qwen):.4f}   논문 essay 평균 0.9488")
print(f"   AUC  사람 vs llama3.1-70b (OOD) {auc(F_te_h, F_llama):.4f}")

# ── 2. 우리 답변 · 음성 대조군 ────────────────────────────────────────────
ours = [l.rstrip("\n") for l in open(f"{BASE}/gijo-answers.txt", encoding="utf-8") if l.strip()]
ours = [t.replace("\\n", "\n") for t in ours]
docs = [l.rstrip("\n") for l in open(f"{BASE}/gijo-humandocs.txt", encoding="utf-8") if l.strip()]
docs = [t.replace("\\n", "\n") for t in docs]

F_ours, F_docs = 특징들(ours), 특징들(docs)
S = {
    "그들 사람 에세이 (검증된 사람)": 점수(F_te_h),
    "그들 GPT-4o (검증된 LLM)": 점수(F_gpt),
    "★ GIJO 제품 답변": 점수(F_ours),
    "★ GIJO 문서 (사람이 쓴 것) ← 음성 대조군": 점수(F_docs),
}
print()
print("═" * 66)
print(" 2. 'LLM이 썼을 확률' 점수 (0=사람쪽 · 1=LLM쪽)")
print("═" * 66)
print(f"   {'구분':<40} {'건수':>5} {'중앙값':>8} {'평균':>8} {'>0.5':>7}")
for k, v in S.items():
    if v is None:
        print(f"   {k:<40} {'(없음)':>5}"); continue
    print(f"   {k:<40} {len(v):>5} {np.median(v):>8.3f} {v.mean():>8.3f} {(v > 0.5).mean()*100:>6.1f}%")
