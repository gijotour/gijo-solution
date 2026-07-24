# Suricata EVE JSON(알림)
- 형식: 한 줄에 JSON 하나(NDJSON). 공통 키: timestamp, flow_id, event_type, src_ip, src_port, dest_ip, dest_port, proto, app_proto.
- event_type이 "alert"인 레코드가 IDS/IPS 탐지. 이때 "alert" 객체 하위 필드를 본다:
  - alert.signature: 시그니처(룰) 이름(사람이 읽는 설명).
  - alert.signature_id: 시그니처 ID(=Snort/Suricata의 sid).
  - alert.category: 분류(예: "A Network Trojan was detected").
  - alert.severity: 심각도(1이 가장 심각, 숫자가 클수록 낮음).
  - alert.gid, alert.rev, alert.action(allowed/blocked).
- 예: `{"event_type":"alert","src_ip":"10.0.0.5","dest_ip":"1.2.3.4","alert":{"signature":"ET MALWARE ...","signature_id":2018358,"category":"...","severity":1}}`
- 담당자 요약: "event_type=alert 레코드에서 alert.signature(이름)·alert.signature_id(sid)·alert.severity(1=최고). IP는 src_ip/dest_ip."
