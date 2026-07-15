# scripts/finetune_unsloth.py — QLoRA 파인튜닝 (Unsloth, 6.2절 ③단계 "학습")
#
# finetune.ts가 `python scripts/finetune_unsloth.py --dataset <id>`로 스폰한다 (cwd=server/).
# 진행률 계약: stdout에 "step N/M loss=X.XXXX" 형식 한 줄씩 출력 — finetune.ts의 정규식
# /step\s+(\d+)\/(\d+)\s+loss=([\d.]+)/ 이 이 줄을 파싱해 WebSocket으로 브로드캐스트한다.
# 반드시 flush=True로 출력할 것 (파이프 버퍼링 때문에 진행률이 안 보이는 사고 방지).
#
# 데이터셋: data/datasets/<id>.json — [{"question": "...", "answer": "..."}, ...]
# (dataset.ts의 convert/amplify → save 로 만든 파일. 한국어 Q&A 쌍.)
#
# --smoke: unsloth/GPU 없이 파이프라인(데이터셋 로드 → 진행률 출력 → 종료)만 검증한다.
# 테스트와 CI에서 사용. 실학습 경로와 동일한 출력 계약을 지킨다.

import argparse
import json
import os
import sys
import time


def log(msg: str) -> None:
    print(msg, flush=True)


def fail(msg: str) -> None:
    print(f"[finetune] ERROR: {msg}", file=sys.stderr, flush=True)
    sys.exit(1)


def load_dataset_file(dataset_id: str) -> list:
    path = os.path.join("data", "datasets", f"{dataset_id}.json")
    if not os.path.exists(path):
        fail(f"데이터셋 파일이 없습니다: {path} — memory.html의 데이터셋 만들기(또는 POST /api/dataset/save)로 먼저 저장하세요")
    with open(path, "r", encoding="utf-8") as f:
        rows = json.load(f)
    examples = [r for r in rows if isinstance(r, dict) and r.get("question") and r.get("answer")]
    if not examples:
        fail(f"데이터셋에 유효한 question/answer 쌍이 없습니다: {path}")
    return examples


def run_smoke(examples: list, max_steps: int) -> None:
    # 실학습과 동일한 stdout 계약만 검증하는 경량 경로 (GPU/unsloth 불필요)
    log(f"[finetune] smoke 모드 — 데이터셋 {len(examples)}쌍 확인, {max_steps}스텝 시뮬레이션")
    loss = 2.0
    for step in range(1, max_steps + 1):
        loss = max(0.3, loss * 0.93)
        log(f"step {step}/{max_steps} loss={loss:.4f}")
        time.sleep(0.02)
    log("[finetune] done output=(smoke — 저장 없음)")


def run_real(examples: list, args) -> None:
    try:
        from unsloth import FastLanguageModel  # noqa: 반드시 transformers보다 먼저 import
        import torch
        from datasets import Dataset
        from trl import SFTTrainer
        from transformers import TrainingArguments, TrainerCallback
    except ImportError as e:
        fail(
            f"학습 의존성이 없습니다({e}). GPU 머신에서: pip install unsloth (CUDA torch 포함 환경 필요). "
            "파이프라인만 확인하려면 --smoke 를 사용하세요."
        )

    log(f"[finetune] 베이스 모델 로드(4bit): {args.base_model}")
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=args.base_model,
        max_seq_length=args.max_seq_length,
        load_in_4bit=True,
    )
    model = FastLanguageModel.get_peft_model(
        model,
        r=16,
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
        lora_alpha=16,
        lora_dropout=0,
    )

    # Q&A 쌍 → 모델의 채팅 템플릿 텍스트로 포맷 (dataset_text_field="text")
    def to_text(ex):
        messages = [
            {"role": "user", "content": ex["question"]},
            {"role": "assistant", "content": ex["answer"]},
        ]
        return {"text": tokenizer.apply_chat_template(messages, tokenize=False)}

    dataset = Dataset.from_list(examples).map(to_text)

    # stdout 진행률 계약을 지키는 콜백 — finetune.ts가 이 줄을 파싱한다
    class ProgressCallback(TrainerCallback):
        def on_log(self, ta, state, control, logs=None, **kwargs):
            if logs and "loss" in logs:
                log(f"step {state.global_step}/{state.max_steps} loss={logs['loss']:.4f}")

    trainer = SFTTrainer(
        model=model,
        tokenizer=tokenizer,
        train_dataset=dataset,
        dataset_text_field="text",
        max_seq_length=args.max_seq_length,
        callbacks=[ProgressCallback()],
        args=TrainingArguments(
            per_device_train_batch_size=2,
            gradient_accumulation_steps=4,
            warmup_steps=5,
            max_steps=args.max_steps,
            learning_rate=2e-4,
            fp16=not torch.cuda.is_bf16_supported(),
            bf16=torch.cuda.is_bf16_supported(),
            logging_steps=1,
            output_dir=args.output,
            report_to="none",
        ),
    )
    trainer.train()

    # LoRA 어댑터 저장. (gguf 병합·내보내기는 llama.cpp convert가 필요한 별도 단계 —
    # 저장된 어댑터로 unsloth의 save_pretrained_gguf를 쓰거나 수동 병합한다.)
    adapter_dir = os.path.join(args.output, "lora-adapter")
    model.save_pretrained(adapter_dir)
    tokenizer.save_pretrained(adapter_dir)
    log(f"[finetune] done output={adapter_dir}")


def main() -> None:
    parser = argparse.ArgumentParser(description="GIJO AS QLoRA 파인튜닝 (Unsloth)")
    parser.add_argument("--dataset", required=True, help="data/datasets/<id>.json 의 <id>")
    parser.add_argument("--base-model", default=os.environ.get("GIJO_FT_BASE_MODEL", "segolilylabs/Lily-Cybersecurity-7B-v0.2"))
    parser.add_argument("--max-steps", type=int, default=int(os.environ.get("GIJO_FT_MAX_STEPS", "60")))
    parser.add_argument("--max-seq-length", type=int, default=2048)
    parser.add_argument("--output", default=None, help="기본: outputs/<dataset-id>")
    parser.add_argument("--smoke", action="store_true", help="unsloth/GPU 없이 파이프라인만 검증")
    args = parser.parse_args()
    if args.output is None:
        args.output = os.path.join("outputs", args.dataset)

    examples = load_dataset_file(args.dataset)
    log(f"[finetune] 데이터셋 로드: {args.dataset} ({len(examples)}쌍)")

    if args.smoke:
        run_smoke(examples, min(args.max_steps, 10))
    else:
        run_real(examples, args)


if __name__ == "__main__":
    main()
