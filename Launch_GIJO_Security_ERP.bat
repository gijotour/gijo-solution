@echo off
setlocal
set TARGET=D:\Connect AI\GIJO_Security_ERP_Suite.html
if not exist "%TARGET%" set TARGET=%~dp0GIJO_Security_ERP_Suite.html
start "" "%TARGET%"
exit /b 0
