@echo off
chcp 65001 >nul 2>&1
title Alinhafood Print Agent - Instalador Assistido

echo.
echo ╔══════════════════════════════════════════════════════╗
echo ║   Alinhafood Print Agent - Instalador Assistido     ║
echo ╚══════════════════════════════════════════════════════╝
echo.

:: Verifica se está executando como administrador
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [!] Este script precisa ser executado como Administrador.
    echo     Clique com o botao direito e selecione "Executar como administrador".
    echo.
    pause
    exit /b 1
)

:: Caminho do instalador (mesmo diretorio deste script)
set "INSTALLER_DIR=%~dp0release"
set "INSTALLER_NAME=AlinhafoodPrintAgent-Setup-1.0.0.exe"
set "INSTALLER_PATH=%INSTALLER_DIR%\%INSTALLER_NAME%"

:: Tenta encontrar o instalador
if not exist "%INSTALLER_PATH%" (
    :: Tenta nome alternativo
    set "INSTALLER_NAME=Alinhafood Print Agent-Setup-1.0.0.exe"
    set "INSTALLER_PATH=%INSTALLER_DIR%\!INSTALLER_NAME!"
)

if not exist "%INSTALLER_PATH%" (
    :: Tenta na mesma pasta do script
    for %%f in ("%~dp0AlinhafoodPrintAgent-Setup*.exe" "%~dp0Alinhafood Print Agent-Setup*.exe") do (
        if exist "%%f" set "INSTALLER_PATH=%%f"
    )
)

if not exist "%INSTALLER_PATH%" (
    echo [ERRO] Instalador nao encontrado.
    echo        Certifique-se de que o arquivo .exe do instalador esta na pasta "release"
    echo        ou na mesma pasta deste script.
    echo.
    pause
    exit /b 1
)

echo [1/3] Desbloqueando arquivo do instalador...
echo       Isso remove a marca de "arquivo baixado da internet"
echo.
powershell -Command "Unblock-File -Path '%INSTALLER_PATH%'" 2>nul
if %errorlevel% equ 0 (
    echo       [OK] Arquivo desbloqueado com sucesso.
) else (
    echo       [AVISO] Nao foi possivel desbloquear automaticamente.
    echo               Isso nao impede a instalacao.
)
echo.

echo [2/3] Adicionando exclusao no Windows Defender...
echo       Isso impede que o antivirus bloqueie o agente de impressao.
echo.
powershell -Command "Add-MpPreference -ExclusionPath '%ProgramFiles%\Alinhafood Print Agent'" 2>nul
powershell -Command "Add-MpPreference -ExclusionPath '%INSTALLER_PATH%'" 2>nul
if %errorlevel% equ 0 (
    echo       [OK] Exclusao adicionada com sucesso.
) else (
    echo       [AVISO] Nao foi possivel adicionar a exclusao.
    echo               Se o app for bloqueado, adicione manualmente.
)
echo.

echo [3/3] Iniciando instalacao...
echo.
echo ────────────────────────────────────────────────────────
echo   Se aparecer um aviso do Windows SmartScreen:
echo   1. Clique em "Mais informacoes"
echo   2. Clique em "Executar assim mesmo"
echo ────────────────────────────────────────────────────────
echo.

start "" "%INSTALLER_PATH%"

echo.
echo Instalador iniciado. Este script pode ser fechado.
echo.
pause
