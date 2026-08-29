$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

Write-Host ""
Write-Host "Parando containers da Ylume..." -ForegroundColor Yellow

docker compose stop

Write-Host ""
Write-Host "Containers parados sem apagar volumes." -ForegroundColor Green
Write-Host "Feche manualmente os terminais do FastAPI e do Vite se ainda estiverem abertos."
Write-Host ""
Write-Host "IMPORTANTE: este script NAO usa docker compose down -v."