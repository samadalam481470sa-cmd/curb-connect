#!/bin/bash
# Gives the Mac server a fixed web address through a Cloudflare tunnel, so the Field Pro API on
# Render can reach it. Needs a free Cloudflare account and a domain on it. Run after install.sh.
#   HOSTNAME_FOR_AI=ai.yourdomain.com ./tunnel-setup.sh
set -euo pipefail
[ "$(uname)" = "Darwin" ] || { echo "This script is for macOS."; exit 1; }
: "${HOSTNAME_FOR_AI:?Set HOSTNAME_FOR_AI, for example HOSTNAME_FOR_AI=ai.yourdomain.com}"
HOME_DIR="$HOME/.fieldpro-home-ai"
AGENTS="$HOME/Library/LaunchAgents"
CF="$(command -v cloudflared)"
NAME="fieldpro-home-ai"

[ -f "$HOME/.cloudflared/cert.pem" ] || "$CF" tunnel login
"$CF" tunnel list 2> /dev/null | grep -q " $NAME " || "$CF" tunnel create "$NAME"
"$CF" tunnel route dns -f "$NAME" "$HOSTNAME_FOR_AI"
ID="$("$CF" tunnel list 2> /dev/null | awk -v n="$NAME" '$2==n {print $1}')"

cat > "$HOME_DIR/tunnel.yml" <<EOT
tunnel: $ID
credentials-file: $HOME/.cloudflared/$ID.json
ingress:
  - hostname: $HOSTNAME_FOR_AI
    service: http://127.0.0.1:11500
  - service: http_status:404
EOT

cat > "$AGENTS/com.fieldpro.tunnel.plist" <<EOT
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>com.fieldpro.tunnel</string>
<key>ProgramArguments</key><array>
<string>$CF</string><string>tunnel</string><string>--config</string><string>$HOME_DIR/tunnel.yml</string><string>run</string>
</array>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><true/>
<key>StandardOutPath</key><string>$HOME_DIR/tunnel.log</string>
<key>StandardErrorPath</key><string>$HOME_DIR/tunnel.log</string>
</dict></plist>
EOT

UID_NUM="$(id -u)"
launchctl bootout "gui/$UID_NUM/com.fieldpro.tunnel" 2> /dev/null || true
launchctl bootstrap "gui/$UID_NUM" "$AGENTS/com.fieldpro.tunnel.plist"

echo
echo "Tunnel running. Put these in the Render API service environment:"
echo "  HOME_AI_BASE_URL = https://$HOSTNAME_FOR_AI/v1"
echo "  HOME_AI_API_KEY  = $(cat "$HOME_DIR/key")"
echo "  HOME_AI_MODEL    = $(cat "$HOME_DIR/model" 2> /dev/null || echo qwen2.5:14b-instruct)"
