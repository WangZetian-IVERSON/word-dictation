@echo off
chcp 65001 >nul
echo ================================================
echo   单词听写系统
echo ================================================
echo.

cd /d "%~dp0"
call venv\Scripts\activate.bat

echo 正在启动服务...
echo 本机访问: http://localhost:5000
echo 同WiFi的手机/电脑也可以访问（启动后会显示局域网地址）
echo 按 Ctrl+C 可停止服务
echo.

python app.py
pause
