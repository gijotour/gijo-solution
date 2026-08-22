#!/usr/bin/env python3
"""modelscan_wrapper.py — bridge.ts의 modelscan 어댑터가 호출하는 래퍼.

modelscan 파이썬 API를 직접 호출한다(CLI는 안 쓴다 — CLI의 rich 콘솔 렌더러가 파일로
리다이렉트해도 stdout에 줄바꿈을 강제로 끼워넣어서 JSON.parse()가 깨진다). 스캔 결과를
StandardFinding[] JSON으로 표준 출력에만 찍는다.

bridge.ts가 stdout 전체를 그대로 JSON.parse()하므로, 이 스크립트는 최종 JSON 배열 한 줄
외에는 stdout에 절대 아무것도 찍으면 안 된다 — 로그/디버그는 전부 stderr로.

종료 코드: 스캔이 정상적으로 수행됐으면(취약점을 발견했든 안 했든) 항상 0으로 끝난다.
modelscan CLI는 이슈 발견 시 exit 1을 쓰지만, 여기서는 "스캔 성공"과 "래퍼 스크립트
자체의 실패"를 구분해야 하므로 그 관례를 따르지 않는다 — 인자 오류나 예외가 났을 때만
0이 아닌 코드로 끝난다(이 경우도 stdout에는 여전히 유효한 JSON을 남긴다 — bridge.ts는
exit code만으로 reject하므로, 실패 원인은 findings의 scan_error 항목으로도 같이 남긴다).

지원 형식: modelscan은 pickle/joblib/dill(.pkl 등), PyTorch(.bin/.pt/.pth/.ckpt),
Keras/H5(.h5/.keras), TensorFlow SavedModel(.pb), NumPy(.npy)만 스캔한다.
GGUF(.gguf, 이 프로젝트의 실제 자산 포맷)는 modelscan이 아예 모르는 형식이라 스캔되지
않고 건너뛴다 — 이 경우 "취약점 없음"이 아니라 "이 형식은 스캔 미지원"이라는 별도
finding을 남긴다(빈 배열을 그냥 반환하면 실제로 스캔해서 깨끗한 것과 구분이 안 돼서
오해를 부른다 — 다음단계 가이드 1.2절의 threat.html 가짜 데이터 문제와 같은 이유).
"""
import json
import sys

from modelscan.modelscan import ModelScan

SEVERITY_MAP = {"LOW": "low", "MEDIUM": "medium", "HIGH": "high", "CRITICAL": "critical"}


def to_standard_findings(result: dict) -> list[dict]:
    findings = []

    for issue in result.get("issues", []):
        findings.append({
            "finding_type": f"unsafe_operator:{issue.get('module', '?')}.{issue.get('operator', '?')}",
            "severity": SEVERITY_MAP.get(str(issue.get("severity", "")).upper(), "low"),
            "evidence": issue.get("description", "설명 없음"),
            "source_tool": "modelscan",
        })

    for err in result.get("errors", []):
        findings.append({
            "finding_type": "scan_error",
            "severity": "low",
            "evidence": str(err),
            "source_tool": "modelscan",
        })

    summary = result.get("summary", {})
    scanned = summary.get("scanned", {}).get("total_scanned", 0)
    skipped = summary.get("skipped", {})
    if skipped.get("total_skipped", 0) > 0 and scanned == 0:
        skipped_files = ", ".join(f.get("source", "?") for f in skipped.get("skipped_files", []))
        findings.append({
            "finding_type": "scan_not_supported",
            "severity": "low",
            "evidence": f"modelscan이 지원하지 않는 파일 형식이라 스캔되지 않았습니다: {skipped_files}",
            "source_tool": "modelscan",
        })

    return findings


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: modelscan_wrapper.py <asset_path>", file=sys.stderr)
        return 2

    asset_path = sys.argv[1]

    try:
        result = ModelScan().scan(asset_path)
        findings = to_standard_findings(result)
        exit_code = 0
    except Exception as exc:  # 스캐너 자체가 예외로 죽었을 때만 여기로 온다
        findings = [{
            "finding_type": "scan_error",
            "severity": "low",
            "evidence": f"modelscan 실행 중 예외 발생: {exc}",
            "source_tool": "modelscan",
        }]
        exit_code = 1

    # ensure_ascii=True(기본값)로 강제 — Windows 콘솔은 파이썬 stdout 인코딩이 UTF-8이
    # 아닌 경우가 많아, 한글을 그대로 찍으면 깨진다(실제로 겪음). \uXXXX 이스케이프는
    # bridge.ts의 JSON.parse()가 알아서 원래 문자열로 복원하므로 데이터 손실은 없다.
    print(json.dumps(findings, ensure_ascii=True))
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
