#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Desbloqueia e instala o Alinhafood Print Agent no Windows.

.DESCRIPTION
    Este script resolve o problema do Windows SmartScreen / Smart App Control
    bloqueando o instalador do Alinhafood Print Agent.

    Ele executa as seguintes acoes:
    1. Remove a marca de "arquivo da internet" (Zone.Identifier) do instalador
    2. Adiciona o diretorio de instalacao como exclusao no Windows Defender
    3. Executa o instalador

.NOTES
    Execute como Administrador:
    - Clique direito no arquivo -> "Executar com PowerShell"
    - Ou abra PowerShell como Admin e rode: .\desbloquear-e-instalar.ps1
#>

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = "Continue"

Write-Host ""
Write-Host "╔══════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║   Alinhafood Print Agent - Instalador Assistido     ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# --- Verifica privilegios de administrador ---
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "[!] Este script precisa ser executado como Administrador." -ForegroundColor Red
    Write-Host "    Clique direito -> 'Executar como administrador'" -ForegroundColor Yellow
    Write-Host ""
    Read-Host "Pressione Enter para sair"
    exit 1
}

# --- Localiza o instalador ---
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$releaseDir = Join-Path $scriptDir "release"

$installerPath = $null
$searchPaths = @(
    (Join-Path $releaseDir "AlinhafoodPrintAgent-Setup-1.0.0.exe"),
    (Join-Path $releaseDir "Alinhafood Print Agent-Setup-1.0.0.exe"),
    (Join-Path $scriptDir "AlinhafoodPrintAgent-Setup-1.0.0.exe"),
    (Join-Path $scriptDir "Alinhafood Print Agent-Setup-1.0.0.exe")
)

foreach ($path in $searchPaths) {
    if (Test-Path $path) {
        $installerPath = $path
        break
    }
}

# Busca por qualquer .exe de setup na pasta
if (-not $installerPath) {
    $found = Get-ChildItem -Path $scriptDir, $releaseDir -Filter "*Setup*.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found) { $installerPath = $found.FullName }
}

if (-not $installerPath) {
    Write-Host "[ERRO] Instalador nao encontrado!" -ForegroundColor Red
    Write-Host "       Coloque o arquivo .exe na pasta 'release' ou na mesma pasta deste script." -ForegroundColor Yellow
    Write-Host ""
    Read-Host "Pressione Enter para sair"
    exit 1
}

Write-Host "Instalador encontrado: $installerPath" -ForegroundColor Green
Write-Host ""

# --- Passo 1: Remove Zone Identifier (marca de internet) ---
Write-Host "[1/4] Removendo marca de 'arquivo da internet'..." -ForegroundColor White
try {
    Unblock-File -Path $installerPath -ErrorAction Stop
    Write-Host "      [OK] Arquivo desbloqueado." -ForegroundColor Green

    # Desbloqueia tambem todos os .exe na pasta release
    if (Test-Path $releaseDir) {
        Get-ChildItem -Path $releaseDir -Filter "*.exe" | ForEach-Object {
            Unblock-File -Path $_.FullName -ErrorAction SilentlyContinue
        }
        Write-Host "      [OK] Todos os executaveis na pasta release foram desbloqueados." -ForegroundColor Green
    }
} catch {
    Write-Host "      [AVISO] Nao foi possivel desbloquear: $_" -ForegroundColor Yellow
}
Write-Host ""

# --- Passo 2: Exclusao no Windows Defender ---
Write-Host "[2/4] Adicionando exclusoes no Windows Defender..." -ForegroundColor White
$exclusionPaths = @(
    "$env:ProgramFiles\Alinhafood Print Agent",
    "${env:ProgramFiles(x86)}\Alinhafood Print Agent",
    "$env:LocalAppData\Programs\Alinhafood Print Agent",
    $installerPath
)

foreach ($exPath in $exclusionPaths) {
    try {
        Add-MpPreference -ExclusionPath $exPath -ErrorAction Stop
        Write-Host "      [OK] Exclusao adicionada: $exPath" -ForegroundColor Green
    } catch {
        Write-Host "      [AVISO] Nao foi possivel adicionar exclusao para: $exPath" -ForegroundColor Yellow
    }
}

# Adiciona exclusao por nome do processo
try {
    Add-MpPreference -ExclusionProcess "Alinhafood Print Agent.exe" -ErrorAction Stop
    Write-Host "      [OK] Processo excluido do Defender." -ForegroundColor Green
} catch {
    Write-Host "      [AVISO] Nao foi possivel excluir o processo." -ForegroundColor Yellow
}
Write-Host ""

# --- Passo 3: Verifica Smart App Control ---
Write-Host "[3/4] Verificando Smart App Control..." -ForegroundColor White
try {
    $sacKey = "HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy"
    if (Test-Path $sacKey) {
        $verifiedAndReputable = (Get-ItemProperty -Path $sacKey -Name "VerifiedAndReputablePolicyState" -ErrorAction SilentlyContinue).VerifiedAndReputablePolicyState
        if ($verifiedAndReputable -eq 1) {
            Write-Host "      [AVISO] Smart App Control esta ATIVADO no modo 'Imposicao'." -ForegroundColor Yellow
            Write-Host "      Isso pode impedir a execucao de aplicativos nao assinados." -ForegroundColor Yellow
            Write-Host ""
            Write-Host "      Para desativar:" -ForegroundColor Cyan
            Write-Host "      Configuracoes > Privacidade e seguranca > Seguranca do Windows" -ForegroundColor Cyan
            Write-Host "      > Controle de aplicativos e navegador > Smart App Control" -ForegroundColor Cyan
            Write-Host "      > Mudar para 'Desativado'" -ForegroundColor Cyan
            Write-Host ""
            Write-Host "      IMPORTANTE: Desativar o Smart App Control nao pode ser revertido" -ForegroundColor Red
            Write-Host "      sem reinstalar o Windows." -ForegroundColor Red
            Write-Host ""
            $continueInstall = Read-Host "Deseja continuar a instalacao mesmo assim? (S/N)"
            if ($continueInstall -ne "S" -and $continueInstall -ne "s") {
                Write-Host "Instalacao cancelada." -ForegroundColor Yellow
                Read-Host "Pressione Enter para sair"
                exit 0
            }
        } elseif ($verifiedAndReputable -eq 2) {
            Write-Host "      [INFO] Smart App Control esta no modo 'Avaliacao'." -ForegroundColor Yellow
            Write-Host "      O instalador pode ser bloqueado. Se isso acontecer, desative o SAC." -ForegroundColor Yellow
        } else {
            Write-Host "      [OK] Smart App Control esta desativado." -ForegroundColor Green
        }
    } else {
        Write-Host "      [OK] Smart App Control nao detectado nesta versao do Windows." -ForegroundColor Green
    }
} catch {
    Write-Host "      [INFO] Nao foi possivel verificar o Smart App Control." -ForegroundColor Yellow
}
Write-Host ""

# --- Passo 4: Executa o instalador ---
Write-Host "[4/4] Iniciando o instalador..." -ForegroundColor White
Write-Host ""
Write-Host "╔══════════════════════════════════════════════════════╗" -ForegroundColor Yellow
Write-Host "║  Se aparecer um aviso do Windows SmartScreen:       ║" -ForegroundColor Yellow
Write-Host "║  1. Clique em 'Mais informacoes'                   ║" -ForegroundColor Yellow
Write-Host "║  2. Clique em 'Executar assim mesmo'               ║" -ForegroundColor Yellow
Write-Host "╚══════════════════════════════════════════════════════╝" -ForegroundColor Yellow
Write-Host ""

try {
    Start-Process -FilePath $installerPath -Wait
    Write-Host ""
    Write-Host "[OK] Instalacao concluida!" -ForegroundColor Green
} catch {
    Write-Host "[ERRO] Falha ao iniciar o instalador: $_" -ForegroundColor Red
    Write-Host ""
    Write-Host "Tente executar o instalador manualmente:" -ForegroundColor Yellow
    Write-Host "  $installerPath" -ForegroundColor Cyan
}

Write-Host ""
Read-Host "Pressione Enter para sair"
