// engine/netmikorunner.ts — 네트워크 장비용 RunFn (조치 검증 Phase 4)
//
// 왜: 방화벽·라우터는 `ssh host "cmd"`가 잘 안 통한다(페이징 --More--, enable 모드, 배너).
// Netmiko(MIT 라이선스 — 상용 배포 제약 없음)가 장비별로 이 처리를 해준다.
// 기존 Python 브릿지 패턴(modelscan_wrapper.py)을 그대로 재사용한다 → scripts/netmiko_runner.py.
//
// ⚠ 우선순위는 낮다: 계획서 실측 기준 장비 어댑터가 필요한 취약점은 전체의 3%뿐이다.
//   그래서 "있으면 쓰고, 없으면 정직하게 못 한다고 말하는" 형태로 만든다 — 억지로 끼우지 않는다.
//
// ⚠ 이 파일이 만드는 RunFn은 hardeningscan.RunFn과 시그니처가 같다.
//   덕분에 조치 검증·하드닝 점검이 장비에서도 같은 판정 코드를 그대로 쓴다(실행 엔진 하나 원칙).

import { execFile } from "child_process";
import * as path from "path";
import type { RunFn, RunResult, HardeningTarget } from "./hardeningscan";
import { serverPython } from "../util/pythonbin";
// ⚠ 이 통로도 `execFile(python)`이라 fetch 관문을 원리상 안 지난다 — 연결 직전에 직접 검사한다.
//   판정기는 airgap 한 곳만 쓴다(hardeningscan의 SSH 통로와 같은 이름표 "hardening-ssh").
import { assertEgressAllowed } from "./airgap";

/** 장비 종류 → Netmiko device_type. 모르는 장비는 null(→ 일반 SSH로 처리하게 둔다). */
export function deviceTypeOf(target: HardeningTarget): string | null {
  const hay = `${target.label} ${target.host}`.toLowerCase();
  if (/cisco|ios/.test(hay)) return "cisco_ios";
  if (/nexus|nx-os/.test(hay)) return "cisco_nxos";
  if (/asa/.test(hay)) return "cisco_asa";
  if (/juniper|junos/.test(hay)) return "juniper_junos";
  if (/arista|eos/.test(hay)) return "arista_eos";
  if (/fortigate|fortios/.test(hay)) return "fortinet";
  if (/palo|pan-os/.test(hay)) return "paloalto_panos";
  return null;
}

const SCRIPT = path.join(process.cwd(), "scripts", "netmiko_runner.py");
// ⚠ 예전엔 `?? "python"`이었다 — 운영(WSL)에 그 이름이 없어(python3만 존재) 조용히 실패한다.
//   서버 도구용 파이썬은 한 곳에서 고른다(util/pythonbin, 2026-08-08 문서 추출 사고).
const PYTHON = serverPython();
const TIMEOUT_MS = Number(process.env.GIJO_NETMIKO_TIMEOUT_MS ?? 45_000);

interface BridgeResponse {
  ok: boolean;
  results?: { cmd: string; out: string }[];
  error?: string;
}

/**
 * 장비 한 대에 명령 하나를 보내는 RunFn을 만든다.
 * 자격증명은 stdin JSON으로만 넘긴다 — 명령행 인자로 주면 ps 목록에 그대로 노출된다.
 */
export function netmikoRunner(target: HardeningTarget, deviceType: string): RunFn {
  // ⚠⚠ **에어갭 봉인을 여기서도 건다**(2026-08-18 검토 지적 — 반쪽이었다).
  //   `hardeningscan.ts targetRunner`에만 관문을 넣었는데, 장비(Cisco·FortiGate 등)는
  //   `verifyroutes.ts:104`의 `netmikoRunnerFor(target) ?? targetRunner(target)`에서
  //   **왼쪽이 이겨** targetRunner를 아예 안 탄다. 즉 관문을 지나지 않았다.
  //   하필 **봉인 증명서(`airgap.ts` hardening-ssh)가 가리키는 바로 그 대상**이 이쪽으로 간다 —
  //   같은 대상인데 하드닝 점검은 막히고 조치 검증은 나가서, 사람이 원인을 못 찾는다.
  //   ⚠ 이것도 `execFile(python)`이라 fetch 관문이 원리상 못 본다. 러너를 **만들 때 한 번** 막는다.
  assertEgressAllowed(target.host, "hardening-ssh");
  return (cmd: string): Promise<RunResult> =>
    new Promise((resolve) => {
      const payload = JSON.stringify({
        host: target.host,
        port: target.port || 22,
        username: target.username ?? "admin",
        device_type: deviceType,
        ...(target.authMethod === "password" && target.secret ? { password: target.secret } : {}),
        ...(target.authMethod === "key" && target.secret ? { key_file: target.secret } : {}),
        commands: [cmd],
      });

      const child = execFile(PYTHON, [SCRIPT], { timeout: TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }, (err, so, se) => {
        // 브리지가 아예 못 도는 경우(파이썬·netmiko 없음)도 "실패"로 정직하게 돌려준다.
        // 여기서 빈 성공을 주면 상위 판정이 "이상 없음"으로 오해한다.
        let parsed: BridgeResponse | null = null;
        try { parsed = JSON.parse(String(so || "").trim()) as BridgeResponse; } catch { /* 파싱 실패 → 아래에서 처리 */ }

        if (parsed?.ok && parsed.results?.length) {
          resolve({ code: 0, out: parsed.results[0].out ?? "", err: "" });
          return;
        }
        const reason = parsed?.error || String(se || "").trim() || (err ? err.message : "장비 응답을 해석하지 못했습니다");
        resolve({ code: 1, out: "", err: reason });
      });
      child.stdin?.end(payload);
    });
}

/**
 * 대상에 맞는 실행기를 고른다. 장비로 식별되면 Netmiko, 아니면 null(호출자가 기존 SSH를 쓴다).
 * "모르면 기존 방식" — 잘못 넘겨 장비를 헤매게 하는 것보다 낫다.
 */
export function netmikoRunnerFor(target: HardeningTarget): RunFn | null {
  if (target.authMethod === "local" || target.host === "local") return null;
  const dt = deviceTypeOf(target);
  return dt ? netmikoRunner(target, dt) : null;
}
