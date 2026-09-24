#!/usr/bin/env bash
# Any-Lover 开发环境一键搭建（macOS / Linux）
# 用法：在仓库根目录执行  ./setup.sh
#   可选参数会原样透传给 setup-dev.js，例如：
#     ./setup.sh --with-nextchat
#     ./setup.sh --mirror=ghproxy
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "未检测到 Node.js。请先安装 Node 18+：https://nodejs.org/ 或 brew install node" >&2
  exit 1
fi

node "build/scripts/setup-dev.js" "$@"
