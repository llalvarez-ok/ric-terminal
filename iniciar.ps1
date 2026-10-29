# Arranca los puentes de MetaTrader 5 y RIC Terminal, cada uno en su ventana.
# Uso: clic derecho > "Ejecutar con PowerShell", o desde PowerShell:
#   powershell -ExecutionPolicy Bypass -File .\iniciar.ps1

$ErrorActionPreference = "Stop"
$raiz = $PSScriptRoot

# Ruta del terminal64.exe de cada MT5. Si las tuyas son otras, cambialas acá
# (clic derecho en el acceso directo del MT5 > Abrir la ubicación del archivo).
$cuentas = @(
    @{ nombre = "exness";    puerto = 8701; terminal = "C:\Program Files\MetaTrader 5 EXNESS\terminal64.exe" },
    @{ nombre = "blackbull"; puerto = 8702; terminal = "C:\Program Files\BlackBull Markets MetaTrader 5\terminal64.exe" }
)

$envFile = Join-Path $raiz ".env.local"
if (-not (Test-Path $envFile)) {
    Write-Host "Falta .env.local: copiá .env.ejemplo como .env.local y completalo." -ForegroundColor Red
    exit 1
}
$token = ((Get-Content $envFile) | Where-Object { $_ -match '^RIC_BRIDGE_TOKEN=' }) -replace '^RIC_BRIDGE_TOKEN=', ''
if (-not $token -or $token.Length -lt 16) {
    Write-Host "RIC_BRIDGE_TOKEN en .env.local tiene que tener al menos 16 caracteres." -ForegroundColor Red
    exit 1
}

# Entorno de Python del puente: se crea la primera vez.
$python = Join-Path $raiz "bridge\.venv\Scripts\python.exe"
if (-not (Test-Path $python)) {
    Write-Host "Instalando el puente de Python (solo la primera vez)..."
    py -3 -m venv (Join-Path $raiz "bridge\.venv")
    & $python -m pip install --upgrade pip
    & $python -m pip install -r (Join-Path $raiz "bridge\requirements.txt")
}

$puente = Join-Path $raiz "bridge\ric_bridge.py"
foreach ($c in $cuentas) {
    if (-not (Test-Path $c.terminal)) {
        Write-Host "No encuentro el MT5 de $($c.nombre) en $($c.terminal). Corregí la ruta en iniciar.ps1." -ForegroundColor Yellow
        continue
    }
    $cmd = "`$host.UI.RawUI.WindowTitle = 'Puente $($c.nombre)'; `$env:RIC_BRIDGE_TOKEN = '$token'; " +
           "& '$python' '$puente' --cuenta $($c.nombre) --terminal '$($c.terminal)' --puerto $($c.puerto)"
    Start-Process powershell -ArgumentList "-NoExit", "-Command", $cmd
}

# La terminal: compila la primera vez y después arranca.
if (-not (Test-Path (Join-Path $raiz ".next\BUILD_ID"))) {
    Push-Location $raiz
    npm install
    npm run build
    Pop-Location
}
$cmd = "`$host.UI.RawUI.WindowTitle = 'RIC Terminal'; Set-Location '$raiz'; npm start"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $cmd
Start-Sleep -Seconds 6
Start-Process "http://localhost:3000"
