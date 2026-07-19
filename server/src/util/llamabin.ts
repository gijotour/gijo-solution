// util/llamabin.ts — llama.cpp 빌드 산출물(llama-server, llama-quantize 등) 경로를 플랫폼에 맞게 만든다.
//
// Windows(MSVC/cmake)는 `build/bin/Release/<name>.exe`, Linux(WSL2 등)는 `build/bin/<name>`로 산출된다.
// WSL2 서버 이관(GIJO_AS_WSL2_서버이전_계획서.md)을 위해 하드코딩된 .exe 경로를 이 헬퍼로 통일한다.
// Windows 개발 PC에서도 동일하게 동작한다(회귀 없음).

import * as path from "path";

export function llamaBinPath(binName: string, cppDir = "llama.cpp"): string {
  const base = path.join(cppDir, "build", "bin");
  return process.platform === "win32" ? path.join(base, "Release", `${binName}.exe`) : path.join(base, binName);
}
