@echo off
title ML Logistics - Control de Statements y Estados de Cuenta
cd /d "%~dp0"
echo Iniciando servidor ML Logistics en http://127.0.0.1:8080 ...
start "" "http://127.0.0.1:8080"
python -m uvicorn app.server:app --host 127.0.0.1 --port 8080 --reload
