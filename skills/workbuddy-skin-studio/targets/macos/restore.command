#!/bin/zsh
set -euo pipefail
ROOT="${0:A:h}/../.."
cd "$ROOT"
STATE_ARGS=()
if [[ -n "${WORKBUDDY_STATE_DIR:-}" ]]; then
  STATE_ARGS=(--state-dir "$WORKBUDDY_STATE_DIR")
fi
exec "$ROOT/runtime/run-node.command" "$ROOT/runtime/runner.mjs" restore --cdp "${WORKBUDDY_CDP:-http://127.0.0.1:9336}" --package-dir "${WORKBUDDY_PACKAGE_DIR:-.}" "${STATE_ARGS[@]}"
