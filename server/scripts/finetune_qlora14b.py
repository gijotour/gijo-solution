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


def 평가분리(질문들, n):
    """평가용으로 뗄 자리 번호를 고른다 — **결정적**이고 **질문 단위**다.

    ★ 왜 질문 단위인가(2026-09-04 · R6): 떼어 둔 행의 손실이 오르는 지점을 보자는 것이 --eval-holdout의
      목적인데, **같은 질문이 학습과 평가 양쪽에 있으면** 그 손실은 「배웠나」가 아니라 「외웠나」를 잰다.
      한 질문이 여러 행이 되는 길이 실제로 있다: 승인 문답이 같은 질문을 두 번 담을 수 있고,
      ⓓ 긴 형식 재료는 딴 생성기에서 와서 RAFT 행과 질문이 겹칠 수 있다.
      옛 판은 자리를 `input_ids` 해시로 골라서 — 같은 질문이라도 system·answer이 다르면 다른 자리라 —
      그 겹침을 **원리상 못 막았다.**

    ★ 왜 결정적인가: 무작위로 떼면 회전마다 다른 시험지로 재게 돼 「2회전이 나아졌다」를 비교할 수 없다.
      씨앗(seed=42)은 섞기용이지 이 선택에는 안 쓴다 — 질문 글자에서 바로 나온 해시로 고른다.

    ⚠ 정확히 n개가 아닐 수 있다. 질문 뭉치를 **통째로** 떼기 때문이다(반쪽을 떼면 겹침이 생긴다).
      n에 닿는 순간 멈추므로 실제 개수는 n 이상, n + (마지막 뭉치 크기 - 1) 이하다.
    """
    import hashlib
    뭉치 = {}
    for i, q in enumerate(질문들):
        뭉치.setdefault(str(q).strip(), []).append(i)
    차례 = sorted(뭉치, key=lambda q: hashlib.sha1(q.encode("utf-8")).hexdigest())
    고른것 = set()
    for q in 차례:
        if len(고른것) >= n:
            break
        고른것.update(뭉치[q])
    return 고른것


def lora_모듈(targets: str):
    """LoRA를 걸 모듈 이름들 — **여기 한 곳**에서 정한다.

    ★ 왜 함수로 빼나(2026-09-10 · 회전 5): 목록을 학습 코드 안에 인라인으로 두면 스모크가
      「무엇에 걸리는지」를 말할 수 없고, 시험도 그 값을 못 본다 — 깃발을 주고도 안 켜진 채
      몇 시간을 돌린 전례(warmup_ratio)가 그 자리였다. 이름을 부르는 곳과 찍는 곳이 같아야 한다.
    · all  = 지금까지의 길(주의 4 + MLP 3)
    · attn = 주의(q,k,v,o)만 — MLP는 사실이 사는 자리라 안 만진다(§12.12 뿌리 ②의 가설)
    """
    주의 = ["q_proj", "k_proj", "v_proj", "o_proj"]
    return 주의 if targets == "attn" else 주의 + ["gate_proj", "up_proj", "down_proj"]


def 평가파일읽기(경로):
    """평가용 행 파일을 읽는다 — **데이터셋과 같은 꼴**(question/answer/system 배열)이라야 한다.

    ★ 왜 같은 꼴인가: 읽는 코드가 둘이 되면 한쪽만 고쳐지는 날 「근거(system)를 안 읽는 평가」가
      조용히 생긴다. 학습과 평가가 다른 틀로 재면 그 손실은 아무것도 뜻하지 않는다.
    """
    if not os.path.exists(경로):
        print(f"[finetune] ERROR: 평가 파일이 없습니다: {경로}", file=sys.stderr, flush=True)
        sys.exit(1)
    with open(경로, "r", encoding="utf-8") as f:
        raw = json.load(f)
    rows = raw.get("행", raw) if isinstance(raw, dict) else raw
    rows = [r for r in rows if r.get("question") and r.get("answer")]
    if not rows:
        print(f"[finetune] ERROR: 평가 파일에 쓸 행이 없습니다: {경로}", file=sys.stderr, flush=True)
        sys.exit(1)
    return rows


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
    # [2026-09-04 · 2회전] 사다리 회전마다 「어느 에폭이 제일 나았나」를 사후에 못 물었다 —
    # 1회전은 3에폭을 통째로 굽고 마지막 것만 남겼다(5시간 20분). 중간 어댑터가 남으면 다시 안 구워도 된다.
    p.add_argument("--save-epochs", action="store_true",
                   help="에폭마다 checkpoint-* 를 어댑터 폴더에 남긴다(기본 off — 지금까지와 같다)")
    # 학습 손실만 보면 「외웠는지」와 「배웠는지」를 못 가른다. 떼어 둔 행의 손실이 오르기 시작하는 지점이 과적합이다.
    p.add_argument("--eval-holdout", type=int, default=0,
                   help="N행을 **결정적으로** 떼어 평가용으로 쓴다(기본 0 = 안 뗀다)")
    # [2026-09-05 · 4회전] --eval-holdout은 **그 회전의 데이터셋 안에서** 뗀다 — 재료가 바뀌면 시험지도
    # 바뀌므로 회전 2·3의 eval_loss는 원리상 서로 견줄 수 없다(다른 시험지의 점수다).
    # 회전 4부터는 홀드아웃을 저장소 파일 하나로 **고정**하고, 빌더가 그 행들을 데이터셋에서 빼 둔다.
    p.add_argument("--eval-file", default="",
                   help="평가용 행이 든 JSON 파일(데이터셋과 같은 꼴). --eval-holdout 과 **함께 못 쓴다**")
    # LoRA alpha = rank × 이 값. 지금까지 코드에 2가 박혀 있어 「세기」를 실험할 수 없었다.
    p.add_argument("--lora-alpha-mult", type=float, default=2.0)
    # [2026-09-10 · 회전 5] 4회전 내내 **재료만** 바꾸고 학습 설정은 한 번도 안 바꿨다(계획서 §12.12).
    #   그래서 아래 둘을 사람이 고를 수 있게 연다. **기본값은 옛 동작 그대로**라, 지금까지의 명령·
    #   사슬·시험은 한 글자도 안 바뀐다(깃발을 안 주면 4bit NF4 + LoRA 7모듈이다).
    #
    #   --precision 4bit  : 지금까지의 길 — bitsandbytes NF4로 눌러 싣는다(3090 24GB 전제).
    #               bf16  : 누르지 않고 싣는다. 왜 여는가 — **학습 격자와 서빙 격자가 달랐다.**
    #                       학습은 NF4(4bit)인데 어댑터를 얹어 돌리는 쪽은 Q4_K_M이라, 눌린 자리가
    #                       서로 다른 두 격자 사이에서 어댑터가 배운 보정이 어긋난다(§12.12 뿌리 ①).
    #                       ⚠ 메모리가 는다 — 14B×2바이트 ≈ 28GB. gb10 가용 44GB에 드는지는
    #                       **재 보고 나서** 말한다(그것이 100스텝 스모크의 목적이다).
    p.add_argument("--precision", choices=["4bit", "bf16"], default="4bit",
                   help="베이스를 어떤 격자로 싣나(기본 4bit = 지금까지와 같다)")
    #   --lora-targets all  : 지금까지의 길 — q,k,v,o + gate,up,down(MLP까지).
    #                  attn : q,k,v,o만. 왜 여는가 — MLP는 **사실이 사는 자리**로 알려져 있고,
    #                       회전 1~4에서 KEV 같은 사실이 밀리는 회귀가 반복됐다(§12.12 뿌리 ②).
    #                       주의를 거는 자리만 만지면 「어디를 보고 답하나」는 배우되 사실은 덜 밀린다는
    #                       가설이고, 이 회전이 **그 가설을 시험한다**(r5b).
    p.add_argument("--lora-targets", choices=["all", "attn"], default="all",
                   help="LoRA를 어느 모듈에 거나(기본 all = 지금까지와 같다)")
    #   --max-steps : 스모크용. 0이면 안 쓴다(에폭 수대로 돈다 = 지금까지와 같다).
    #     왜 필요한가: bf16이 44GB에 드는지·교사(8080)를 안 미는지는 **몇 스텝만 돌려도** 답이 나오는데,
    #     지금은 전 회차(3~5시간)를 돌리는 길밖에 없어 밤 한 번을 통째로 쓴다.
    p.add_argument("--max-steps", type=int, default=0,
                   help="N스텝만 돌고 멈춘다(기본 0 = 안 쓴다 · 에폭 수대로)")
    # [2026-09-13 · r5b 메모리 대책] 회전 5 r5a 본 굽기 실측(gb10): cgroup 상한(MemoryMax)이
    #   통합메모리 GPU 할당을 원리상 못 봐(memcg 밖) 아무 것도 못 막았다 — 밤새 가용 0~1G로
    #   돌다 커널 OOM을 맞을 수 있었다. 이 깃발은 **토치 수준**에서 한도를 걸어, 넘는 순간 몇 분
    #   안에 깨끗한 CUDA OOM으로 실패하게 한다(밤새 기다리는 대신 빨리 안다).
    #   ⚠ 기본 0 = 안 걺 — 값을 얼마로 잡을지는 계측(GPU 메모리 로그) 없이 못 고른다(그래서 먼저 연다).
    p.add_argument("--gpu-mem-fraction", type=float, default=0.0,
                   help="CUDA per-process 메모리 상한 비율(0~1, 기본 0=안 걺). 0보다 크면 "
                        "torch.cuda.set_per_process_memory_fraction으로 건다(계측 뒤 판단 · 기본은 안 켠다)")
    # --smoke: GPU·학습 의존성 없이 **파이프라인 계약만** 확인한다(시험·CI 전용).
    #   원클릭 루프가 이 스크립트를 부르게 되면서 필요해졌다 — 예전 스크립트에는 있고
    #   여기엔 없어, 배선을 바꾸면 스모크 시험이 통째로 죽는다(2026-08-08).
    p.add_argument("--smoke", action="store_true")
    args = p.parse_args()

    # 둘을 함께 주면 **어느 시험지로 쟀는지** 알 수 없다 — 조용히 한쪽을 이기게 두지 않는다.
    if args.eval_file and args.eval_holdout > 0:
        print("[finetune] ERROR: --eval-file 과 --eval-holdout 은 함께 못 씁니다(시험지가 둘이 됩니다)",
              file=sys.stderr, flush=True)
        sys.exit(1)

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
        # 새 인자가 **받아들여졌는지**를 스모크가 말한다 — 이름이 틀리면 argparse가 여기 오기 전에 죽고,
        # 조용히 무시되면 「켰다고 믿은 채」 안 켜진 학습을 몇 시간 돌린다(1회전의 warmup_ratio 사고 계보).
        log(f"[finetune] (smoke) save_epochs={int(args.save_epochs)} · eval_holdout={args.eval_holdout} · lora_alpha_mult={args.lora_alpha_mult} · eval_file={args.eval_file or '-'}")
        # 회전 5의 두 변수도 스모크가 **말로** 확인한다 — 깃발을 주고도 안 켜진 채 몇 시간을 돌린
        # 전례(warmup_ratio)가 있어, 「받았다」가 아니라 「이 값으로 돌겠다」를 찍는다.
        log(f"[finetune] (smoke) precision={args.precision} · lora_targets={args.lora_targets}({'·'.join(lora_모듈(args.lora_targets))}) · max_steps={args.max_steps} · gpu_mem_fraction={args.gpu_mem_fraction}")
        if args.eval_file:
            # ★ 스모크가 **진짜 파일**을 읽고 겹침까지 본다 — 실학습 경로는 GPU가 있어야 도는데,
            #   「홀드아웃이 데이터셋에서 빠졌나」는 값싸게 확인할 수 있다(빠지지 않았으면 그 손실은
            #   「배웠나」가 아니라 「외웠나」를 재고, 그 숫자로 회전을 판정하게 된다).
            평가행 = 평가파일읽기(args.eval_file)
            학습질문 = {str(r.get("question") or "").strip() for r in smoke_rows}
            평가질문 = {str(r.get("question") or "").strip() for r in 평가행}
            겹침 = sorted(학습질문 & 평가질문)
            log(f"[finetune] (smoke) 평가 파일 {len(평가행)}행 · 양쪽 겹친 질문 {len(겹침)}")
            if 겹침:
                log(f"[finetune] ERROR: 평가 파일의 질문이 학습 재료에도 있습니다: {겹침[:3]}")
                sys.exit(1)
            log(f"eval 10/10 eval_loss={0.5000:.4f}")
        if args.eval_holdout > 0:
            # ★ 스모크가 **진짜 분리기**(평가분리)를 돌린다(2026-09-04 · R6). 실학습 경로는 GPU·torch가
            #   있어야 돌아 어느 시험도 못 지나가는데, 「같은 질문이 양쪽에 있나」는 값싸게 확인할 수 있다.
            #   ⚠ 여기서 **다른 식을 새로 적으면** 스모크가 제 코드를 검사하게 된다 — 같은 함수를 부른다.
            질문들 = [str(r.get("question") or "") for r in smoke_rows]
            뗀자리 = 평가분리(질문들, args.eval_holdout)
            평가질문 = {질문들[i].strip() for i in 뗀자리}
            학습질문 = {q.strip() for i, q in enumerate(질문들) if i not in 뗀자리}
            겹침 = sorted(평가질문 & 학습질문)
            log(
                f"[finetune] (smoke) 평가 분리 — 평가 {len(뗀자리)}행 / 학습 {len(질문들) - len(뗀자리)}행"
                f" · 양쪽 겹친 질문 {len(겹침)}"
            )
            if 겹침:
                # 겹치면 평가 손실이 「외운 것」을 재게 된다 — 조용히 넘기면 그 숫자로 회전을 판정한다.
                log(f"[finetune] ERROR: 같은 질문이 학습·평가 양쪽에 있습니다: {겹침[:3]}")
                sys.exit(1)
            # 평가 줄의 꼴을 스모크에서도 한 번 낸다 — 화면 파서(finetune.ts)가 `step N/M loss=`만 읽으므로
            # 이 줄은 그 정규식에 **걸리지 않아야** 한다(걸리면 진행률 막대가 평가 손실로 튄다).
            log(f"eval 10/10 eval_loss={0.5000:.4f}")
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

    def gpu_메모리_로그(단계: str) -> None:
        r"""GPU 메모리 계측 — 적재 직후·학습 종료 두 자리에서 한 줄씩 찍는다(2026-09-13 · r5b 메모리 대책).

        ★ 왜 필요한가(2026-09-12 gb10 실측): r5a 본 굽기 내내 가용 메모리가 0~1G에 붙어 있었는데,
          이 스크립트는 GPU 메모리를 **한 글자도 안 남겼다**(bake.log에 0건). (3)(8) 같은 대책의
          숫자를 고르려면 먼저 재야 한다 — 계측 없이 상한값을 고르는 것은 추측이지 대책이 아니다.
        ⚠ `step N/M loss=` 꼴을 쓰지 않는다 — server/src/engine/finetune.ts:131의 진행률 파서가
          그 정규식(`/step\s+(\d+)\/(\d+)\s+loss=([\d.]+)/`)만 읽는다. 여기에 걸리면 진행률 막대가
          이 계측 값으로 튄다.
        ⚠ nvidia-smi로 재지 않는다 — GB10은 통합메모리라 GPU 메모리를 `[N/A]`로 준다
          (CLAUDE.md·server/src/util/unifiedmem.ts 계약). torch.cuda.max_memory_allocated/reserved는
          CUDA 런타임 API라 정확히 준다.
        """
        if not torch.cuda.is_available():
            return
        allocated = torch.cuda.max_memory_allocated() / (1024 ** 3)
        reserved = torch.cuda.max_memory_reserved() / (1024 ** 3)
        log(f"[finetune] GPU 메모리({단계}) allocated={allocated:.2f}GiB reserved={reserved:.2f}GiB")

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

    # 질문을 feats와 **나란히** 들고 간다 — 평가분리()가 질문 단위로 떼려면 자리마다 질문을 알아야 한다.
    쌍들 = [(r, render(r["question"], r["answer"], str(r.get("system") or ""))) for r in rows]
    feats = [f for _, f in 쌍들 if f]
    질문들 = [str(r.get("question") or "") for r, f in 쌍들 if f]
    dropped = len(rows) - len(feats)
    log(f"[finetune] 토큰화 — 사용 {len(feats)}쌍(길이 초과 제외 {dropped}, max_seq={args.max_seq})")
    # ⚠ 길이 초과는 **조용한 손실**이다 — render가 None을 돌려주면 그 행은 그냥 사라지고 학습은 정상 종료된다.
    #   근거(system)를 실은 RAFT 행은 길어서 기본 1024를 넘기 쉬우므로, 눈에 띄게 경고한다(전-N 위생 계보).
    if dropped and dropped / max(1, len(rows)) >= 0.1:
        log(f"[finetune] ⚠ 재료의 {dropped / len(rows) * 100:.0f}%가 길이 초과로 빠졌습니다 — --max-seq(현재 {args.max_seq})를 올리거나 근거 조각 수를 줄이세요")
    if not feats:
        log("[finetune] 길이 조건을 통과한 행이 없습니다 — 중단"); sys.exit(1)

    # 평가용 떼어내기 — **결정적**이고 **질문 단위**다(평가분리()가 그 규칙의 단일 출처다).
    eval_feats = []
    if args.eval_holdout > 0:
        if args.eval_holdout >= len(feats):
            log(f"[finetune] --eval-holdout({args.eval_holdout})이 재료({len(feats)})보다 많거나 같습니다 — 중단"); sys.exit(1)
        held = 평가분리(질문들, args.eval_holdout)
        if len(held) >= len(feats):
            log(f"[finetune] 질문 단위로 떼면 재료가 남지 않습니다(뗄 것 {len(held)} / 전체 {len(feats)}) — 중단"); sys.exit(1)
        eval_feats = [feats[i] for i in sorted(held)]
        feats = [f for i, f in enumerate(feats) if i not in held]
        log(f"[finetune] 평가용으로 {len(eval_feats)}행을 뗐습니다 — 학습 {len(feats)}행")

    if args.eval_file:
        # ★ 파일로 고정한 시험지 — **회전이 바뀌어도 같은 문항**이라 eval_loss를 회전 간에 견줄 수 있다.
        #   ⚠ 겹침은 여기서도 본다(빌더가 빼 줬더라도 확인한다 — 「빼 줬을 것이다」는 측정이 아니다).
        평가행 = 평가파일읽기(args.eval_file)
        학습질문 = {q.strip() for q in 질문들}
        겹침 = sorted({str(r.get("question") or "").strip() for r in 평가행} & 학습질문)
        if 겹침:
            log(f"[finetune] ERROR: 평가 파일의 질문이 학습 재료에도 있습니다({len(겹침)}건): {겹침[:3]} — 중단"); sys.exit(1)
        쌍 = [render(r["question"], r["answer"], str(r.get("system") or "")) for r in 평가행]
        eval_feats = [f for f in 쌍 if f]
        if not eval_feats:
            log(f"[finetune] 평가 파일의 행이 전부 길이를 넘었습니다(max_seq={args.max_seq}) — 중단"); sys.exit(1)
        log(f"[finetune] 평가 파일 {args.eval_file} — {len(eval_feats)}행 사용(길이 초과 제외 {len(평가행) - len(eval_feats)})")

    data = Dataset.from_list(feats)
    eval_data = Dataset.from_list(eval_feats) if eval_feats else None
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

    # [2026-09-13 · r5b 메모리 대책] 모델 적재 **전에** 건다 — 적재 중간에 넘으면 늦다.
    # 기본 0이면 아예 안 부른다: 부르고 0을 주면 라이브러리에 따라 「즉시 OOM」으로 읽힐 수 있어,
    # 안 켠 것과 켰는데 0인 것을 코드가 갈라 둔다.
    if args.gpu_mem_fraction and args.gpu_mem_fraction > 0:
        if torch.cuda.is_available():
            torch.cuda.set_per_process_memory_fraction(args.gpu_mem_fraction, 0)
            log(f"[finetune] GPU 메모리 상한 설정 — set_per_process_memory_fraction({args.gpu_mem_fraction}, 0)")
        else:
            log("[finetune] --gpu-mem-fraction 은 CUDA가 있어야 걸린다 — 건너뜀(CUDA 없음)")

    if args.precision == "bf16":
        # 누르지 않고 싣는다 — 학습 격자(bf16)와 서빙 격자(Q4_K_M) 사이의 어긋남을 없애려는 판이다.
        # ⚠ prepare_model_for_kbit_training은 **k-bit 전용**이라 여기서 부르지 않는다. 대신 그 함수가
        #   해 주던 일 중 이 경로에 필요한 것 하나(입력에 grad를 요구하게 하기)를 직접 켠다 —
        #   gradient_checkpointing과 PEFT를 함께 쓰면 이게 없어 「grad가 필요한 입력이 없다」로 죽는다.
        log("[finetune] 베이스 로드(bf16 · 누르지 않음)…")
        model = AutoModelForCausalLM.from_pretrained(args.base_model, dtype=torch.bfloat16, device_map={"": 0})
        if hasattr(model, "enable_input_require_grads"):
            model.enable_input_require_grads()
    else:
        bnb = BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4",
                                 bnb_4bit_compute_dtype=torch.bfloat16, bnb_4bit_use_double_quant=True)
        log("[finetune] 베이스 로드(4bit NF4)…")
        model = AutoModelForCausalLM.from_pretrained(args.base_model, quantization_config=bnb,
                                                     dtype=torch.bfloat16, device_map={"": 0})
        model = prepare_model_for_kbit_training(model)
    gpu_메모리_로그("적재 직후")
    lora_alpha = max(1, int(round(args.rank * args.lora_alpha_mult)))
    모듈들 = lora_모듈(args.lora_targets)
    # ★ **실제로 무엇으로 도는지**를 한 줄에 찍는다 — 깃발이 조용히 무시되면 몇 시간을 헛돈다.
    log(f"[finetune] 설정 — precision={args.precision} · lora_targets={args.lora_targets}({'·'.join(모듈들)})"
        f" · max_steps={args.max_steps or '-'} · r={args.rank} alpha={lora_alpha}(=r×{args.lora_alpha_mult})"
        f" · epochs={args.epochs} · lr={args.lr} · max_seq={args.max_seq}")
    model = get_peft_model(model, LoraConfig(
        r=args.rank, lora_alpha=lora_alpha, lora_dropout=0.05, bias="none", task_type="CAUSAL_LM",
        target_modules=모듈들))
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
            # 평가 손실은 **다른 낱말**로 찍는다 — 화면 파서가 읽는 정규식은 `step N/M loss=`라,
            # 여기에 "step"을 쓰면 진행률 막대가 평가 손실로 튄다(같은 꼴·다른 머리말).
            if logs and "eval_loss" in logs:
                log(f"eval {int(state.global_step)}/{int(state.max_steps)} eval_loss={float(logs['eval_loss']):.4f}")

    # transformers 5.x는 evaluation_strategy를 **eval_strategy로 이름을 바꿨다**(4.x에는 옛 이름만 있다).
    # 새 이름을 먼저 쓰고, TypeError가 나면 옛 이름으로 한 번 더 시도한다 —
    # warmup_ratio가 사라져 1차 학습이 통째로 죽었던 그 자리라, 이름 하나에 몇 시간을 걸지 않는다.
    # ★ 실측(2026-09-04, gb10 ~/venv-train): transformers **5.16.1**의 TrainingArguments.__init__ 서명에
    #   `eval_strategy`는 있고 `evaluation_strategy`는 **없다**(eval이 든 인자: bf16_full_eval,
    #   fp16_full_eval, eval_strategy, eval_steps, eval_delay, per_device_eval_batch_size, eval_on_start,
    #   eval_do_concat_batches, eval_use_gather_object, eval_accumulation_steps, batch_eval_metrics, do_eval).
    #   → **지금 gb10에서 사는 쪽은 `eval_strategy`다.** 옛 이름은 4.x로 내려갈 때의 대비책일 뿐이라,
    #   로그의 「평가 주기 인자 이름: …」 줄이 evaluation_strategy로 찍히면 venv가 내려간 것이다.
    ta_common = dict(
        output_dir=args.output, num_train_epochs=args.epochs, learning_rate=args.lr,
        per_device_train_batch_size=1, gradient_accumulation_steps=16,
        # warmup은 비율이 아니라 스텝 수로 준다 — transformers 5.x(gb10 실측 5.16.1, 2026-09-03)에서
        # warmup_ratio 인자가 사라져 TrainingArguments가 TypeError로 죽었다(3회전 학습 1차 실행).
        # 0.03 비율을 총 스텝으로 환산한 값(최소 1)이라 4.x에서도 같은 뜻이다.
        lr_scheduler_type="cosine", warmup_steps=max(1, round(0.03 * total_steps)), logging_steps=5,
        bf16=True, gradient_checkpointing=True, optim="paged_adamw_8bit",
        save_strategy="epoch" if args.save_epochs else "no", report_to=[], seed=42,
    )
    # 스모크(몇 스텝만) — max_steps는 num_train_epochs를 **덮는다**(transformers 계약).
    # 0이면 아예 안 넣는다: 넣어 두고 0이면 「스텝 0으로 끝」이 되어 조용히 아무것도 안 배운다.
    if args.max_steps and args.max_steps > 0:
        ta_common["max_steps"] = args.max_steps
        log(f"[finetune] ⚠ max_steps={args.max_steps} — 스모크입니다(에폭을 끝까지 돌지 않습니다)")
    if eval_data is not None:
        ta_common["per_device_eval_batch_size"] = 1
    ta = None
    if eval_data is not None:
        for 이름 in ("eval_strategy", "evaluation_strategy"):
            try:
                ta = TrainingArguments(**ta_common, **{이름: "epoch"})
                log(f"[finetune] 평가 주기 인자 이름: {이름}")
                break
            except TypeError as e:
                log(f"[finetune] {이름} 인자가 없습니다({e}) — 다음 이름으로 시도")
        if ta is None:
            log("[finetune] eval_strategy/evaluation_strategy 둘 다 없습니다 — 평가 없이 계속합니다")
            eval_data = None
    if ta is None:
        ta = TrainingArguments(**ta_common)

    trainer = Trainer(
        model=model, train_dataset=data, eval_dataset=eval_data, data_collator=collate,
        callbacks=[진행알림()], args=ta,
    )
    trainer.train()
    gpu_메모리_로그("학습 종료")
    model.save_pretrained(args.output)
    tok.save_pretrained(args.output)
    log(f"[finetune] done output={args.output} ({round(time.time() - t0)}초)")


if __name__ == "__main__":
    main()
