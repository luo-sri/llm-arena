@echo off
chcp 65001 >nul
title LLM Arena 多模型能力评测竞技场
cd /d "%~dp0app"

where npm >nul 2>nul
if errorlevel 1 (
  echo  [错误] 未找到 Node.js，请先安装后再运行本脚本。
  pause
  exit /b 1
)

echo.
echo  ============================================
echo    LLM Arena 多模型能力评测竞技场
echo  ============================================
echo  正在启动，约 5 秒后自动打开浏览器...
echo  关闭本窗口（或按 Ctrl+C）即可退出系统。
echo.

start "" /b cmd /c "timeout /t 6 /nobreak >nul & start http://localhost:3000"
npm run dev
pause
