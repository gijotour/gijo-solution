# scripts/export_gguf.py — 학습된 LoRA 어댑터를 병합해 GGUF로 내보내고 서빙 경로에 배치 (6.2절 ③단계 마지막 조각)
#
# finetune_unsloth.py가 만든 outputs/<dataset>/lora-adapter 를 입력으로:
#   1) 베이스 모델에 LoRA 병합 → fp16 HF 체크포인트 (unsloth save_pretrained_merged)
#   2) llama.cpp convert_hf_to_gguf.py 로 GGUF 변환
#   3) (기본) llama-quantize.exe 로 Q5_K_M 양자화 — 제품 기본 모델과 같은 양자화 수준
#   4) models/<model-id>/<model-id>.gguf 배치 → 에이전트 AI 화면에서 해당 modelId로 즉시 기동 가능
#
# 사용 예 (cwd=server/):
#   python scripts/export_gguf.py --adapter outputs/gijo-sec-qa-v0/lora-adapter --model-id lily-sec-tuned-v1
#
# GPU 머신 전용(unsloth 필요). llama.cpp 빌드(STEP 5)와 pip install gguf 선행.

import argparse
import os
import shutil
import subprocess
import sys

LLAMA_CPP_DIR = os.environ.get("GIJO_LLAMA_CPP_DIR", "llama.cpp")
QUANTIZE_EXE = os.path.join(LLAMA_CPP_DIR, "build", "bin", "Release", "llama-quantize.exe")
CONVERT_SCRIPT = os.path.join(LLAMA_CPP_DIR, "convert_hf_to_gguf.py")
MODELS_DIR = os.environ.get("GIJO_MODELS_DIR", "models")
MODEL_ID_RE = r"^[a-z0-9][a-z0-9.-]{0,63}$"


def log(msg: str) -> None:
    print(f"[export] {msg}", flush=True)


def fail(msg: str) -> None:
    print(f"[export] ERROR: {msg}", file=sys.stderr, flush=True)
    sys.exit(1)


def run(cmd: list, what: str) -> None:
    log(f"{what}: {' '.join(str(c) for c in cmd)}")
    result = subprocess.run(cmd)
    if result.returncode != 0:
        fail(f"{what} 실패 (exit {result.returncode})")


def main() -> None:
    import re

    parser = argparse.ArgumentParser(description="LoRA 어댑터 → 병합 GGUF → 서빙 배치")
    parser.add_argument("--adapter", required=True, help="finetune 산출물 (예: outputs/gijo-sec-qa-v0/lora-adapter)")
    parser.add_argument("--model-id", required=True, help="서빙용 modelId — models/<id>/<id>.gguf 로 배치된다")
    parser.add_argument("--quant", default="Q5_K_M", help="양자화 (기본 Q5_K_M, 'f16'이면 양자화 생략)")
    parser.add_argument("--keep-merged", action="store_true", help="중간 산출물(fp16 병합 체크포인트) 보존")
    args = parser.parse_args()

    if not re.match(MODEL_ID_RE, args.model_id):
        fail("model-id는 영문 소문자/숫자/하이픈/점만 가능합니다 (예: lily-sec-tuned-v1)")
    if not os.path.isdir(args.adapter):
        fail(f"어댑터 디렉터리가 없습니다: {args.adapter} — 먼저 파인튜닝을 실행하세요")
    if not os.path.exists(CONVERT_SCRIPT):
        fail(f"{CONVERT_SCRIPT} 없음 — llama.cpp 클론(체크리스트 STEP 5)이 선행돼야 합니다")

    # 1) LoRA 병합 → fp16 HF 체크포인트
    try:
        from unsloth import FastLanguageModel
    except ImportError as e:
        fail(f"unsloth가 없습니다({e}) — GPU 머신에서 실행하세요")

    log(f"어댑터 로드(베이스 모델은 adapter_config에서 자동 해석): {args.adapter}")
    model, tokenizer = FastLanguageModel.from_pretrained(model_name=args.adapter, load_in_4bit=True)

    merged_dir = os.path.join(os.path.dirname(args.adapter), "merged-16bit")
    log(f"LoRA 병합(fp16) 저장: {merged_dir}")
    model.save_pretrained_merged(merged_dir, tokenizer, save_method="merged_16bit")

    # 2) GGUF 변환 (f16)
    out_dir = os.path.join(MODELS_DIR, args.model_id)
    os.makedirs(out_dir, exist_ok=True)
    f16_path = os.path.join(out_dir, f"{args.model_id}.f16.gguf")
    run([sys.executable, CONVERT_SCRIPT, merged_dir, "--outfile", f16_path, "--outtype", "f16"], "GGUF 변환")

    # 3) 양자화 → 4) 서빙 경로 배치
    final_path = os.path.join(out_dir, f"{args.model_id}.gguf")
    if args.quant.lower() == "f16":
        shutil.move(f16_path, final_path)
    else:
        if not os.path.exists(QUANTIZE_EXE):
            fail(f"{QUANTIZE_EXE} 없음 — llama.cpp 빌드가 필요합니다 (또는 --quant f16으로 양자화 생략)")
        run([QUANTIZE_EXE, f16_path, final_path, args.quant], f"양자화({args.quant})")
        os.remove(f16_path)

    if not args.keep_merged:
        shutil.rmtree(merged_dir, ignore_errors=True)

    size_gb = os.path.getsize(final_path) / (1024**3)
    log(f"done output={final_path} ({size_gb:.2f}GB)")
    log(f"서빙: 에이전트 AI 화면에서 modelId '{args.model_id}' 로 로컬 엔진 시작 (또는 서버 재시작 없이 /api/localengine/start)")


if __name__ == "__main__":
    main()
