@echo off
chcp 65001 > nul
title GIJO WIKI - 보안 솔루션 통합 ERP & 스마트 아키텍처 스튜디오

echo ========================================================
echo   GIJO WIKI (v5.0 Pro) 데스크톱 환경을 실행합니다...
echo   - 내 문서 사내 지식고 (My Docs Vault)
echo   - 온프레미스 GB10 / 로컬 Ollama LLM RAG 연동
echo   - 스마트 아키텍처 Pro 스튜디오 & 실시간 TCO
echo ========================================================

cd /d "%~dp0"
if exist "GIJO_Security_ERP_Suite.html" (
    start "" "GIJO_Security_ERP_Suite.html"
) else if exist "GIJO_AS_스마트아키텍처_v3.html" (
    start "" "GIJO_AS_스마트아키텍처_v3.html"
) else (
    echo [ERROR] 실행할 HTML 파일을 찾을 수 없습니다.
    pause
)
