#!/usr/bin/env bash
# Remove the EntityModel.com background service. Models are not touched.
set -euo pipefail
LABEL="com.entitymodeler.app"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$PLIST"
echo "Service removed. (Logs remain in ~/Library/Logs/EntityModeler)"
