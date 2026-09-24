# Any-Lover 开发环境一键搭建（Windows）
# 用法：在仓库根目录 PowerShell 执行  ./setup.ps1
#   可选参数会原样透传给 setup-dev.js，例如：
#     ./setup.ps1 --with-nextchat
#     ./setup.ps1 --mirror=ghproxy
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

# 检查 Node
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host "未检测到 Node.js。请先安装 Node 18+：https://nodejs.org/" -ForegroundColor Red
  exit 1
}

node "build/scripts/setup-dev.js" @args
