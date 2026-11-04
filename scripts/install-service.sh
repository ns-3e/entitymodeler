#!/usr/bin/env bash
# Install EntityModel.com as a macOS background service (launchd LaunchAgent).
# Starts at login, restarts if it stops, serves http://localhost:${PORT:-5180}.
set -euo pipefail

LABEL="com.entitymodeler.app"
PORT="${PORT:-5180}"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs/EntityModeler"
NODE_BIN="$(command -v node || true)"

if [[ "$(uname)" != "Darwin" ]]; then echo "This installer is for macOS (launchd)."; exit 1; fi
if [[ -z "$NODE_BIN" ]]; then echo "node not found on PATH. Install Node 18+ first."; exit 1; fi
if [[ ! -f "$APP_DIR/node_modules/vite/bin/vite.js" ]]; then
  echo "Installing dependencies…"
  (cd "$APP_DIR" && npm install)
fi
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1 && ! launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
  echo "Port $PORT is already in use (is 'npm run dev' running?). Stop it, or rerun with PORT=<other port>."
  exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>$APP_DIR/node_modules/vite/bin/vite.js</string>
    <string>--port</string><string>$PORT</string>
    <string>--strictPort</string>
    <string>--host</string><string>127.0.0.1</string>
  </array>
  <key>WorkingDirectory</key><string>$APP_DIR</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$(dirname "$NODE_BIN"):/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>$LOG_DIR/out.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/error.log</string>
</dict>
</plist>
EOF

# (Re)load
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl enable "gui/$(id -u)/$LABEL"

for _ in $(seq 1 30); do
  if curl -fs "http://127.0.0.1:$PORT/api/info" >/dev/null 2>&1; then
    echo "EntityModel.com is running at http://localhost:$PORT"
    echo "Logs: $LOG_DIR"
    exit 0
  fi
  sleep 0.5
done
echo "Service installed but not answering yet. Check $LOG_DIR/error.log"
exit 1
