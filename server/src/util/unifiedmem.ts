// util/unifiedmem.ts — **「GPU 메모리를 따로 셀 수 없는 기계」를 알아보는 단 한 곳.**
//
// ■ 왜 생겼나 — 1 PetaFLOP 기계에 「GPU를 찾지 못했습니다」라고 말했다 (2026-08-11 GB10 실측)
//   NVIDIA DGX Spark(GB10)는 CPU와 GPU가 메모리 121GB를 **함께** 쓴다(통합메모리). 그래서
//   nvidia-smi가 GPU 전용 메모리(FB)를 **아예 보고하지 않는다**. 그 기계에서 채취한 실제 출력:
//       --query-gpu=memory.free                     → [N/A]
//       --query-gpu=utilization.gpu,memory.used,total → 0, [N/A], [N/A]
//       --query-gpu=name,memory.total                → NVIDIA GB10, [N/A]
//   (nvidia-smi 표에도 Memory-Usage 칸이 "Not Supported"로 나온다 — 드라이버 차원이라
//    컨테이너 안에서도 똑같다. 도커로 감싸도 해결되지 않는다.)
//
//   우리 코드는 그 값을 parseInt로 읽어 NaN을 얻고 **「GPU 없음」으로 판정**했다. 결과:
//     · 설정 화면 구동 티어 → "NVIDIA GPU를 찾지 못했습니다 … 로컬 LLM 구동 미지원 환경입니다"
//     · makeRoomFor        → 여유를 모른다며 개수상한(2개) 폴백. 121GB인데 2개로 묶였다.
//     · 자가진단(preflight) → 같은 명령이 성공하니 **pass**. 두 화면이 서로 모순됐다.
//
//   mac(Apple Silicon)도 통합메모리지만 nvidia-smi가 **아예 없어** 다른 갈래로 이미 처리돼
//   있었다. GB10은 「nvidia-smi는 있는데 메모리만 없는」 제3의 경우다 — 갈래를 하나 더 둔다.
//
// ■ 왜 MemAvailable을 직접 읽는가 — mac과 사정이 **다르다**(2026-08-11 GB10 실측)
//   mac에서는 os.freemem()이 정상 상태에서도 거의 0이라 못 쓴다. 리눅스는 그렇지 않았다:
//       MemFree 117,783,548 kB · MemAvailable 122,391,476 kB · os.freemem() 122,385,704 kB
//   → Node(24, libuv)의 os.freemem()은 리눅스에서 이미 **MemAvailable 쪽**을 따라간다.
//   그래도 MemAvailable을 직접 읽는다. 이유 셋:
//     ① os.freemem()이 무엇을 세는지는 Node 문서의 약속이 아니라 libuv 구현이다 — 판본에 따라
//        MemFree로 돌아갈 수 있고, 그때는 조용히 과소평가가 된다.
//     ② 화면(getGpuUsage)과 판단(makeRoomFor)이 **같은 값**을 써야 어긋나지 않는다 — 근거를
//        코드에 못박아 둔다(mac에서 이 어긋남으로 「사용 31.8GB / 32GB」를 띄웠다).
//     ③ 컨테이너 안에서는 cgroup 한도와 호스트 값이 갈린다 — 어느 쪽을 세는지 분명해야 한다.
//
// ⚠ 판정을 여기 한 곳에만 둔다. 같은 nvidia-smi 읽기가 localengine(2곳)·preflight에 흩어져
//   있었고, 그래서 한 곳만 고치면 다른 곳이 어긋난다. 새로 nvidia-smi로 메모리를 읽는 코드를
//   쓸 때 직접 execFile하지 말고 gpuMemoryReport()를 부를 것.

import * as fs from "fs";
import { spawnSync } from "child_process";

/** GPU 메모리를 어떻게 보고받을 수 있는가. */
export type GpuMemoryReport =
  /** nvidia-smi가 없거나 실패 — GPU를 못 찾았다. */
  | { kind: "none" }
  /** 보통의 NVIDIA GPU — 전용 VRAM 총량을 그대로 준다. */
  | { kind: "reported"; name: string; totalMb: number }
  /** GPU는 있는데 메모리를 안 준다(통합메모리 — GB10·Jetson 등). 시스템 메모리로 대신 센다. */
  | { kind: "unified"; name: string };

/**
 * `nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits` 출력을 읽는다.
 *
 * **순수 함수** — 형식이 바뀌면 시험이 잡는다. 실행 시험으로는 안 드러난다:
 * `[N/A]`도 parseInt를 통과해 NaN이라는 **그럴듯한 실패**가 되기 때문이다(이 사고의 정체).
 *
 * 이름에 쉼표가 들어갈 수 있으니 **마지막 쉼표**로 가른다.
 */
export function parseGpuMemoryReport(stdout: string): GpuMemoryReport {
  const 첫줄 = String(stdout).trim().split("\n")[0]?.trim() ?? ""; // 여러 GPU면 첫 줄만
  if (!첫줄) return { kind: "none" };
  const 쉼표 = 첫줄.lastIndexOf(",");
  if (쉼표 < 0) return { kind: "none" };
  const name = 첫줄.slice(0, 쉼표).trim();
  const 총량 = 첫줄.slice(쉼표 + 1).trim();
  if (!name) return { kind: "none" };
  const mb = Number.parseInt(총량, 10);
  // ⚠ "[N/A]"·"Not Supported"·빈칸은 모두 「GPU가 없다」가 아니라 「메모리를 안 준다」다.
  //   숫자로 읽히지 않으면 통합메모리로 본다 — 이름이 나왔다는 것은 GPU가 있다는 뜻이다.
  if (!Number.isFinite(mb) || mb <= 0) return { kind: "unified", name };
  return { kind: "reported", name, totalMb: mb };
}

let 캐시: GpuMemoryReport | null = null;

/**
 * 이 기계의 GPU 메모리 보고 방식. 프로세스 생애 동안 바뀌지 않으므로 한 번만 재고 캐시한다.
 * (nvidia-smi 실행이 100ms 안팎이라 매 모델 로드마다 부르면 아깝다.)
 */
export function gpuMemoryReport(): GpuMemoryReport {
  if (캐시) return 캐시;
  const r = spawnSync("nvidia-smi", ["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"], {
    encoding: "utf-8",
    timeout: 5000,
  });
  캐시 = r.status === 0 && r.stdout ? parseGpuMemoryReport(r.stdout) : { kind: "none" };
  return 캐시;
}

/** 시험 전용 — 환경을 바꿔 가며 확인할 때 캐시를 비운다. */
export function resetGpuMemoryReportCache(): void {
  캐시 = null;
}

/**
 * /proc/meminfo 에서 「지금 실제로 더 쓸 수 있는 메모리」(MB).
 *
 * **순수 함수.** 읽지 못하면 null을 준다 — 0을 「여유가 없다」로 오해하면 여유가 있는데도
 * 올라간 모델을 내린다(mac에서 실제로 그랬다).
 *
 * ⚠ MemFree로 세지 말 것. 리눅스는 남는 RAM을 페이지 캐시로 채우므로 MemFree는 실제로 더 쓸 수
 *   있는 양보다 작다(GB10 실측 차이 4.6GB). MemAvailable은 커널이 「회수 가능한 캐시」를
 *   감안해 계산한 값이다.
 */
export function parseMemAvailableMb(meminfo: string): number | null {
  const m = /^MemAvailable:\s+(\d+)\s*kB/m.exec(String(meminfo));
  if (!m) return null; // 아주 오래된 커널(3.14 미만)엔 이 항목이 없다 — 추측하지 않는다
  return Math.max(0, Math.round(Number(m[1]) / 1024));
}

/** 리눅스에서 지금 더 쓸 수 있는 메모리(MB). 읽지 못하면 null. */
export function linuxAvailableMb(): number | null {
  try {
    return parseMemAvailableMb(fs.readFileSync("/proc/meminfo", "utf-8"));
  } catch {
    return null;
  }
}
