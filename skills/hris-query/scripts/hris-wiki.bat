@echo off
rem hris-wiki.bat —— hris-query 的 Windows 启动垫片
rem 用法：把本文件复制到 PATH 目录，并将下方 SKILL_DIR 改为本机实际路径，
rem 之后即可在 cmd / PowerShell 中使用 `hris-wiki query <关键词>` 等命令。
set "SKILL_DIR=C:\Users\%USERNAME%\.workbuddy\skills\hris-query"
if not exist "%SKILL_DIR%\scripts\hris-wiki" (
  echo [hris-wiki] 未找到脚本：%SKILL_DIR%\scripts\hris-wiki
  echo [hris-wiki] 请编辑本文件中的 SKILL_DIR 为实际路径。
  exit /b 1
)
python "%SKILL_DIR%\scripts\hris-wiki" %*
