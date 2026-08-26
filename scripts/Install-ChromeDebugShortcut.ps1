# Makes your everyday Chrome launch with CDP port 9222 (Seller Hub scripts work without npm run chrome:cdp).
# Does NOT use a separate profile - bookmarks and extensions stay as they are.
#
# Run once (PowerShell):
#   powershell -ExecutionPolicy Bypass -File scripts/Install-ChromeDebugShortcut.ps1
#
# Undo: run with -Remove

param(
  [switch]$Remove
)

$ErrorActionPreference = 'Stop'
$DebugFlag = '--remote-debugging-port=9222'
$HubProfileDir = Join-Path $env:LOCALAPPDATA 'inventory-pro-chrome-hub'
$ProfileFlags = "--user-data-dir=`"$HubProfileDir`" --profile-directory=Default"
$Port = 9222

function Find-ChromeExe {
  $candidates = @(
    ($env:ProgramFiles + '\Google\Chrome\Application\chrome.exe'),
    ($env:ProgramFiles + ' (x86)\Google\Chrome\Application\chrome.exe'),
    ($env:LOCALAPPDATA + '\Google\Chrome\Application\chrome.exe')
  )
  foreach ($p in $candidates) {
    if (Test-Path $p) { return $p }
  }
  return $null
}

function Get-ShortcutPaths {
  $paths = @()
  $desktop = [Environment]::GetFolderPath('Desktop')
  $pubDesktop = [Environment]::GetFolderPath('CommonDesktopDirectory')
  $startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
  $pubStart = Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs'

  foreach ($root in @($desktop, $pubDesktop, $startMenu, $pubStart)) {
    if (-not (Test-Path $root)) { continue }
    Get-ChildItem -Path $root -Filter '*Chrome*.lnk' -Recurse -ErrorAction SilentlyContinue |
      ForEach-Object { $paths += $_.FullName }
  }

  $appLinks = Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar'
  if (Test-Path $appLinks) {
    Get-ChildItem -Path $appLinks -Filter '*Chrome*.lnk' -ErrorAction SilentlyContinue |
      ForEach-Object { $paths += $_.FullName }
  }

  return $paths | Select-Object -Unique
}

function Read-ShortcutTarget($lnkPath) {
  $shell = New-Object -ComObject WScript.Shell
  $sc = $shell.CreateShortcut($lnkPath)
  return [PSCustomObject]@{
    Target = $sc.TargetPath
    Args   = $sc.Arguments
    Work   = $sc.WorkingDirectory
    Icon   = $sc.IconLocation
  }
}

function Write-Shortcut($lnkPath, $target, $shortcutArgs, $workDir, $icon) {
  $dir = Split-Path $lnkPath -Parent
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  $shell = New-Object -ComObject WScript.Shell
  $sc = $shell.CreateShortcut($lnkPath)
  $sc.TargetPath = $target
  $sc.Arguments = $shortcutArgs
  if ($workDir) { $sc.WorkingDirectory = $workDir }
  if ($icon) { $sc.IconLocation = $icon }
  $sc.Description = 'Google Chrome (Seller Hub debug port 9222)'
  $sc.Save()
}

function Strip-DebugFlag([string]$shortcutArgs) {
  if (-not $shortcutArgs) { return '' }
  $parts = $shortcutArgs -split '\s+' | Where-Object {
    $_ -and $_ -notmatch '^--remote-debugging-port(=\d+)?$'
  }
  return ($parts -join ' ').Trim()
}

function Add-DebugFlag([string]$shortcutArgs) {
  $clean = Strip-DebugFlag $shortcutArgs
  $flags = "$DebugFlag $ProfileFlags"
  if ($clean) { return ($clean + ' ' + $flags) }
  return $flags
}

$chrome = Find-ChromeExe
if (-not $chrome) {
  Write-Host 'Google Chrome not found. Install Chrome first.' -ForegroundColor Red
  exit 1
}

Write-Host ''
Write-Host 'Inventory Pro - Chrome always-on debug (port 9222)' -ForegroundColor Cyan
Write-Host "Chrome: $chrome" -ForegroundColor DarkGray
Write-Host ''

$shortcuts = Get-ShortcutPaths
$updated = 0
$skipped = 0

foreach ($lnk in $shortcuts) {
  try {
    $info = Read-ShortcutTarget $lnk
    if ($info.Target -notmatch 'chrome\.exe$') { continue }

    if ($Remove) {
      $newArgs = Strip-DebugFlag $info.Args
      if ($newArgs -eq $info.Args) {
        $skipped++
        continue
      }
      Write-Shortcut $lnk $info.Target $newArgs $info.Work $info.Icon
      Write-Host "Removed debug flag: $lnk" -ForegroundColor Yellow
      $updated++
      continue
    }

    if ($info.Args -match '--remote-debugging-port') {
      Write-Host "Already set: $lnk" -ForegroundColor DarkGray
      $skipped++
      continue
    }

    $newArgs = Add-DebugFlag $info.Args
    Write-Shortcut $lnk $info.Target $newArgs $info.Work $info.Icon
    Write-Host "Updated: $lnk" -ForegroundColor Green
    $updated++
  } catch {
    Write-Host "Skip $lnk - $($_.Exception.Message)" -ForegroundColor DarkYellow
  }
}

$desktop = [Environment]::GetFolderPath('Desktop')
$hubLnk = Join-Path $desktop 'Google Chrome.lnk'
$hubLnkAlt = Join-Path $desktop 'Google Chrome (Hub).lnk'

if (-not $Remove) {
  $work = Split-Path $chrome -Parent
  $icon = "$chrome,0"
  if (-not (Test-Path $hubLnk)) {
    Write-Shortcut $hubLnkAlt $chrome (Add-DebugFlag '') $work $icon
    Write-Host "Created: $hubLnkAlt" -ForegroundColor Green
    $updated++
  }

  $projectRoot = Split-Path $PSScriptRoot -Parent
  $launcherVbs = Join-Path $projectRoot 'Start-InventoryPro.vbs'
  $appLnk = Join-Path $desktop 'Inventory Pro.lnk'
  if ((Test-Path $launcherVbs) -and -not (Test-Path $appLnk)) {
    $wsh = New-Object -ComObject WScript.Shell
    $sc = $wsh.CreateShortcut($appLnk)
    $sc.TargetPath = $launcherVbs
    $sc.WorkingDirectory = $projectRoot
    $sc.Description = 'Inventory Pro — Chrome + app + eBay Hub sync'
    $sc.IconLocation = "$chrome,0"
    $sc.Save()
    Write-Host "Created: $appLnk" -ForegroundColor Green
    $updated++
  }
}

Write-Host ''
if ($Remove) {
  Write-Host "Removed debug flag from $updated shortcut(s). Restart Chrome." -ForegroundColor Yellow
} elseif ($updated -eq 0) {
  Write-Host 'No shortcuts updated (may already be configured).' -ForegroundColor Yellow
  Write-Host ''
  Write-Host 'Manual fix: Right-click Chrome, Properties, Target, append:' -ForegroundColor White
  Write-Host "  $DebugFlag" -ForegroundColor Cyan
} else {
  Write-Host "Updated $updated shortcut(s). $skipped already OK." -ForegroundColor Green
  Write-Host ''
  Write-Host 'Next steps:' -ForegroundColor White
  Write-Host '  Double-click "Inventory Pro" on your Desktop (starts Chrome + app + Hub sync).' -ForegroundColor White
  Write-Host '  Or use your patched Chrome shortcut, then open the panel in the browser.' -ForegroundColor White
}
Write-Host ''
