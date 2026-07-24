# LEEF(Log Event Extended Format) — IBM QRadar
- 구조: `LEEF:Version|Vendor|Product|Version|EventID|(Delimiter)Key=Value 쌍…`
  - Version: 1.0 또는 2.0. 2.0은 헤더 뒤에 속성 구분자(Delimiter, 예: ^)를 지정 가능.
  - EventID: 이벤트 종류 식별자.
- 속성부: LEEF는 기본 구분자가 탭(\t). QRadar가 잘 파싱하는 표준 키가 있음: cat(범주), devTime, src, dst, srcPort, dstPort, proto, usrName, sev(0~10), action.
- CEF와 차이:
  1) 헤더 필드 수: CEF는 7개(Signature ID·Name·Severity 포함), LEEF는 5개(EventID까지) — 심각도·이름은 속성부(sev 등)로.
  2) 속성부 구분자: CEF=공백, LEEF=기본 탭(2.0은 지정 가능).
  3) 생태계: CEF=ArcSight 중심, LEEF=IBM QRadar 중심.
- 담당자 요약: "LEEF:Version|벤더|제품|버전|이벤트ID|key=value(탭 구분). CEF보다 헤더가 짧고 QRadar 전용, 심각도는 sev 키."
