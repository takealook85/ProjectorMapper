@echo off
title Projection Mapper
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo Node.js non trovato. Installalo da https://nodejs.org e riprova.
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo Installazione dipendenze in corso...
    call npm install
    if errorlevel 1 (
        echo Installazione non riuscita.
        pause
        exit /b 1
    )
)

echo Avvio di Projection Mapper: gli indirizzi (locale e di rete) compaiono qui sotto.
echo Chiudi questa finestra o premi Ctrl+C per fermare il server.
call npm run dev

pause
