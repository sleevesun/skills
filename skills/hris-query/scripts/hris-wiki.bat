@echo off
rem hris-wiki.bat —— hris-query 的 Windows 启动垫片
rem 用法：把本文件复制到 PATH 目录。若环境变量未设置 SKILL_DIR，
rem 将尝试使用当前脚本所在目录或默认安装目录。
rem 之后即可在 cmd / PowerShell 中使用 `hris-wiki query <关键词>` 等命令。

if "%SKILL_DIR%"=="" (
  if exist "%~dp0hris-wiki" (
    set "SKILL_DIR=%~dp0.."
  ) else if exist "%CODEX_HOME%\skills\hris-query\scripts\hris-wiki" (
    set "SKILL_DIR=%CODEX_HOME%\skills\hris-query"
  ) else (
    set "SKILL_DIR=%USERPROFILE%\.codex\skills\hris-query"
  )
)

if not exist "%SKILL_DIR%\scripts\hris-wiki" (
  echo [hris-wiki] 未找到脚本：%SKILL_DIR%\scripts\hris-wiki
  echo [hris-wiki] 请设置环境变量 SKILL_DIR 为实际 hris-query 目录路径。
  exit /b 1
)
python "%SKILL_DIR%\scripts\hris-wiki" %*
