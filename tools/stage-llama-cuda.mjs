// tools/stage-llama-cuda.mjs — 라이트 Windows(nsis)에 동봉할 CUDA llama-server를 꾸린다.
//
// ■ mac(stage-llama-metal.sh)의 Windows 판이다. 함정도 판박이인데 이름만 다르다:
//   mac의 rpath 함정 = win의 **DLL 동반** 함정. 바이너리는 옆(같은 폴더)의 DLL을 먼저 찾지만,
//   개발 기계는 PATH에 CUDA 툴킷이 있어 **빠뜨려도 돌아 거짓 통과한다** — 그래서 이 스크립트는
//   꾸린 뒤 PATH를 비우고 실행해 「고객 기계 모양」으로 자가 검증한다.
//
// ■ 크기 정직(2026-08-13 실측): ggml-cuda가 cublas64_13를 물고, cublas가 cublasLt64_13(463MB)을
//   문다. 출하 결정서의 「CUDA 87MB」는 llama 자체만 센 값이었다 — 실제 동봉은 약 575MB다.
//   숨기지 않는다: 슬림화(MMQ 전용 빌드·Vulkan)는 후속 검토 항목으로 남긴다.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const 루트 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(루트, "server", "llama.cpp", "build", "bin", "Release");
const CUDA = "C:/Program Files/NVIDIA GPU Computing Toolkit/CUDA/v13.3/bin/x64";
const OUT = path.join(루트, "client", "build", "llama-cuda");

// ⚠ llama-server.exe는 10KB **껍데기**다 — 본체가 llama-server-impl.dll이다(빈 PATH 자가검증이
//   잡아낸 누락 1호). 임포트 폐포는 바이너리에서 뽑아 확정했다: cudart64가 아니라
//   **nvcudart_hybrid64**를 물고, 드라이버 nvcuda.dll은 고객 NVIDIA 드라이버가 준다(동봉 금지).
const 필수 = ["llama-server.exe", "llama-server-impl.dll", "llama-common.dll", "llama.dll", "ggml.dll", "ggml-base.dll", "ggml-cpu.dll", "ggml-cuda.dll", "mtmd.dll"];
// ⚠ nvcudart_hybrid64.dll은 임포트 문자열에 보이지만 **이 기계 어디에도 없다** — 지연 로드
//   참조(CUDA13 하이브리드 드라이버 모드)로 판단. 빈 PATH 자가검증이 실증 심판이다.
const 런타임 = ["cudart64_13.dll", "cublas64_13.dll", "cublasLt64_13.dll"];
// MSVC 런타임 — 깨끗한 고객 PC에는 없을 수 있다. exe 옆 동봉(app-local)이 MS 공식 허용 방식.
const MSVC = ["vcomp140.dll", "msvcp140.dll", "vcruntime140.dll", "vcruntime140_1.dll"];

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

let 합 = 0;
for (const f of 필수) {
  const s = path.join(SRC, f);
  if (!fs.existsSync(s)) { console.error(`★ 없음: ${s}`); process.exit(1); }
  fs.copyFileSync(s, path.join(OUT, f));
  합 += fs.statSync(s).size;
}
for (const f of 런타임) {
  const s = path.join(CUDA, f);
  if (!fs.existsSync(s)) { console.error(`★ CUDA 런타임 없음: ${s} — 툴킷 판이 바뀌었으면 이 목록을 갱신할 것`); process.exit(1); }
  fs.copyFileSync(s, path.join(OUT, f));
  합 += fs.statSync(s).size;
}
for (const f of MSVC) {
  const s = path.join(process.env.SystemRoot ?? "C:/Windows", "System32", f);
  if (!fs.existsSync(s)) { console.error(`★ MSVC 런타임 없음: ${s}`); process.exit(1); }
  fs.copyFileSync(s, path.join(OUT, f));
  합 += fs.statSync(s).size;
}

// 자가 검증 — PATH를 비워 「고객 기계 모양」으로 실행. 여기서 죽으면 DLL이 빠진 것이다.
try {
  const out = execFileSync(path.join(OUT, "llama-server.exe"), ["--version"], {
    env: { SystemRoot: process.env.SystemRoot ?? "C:\\Windows", PATH: (process.env.SystemRoot ?? "C:\\Windows") + "\\System32" },
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000,
  });
  console.log(`자가 검증(빈 PATH): ${String(out).trim().split("\n")[0] || "실행됨"}`);
} catch (e) {
  const err = e && typeof e === "object" ? e : {};
  const msg = String(err.stderr ?? "");
  if (/version/i.test(msg)) console.log(`자가 검증(빈 PATH): ${msg.trim().split("\n")[0]}`); // --version이 stderr로 나오는 판
  else {
    const st = err.status == null ? "?" : "0x" + (err.status >>> 0).toString(16).toUpperCase();
    // 0xC0000135=DLL 못 찾음 · 0xC000007B=아키텍처 불일치 · 0xC0000409=스택 보호
    console.error(`★ 빈 PATH 실행 실패 — 상태 ${st}\n${msg.slice(0, 400)}`);
    process.exit(1);
  }
}
console.log(`완료: ${OUT} — ${필수.length + 런타임.length}개 파일 · ${(합 / 1048576).toFixed(0)}MB`);
