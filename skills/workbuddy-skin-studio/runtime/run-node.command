#!/bin/zsh
set -euo pipefail

if [[ -n "${WORKBUDDY_NODE:-}" ]]; then
  if [[ -x "$WORKBUDDY_NODE" ]]; then
    exec "$WORKBUDDY_NODE" "$@"
  fi
  /usr/bin/osascript -e 'display dialog "WORKBUDDY_NODE 不是可执行文件。请移除该环境变量后重试。" buttons {"好"} default button "好" with icon stop' >/dev/null
  exit 1
fi

if command -v node >/dev/null 2>&1; then
  exec "$(command -v node)" "$@"
fi

WORKBUDDY_ELECTRON="/Applications/WorkBuddy.app/Contents/MacOS/Electron"
if [[ -x "$WORKBUDDY_ELECTRON" ]]; then
  exec env ELECTRON_RUN_AS_NODE=1 "$WORKBUDDY_ELECTRON" "$@"
fi

/usr/bin/osascript -e 'display dialog "没有找到可用的 JavaScript 运行时。请先安装 Node.js，或安装 /Applications/WorkBuddy.app。" buttons {"好"} default button "好" with icon stop' >/dev/null
exit 1
