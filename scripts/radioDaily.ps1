# Daily run of the radio recording (scripts/radioGemini.py), for Windows Task Scheduler.
#
# Registered as the task "RL Arena radio voices", every day at 13:00: Gemini's
# free daily quota resets at midnight in California (10:00 in Israel), so by
# then a fresh day of requests is waiting. Each run records until the API
# refuses for the day, and picks up where the last one stopped. When every
# voice is recorded the task removes itself.
#
# Log: node_modules/.cache/radioDaily.log

$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo
$log = Join-Path $repo 'node_modules/.cache/radioDaily.log'
New-Item -ItemType Directory -Force (Split-Path $log) | Out-Null

function Write-Log($text) {
  Add-Content -Path $log -Value ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $text) -Encoding utf8
}

# ffmpeg cuts the clips to MP3; make sure the task finds it even without the user's shell profile.
$ffmpeg = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Recurse -Filter ffmpeg.exe -ErrorAction SilentlyContinue | Select-Object -First 1
if ($ffmpeg) { $env:PATH = "$($ffmpeg.DirectoryName);$env:PATH" }

$python = "$env:LOCALAPPDATA\Programs\Python\Python311\python.exe"
if (-not (Test-Path $python)) { $python = (Get-Command python).Source }

Write-Log 'start'
& npx tsx scripts/radioLines.ts 2>&1 | Out-File -Append -Encoding utf8 $log
& $python scripts/radioGemini.py 2>&1 | Out-File -Append -Encoding utf8 $log
$code = $LASTEXITCODE
Write-Log "radioGemini exit $code"

if ($code -eq 0) {
  # Everything is recorded: nothing left for tomorrow.
  Unregister-ScheduledTask -TaskName 'RL Arena radio voices' -Confirm:$false -ErrorAction SilentlyContinue
  Write-Log 'all voices recorded - task removed'
}
