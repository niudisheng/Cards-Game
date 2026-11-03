@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title 双线魔阵 - 开发服务器

where node >nul 2>nul
if errorlevel 1 (
  echo 未找到 Node.js。请先安装：https://nodejs.org/ ^(建议 20 以上版本^)
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo 首次运行，正在安装依赖（只需一次）...
  call npm install
  if errorlevel 1 (
    echo 依赖安装失败，请检查网络后重试。
    pause
    exit /b 1
  )
)

echo.
echo 正在启动开发服务器，浏览器将自动打开 http://127.0.0.1:5173
echo 关闭本窗口或按 Ctrl+C 即可停止。
echo.
call npm run dev -- --open

if errorlevel 1 (
  echo.
  echo 服务器异常退出，请查看上方日志。
  pause
)

endlocal
