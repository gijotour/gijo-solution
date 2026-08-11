# GIJO AS — 폰으로 GB10에 명령 내리는 법 (Remote Control)

- 작성: 2026-08-11 · 지시: "핸드폰으로 원격으로 명령 내리는 환경이어야 해"
- 근거: Claude Code 공식 문서 [Remote Control](https://code.claude.com/docs/en/remote-control)
- 성격: **작업 절차서**. 이 문서를 쓴 세션은 클라우드라 GB10에서 실행·검증하지 못했다 — 첫 실행은 사장님이.

---

## 1. 결론 — `claude remote-control`

**GB10에서 클로드를 돌리고, 폰으로 조종한다.** 클로드는 GB10 안에서 실행되므로 GPU·모델·
파일을 그대로 쓰고, 폰은 **창(window)** 역할만 한다.

```
    폰 (Claude 앱)  ──인터넷──▶  Anthropic  ◀──인터넷──  GB10에서 도는 클로드
       조종만                                             실제 일은 여기서
```

## 2. 왜 이게 우리 상황에 맞나 — 세 가지가 한꺼번에 풀린다

| 우리 문제 | Remote Control이 푸는 방식 |
|---|---|
| **공유기에 못 들어가 포워딩 불가** | ✅ **들어오는 포트를 안 연다.** GB10이 밖으로 나가는 HTTPS만 쓴다 — 공유기 설정이 아예 필요 없다 |
| **작업(클라우드)과 검증(GB10)이 갈려 왔다갔다** | ✅ **한자리에서 끝난다.** 클로드가 GB10 안에 있으니 고치고 바로 `vitest`·`gb10-check` 실행 |
| **폰에서 명령 내리고 싶다** | ✅ Claude 앱에서 그 세션을 열어 대화. 긴 작업이 끝나면 **푸시 알림**도 온다 |

덤: 클라우드 세션과 달리 **GB10의 128GB·CUDA·models/·운영 데이터를 그대로** 쓴다.

## 3. 설치 (GB10에서 한 번만)

### 3-1. 로그인
```bash
claude auth login        # claude.ai 계정으로. API 키 방식은 Remote Control 불가
```

### 3-2. ⚠ tmux 안에서 띄운다 — 이걸 빠뜨리면 SSH 끊는 순간 죽는다
공식 문서에 명시된 제약이다: **"로컬 프로세스가 멈추면 세션도 끝난다. SSH를 끊어도 살아
있게 하려면 `tmux`나 `screen` 안에서 시작하라."** GB10은 화면 없이 두는 장비라 필수다.

```bash
sudo apt install -y tmux          # 없으면
tmux new -s claude                # 'claude'라는 이름의 방을 만든다
cd ~/gijo-as                      # ⚠ 반드시 저장소 폴더에서 (홈에서 띄우지 말 것)
claude remote-control --name "GB10"
```

- **스페이스바**를 누르면 **QR 코드**가 뜬다 → 폰 Claude 앱으로 스캔하면 바로 연결
- 빠져나올 때는 **`Ctrl+B` 누른 뒤 `D`** — 프로세스는 계속 돈다
- 다시 들어갈 때는 `tmux attach -t claude`

### 3-3. 폰 푸시 알림 켜기
GB10 터미널에서 `/config` → **Push when Claude decides**(긴 작업 끝났을 때) ·
**Push when actions required**(허락을 물어야 할 때) 둘 다 켠다.

## 4. 하루 흐름

```
폰: Claude 앱 → Code 탭 → "GB10" 세션 열기 (컴퓨터 아이콘 + 초록 점 = 접속 중)
    → 일 시키기 → GB10에서 코드 고치고 시험까지 그 자리에서 돎
    → 긴 작업이면 푸시 알림 오면 다시 열어 확인
게시할 때만 → Windows로
```

**넘기고 기다리는 단계가 사라진다.**

## 5. 알아 둘 제약 (문서에 명시된 것)

| 제약 | 뜻 | 대비 |
|---|---|---|
| **프로세스가 죽으면 세션도 끝** | 터미널 닫기·재부팅 시 | `tmux` 필수(3-2). 재부팅 후엔 다시 띄워야 한다 |
| **10분 이상 인터넷 끊기면 종료** | GB10 인터넷이 오래 끊기면 | 다시 `claude remote-control` |
| 일부 명령은 터미널 전용 | `/plugin`·`/resume`은 폰에서 안 됨 | `/model`·`/effort` 등은 **값을 인자로** 줘야 함(`/model sonnet`) |
| 대화 기록이 서버에 저장됨 | 기기 간 동기화를 위해 | **실행·파일 접근은 GB10에 남는다.** 코드가 밖으로 나가는 게 아니다 |

⚠ **무선 주의**: GB10이 무선이라 절전으로 잠들면 연결이 끊긴다.
`sudo iw dev wlP9s9 set power_save off` 또는 **유선으로 옮기는 것**이 낫다.

## 6. 재부팅해도 살아 있게 (선택 — 익숙해진 뒤에)

매번 띄우기 귀찮아지면 systemd 사용자 서비스로 만든다.
```bash
mkdir -p ~/.config/systemd/user
cat > ~/.config/systemd/user/claude-rc.service <<'EOF'
[Unit]
Description=Claude Code Remote Control (GIJO AS)
After=network-online.target

[Service]
WorkingDirectory=%h/gijo-as
ExecStart=/usr/bin/env claude remote-control --name "GB10"
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
systemctl --user enable --now claude-rc
sudo loginctl enable-linger $USER    # 로그아웃해도 계속 돌게
journalctl --user -u claude-rc -f    # 상태 보기
```
> **[확인]** `claude` 실행 파일 경로가 다르면 `ExecStart`를 `which claude` 값으로 바꾼다.

## 7. Windows 클로드 데스크탑이 "사용 중"이라며 안 켜질 때

증상: 이미 실행 중이라고 뜨는데 창이 없다 — 유령 프로세스가 남은 경우다.
```powershell
Get-Process | Where-Object { $_.Name -like "*laude*" } | Format-Table Name,Id,SessionId
Stop-Process -Name "Claude" -Force        # [확인] 위에서 나온 실제 이름으로
```
⚠ 다른 계정(`claude-deploy`)으로 로그인된 세션에 떠 있을 수도 있다 —
`SessionId`가 지금 세션과 다르면 그쪽에서 종료해야 한다.

**다만 Windows는 급하지 않다.** 폰 작업의 목적지는 GB10이고, Windows는 **게시 전용**이다.

## 8. 다른 방식과의 비교 (왜 이걸 골랐나)

| 방식 | 클로드가 도는 곳 | 우리에게 |
|---|---|---|
| **Remote Control** | **GB10** | ✅ **채택** — GPU·모델·데이터 그대로, 포워딩 불필요 |
| Claude Code on the web | 앤트로픽 클라우드 | ❌ GB10에 못 닿는다(오늘 겪은 3단계 중계의 원인) |
| Dispatch | Windows/Mac 데스크탑 | ❌ 리눅스용 데스크탑 앱이 없다 |
| 자체호스팅 환경(self-hosted) | 우리 인프라 | ⏸ Team/Enterprise 요금제 기능 — 나중에 검토 |
