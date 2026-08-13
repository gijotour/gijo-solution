# win 인계 — 원격 LLM 주소를 **런타임 설정**으로 (BridgeAI 1단계 선결) (max, 2026-08-13)

사장님 결정: BridgeAI(원격 GPU 오프로드)를 **전 제품에 선택 연동**, **VPN 전용**.
1단계는 「설정에서 원격 GPU 주소를 넣으면 GIJO AS의 채팅이 그리로 간다」인데, **지금 구조로는
불가능**하다 — 그 자리를 win이 열어야 max가 UI를 얹는다.

## 1. 왜 지금은 안 되나

채팅 백엔드 URL이 **모듈 상수(env)**다. 부팅 때 한 번 읽고 끝이라 런타임에 못 바꾼다:
```
server/src/engine/llm.ts:24        const LOCAL_LLM_BASE_URL = process.env.GIJO_LOCAL_LLM_URL ?? "http://localhost:8080/v1";
server/src/engine/searchrewrite.ts:25   const 통로 = process.env.GIJO_LOCAL_LLM_URL ?? "http://localhost:8080/v1";
```
그리고 제품은 이미 화면 문구로 **「② 사내 GPU 서버에 연결 — 설정에서 서버 주소 입력」**(llm.ts:719)을
광고하지만, **그 입력을 받는 라우트·저장·적용이 어디에도 없다.** 광고만 있고 구현이 없다.
(설정의 「서버 주소」(settings.html:246)는 **GIJO 서버** 주소지 LLM 백엔드가 아니다. cloudllm.ts는
OpenAI/Anthropic 같은 **클라우드 제공자**용이라 또 다른 것이다.)

## 2. 열어야 할 것 (win, server)

**① 원격 LLM URL을 런타임 값 + app_state 영속으로**
- `llm.ts`의 `LOCAL_LLM_BASE_URL`을 상수에서 **함수/게터**로: app_state에 저장된 값이 있으면 그걸,
  없으면 `GIJO_LOCAL_LLM_URL ?? localhost:8080/v1`. `searchrewrite.ts`의 `통로`도 같은 게터를 쓴다.
- ⚠ `ensureAgentModel`(localengine.ts)이 로컬 모델을 로드·서빙하는 경로와 **충돌 정리**가 필요하다:
  원격 모드가 켜지면 **로컬 llama를 띄우지 않고** 원격 `/v1`로 바로 간다. 지금은 llm.ts:685가
  `ensureAgentModel`로 baseUrl을 받으므로, 원격 모드일 때 그걸 원격 URL로 **우회**시키면 된다.

**② 라우트 3개**
```
GET  /api/llm/remote            → { enabled, url, lastCheck }   (키·비번은 안 돌려준다)
POST /api/llm/remote/test       { url } → 원격 /v1/models 또는 /health 찔러 도달 확인
POST /api/llm/remote            { enabled, url } → 저장(+원격 모드 on/off)
```

**③ VPN 전용 가드 (사장님 결정)**
- 저장 시 URL 호스트가 **사설 대역**(10./172.16-31./192.168./100.64. CGNAT/WireGuard)인지 확인.
  공인 IP·공개 도메인이면 **거부**하고 「VPN 안의 주소만 됩니다」로 돌려준다.
- **에어갭 모드(`airgap`)가 켜져 있으면** 이 기능 자체를 막는다(원격은 네트워크가 전제).

**④ 자격증명**
- BridgeAI 프록시는 그냥 `/v1`이라 대개 URL만으로 되지만, 인증이 붙으면 토큰은
  **cloudllm.ts의 암호화 키 보관 패턴**을 그대로 재사용(app_state에 평문 금지, 우리 원칙).

## 3. max가 얹을 것 (client, 그 뒤)

라우트가 열리면 **lite-settings.html에 「원격 GPU(VPN)」 카드**를 추가한다(내 구역):
- 기본 **꺼짐** · 주소 입력 · [연결 테스트] · [켜기]
- 켤 때 한 줄: **「질문이 VPN으로 원격 GPU에 전송됩니다」**(투명성 — 사장님 결정)
- 켜지면 대시보드 「지금 돌고 있나」가 **원격 상태**를 보이게(로컬 llama 대신)
- ⚠ 이건 **전 제품 공통 기능**이라, 스탠다드 settings.html에도 같은 카드가 필요하다 —
  그건 win 구역(공용 설정). 라이트 카드를 먼저 만들어 **모양을 맞춰** 둘 테니 그대로 옮기면 된다.

## 4. 이게 왜 큰가 (다시)
- 라이트 10GB 기계가 원격 14B/32B를 쓰면, 우리가 못 되찾던 **라우팅 2건·정리본 값 손실이
  모델을 안 바꾸고 풀린다**(다 모델 크기 문제였다).
- 기능등급 가이드의 「더 크게 쓰면 좋아진다」가 **기계 교체 없이** 실현된다.
- 그리고 오늘 인계한 **「모델 교체 후 긴 프롬프트 즉시 실패」**(별건)도, 원격이 안정적이면
  로컬 스왑을 아예 안 해 우회된다.

## 5. 상태 (max)
- **코드 무수정**(이 자리는 win 구역). 이 문서가 전부다.
- 라우트가 열리면 lite-settings 카드는 **반나절**이면 얹는다 — 신호만 주면 된다.
