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
    p.add_argument("--max-seq", type=int, default=1024)
    p.add_argument("--rank", type=int, default=16)
    args = p.parse_args()

    ds_path = os.path.join("data", "datasets", f"{args.dataset}.json")
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

    def render(q: str, a: str):
        msgs_prompt = [{"role": "system", "content": args.system}, {"role": "user", "content": q}]
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

    feats = [f for f in (render(r["question"], r["answer"]) for r in rows) if f]
    log(f"[finetune] 토큰화 — 사용 {len(feats)}쌍(길이 초과 제외 {len(rows) - len(feats)})")
    data = Dataset.from_list(feats)

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
    trainer = Trainer(
        model=model, train_dataset=data, data_collator=collate,
        args=TrainingArguments(
            output_dir=args.output, num_train_epochs=args.epochs, learning_rate=args.lr,
            per_device_train_batch_size=1, gradient_accumulation_steps=16,
            lr_scheduler_type="cosine", warmup_ratio=0.03, logging_steps=5,
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
