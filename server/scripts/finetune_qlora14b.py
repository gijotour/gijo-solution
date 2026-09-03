# scripts/finetune_qlora14b.py — Qwen3-14B 위 주제별 전문가 LoRA(QLoRA) 학습.
#
# [2026-08-08] 기존 finetune_unsloth.py를 안 건드리고 따로 둔다 — 그 스크립트는 unsloth 전제인데
# 운영 WSL 학습 환경이 정리돼(unsloth·CUDA torch 부재) venv-train을 새로 꾸렸고, 14B는
# transformers+peft+bitsandbytes 표준 조합이 가장 검증된 길이다(RTX 3090 24GB, 4bit NF4).
#
# 학습 형식: Qwen3 챗 템플릿(생각 모드 끔) — 프롬프트 토큰은 라벨 마스킹(-100)해 **답변만** 배운다.
# 실행(venv-train):
#   GIJO_FT_BASE_MODEL=Qwen/Qwen3-14B python scripts/finetune_qlora14b.py \
#     --dataset lora-vuln-2026-08-08 --output data/lora/vuln-r16 --system "..."
import argparse, json, os, sys, time


def log(msg: str) -> None:
    print(msg, flush=True)


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--dataset", required=True)
    p.add_argument("--output", required=True)
    p.add_argument("--base-model", default=os.environ.get("GIJO_FT_BASE_MODEL", "Qwen/Qwen3-14B"))
    p.add_argument("--system", default="당신은 GIJO AS의 취약점 전문 보안 분석가다. 사내 근거를 우선하고, 모르는 것은 모른다고 말하며, 한국어로 정확하고 간결하게 답한다.")
    p.add_argument("--epochs", type=float, default=3.0)
    p.add_argument("--lr", type=float, default=1e-4)
    # 기본 1024는 지식 문답(근거 없음) 기준이다. RAFT형(행마다 system에 근거 조각)은 이걸 넘으므로
    # 제품 경로(finetune.ts)가 env GIJO_FINETUNE_MAX_SEQ(기본 3072)로 --max-seq를 **명시해서** 넘긴다.
    # 여기 기본값을 올리지 않는 이유: 손으로 부르는 옛 명령들의 VRAM 발자국을 말없이 키우지 않으려는 것.
    p.add_argument("--max-seq", type=int, default=1024)
    p.add_argument("--rank", type=int, default=16)
    # --smoke: GPU·학습 의존성 없이 **파이프라인 계약만** 확인한다(시험·CI 전용).
    #   원클릭 루프가 이 스크립트를 부르게 되면서 필요해졌다 — 예전 스크립트에는 있고
    #   여기엔 없어, 배선을 바꾸면 스모크 시험이 통째로 죽는다(2026-08-08).
    p.add_argument("--smoke", action="store_true")
    args = p.parse_args()

    ds_path = os.path.join("data", "datasets", f"{args.dataset}.json")
    if not os.path.exists(ds_path):
        # 없는 데이터셋은 **스모크에서도** 실패여야 한다 — 이 오류 문구가 화면까지 전달되는지가
        # 시험 계약이다(실학습 경로와 같은 출력 계약, 구 finetune_unsloth.py에서 이어받음).
        print(f"[finetune] ERROR: 데이터셋 파일이 없습니다: {ds_path}", file=sys.stderr, flush=True)
        sys.exit(1)

    if args.smoke:
        # 스모크에서도 **데이터셋을 실제로 읽는다**(2026-09-03). 실학습 경로는 GPU·torch가 있어야 돌아
        # 어느 시험도 못 지나가는데, 「행에 실린 per-row system(RAFT 근거)을 읽는가」는 값싸게 확인할 수 있다.
        # 이 줄이 없으면 근거 칸이 통째로 무시돼도 학습은 정상 종료되고 아무도 모른다.
        with open(ds_path, "r", encoding="utf-8") as f:
            smoke_rows = [r for r in json.load(f) if r.get("question") and r.get("answer")]
        with_system = sum(1 for r in smoke_rows if str(r.get("system") or "").strip())
        log(f"[finetune] (smoke) 행 {len(smoke_rows)} · 근거(system) 실린 행 {with_system} · max_seq={args.max_seq}")
        os.makedirs(args.output, exist_ok=True)
        # 다음 단계(GGUF 변환)가 읽을 자리의 **모양만** 갖춘다. 내용은 학습물이 아니므로
        # 실제 변환은 하지 않는다 — 루프도 스모크에서는 변환을 건너뛴다.
        with open(os.path.join(args.output, "adapter_config.json"), "w", encoding="utf-8") as f:
            json.dump({"smoke": True, "dataset": args.dataset}, f)
        for i in range(1, 11):  # 10스텝 — 구 스크립트와 같은 진행률 계약(화면 막대가 이 꼴만 읽는다)
            log(f"step {i}/10 loss={1.0 - i * 0.05:.4f}")
            time.sleep(0.01)
        log(f"[finetune] done(smoke) output={args.output}")
        return

    with open(ds_path, "r", encoding="utf-8") as f:
        rows = [r for r in json.load(f) if r.get("question") and r.get("answer")]
    if len(rows) < 20:
        log(f"[finetune] 재료가 너무 적습니다({len(rows)}쌍) — 중단"); sys.exit(1)
    log(f"[finetune] 데이터셋 {args.dataset} — {len(rows)}쌍 · base={args.base_model}")

    import torch
    from datasets import Dataset
    from transformers import (AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig,
                              Trainer, TrainingArguments)
    from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training

    tok = AutoTokenizer.from_pretrained(args.base_model)
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token

    def ids_of(x):
        # transformers 5의 apply_chat_template(tokenize=True)는 dict(BatchEncoding)를 돌려준다
        # (첫 실행에서 collate의 dict+list TypeError로 실측). 리스트로 통일한다.
        if isinstance(x, dict):
            x = x["input_ids"]
        elif hasattr(x, "input_ids"):
            x = x.input_ids
        if x and isinstance(x[0], list):  # 배치 차원 [[ids]] 벗기기
            x = x[0]
        return list(x)

    def render(q: str, a: str, system: str = ""):
        # 행마다 system이 다를 수 있다(RAFT형 근거 학습, 증류 사다리 §12) — 근거 조각이 여기 실린다.
        # 없으면 --system(전역 하나)로 떨어진다: 지금까지의 지식 데이터셋은 한 글자도 안 바뀐다.
        # ★ 왜 질문이 아니라 system인가: 제품 추론이 근거를 system에 싣는다(llm.ts systemContent).
        #   배운 자리와 쓰는 자리가 다르면 모델이 배운 것을 못 꺼낸다.
        msgs_prompt = [{"role": "system", "content": system or args.system}, {"role": "user", "content": q}]
        kw = {}
        try:  # Qwen3 템플릿의 생각(thinking) 모드는 끈다 — 제품 구동도 --reasoning off다
            tok.apply_chat_template(msgs_prompt, tokenize=False, add_generation_prompt=True, enable_thinking=False)
            kw["enable_thinking"] = False
        except (TypeError, ValueError):
            pass
        prompt_ids = ids_of(tok.apply_chat_template(msgs_prompt, tokenize=True, add_generation_prompt=True, **kw))
        full_ids = ids_of(tok.apply_chat_template(
            msgs_prompt + [{"role": "assistant", "content": a}], tokenize=True, add_generation_prompt=False, **kw))
        if len(full_ids) > args.max_seq:
            return None
        labels = [-100] * len(prompt_ids) + full_ids[len(prompt_ids):]
        return {"input_ids": full_ids, "labels": labels}

    feats = [f for f in (render(r["question"], r["answer"], str(r.get("system") or "")) for r in rows) if f]
    dropped = len(rows) - len(feats)
    log(f"[finetune] 토큰화 — 사용 {len(feats)}쌍(길이 초과 제외 {dropped}, max_seq={args.max_seq})")
    # ⚠ 길이 초과는 **조용한 손실**이다 — render가 None을 돌려주면 그 행은 그냥 사라지고 학습은 정상 종료된다.
    #   근거(system)를 실은 RAFT 행은 길어서 기본 1024를 넘기 쉬우므로, 눈에 띄게 경고한다(전-N 위생 계보).
    if dropped and dropped / max(1, len(rows)) >= 0.1:
        log(f"[finetune] ⚠ 재료의 {dropped / len(rows) * 100:.0f}%가 길이 초과로 빠졌습니다 — --max-seq(현재 {args.max_seq})를 올리거나 근거 조각 수를 줄이세요")
    if not feats:
        log("[finetune] 길이 조건을 통과한 행이 없습니다 — 중단"); sys.exit(1)
    data = Dataset.from_list(feats)
    # 총 스텝 = ceil(쌍 수 / 누적 16) × 에폭 — 아래 warmup_steps 환산에 쓴다(배치 1·누적 16과 같은 숫자여야 한다).
    total_steps = -(-len(feats) // 16) * args.epochs

    def collate(batch):
        mx = max(len(b["input_ids"]) for b in batch)
        pad = tok.pad_token_id
        return {
            "input_ids": torch.tensor([b["input_ids"] + [pad] * (mx - len(b["input_ids"])) for b in batch]),
            "labels": torch.tensor([b["labels"] + [-100] * (mx - len(b["labels"])) for b in batch]),
            "attention_mask": torch.tensor([[1] * len(b["input_ids"]) + [0] * (mx - len(b["input_ids"])) for b in batch]),
        }

    bnb = BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4",
                             bnb_4bit_compute_dtype=torch.bfloat16, bnb_4bit_use_double_quant=True)
    log("[finetune] 베이스 로드(4bit NF4)…")
    model = AutoModelForCausalLM.from_pretrained(args.base_model, quantization_config=bnb,
                                                 dtype=torch.bfloat16, device_map={"": 0})
    model = prepare_model_for_kbit_training(model)
    model = get_peft_model(model, LoraConfig(
        r=args.rank, lora_alpha=args.rank * 2, lora_dropout=0.05, bias="none", task_type="CAUSAL_LM",
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"]))
    model.print_trainable_parameters()
    model.config.use_cache = False

    t0 = time.time()

    # 진행률 — 화면(학습 진행 막대)은 `step N/M loss=…` 꼴만 읽는다(finetune.ts 파서).
    # 이게 없으면 몇 시간짜리 학습이 "아무 일도 안 하는 것처럼" 보인다.
    from transformers import TrainerCallback

    class 진행알림(TrainerCallback):
        def on_log(self, cfg, state, control, logs=None, **kw):
            if logs and "loss" in logs:
                log(f"step {int(state.global_step)}/{int(state.max_steps)} loss={float(logs['loss']):.4f}")

    trainer = Trainer(
        model=model, train_dataset=data, data_collator=collate, callbacks=[진행알림()],
        args=TrainingArguments(
            output_dir=args.output, num_train_epochs=args.epochs, learning_rate=args.lr,
            per_device_train_batch_size=1, gradient_accumulation_steps=16,
            # warmup은 비율이 아니라 스텝 수로 준다 — transformers 5.x(gb10 실측 5.16.1, 2026-09-03)에서
            # warmup_ratio 인자가 사라져 TrainingArguments가 TypeError로 죽었다(3회전 학습 1차 실행).
            # 0.03 비율을 총 스텝으로 환산한 값(최소 1)이라 4.x에서도 같은 뜻이다.
            lr_scheduler_type="cosine", warmup_steps=max(1, round(0.03 * total_steps)), logging_steps=5,
            bf16=True, gradient_checkpointing=True, optim="paged_adamw_8bit",
            save_strategy="no", report_to=[], seed=42,
        ),
    )
    trainer.train()
    model.save_pretrained(args.output)
    tok.save_pretrained(args.output)
    log(f"[finetune] done output={args.output} ({round(time.time() - t0)}초)")


if __name__ == "__main__":
    main()
