# Always-on home AI server for Field Pro

This runs an AI model on your Mac. The Field Pro API on Render sends questions to it, and
"Ask Field Pro" in the app shows the answers. If the Mac is off, the app uses the backup model
(`OPEN_MODEL_*`) when one is set, and says so plainly when none is.

## What you need

- A Mac with Apple silicon. 16 GB of memory runs the 7B model. 32 GB or more runs the 14B model.
- Homebrew (https://brew.sh).
- A free Cloudflare account with one domain on it, for the web address.
- The Mac plugged in. `caffeinate -s` only blocks sleep on power.

## Set up

1. `cd infra/home-ai`
2. `./install.sh` (16 GB Mac: `MODEL=qwen2.5:7b-instruct ./install.sh`)
3. `HOSTNAME_FOR_AI=ai.yourdomain.com ./tunnel-setup.sh`
4. In the Render dashboard, open the `curb-connect-api` service, Environment, and add the three
   values the script printed: `HOME_AI_BASE_URL`, `HOME_AI_API_KEY`, `HOME_AI_MODEL`.
5. Open Field Pro, then Search, then "Ask Field Pro". The status line should say the home server is
   online.

## What keeps it on

- `ollama`, the key-checking `proxy`, `caffeinate` and the `tunnel` are launchd jobs. They start at
  login and restart after a crash.
- `watchdog` runs every minute and restarts ollama or the proxy if they stop answering.
- Logs are in `~/.fieldpro-home-ai/`.

## Limits to know

- A closed lid sleeps the Mac unless an external display, power and an external keyboard or mouse
  are attached.
- After a restart, FileVault asks for your password before anything starts. Log in once.
- macOS gives the GPU about two thirds of memory. A model larger than that runs slowly.
- The Mac is the single point of failure. When it is off, only the backup model answers.
- No model answers every question correctly. The assistant is told to say when it does not know
  and to send safety, structural, electrical, gas and permit questions to licensed professionals.

## Security

- The model server listens on `127.0.0.1` only. Only the proxy is reached through the tunnel.
- The proxy requires the secret key and forwards only the chat, completion, embedding and model
  list routes. Model management stays on the Mac.
- The key lives in `~/.fieldpro-home-ai/key` (owner-only). Never commit it.
- To change the key, delete that file, run `./install.sh` again, and update Render.

## Check it by hand

```sh
curl -s http://127.0.0.1:11500/health
curl -s https://ai.yourdomain.com/v1/models -H "Authorization: Bearer $(cat ~/.fieldpro-home-ai/key)"
node --test infra/home-ai/proxy.test.mjs
```

## Remove it

```sh
for n in ollama proxy caffeinate watchdog tunnel; do
  launchctl bootout gui/$(id -u)/com.fieldpro.$n
  rm ~/Library/LaunchAgents/com.fieldpro.$n.plist
done
```

## Windows PC version

The `windows/` folder does the same job on a Windows 10 or 11 PC. It uses winget to install Node,
Ollama and cloudflared, and one scheduled task, `FieldPro-HomeAI-Watchdog`, that starts everything
at sign-in and restarts anything that stops answering, checked every minute. It was written
without a Windows machine to test on, so run it once and read the output.

1. Open PowerShell in `infra\home-ai\windows`.
2. `powershell -ExecutionPolicy Bypass -File .\install.ps1`
   (smaller PC: `$env:MODEL = "qwen2.5:7b-instruct"` first).
3. `$env:HOSTNAME_FOR_AI = "ai.yourdomain.com"; powershell -ExecutionPolicy Bypass -File .\tunnel-setup.ps1`
4. Put the three printed values into the Render `curb-connect-api` environment.

Sleep: in Settings, System, Power, set "Screen and sleep" to Never while plugged in. Without that
the PC sleeps and the server goes offline. The key is in `%USERPROFILE%\.fieldpro-home-ai\key`.
Remove it with `Unregister-ScheduledTask -TaskName FieldPro-HomeAI-Watchdog -Confirm:$false`.
