#!/bin/bash
# Field Pro always-on AI server for a Mac. Safe to run again.
#   ./install.sh                 install with the default model
#   MODEL=qwen2.5:7b-instruct ./install.sh     pick a smaller model for 8 or 16 GB Macs
# What it sets up (all as launchd jobs that start at login and restart after a crash):
#   ollama     the model server, bound to this Mac only, model kept loaded
#   proxy      checks a secret key, then forwards to ollama
#   caffeinate stops the Mac from sleeping while on power
#   watchdog   every minute, restarts ollama or the proxy if they stop answering
set -euo pipefail
[ "$(uname)" = "Darwin" ] || { echo "This installer is for macOS."; exit 1; }

MODEL="${MODEL:-qwen2.5:14b-instruct}"
HERE="$(cd "$(dirname "$0")" && pwd)"
HOME_DIR="$HOME/.fieldpro-home-ai"
AGENTS="$HOME/Library/LaunchAgents"
mkdir -p "$HOME_DIR" "$AGENTS"
chmod 700 "$HOME_DIR"

command -v brew > /dev/null || { echo "Install Homebrew first: https://brew.sh"; exit 1; }
command -v node > /dev/null || brew install node
command -v ollama > /dev/null || brew install ollama
command -v cloudflared > /dev/null || brew install cloudflared

cp "$HERE/proxy.mjs" "$HERE/watchdog.sh" "$HOME_DIR/"
chmod 755 "$HOME_DIR/watchdog.sh"

# Secret key, made once and kept.
if [ ! -f "$HOME_DIR/key" ]; then
  openssl rand -hex 32 > "$HOME_DIR/key"
  chmod 600 "$HOME_DIR/key"
fi
KEY="$(cat "$HOME_DIR/key")"

OLLAMA_BIN="$(command -v ollama)"
NODE_BIN="$(command -v node)"
CLOUDFLARED_BIN="$(command -v cloudflared)"

plist() { # name, then program arguments, then optional extras on stdin
  local name="$1"; shift
  {
    echo '<?xml version="1.0" encoding="UTF-8"?>'
    echo '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">'
    echo '<plist version="1.0"><dict>'
    echo "<key>Label</key><string>com.fieldpro.$name</string>"
    echo '<key>ProgramArguments</key><array>'
    for a in "$@"; do echo "<string>$a</string>"; done
    echo '</array>'
    cat
    echo "<key>StandardOutPath</key><string>$HOME_DIR/$name.log</string>"
    echo "<key>StandardErrorPath</key><string>$HOME_DIR/$name.log</string>"
    echo '</dict></plist>'
  } > "$AGENTS/com.fieldpro.$name.plist"
}

plist ollama "$OLLAMA_BIN" serve <<EOT
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><true/>
<key>EnvironmentVariables</key><dict>
<key>OLLAMA_HOST</key><string>127.0.0.1:11434</string>
<key>OLLAMA_KEEP_ALIVE</key><string>-1</string>
<key>OLLAMA_NUM_PARALLEL</key><string>2</string>
</dict>
EOT

plist proxy "$NODE_BIN" "$HOME_DIR/proxy.mjs" <<EOT
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><true/>
<key>EnvironmentVariables</key><dict>
<key>HOME_AI_API_KEY</key><string>$KEY</string>
</dict>
EOT

plist caffeinate /usr/bin/caffeinate -s -i <<EOT
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><true/>
EOT

plist watchdog /bin/bash "$HOME_DIR/watchdog.sh" <<EOT
<key>RunAtLoad</key><true/>
<key>StartInterval</key><integer>60</integer>
EOT

# The public tunnel is added by tunnel-setup.sh, because it needs a browser sign-in once.
UID_NUM="$(id -u)"
for name in ollama proxy caffeinate watchdog; do
  launchctl bootout "gui/$UID_NUM/com.fieldpro.$name" 2> /dev/null || true
  launchctl bootstrap "gui/$UID_NUM" "$AGENTS/com.fieldpro.$name.plist"
done

echo "Waiting for ollama..."
for _ in $(seq 1 30); do curl -fsS -m 2 http://127.0.0.1:11434/api/version > /dev/null 2>&1 && break; sleep 1; done
echo "Downloading model $MODEL (this can take a while the first time)..."
"$OLLAMA_BIN" pull "$MODEL"
echo "$MODEL" > "$HOME_DIR/model"

echo
echo "Done. Local check:"
curl -fsS -m 60 http://127.0.0.1:11500/v1/chat/completions \
  -H "Authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d "{\"model\":\"$MODEL\",\"max_tokens\":20,\"messages\":[{\"role\":\"user\",\"content\":\"Say ready.\"}]}" || echo "Local check failed. See $HOME_DIR/*.log"
echo
echo "Next: run ./tunnel-setup.sh to give Render a web address for this server."
echo "Values for Render (API service environment):"
echo "  HOME_AI_API_KEY = $KEY"
echo "  HOME_AI_MODEL   = $MODEL"
