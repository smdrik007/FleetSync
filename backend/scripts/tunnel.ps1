# Opens a free Cloudflare quick tunnel to the local backend so phones on any network can reach it.
# Run the backend first (npm start). The https://....trycloudflare.com address printed below changes on every
# run: paste it into the app (login screen -> Server -> Change). Stop the tunnel with Ctrl+C.
# Install once with: winget install Cloudflare.cloudflared
$exe = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
if (-not $exe) { $exe = 'C:\Program Files (x86)\cloudflared\cloudflared.exe' }
if (-not (Test-Path $exe)) { Write-Error 'cloudflared not found. Install it: winget install Cloudflare.cloudflared'; exit 1 }
$port = if ($env:PORT) { $env:PORT } else { '3000' }
& $exe tunnel --url "http://localhost:$port" --no-autoupdate
