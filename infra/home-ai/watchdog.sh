#!/bin/bash
# Runs every minute from launchd. If the model server or the proxy does not answer, restart it.
# Writes one line per problem to ~/.fieldpro-home-ai/watchdog.log.
LOG="$HOME/.fieldpro-home-ai/watchdog.log"
UID_NUM="$(id -u)"
restart() {
  echo "$(date '+%F %T') $1 not answering, restarting" >> "$LOG"
  launchctl kickstart -k "gui/${UID_NUM}/com.fieldpro.$1" >> "$LOG" 2>&1
}
curl -fsS -m 5 http://127.0.0.1:11434/api/version > /dev/null 2>&1 || restart ollama
curl -fsS -m 5 http://127.0.0.1:11500/health > /dev/null 2>&1 || restart proxy
# Keep the log small.
[ -f "$LOG" ] && [ "$(wc -c < "$LOG")" -gt 1000000 ] && tail -n 200 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
exit 0
