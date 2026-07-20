#!/bin/bash
# 운영 gijo-as 무sudo 재시작 — MainPID kill 후 systemd(Restart=always)가 5초 뒤 자동 재기동.
OLD=$(pgrep -u gijo -f dist/index.js | head -1)
echo "OLD_PID=$OLD"
kill "$OLD"
sleep 9
echo "state=$(systemctl is-active gijo-as)"
echo "NEW_PID=$(pgrep -u gijo -f dist/index.js | head -1)"
