@echo off
chcp 65001 >nul
echo ========================================
echo   单词听写系统 - 打包成 EXE
echo ========================================
echo.

:: 安装 pyinstaller
echo [1/3] 安装 PyInstaller...
venv\Scripts\pip install pyinstaller -q

echo.
echo [2/3] 开始打包（约需 1~3 分钟）...
venv\Scripts\pyinstaller ^
  --onefile ^
  --noconsole ^
  --name 单词听写 ^
  --add-data "templates;templates" ^
  --add-data "static;static" ^
  --hidden-import edge_tts ^
  --hidden-import fitz ^
  --hidden-import docx ^
  --hidden-import openai ^
  app.py

echo.
echo [3/3] 复制数据文件...
if not exist dist\data mkdir dist\data
if exist data\words.json    copy data\words.json    dist\data\ >nul
if exist data\mistakes.json copy data\mistakes.json dist\data\ >nul
if exist data\ecdict.db     copy data\ecdict.db     dist\data\ >nul

echo.
echo ========================================
echo   打包完成！
echo   文件在: dist\单词听写.exe
echo   把整个 dist 文件夹发给朋友即可
echo ========================================
pause
