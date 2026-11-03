#!/bin/bash
# 双击启动《双线魔阵》开发服务器（macOS）
set -e
cd "$(dirname "$0")"

pause_on_error() {
  echo
  read -n 1 -s -r -p "按任意键关闭窗口..."
  echo
}

if ! command -v node >/dev/null 2>&1; then
  echo "未找到 Node.js。请先安装：https://nodejs.org/ （建议 20 以上版本）"
  pause_on_error
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "首次运行，正在安装依赖（只需一次）..."
  if ! npm install; then
    echo "依赖安装失败，请检查网络后重试。"
    pause_on_error
    exit 1
  fi
fi

echo
echo "正在启动开发服务器，浏览器将自动打开 http://127.0.0.1:5173"
echo "关闭本窗口或按 Ctrl+C 即可停止。"
echo
npm run dev -- --open
