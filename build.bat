@echo off
echo ============================================
echo  Alinhafood Print Agent - Gerar Instalador
echo ============================================
echo.

echo [1/3] Atualizando repositorio...
git pull
if %errorlevel% neq 0 (
  echo ERRO: falha no git pull
  pause
  exit /b 1
)

echo.
echo [2/3] Instalando dependencias...
npm install
if %errorlevel% neq 0 (
  echo ERRO: falha no npm install
  pause
  exit /b 1
)

echo.
echo [3/3] Gerando instalador...
npm run dist
if %errorlevel% neq 0 (
  echo ERRO: falha ao gerar instalador
  pause
  exit /b 1
)

echo.
echo ============================================
echo  Instalador gerado em: release\
echo  Arquivo: AlinhafoodPrintAgent-Setup-1.0.0.exe
echo ============================================
pause
