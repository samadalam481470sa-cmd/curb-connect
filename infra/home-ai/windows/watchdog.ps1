# Runs at sign-in and every minute. Starts or restarts ollama, the proxy and the tunnel when they
# do not answer. Logs problems to %USERPROFILE%\.fieldpro-home-ai\watchdog.log.
$Dir = Join-Path $env:USERPROFILE ".fieldpro-home-ai"
$Log = Join-Path $Dir "watchdog.log"
function Note($m) { Add-Content -Path $Log -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $m" }
function Up($url) { try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 $url | Out-Null; $true } catch { $false } }
$env:OLLAMA_KEEP_ALIVE = "-1"; $env:OLLAMA_HOST = "127.0.0.1:11434"

if (-not (Up "http://127.0.0.1:11434/api/version")) {
  Note "ollama not answering, starting"
  Get-Process ollama -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Process -WindowStyle Hidden -FilePath "ollama" -ArgumentList "serve" -RedirectStandardError (Join-Path $Dir "ollama.log")
  Start-Sleep -Seconds 5
}

if (-not (Up "http://127.0.0.1:11500/health")) {
  Note "proxy not answering, starting"
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like "*fieldpro-home-ai*proxy.mjs*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
  $env:HOME_AI_API_KEY = (Get-Content (Join-Path $Dir "key") -Raw).Trim()
  Start-Process -WindowStyle Hidden -FilePath "node" -ArgumentList "`"$Dir\proxy.mjs`"" -RedirectStandardOutput (Join-Path $Dir "proxy.log") -RedirectStandardError (Join-Path $Dir "proxy.err.log")
}

# The tunnel exists only after tunnel-setup.ps1 has written its config.
if (Test-Path (Join-Path $Dir "tunnel.yml")) {
  $running = Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" | Where-Object { $_.CommandLine -like "*fieldpro-home-ai*tunnel.yml*" }
  if (-not $running) {
    Note "tunnel not running, starting"
    Start-Process -WindowStyle Hidden -FilePath "cloudflared" -ArgumentList "tunnel --config `"$Dir\tunnel.yml`" run" -RedirectStandardError (Join-Path $Dir "tunnel.log")
  }
}

if ((Test-Path $Log) -and ((Get-Item $Log).Length -gt 1000000)) { Get-Content $Log -Tail 200 | Set-Content "$Log.tmp"; Move-Item -Force "$Log.tmp" $Log }
