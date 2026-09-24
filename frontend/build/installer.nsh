; NSIS 自定义脚本（electron-builder nsis.include）。
; 方案乙：卸载时删除整个用户数据目录 %APPDATA%\Any-Lover
;（含运行时下载的 Ollama 模型、聊天记录、配置、日志等，可能数 GB）。
; 同时清理可能残留的后台进程，避免文件占用导致删除失败。

!include LogicLib.nsh

; 卸载前：结束我们的后台进程（后端 / Ollama / 推理进程），防止占用文件。
!macro customUnInit
  ; taskkill 找不到进程会返回非 0，属正常，忽略即可。
  nsExec::Exec 'taskkill /F /T /IM "any-lover.exe"'
  nsExec::Exec 'taskkill /F /T /IM "aibot-backend.exe"'
  nsExec::Exec 'taskkill /F /T /IM "ollama app.exe"'
  nsExec::Exec 'taskkill /F /T /IM "ollama.exe"'
  nsExec::Exec 'taskkill /F /T /IM "llama-server.exe"'
  Sleep 800
!macroend

; 卸载收尾：删除模型相关的全部数据（默认目录 + 用户自选安装目录），
; 使重装后 onboarded 归零、需重新手动下载。
; - 默认目录：整个 %APPDATA%\Any-Lover（含 ollama/models、settings.json、聊天记录等）
; - 用户自选目录：从 settings.json 读 ollamaDir，只删其下的 bin/ 与 models/ 子目录
;   （避免误删用户在该目录里的其他文件）。
; 仅在「交互式卸载」时删除；「静默卸载」多为自动更新流程，跳过以免误删。
!macro customUnInstall
  ${IfNot} ${Silent}
    ; 1) 先从 settings.json 解析用户自选的 ollamaDir，删其 bin/models（在删 APPDATA 之前读）。
    ;    用 PowerShell 解析 JSON；ollamaDir 为空则跳过（用的是默认目录）。
    ;    注意：NSIS 用 $ 作变量前缀，PowerShell 里的 $ 必须写成 $$ 才会被当字面量输出，
    ;    否则会触发 "unknown variable" 警告，而 electron-builder 把警告当错误导致打包失败。
    nsExec::Exec 'powershell -NoProfile -ExecutionPolicy Bypass -Command "$$f=Join-Path $$env:APPDATA (Join-Path Any-Lover settings.json); if(Test-Path $$f){ try{ $$d=(Get-Content $$f -Raw | ConvertFrom-Json).ollamaDir; if($$d -and (Test-Path $$d)){ Remove-Item -LiteralPath (Join-Path $$d bin) -Recurse -Force -ErrorAction SilentlyContinue; Remove-Item -LiteralPath (Join-Path $$d models) -Recurse -Force -ErrorAction SilentlyContinue } }catch{} }"'
    DetailPrint "已清理用户自选安装目录下的 Ollama 二进制与模型（若有）"

    ; 2) 删默认用户数据目录（含默认 ollama/models、settings.json、聊天记录、日志等）。
    RMDir /r "$APPDATA\Any-Lover"
    DetailPrint "已删除用户数据目录：$APPDATA\Any-Lover"
  ${EndIf}
!macroend
