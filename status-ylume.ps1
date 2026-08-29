$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

Write-Host ""
Write-Host "YLUME - STATUS LOCAL" -ForegroundColor Magenta
Write-Host ""

Write-Host "Docker Compose:" -ForegroundColor Cyan
docker compose ps

Write-Host ""
Write-Host "Portas:" -ForegroundColor Cyan

$Ports = @(
    @{ Name = "Frontend"; Port = 5173 },
    @{ Name = "FastAPI"; Port = 8001 },
    @{ Name = "n8n"; Port = 5678 },
    @{ Name = "PostgreSQL"; Port = 5433 },
    @{ Name = "Ollama"; Port = 11434 }
)

foreach ($Item in $Ports) {
    $Online = Test-NetConnection localhost -Port $Item.Port -InformationLevel Quiet
    $Status = if ($Online) { "OK" } else { "OFF" }

    Write-Host (
        "{0,-12} {1,-5} porta {2}" -f
        $Item.Name,
        $Status,
        $Item.Port
    )
}