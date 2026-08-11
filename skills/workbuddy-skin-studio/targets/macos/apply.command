#!/bin/zsh
set -euo pipefail
ROOT="${0:A:h}/../.."
cd "$ROOT"
CDP="${WORKBUDDY_CDP:-http://127.0.0.1:9336}"
PACKAGE_DIR="${WORKBUDDY_PACKAGE_DIR:-.}"
STATE_ARGS=()
if [[ -n "${WORKBUDDY_STATE_DIR:-}" ]]; then
  STATE_ARGS=(--state-dir "$WORKBUDDY_STATE_DIR")
fi
NODE_RUNNER="$ROOT/runtime/run-node.command"

if [[ "${1:-}" == "--dry-run" ]]; then
  exec "$NODE_RUNNER" "$ROOT/runtime/runner.mjs" dry-run --cdp "$CDP" --package-dir "$PACKAGE_DIR" "${STATE_ARGS[@]}"
fi

PREPARED="$("$NODE_RUNNER" "$ROOT/runtime/runner.mjs" dry-run --cdp "$CDP" --package-dir "$PACKAGE_DIR" "${STATE_ARGS[@]}")"
TOKEN="$(printf '%s' "$PREPARED" | "$NODE_RUNNER" -e 'let s=""; process.stdin.on("data", d => s += d); process.stdin.on("end", () => process.stdout.write(JSON.parse(s).confirmToken));')"
if ! osascript -e 'display dialog "主题已准备完成。现在重启并应用 WorkBuddy 主题吗？" buttons {"取消", "重启并应用"} default button "取消" cancel button "取消"' >/dev/null; then
  exit 0
fi
exec "$NODE_RUNNER" "$ROOT/runtime/runner.mjs" apply --confirm-token "$TOKEN" --restart --cdp "$CDP" --package-dir "$PACKAGE_DIR" "${STATE_ARGS[@]}"
