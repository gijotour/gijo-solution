#!/usr/bin/env python3
"""netmiko_runner.py — 네트워크 장비 CLI 실행 브리지 (조치 검증 Phase 4)

왜 필요한가: 방화벽·라우터 같은 장비는 `ssh host "명령"`이 잘 통하지 않는다.
  · 페이징(--More--)이 걸려 출력이 잘린다
  · enable 모드로 올라가야 보이는 정보가 있다
  · 로그인 배너·프롬프트가 출력에 섞인다
Netmiko(MIT)는 장비별로 이 처리를 해준다. 상용 배포에 제약이 없어 채택했다.

계약(서버 쪽 hardeningscan.RunFn과 맞춤):
  입력  : stdin으로 JSON {host, username, password|key_file, device_type, port, commands[]}
  출력  : stdout으로 JSON {ok, results:[{cmd, out}], error?}
  종료코드: 성공 0 / 실패 1

⚠ 읽기 전용만 — 이 스크립트는 show/get 계열만 보낸다(서버가 명령을 만들고, 여기선 실행만).
⚠ 자격증명은 stdin으로만 받는다. 명령행 인자로 주면 ps에 그대로 노출된다.
"""
import json
import sys

READ_ONLY_PREFIXES = ("show", "get", "display", "dir", "diagnose", "execute date")


def fail(msg: str, code: int = 1) -> None:
    print(json.dumps({"ok": False, "error": msg}, ensure_ascii=False))
    sys.exit(code)


def main() -> None:
    try:
        req = json.load(sys.stdin)
    except Exception as e:  # noqa: BLE001
        fail(f"입력 JSON을 읽지 못했습니다: {e}")

    commands = req.get("commands") or []
    if not commands:
        fail("실행할 명령이 없습니다")

    # 읽기 전용 가드 — 서버가 실수로 설정 변경 명령을 보내도 여기서 막는다(이중 안전장치).
    for c in commands:
        if not str(c).strip().lower().startswith(READ_ONLY_PREFIXES):
            fail(f"읽기 전용 명령만 실행할 수 있습니다: {c}")

    try:
        from netmiko import ConnectHandler  # type: ignore
    except ImportError:
        fail("netmiko가 설치돼 있지 않습니다 — `pip install netmiko` 후 다시 시도하세요")

    params = {
        "device_type": req.get("device_type") or "cisco_ios",
        "host": req.get("host"),
        "username": req.get("username"),
        "port": int(req.get("port") or 22),
        "conn_timeout": int(req.get("timeout") or 20),
    }
    if req.get("password"):
        params["password"] = req["password"]
    if req.get("key_file"):
        params["use_keys"] = True
        params["key_file"] = req["key_file"]

    results = []
    try:
        with ConnectHandler(**params) as conn:
            if req.get("enable_secret"):
                conn.enable()
            for c in commands:
                results.append({"cmd": c, "out": conn.send_command(c, read_timeout=30)})
    except Exception as e:  # noqa: BLE001
        fail(f"장비 접속·명령 실행 실패: {e}")

    print(json.dumps({"ok": True, "results": results}, ensure_ascii=False))


if __name__ == "__main__":
    main()
