# Gives the Windows server a fixed web address through a Cloudflare tunnel, so the Field Pro API on
# Render can reach it. Needs a free Cloudflare account and a domain on it. Run after install.ps1.
#   $env:HOSTNAME_FOR_AI = "ai.yourdomain.com"; powershell -ExecutionPolicy Bypass -File .\tunnel-setup.ps1
$ErrorActionPreference = "Stop"
if (-not $env:HOSTNAME_FOR_AI) { throw 'Set HOSTNAME_FOR_AI first, for example $env:HOSTNAME_FOR_AI = "ai.yourdomain.com"' }
$Dir = Join-Path $env:USERPROFILE ".fieldpro-home-ai"
$Name = "fieldpro-home-ai"
$env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")

if (-not (Test-Path (Join-Path $env:USERPROFILE ".cloudflared\cert.pem"))) { cloudflared tunnel login }
$list = (cloudflared tunnel list 2>$null) -join "`n"
if ($list -notmatch " $Name ") { cloudflared tunnel create $Name }
cloudflared tunnel route dns -f $Name $env:HOSTNAME_FOR_AI
$line = ((cloudflared tunnel list 2>$null) | Where-Object { $_ -match " $Name " } | Select-Object -First 1)
$Id = ($line -split "\s+")[0]

@"
tunnel: $Id
credentials-file: $($env:USERPROFILE)\.cloudflared\$Id.json
ingress:
  - hostname: $($env:HOSTNAME_FOR_AI)
    service: http://127.0.0.1:11500
  - service: http_status:404
"@ | Set-Content -Path (Join-Path $Dir "tunnel.yml")

Start-ScheduledTask -TaskName "FieldPro-HomeAI-Watchdog"
Write-Host ""
Write-Host "Tunnel starting. Put these in the Render API service environment:"
Write-Host "  HOME_AI_BASE_URL = https://$($env:HOSTNAME_FOR_AI)/v1"
Write-Host "  HOME_AI_API_KEY  = $((Get-Content (Join-Path $Dir 'key') -Raw).Trim())"
Write-Host "  HOME_AI_MODEL    = $((Get-Content (Join-Path $Dir 'model') -Raw).Trim())"
