# Field Pro always-on AI server for Windows. Safe to run again.
# Run in PowerShell (not as administrator):
#   powershell -ExecutionPolicy Bypass -File .\install.ps1
#   $env:MODEL = "qwen2.5:7b-instruct"; powershell -ExecutionPolicy Bypass -File .\install.ps1   (smaller PC)
# Sets up: ollama (model server), the key-checking proxy, and a watchdog scheduled task that starts
# both at sign-in and restarts them within a minute if they stop answering.
$ErrorActionPreference = "Stop"
$Model = if ($env:MODEL) { $env:MODEL } else { "qwen2.5:14b-instruct" }
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Home_ = Join-Path $env:USERPROFILE ".fieldpro-home-ai"
New-Item -ItemType Directory -Force -Path $Home_ | Out-Null
# Only this user can read the folder (it holds the secret key).
icacls $Home_ /inheritance:r /grant:r "$($env:USERNAME):(OI)(CI)F" | Out-Null

function Need($cmd, $wingetId) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
    Write-Host "Installing $wingetId ..."
    winget install --id $wingetId -e --accept-source-agreements --accept-package-agreements
  }
}
if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { throw "winget is missing. Install App Installer from the Microsoft Store, then run this again." }
Need "node" "OpenJS.NodeJS.LTS"
Need "ollama" "Ollama.Ollama"
Need "cloudflared" "Cloudflare.cloudflared"
# winget changes PATH for new windows only; pick up the new entries here.
$env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")

Copy-Item "$Here\..\proxy.mjs" "$Home_\proxy.mjs" -Force
Copy-Item "$Here\watchdog.ps1" "$Home_\watchdog.ps1" -Force

$KeyFile = Join-Path $Home_ "key"
if (-not (Test-Path $KeyFile)) {
  $bytes = New-Object byte[] 32
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  ($bytes | ForEach-Object { $_.ToString("x2") }) -join "" | Set-Content -NoNewline $KeyFile
}
$Key = (Get-Content $KeyFile -Raw).Trim()
Set-Content -NoNewline -Path (Join-Path $Home_ "model") -Value $Model

# Keep the model loaded in memory.
[Environment]::SetEnvironmentVariable("OLLAMA_KEEP_ALIVE", "-1", "User")
[Environment]::SetEnvironmentVariable("OLLAMA_HOST", "127.0.0.1:11434", "User")
$env:OLLAMA_KEEP_ALIVE = "-1"; $env:OLLAMA_HOST = "127.0.0.1:11434"

# Watchdog task: at sign-in, then every minute.
$ps = (Get-Command powershell.exe).Source
$action = New-ScheduledTaskAction -Execute $ps -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Home_\watchdog.ps1`""
$t1 = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$t2 = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
Register-ScheduledTask -TaskName "FieldPro-HomeAI-Watchdog" -Action $action -Trigger @($t1, $t2) -Settings $settings -Description "Keeps the Field Pro home AI server running" -Force | Out-Null
Start-ScheduledTask -TaskName "FieldPro-HomeAI-Watchdog"

Write-Host "Waiting for ollama ..."
for ($i = 0; $i -lt 40; $i++) {
  try { Invoke-RestMethod -TimeoutSec 2 http://127.0.0.1:11434/api/version | Out-Null; break } catch { Start-Sleep -Seconds 1 }
}
Write-Host "Downloading model $Model (this can take a while the first time) ..."
ollama pull $Model

Write-Host ""
Write-Host "Local check:"
try {
  $body = @{ model = $Model; max_tokens = 20; messages = @(@{ role = "user"; content = "Say ready." }) } | ConvertTo-Json -Depth 5
  $r = Invoke-RestMethod -TimeoutSec 90 -Method Post -Uri http://127.0.0.1:11500/v1/chat/completions -Headers @{ Authorization = "Bearer $Key" } -ContentType "application/json" -Body $body
  Write-Host $r.choices[0].message.content
} catch { Write-Host "Local check failed. See $Home_\*.log" }

Write-Host ""
Write-Host "Next: run tunnel-setup.ps1 to give Render a web address for this server."
Write-Host "Values for Render (API service environment):"
Write-Host "  HOME_AI_API_KEY = $Key"
Write-Host "  HOME_AI_MODEL   = $Model"
Write-Host ""
Write-Host "To stop the PC sleeping while plugged in, see the Sleep section of README.md."
