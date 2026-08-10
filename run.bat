@echo off
title MyRoutine PWA Local Server
echo ========================================================
echo  MyRoutine Habit Tracker PWA 로컬 서버를 구동합니다.
echo ========================================================
echo.
echo 브라우저 주소: http://localhost:5173/
echo (서버를 종료하려면 이 창을 닫거나 Ctrl+C를 누르세요)
echo.

cd /d "%~dp0"
python -m http.server 5173

pause
