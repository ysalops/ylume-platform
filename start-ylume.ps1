$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$Backend = Join-Path $Root "backend"
$Frontend = Join-Path $Root "frontend"

Write-Host ""
Write-Host "Ylume - iniciando ambiente local..." -ForegroundColor Magenta
Write-Host ""

try {
    docker info *> $null
}
catch {
    Write-Host "Docker Desktop nao esta pronto." -ForegroundColor Yellow
    Write-Host "Abra o Docker Desktop, espere o engine iniciar e rode este script novamente."
    exit 1
}

Set-Location $Root
docker compose up -d

Write-Host ""
docker compose ps

$OllamaOnline = Test-NetConnection localhost -Port 11434 -InformationLevel Quiet

if (-not $OllamaOnline) {
    Write-Host ""
    Write-Host "Ollama nao respondeu na porta 11434. Tentando iniciar..." -ForegroundColor Yellow

    Start-Process powershell -ArgumentList @(
        "-NoExit",
        "-Command",
        "ollama serve"
    )

    Start-Sleep -Seconds 3
}

$BackendCommand = @"
Set-Location '$Backend'
Set-ExecutionPolicy -Scope Process -ExecutionPolicy RemoteSigned -Force
& '.\.venv\Scripts\Activate.ps1'
python -m uvicorn main:app --host 127.0.0.1 --port 8001
"@

Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-Command",
    $BackendCommand
)

$FrontendCommand = @"
Set-Location '$Frontend'
npm run dev
"@

Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-Command",
    $FrontendCommand
)

Write-Host ""
Write-Host "Servicos iniciados." -ForegroundColor Green
Write-Host "FastAPI:  http://127.0.0.1:8001/health"
Write-Host "n8n:      http://localhost:5678"
Write-Host "Frontend: http://localhost:5173"
Write-Host ""

Start-Sleep -Seconds 4
Start-Process "http://localhost:5173"