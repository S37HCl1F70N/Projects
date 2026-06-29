@echo off
cd /d "%~dp0"
start "" powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File ".\Penny_For_Your_Time.ps1"
