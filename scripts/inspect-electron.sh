#!/bin/bash
# Developer tool (#45): drive the REAL Electron IDE with a steps module, isolated from
# the user's own session. Needs the renderer dev server (npm run dev) on port 5175.
#   scripts/inspect-electron.sh <isolated-home> <steps.mjs> <out-dir>
# - HOME and Electron user data live in <isolated-home>; it must not be the real home.
#   Put there what the run needs (for example .retrostudio/ui-settings.json and links
#   to the toolkit/emulators) before calling.
# - Runs under Xvfb; only the Electron started here is terminated at the end.
# steps.mjs default-exports async ({evaluate,screenshot,desktop,key,type,wait}) => {}
set -eu
if [ "${1:-}" != "--inside" ]; then
  [ $# -eq 3 ] || { echo "usage: $0 <isolated-home> <steps.mjs> <out-dir>" >&2; exit 2; }
  for tool in xvfb-run import node; do command -v "$tool" >/dev/null || { echo "missing $tool" >&2; exit 3; }; done
  ISOLATED=$(realpath "$1"); REAL_HOME=$(realpath "$HOME"); REPOSITORY=$(cd "$(dirname "$0")/.." && pwd)
  case "$ISOLATED/" in "$REAL_HOME/"*|"$REPOSITORY/"*) echo "refusing a home inside the real home directory or the repository" >&2; exit 4;; esac
  mkdir -p "$3"
  NODE_BIN=$(node -e 'console.log(process.execPath)')
  # Version managers (asdf...) resolve tools through the real HOME: put the real interpreters first in PATH.
  PYTHON_BIN=$(python3 -c 'import sys;print(sys.executable)' 2>/dev/null || true)
  export PATH="$(dirname "$NODE_BIN")${PYTHON_BIN:+:$(dirname "$(realpath "$PYTHON_BIN")")}:$PATH"
  # Python packages installed for the user (Pillow for the map exporter) are read from the real home.
  export PYTHONUSERBASE="${PYTHONUSERBASE:-$HOME/.local}"
  exec xvfb-run -a -s "-screen 0 1440x900x24" "$0" --inside "$ISOLATED" "$(realpath "$2")" "$(realpath "$3")" "$NODE_BIN"
fi
ISOLATED="$2"; STEPS="$3"; OUT="$4"; NODE_BIN="$5"
REPO=$(cd "$(dirname "$0")/.." && pwd)
PORT=$((20000 + RANDOM % 20000))
cd "$REPO"
HOME="$ISOLATED" "$REPO/node_modules/electron/dist/electron" . --no-sandbox --user-data-dir="$ISOLATED/userdata" --remote-debugging-port=$PORT >"$OUT/electron.log" 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null || true; sleep 1; pkill -P $PID 2>/dev/null || true' EXIT
"$NODE_BIN" "$REPO/scripts/inspect-electron.mjs" "$PORT" "$STEPS" "$OUT"
