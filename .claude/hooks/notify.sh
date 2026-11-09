#!/usr/bin/env bash
# Notification hook: macOS alert when Claude needs attention

osascript -e 'display notification "Claude needs your attention" with title "Alter Ego" sound name "Ping"' 2>/dev/null || true
