#Requires -Version 5.1
<#
    Habit Maker - installer
    -----------------------
    Double-click Install.bat in the folder above instead of running this by hand.

        tools\install.ps1                  normal
        tools\install.ps1 -NonInteractive  answers yes to everything

    A full record of the run is written to install.log in the project folder.
#>
[CmdletBinding()]
param([switch]$NonInteractive)

# ============================================================================
#  CONFIG - what this project needs
#
#  Habit Maker deliberately has no runtime dependencies: the server is Python
#  standard library only.  So this installer mostly *checks* rather than
#  installs - and then proves the whole thing works end to end.
# ============================================================================

$App = @{
    Name          = 'Habit Maker'
    Blurb         = 'A local-first habit tracker and PDF reader. Your data never leaves this PC.'
    Repo          = 'https://github.com/semyonsw/habbit_maker.git'
    Issues        = 'https://github.com/semyonsw/habbit_maker/issues'
    WindowsOnly   = $false

    MinPython     = '3.10'
    Venv          = $null          # stdlib only - nothing to install, nothing to isolate
    Requirements  = $null
    VerifyImports = @('sqlite3', 'http.server', 'json', 'urllib.request')

    MinNode       = $null          # only the optional developer tools need Node
    NpmDirs       = @()
    EnvKeys       = @()

    ExtraSteps = @(
        @{ Title  = 'Proving the app actually runs on this PC'
           Action = {
               param($PyExe)
               Info 'starting the server on a spare port against a throwaway database...'
               $r = Run -Exe $PyExe -Arguments @((Join-Path $Root 'tools\selfcheck.py'))
               foreach ($line in ($r.Output -split "`n")) {
                   $t = $line.Trim()
                   if ($t -match '^PASS (.+)$') { OK $Matches[1] }
                   elseif ($t -match '^FAIL (.+)$') { Warn $Matches[1] }
               }
               if ($r.Code -ne 0) {
                   Stop-Install 'the app did not pass its own self-check on this PC.' @(
                       'The FAIL lines above say what broke. The full output is at the end of install.log.',
                       'Most common cause: an incomplete download - re-clone the project and try again.')
               }
           } },

        @{ Title  = 'Checking that port 3000 is free'
           Action = {
               param($PyExe)
               $busy = $false
               try {
                   $busy = [bool](Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue)
               } catch {
                   $r = Run -Exe 'netstat' -Arguments @('-ano')
                   $busy = ($r.Output -match ':3000\s+.*LISTENING')
               }
               if ($busy) {
                   Warn 'something is already listening on port 3000.' `
                        'Habit Maker will not start until that stops. Either close it, or start the app with a different port:  set HABIT_PORT=4000 before launching.'
               } else {
                   OK 'port 3000 is free'
               }
           } },

        @{ Title  = 'Developer tools (optional)'
           Action = {
               param($PyExe)
               Info 'the app itself needs none of this - it is the linter and the Android build.'
               if (-not (Ask 'Install the optional developer tools with npm?' 'n')) {
                   OK 'skipped - you can run Install again later if you change your mind'
                   return
               }
               $v = Get-NodeVersion
               if (-not $v -or $v -lt [version]'18.0') {
                   Warn 'Node.js 18+ is needed for the developer tools and was not found.' `
                        'Install it from https://nodejs.org/en/download and run Install again. The app itself is unaffected.'
                   return
               }
               OK ('Node.js ' + $v)
               Invoke-Npm -Dir $Root -What 'developer tools'
           } }
    )

    Launchers = @(
        @{ Name = 'Start Habit Maker.bat'; Body = @'
@echo off
rem Written by Install.bat. Runs the local server and opens the app in your
rem browser. Everything stays on this PC. Close this window to stop the server.
setlocal EnableExtensions
title Habit Maker
cd /d "%~dp0"

set "PY=__PYTHON__"
if not exist "%PY%" set "PY=py"

if not exist "server\app.py" (
    echo.
    echo  [ERROR] server\app.py is missing - this download is incomplete.
    echo          Re-download the project, then run Install.bat again.
    echo.
    pause
    exit /b 1
)

echo.
echo   Habit Maker is starting on http://localhost:3000
echo   Your browser opens by itself in a moment.
echo.
echo   Keep this window open while you use the app. Closing it stops the server.
echo.

rem Opens the browser as soon as the server answers - not before.
start "" /b powershell -NoProfile -Command "for($i=0;$i -lt 90;$i++){ try{ Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:3000/' -TimeoutSec 2 | Out-Null; Start-Process 'http://localhost:3000'; exit 0 } catch { Start-Sleep -Milliseconds 500 } }"

"%PY%" "server\app.py"
set "RC=%ERRORLEVEL%"

if not "%RC%"=="0" (
    echo.
    echo  [ERROR] The server stopped with code %RC%.
    echo.
    echo   * "Address already in use" means port 3000 is taken - either close the
    echo     other program, or start on another port:
    echo         set HABIT_PORT=4000 ^&^& "%PY%" server\app.py
    echo   * Anything else: run Install.bat again, it checks the whole app.
    echo.
    pause
)
exit /b %RC%
'@ }
    )

    Shortcut = @{ Name = 'Habit Maker'; Target = 'Start Habit Maker.bat'; Icon = 'icons\habit-maker.ico' }

    NextSteps = @(
        'Double-click "Habit Maker" on your Desktop  (or "Start Habit Maker.bat" here).',
        'The browser opens on http://localhost:3000 by itself.',
        '',
        'Keep the black window open while you use the app; closing it stops the server.',
        '',
        'Your data:  data.db in this folder. Back that one file up and you have backed',
        'up everything - habits, notes, bookmarks and summaries.'
    )
}

# ============================================================================
#  INSTALLER ENGINE - shared by all of the projects in this family.
#  Everything below this line is generic.  Configure the block above instead.
# ============================================================================

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'

$Root    = Split-Path -Parent $PSScriptRoot
$LogFile = Join-Path $Root 'install.log'

$script:StepNo   = 0
$script:Warnings = New-Object System.Collections.ArrayList
$script:Fixed    = New-Object System.Collections.ArrayList

# --------------------------------------------------------------------------
#  Output helpers
# --------------------------------------------------------------------------

function Log { param([string]$Text)
    try { Add-Content -LiteralPath $LogFile -Value ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Text) -Encoding UTF8 } catch { }
}

function Line { param([string]$Text = '', [string]$Colour = 'Gray')
    Write-Host $Text -ForegroundColor $Colour; Log $Text
}

function Step { param([string]$Text)
    $script:StepNo++
    Write-Host ''
    Write-Host ("  [{0}] {1}" -f $script:StepNo, $Text) -ForegroundColor Cyan
    Log ("STEP {0}: {1}" -f $script:StepNo, $Text)
}

function OK { param([string]$Text)
    Write-Host '      ' -NoNewline; Write-Host 'ok' -ForegroundColor Green -NoNewline; Write-Host ("   " + $Text)
    Log ("  ok    " + $Text)
}

function Info { param([string]$Text)
    Write-Host ("           " + $Text) -ForegroundColor DarkGray; Log ("  info  " + $Text)
}

function Fixed { param([string]$Text)
    Write-Host '      ' -NoNewline; Write-Host 'fixed' -ForegroundColor Green -NoNewline; Write-Host ("  " + $Text)
    Log ("  fixed " + $Text); [void]$script:Fixed.Add($Text)
}

function Warn { param([string]$Text, [string]$Fix = '')
    Write-Host '      ' -NoNewline; Write-Host 'warn' -ForegroundColor Yellow -NoNewline; Write-Host (" " + $Text)
    if ($Fix) { Write-Host ("           -> " + $Fix) -ForegroundColor DarkYellow }
    Log ("  warn  " + $Text + "  fix: " + $Fix)
    [void]$script:Warnings.Add(@{ Text = $Text; Fix = $Fix })
}

function Stop-Install { param([string]$Text, [string[]]$Fix = @(), [string]$Kind = '')
    $err = New-Object System.Exception ($Text)
    $err.Data['fix']  = ($Fix -join "`n")
    $err.Data['kind'] = $Kind
    throw $err
}

function Box { param([string[]]$Lines, [string]$Colour = 'Cyan')
    $width = 0
    foreach ($l in $Lines) { if ($l.Length -gt $width) { $width = $l.Length } }
    $width += 4
    $rule = '  +' + ('-' * $width) + '+'
    Write-Host $rule -ForegroundColor $Colour
    foreach ($l in $Lines) {
        Write-Host '  |' -ForegroundColor $Colour -NoNewline
        Write-Host ('  ' + $l.PadRight($width - 2)) -NoNewline
        Write-Host '|' -ForegroundColor $Colour
    }
    Write-Host $rule -ForegroundColor $Colour
    foreach ($l in $Lines) { Log ("| " + $l) }
}

function Ask { param([string]$Question, [string]$Default = 'y')
    if ($NonInteractive) { return ($Default -eq 'y') }
    $suffix = '[Y/n]'
    if ($Default -ne 'y') { $suffix = '[y/N]' }
    while ($true) {
        Write-Host ('      ' + $Question + ' ' + $suffix + ' ') -ForegroundColor White -NoNewline
        $answer = Read-Host
        if ([string]::IsNullOrWhiteSpace($answer)) { $answer = $Default }
        switch ($answer.Trim().ToLower()) {
            'y' { return $true }
            'yes' { return $true }
            'n' { return $false }
            'no' { return $false }
        }
    }
}

# --------------------------------------------------------------------------
#  Process runner - captures everything, never throws on a non-zero exit
# --------------------------------------------------------------------------

function Run { param([string]$Exe, [string[]]$Arguments = @(), [string]$WorkDir = $Root)
    Log ("  run   " + $Exe + ' ' + ($Arguments -join ' '))
    $prevPref = $ErrorActionPreference
    $prevLoc  = Get-Location
    $code = 1603
    $text = ''
    try {
        # PowerShell's call operator quotes each array element for us, which is
        # the only way arguments like  -c "import sys; print(1)"  survive.
        $ErrorActionPreference = 'Continue'
        if ($WorkDir -and (Test-Path -LiteralPath $WorkDir)) { Set-Location -LiteralPath $WorkDir }
        $global:LASTEXITCODE = 0
        $out = (& $Exe @Arguments 2>&1 |
                    ForEach-Object {
                        if ($_ -is [System.Management.Automation.ErrorRecord]) { $_.ToString() } else { $_ }
                    } | Out-String)
        $code = $global:LASTEXITCODE
        if ($null -eq $code) { $code = 0 }
        $text = $out
    } catch {
        $text = ('could not run "' + $Exe + '": ' + $_.Exception.Message)
        $code = 1603
    } finally {
        Set-Location $prevLoc
        $ErrorActionPreference = $prevPref
    }
    Log ("  exit  " + $code)
    if ($text -and $text.Trim()) { Log ("  ----- " + $text.Trim()) }
    return @{ Code = $code; Output = [string]$text }
}

function Get-Npm {
    foreach ($n in @('npm.cmd', 'npm.exe')) {
        $src = Have $n
        if ($src) { return $src }
    }
    $node = Have 'node'
    if ($node) {
        $guess = Join-Path (Split-Path -Parent $node) 'npm.cmd'
        if (Test-Path $guess) { return $guess }
    }
    $src = Have 'npm'
    if ($src -and $src -notmatch '\.ps1$') { return $src }   # npm.ps1 cannot be called like an exe
    return $null
}

function Have { param([string]$Name)
    $c = Get-Command $Name -ErrorAction SilentlyContinue
    if ($c) { return $c.Source } else { return $null }
}

# --------------------------------------------------------------------------
#  Prerequisite: Python
# --------------------------------------------------------------------------

# A Python that cannot import ssl cannot download anything, and one that cannot
# import venv or sqlite3 will fail later in a much more confusing way.  So the
# probe checks all three and prints the OpenSSL version as its proof of health.
$script:PythonProbe = 'import platform;print(platform.python_version());import ssl,sqlite3,venv;print(ssl.OPENSSL_VERSION)'
$script:BadPythons  = New-Object System.Collections.ArrayList

function Get-PythonVersion { param([string]$Exe, [string[]]$Prefix = @())
    $r = Run -Exe $Exe -Arguments ($Prefix + @('-c', 'import platform;print(platform.python_version())'))
    if ($r.Code -ne 0) { return $null }
    $m = [regex]::Match($r.Output, '(\d+)\.(\d+)\.(\d+)')
    if (-not $m.Success) { return $null }
    return [version]$m.Value
}

function Test-PythonCandidate { param([string]$Exe, [string[]]$Prefix = @())
    $r = Run -Exe $Exe -Arguments ($Prefix + @('-c', $script:PythonProbe))
    $m = [regex]::Match($r.Output, '(?m)^\s*(\d+\.\d+\.\d+)\s*$')
    if (-not $m.Success) { return $null }          # not a usable Python at all
    $info = @{ Exe = $Exe; Prefix = $Prefix; Version = [version]$m.Groups[1].Value
               Healthy = $false; Problem = '' }
    if ($r.Code -eq 0 -and $r.Output -match 'OpenSSL') { $info.Healthy = $true; return $info }
    if ($r.Output -match "_ssl|No module named 'ssl'|ssl\.py") {
        $info.Problem = 'its SSL support is broken, so pip cannot download anything'
    } elseif ($r.Output -match 'sqlite3') {
        $info.Problem = 'its sqlite3 module is broken'
    } elseif ($r.Output -match "No module named 'venv'|ensurepip") {
        $info.Problem = 'it cannot create virtual environments'
    } else {
        $info.Problem = 'it fails a basic self-check'
    }
    return $info
}

function Find-Python { param([version]$Min)
    $candidates = New-Object System.Collections.ArrayList
    # The "py" launcher knows about every Python on the box.  3.12 first: it has
    # the widest choice of ready-made packages, so it needs no C++ compiler.
    if (Have 'py') {
        foreach ($tag in @('-3.12', '-3.13', '-3.11', '-3.10', '-3')) {
            [void]$candidates.Add(@{ Exe = 'py'; Prefix = @($tag) })
        }
    }
    foreach ($name in @('python', 'python3')) {
        $src = Have $name
        if ($src) { [void]$candidates.Add(@{ Exe = $src; Prefix = @() }) }
    }
    foreach ($glob in @(
        "$env:LOCALAPPDATA\Programs\Python\Python3*\python.exe",
        "$env:ProgramFiles\Python3*\python.exe",
        "C:\Python3*\python.exe",
        "$env:LOCALAPPDATA\Python\pythoncore-3*\python.exe",
        "$env:USERPROFILE\miniconda3\python.exe",
        "$env:USERPROFILE\anaconda3\python.exe")) {
        foreach ($hit in (Get-ChildItem -Path $glob -ErrorAction SilentlyContinue | Sort-Object FullName -Descending)) {
            [void]$candidates.Add(@{ Exe = $hit.FullName; Prefix = @() })
        }
    }

    $seen = @{}
    $script:BadPythons.Clear()
    foreach ($c in $candidates) {
        $key = ($c.Exe + ' ' + ($c.Prefix -join ' '))
        if ($seen.ContainsKey($key)) { continue }
        $seen[$key] = $true
        $info = Test-PythonCandidate -Exe $c.Exe -Prefix $c.Prefix
        if (-not $info) { continue }
        $where = $key
        if ($info.Healthy) {
            Info ('found Python ' + $info.Version + '  (' + $where + ')')
            if ($info.Version -ge $Min -and $info.Version.Major -eq 3) { return $info }
        } else {
            Info ('found Python ' + $info.Version + ' (' + $where + ') but ' + $info.Problem + ' - skipping it')
            [void]$script:BadPythons.Add(('Python ' + $info.Version + ' at "' + $where + '": ' + $info.Problem))
        }
    }
    return $null
}

function Install-Python { param([version]$Min, [string]$Series = '3.12', [switch]$Quiet)
    if (-not $Quiet) {
        if ($script:BadPythons.Count) {
            Warn ('a Python is installed, but not one this app can use.')
            foreach ($b in $script:BadPythons) { Info $b }
        } else {
            Warn ('Python ' + $Min + ' or newer was not found on this computer.')
        }
    }
    if (Have 'winget') {
        if ($Quiet -or (Ask ('Install Python ' + $Series + ' automatically now (via winget)?'))) {
            Info ('downloading and installing Python ' + $Series + ' - this takes a couple of minutes...')
            $r = Run -Exe 'winget' -Arguments @('install', '--id', ('Python.Python.' + $Series), '-e',
                        '--source', 'winget', '--accept-package-agreements',
                        '--accept-source-agreements', '--disable-interactivity')
            if ($r.Code -eq 0 -or $r.Output -match 'Successfully installed|already installed') {
                # winget only puts python on the PATH of *new* shells - refresh ours.
                $env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
                            [System.Environment]::GetEnvironmentVariable('Path', 'User')
                $found = Find-Python -Min $Min
                if ($found) { Fixed ('installed Python ' + $found.Version); return $found }
                Warn 'Python was installed but still cannot be found from this window.'
                Info 'close this window and double-click Install again - a fresh window will see it.'
            } else {
                Warn 'the automatic Python install did not complete.' 'Install it by hand with the link below, then run this installer again.'
            }
        }
    } else {
        Warn 'winget is not available on this Windows version, so Python cannot be installed automatically.'
    }
    if ($Quiet) { return $null }
    $fix = @(
        '1. Download Python from  https://www.python.org/downloads/windows/',
        '   (3.12 or 3.13 - avoid the newest release for a week or two: not every',
        '    package has been rebuilt for it yet.)',
        '2. On the FIRST screen of the Python installer, tick "Add python.exe to PATH".',
        '3. Finish the install, then double-click Install again.')
    if ($script:BadPythons.Count) {
        $fix += @('', 'Note: an Anaconda/Miniconda Python was found but its SSL is broken.',
                      'Either fix it (open "Anaconda Prompt" and run: conda install -y openssl)',
                      'or just install a normal Python as above - both can live side by side.')
    }
    Stop-Install 'Python is required and no usable copy could be installed automatically.' $fix
}

# --------------------------------------------------------------------------
#  Prerequisite: Node.js
# --------------------------------------------------------------------------

function Get-NodeVersion {
    $exe = Have 'node'
    if (-not $exe) { return $null }
    $r = Run -Exe $exe -Arguments @('--version')
    if ($r.Code -ne 0) { return $null }
    $m = [regex]::Match($r.Output, '(\d+)\.(\d+)\.(\d+)')
    if (-not $m.Success) { return $null }
    return [version]$m.Value
}

function Ensure-Node { param([version]$Min)
    $v = Get-NodeVersion
    if ($v -and $v -ge $Min) { OK ('Node.js ' + $v); return $true }
    if ($v) { Warn ('Node.js ' + $v + ' is older than the required ' + $Min + '.') }
    else    { Warn 'Node.js was not found on this computer.' }

    if (Have 'winget') {
        if (Ask 'Install the current Node.js LTS automatically now (via winget)?') {
            Info 'installing Node.js LTS - this takes a couple of minutes...'
            $r = Run -Exe 'winget' -Arguments @('install', '--id', 'OpenJS.NodeJS.LTS', '-e',
                        '--source', 'winget', '--accept-package-agreements',
                        '--accept-source-agreements', '--disable-interactivity')
            if ($r.Code -eq 0) {
                $env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
                            [System.Environment]::GetEnvironmentVariable('Path', 'User')
                $v = Get-NodeVersion
                if ($v -and $v -ge $Min) { Fixed ('installed Node.js ' + $v); return $true }
            }
            Warn 'the automatic Node.js install did not complete.'
        }
    }
    Stop-Install ('Node.js ' + $Min + ' or newer is required and could not be installed automatically.') @(
        '1. Download the LTS installer from  https://nodejs.org/en/download',
        '2. Install it with the default options.',
        '3. Close this window, then double-click Install again.')
}

# --------------------------------------------------------------------------
#  pip, with a diagnosis for every common failure
# --------------------------------------------------------------------------

function Explain-PipFailure { param([string]$Output)
    $o = $Output
    if ($o -match 'Microsoft Visual C\+\+ 14|vcvarsall|error: command .*cl\.exe') {
        return @{ Why = 'a package wanted to compile C code and this PC has no C++ compiler.'
                  Fix = @('Install the free "Build Tools for Visual Studio" (tick "Desktop development with C++"):',
                          '  https://visualstudio.microsoft.com/visual-cpp-build-tools/',
                          'Then run this installer again.') }
    }
    if ($o -match 'CERTIFICATE_VERIFY_FAILED|SSLError|SSLCertVerificationError') {
        return @{ Why = 'the HTTPS connection to pypi.org could not be verified - usually a company proxy or antivirus.'
                  Fix = @('If you are on a work network, ask IT for the proxy address and set it first:',
                          '  set HTTPS_PROXY=http://proxy.company.com:8080',
                          'Then run this installer again. (It already retried with the certificate check relaxed.)') }
    }
    if ($o -match 'ProxyError|Tunnel connection failed|407 ') {
        return @{ Why = 'a proxy server refused the connection.'
                  Fix = @('Set your proxy and try again:',
                          '  set HTTPS_PROXY=http://user:password@proxy.company.com:8080') }
    }
    if ($o -match 'Temporary failure in name resolution|Failed to establish a new connection|getaddrinfo failed|Network is unreachable|Connection reset') {
        return @{ Why = 'the download could not reach pypi.org - the internet connection dropped or is blocked.'
                  Fix = @('Check that this PC is online (open pypi.org in a browser), then run the installer again.') }
    }
    if ($o -match 'No matching distribution found|Could not find a version that satisfies') {
        $pkg = ([regex]::Match($o, 'for ([A-Za-z0-9_.\-]+)')).Groups[1].Value
        return @{ Kind = 'python-mismatch'
                  Why = ('no ready-made build of ' + $pkg + ' exists for this Python version.')
                  Fix = @('Install Python 3.12 - every package this app needs has a build for it:',
                          '  https://www.python.org/downloads/windows/',
                          'Then delete the .venv folder in this project and run the installer again.') }
    }
    if ($o -match 'No space left on device|not enough space|ENOSPC') {
        return @{ Why = 'the disk is full.'
                  Fix = @('Free up a couple of gigabytes on this drive and run the installer again.') }
    }
    if ($o -match 'Access is denied|WinError 5|Permission denied|being used by another process') {
        return @{ Why = 'a file could not be written - the app is probably still running, or antivirus locked it.'
                  Fix = @('Close the app (check the tray and Task Manager), then run the installer again.') }
    }
    if ($o -match 'is not recognized as an internal or external command|cannot find the path') {
        return @{ Why = 'the Python installation looks broken - pip is missing from it.'
                  Fix = @('Repair Python from Settings > Apps > Python > Modify > Repair,',
                          'or reinstall it from https://www.python.org/downloads/windows/') }
    }
    return @{ Why = 'pip stopped with an error (the full text is at the end of install.log).'
              Fix = @('Read the last lines of install.log in this folder - they name the package that failed.',
                      'A retry often works if the cause was a dropped connection.') }
}

function Invoke-Pip { param([string]$PyExe, [string[]]$PyPrefix, [string[]]$PipArgs, [string]$What)
    $attempts = @(
        @{ Label = ''                       ; Extra = @() },
        @{ Label = 'retrying with a longer timeout'          ; Extra = @('--timeout', '60', '--retries', '5') },
        @{ Label = 'retrying with the certificate check relaxed' ; Extra = @('--timeout', '60', '--retries', '5',
                       '--trusted-host', 'pypi.org', '--trusted-host', 'files.pythonhosted.org', '--trusted-host', 'pypi.python.org') },
        @{ Label = 'retrying with pre-built wheels only'     ; Extra = @('--only-binary', ':all:', '--timeout', '60') }
    )
    $last = $null
    for ($i = 0; $i -lt $attempts.Count; $i++) {
        $a = $attempts[$i]
        if ($a.Label) { Info $a.Label }
        $r = Run -Exe $PyExe -Arguments ($PyPrefix + @('-m', 'pip') + $PipArgs + $a.Extra + @('--disable-pip-version-check'))
        if ($r.Code -eq 0) {
            if ($i -gt 0) { Fixed ($What + ' (' + $a.Label + ')') } else { OK $What }
            return
        }
        $last = $r.Output
        # A compiler error or a genuinely missing package will not be fixed by a retry.
        if ($last -match 'No matching distribution found|Could not find a version that satisfies') { break }
        if ($i -eq 0) { Warn ($What + ' failed on the first try.') }
    }
    $diag = Explain-PipFailure -Output $last
    $kind = ''
    if ($diag.ContainsKey('Kind')) { $kind = $diag.Kind }
    Stop-Install ($What + ' failed: ' + $diag.Why) $diag.Fix -Kind $kind
}

# --------------------------------------------------------------------------
#  npm, with the same treatment
# --------------------------------------------------------------------------

function Explain-NpmFailure { param([string]$Output)
    $o = $Output
    if ($o -match 'EBADENGINE|Unsupported engine') {
        return @{ Why = 'the installed Node.js version is not supported by this project.'
                  Fix = @('Install the current Node.js LTS from https://nodejs.org/en/download and run the installer again.') }
    }
    if ($o -match 'ERESOLVE') {
        return @{ Why = 'two packages asked for conflicting versions of the same dependency.'
                  Fix = @('The installer already retried with --legacy-peer-deps.',
                          'If it still fails, delete node_modules and package-lock.json, then run the installer again.') }
    }
    if ($o -match 'ENOENT.*package-lock|can only install packages when your package.json and package-lock.json') {
        return @{ Why = 'package-lock.json does not match package.json, so the exact-versions install refused to run.'
                  Fix = @('The installer already retried with "npm install".',
                          'If it still fails, delete node_modules and package-lock.json and run the installer again.') }
    }
    if ($o -match 'EACCES|EPERM|operation not permitted') {
        return @{ Why = 'npm could not write into the project folder.'
                  Fix = @('Close any editor or terminal using this folder, then run the installer again.',
                          'If the folder is inside OneDrive, pause OneDrive syncing while installing.') }
    }
    if ($o -match 'ENOTFOUND|ETIMEDOUT|ECONNRESET|network|EAI_AGAIN') {
        return @{ Why = 'npm could not reach the package registry.'
                  Fix = @('Check that this PC is online, then run the installer again.',
                          'Behind a company proxy:  npm config set proxy http://proxy.company.com:8080') }
    }
    if ($o -match 'ENOSPC|no space left') {
        return @{ Why = 'the disk is full.'
                  Fix = @('Free up a few gigabytes on this drive and run the installer again.') }
    }
    return @{ Why = 'npm stopped with an error (the full text is at the end of install.log).'
              Fix = @('Read the last lines of install.log in this folder - npm names the failing package.') }
}

function Invoke-Npm { param([string]$Dir, [string]$What)
    $npm = Get-Npm
    if (-not $npm) { Stop-Install 'npm was not found even though Node.js is installed.' @('Reinstall Node.js from https://nodejs.org/en/download') }

    $hasLock = Test-Path (Join-Path $Dir 'package-lock.json')
    $attempts = New-Object System.Collections.ArrayList
    if ($hasLock) { [void]$attempts.Add(@{ Label = ''; Args = @('ci', '--no-audit', '--no-fund') }) }
    [void]$attempts.Add(@{ Label = 'retrying with "npm install"'; Args = @('install', '--no-audit', '--no-fund') })
    [void]$attempts.Add(@{ Label = 'retrying with --legacy-peer-deps'; Args = @('install', '--no-audit', '--no-fund', '--legacy-peer-deps') })

    $last = $null
    for ($i = 0; $i -lt $attempts.Count; $i++) {
        $a = $attempts[$i]
        if ($a.Label) { Info $a.Label }
        $r = Run -Exe $npm -Arguments $a.Args -WorkDir $Dir
        if ($r.Code -eq 0) {
            if ($i -gt 0) { Fixed ($What + ' (' + $a.Label + ')') } else { OK $What }
            return
        }
        $last = $r.Output
        if ($i -eq 0) { Warn ($What + ' failed on the first try.') }
    }
    $diag = Explain-NpmFailure -Output $last
    Stop-Install ($What + ' failed: ' + $diag.Why) $diag.Fix
}

# --------------------------------------------------------------------------
#  Virtual environment
# --------------------------------------------------------------------------

function Ensure-Venv { param($Python, [string]$VenvDir)
    $full   = Join-Path $Root $VenvDir
    $pyExe  = Join-Path $full 'Scripts\python.exe'
    if (Test-Path $pyExe) {
        $v = Get-PythonVersion -Exe $pyExe
        if ($v) { OK ('existing environment reused  (' + $VenvDir + ', Python ' + $v + ')'); return $pyExe }
        Warn ('the existing ' + $VenvDir + ' folder is broken.')
        Info 'deleting and rebuilding it...'
        Remove-Item -LiteralPath $full -Recurse -Force -ErrorAction SilentlyContinue
        if (Test-Path $full) {
            Stop-Install ('the old ' + $VenvDir + ' folder could not be deleted.') @(
                'Something is still using it. Close the app and any open terminals,',
                ('then delete this folder by hand and run the installer again:  ' + $full))
        }
        Fixed 'removed the broken environment'
    }

    Info ('creating a private Python environment in ' + $VenvDir + ' ...')
    $r = Run -Exe $Python.Exe -Arguments ($Python.Prefix + @('-m', 'venv', $full))
    if ($r.Code -ne 0) {
        if ($r.Output -match 'ensurepip|No module named venv') {
            Stop-Install 'this Python installation is missing the "venv" module.' @(
                'Repair Python: Settings > Apps > Python > Modify > Repair,',
                'or reinstall from https://www.python.org/downloads/windows/')
        }
        if ($r.Output -match 'Access is denied|Permission') {
            Stop-Install 'the environment folder could not be created - permission denied.' @(
                'Move the project somewhere under your own user folder (for example the Desktop),',
                'or right-click Install and choose "Run as administrator".')
        }
        Stop-Install 'the private Python environment could not be created.' @(
            'The reason is at the end of install.log in this folder.')
    }
    if (-not (Test-Path $pyExe)) {
        Stop-Install 'the private Python environment was created but has no python.exe in it.' @(
            'Delete the ' + $VenvDir + ' folder and run the installer again.')
    }
    OK ('private Python environment created  (' + $VenvDir + ')')
    return $pyExe
}

# --------------------------------------------------------------------------
#  Shortcuts and launchers
# --------------------------------------------------------------------------

function New-Launcher { param([string]$Name, [string]$Body)
    $path = Join-Path $Root $Name
    if ($script:VenvPy) { $Body = $Body.Replace('__PYTHON__', $script:VenvPy) }
    $text = ($Body -replace "`r`n", "`n") -replace "`n", "`r`n"
    [System.IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding($false)))
    OK ('launcher written  (' + $Name + ')')
    return $path
}

function New-Shortcut { param([string]$Name, [string]$Target, [string]$Icon = '', [string]$Description = '', [string]$Arguments = '')
    $made = New-Object System.Collections.ArrayList
    try {
        $shell = New-Object -ComObject WScript.Shell
        $places = @($shell.SpecialFolders('Desktop'), $shell.SpecialFolders('Programs'))
        foreach ($dir in $places) {
            if (-not $dir) { continue }
            $lnk = $shell.CreateShortcut((Join-Path $dir ($Name + '.lnk')))
            $lnk.TargetPath       = $Target
            $lnk.Arguments        = $Arguments
            $lnk.WorkingDirectory = $Root
            $lnk.Description      = $Description
            if ($Icon -and (Test-Path $Icon)) { $lnk.IconLocation = $Icon }
            $lnk.Save()
            [void]$made.Add((Join-Path $dir ($Name + '.lnk')))
        }
    } catch {
        Warn ('the Desktop shortcut could not be created: ' + $_.Exception.Message) `
             ('Start the app from ' + (Split-Path -Leaf $Target) + ' in this folder instead.')
        return
    }
    foreach ($m in $made) { OK ('shortcut: ' + $m) }
}

# --------------------------------------------------------------------------
#  .env handling
# --------------------------------------------------------------------------

function Ensure-EnvKey { param([hashtable]$Spec)
    $file = Join-Path $Root $Spec.File
    $text = ''
    if (Test-Path $file) { $text = Get-Content -LiteralPath $file -Raw }

    $pattern = '(?m)^\s*' + [regex]::Escape($Spec.Key) + '\s*=\s*(.*)$'
    $m = [regex]::Match($text, $pattern)
    if ($m.Success) {
        $val = $m.Groups[1].Value.Trim().Trim('"').Trim("'")
        if ($val -and $val -notmatch '^(your|paste|changeme|xxx|<)' ) {
            OK ($Spec.Key + ' is already set in ' + $Spec.File)
            return
        }
    }

    Warn ($Spec.Key + ' is not set yet, so the app cannot talk to its API.') `
         ('Get a key here: ' + $Spec.Url)
    $value = ''
    if (-not $NonInteractive) {
        Line ''
        Line ('      Paste your ' + $Spec.Prompt + ' and press Enter.') 'White'
        Line  '      (Press Enter on its own to skip - you can fill it in later.)' 'DarkGray'
        Write-Host '      > ' -NoNewline -ForegroundColor White
        $value = (Read-Host).Trim().Trim('"')
    }
    if (-not $value) {
        Warn ($Spec.Key + ' was left empty.') `
             ('Open ' + $Spec.File + ' in Notepad later and put your key after ' + $Spec.Key + '=')
        if (-not (Test-Path $file)) {
            [System.IO.File]::WriteAllText($file, ($Spec.Key + "=`r`n"), (New-Object System.Text.UTF8Encoding($false)))
            Info ('created an empty ' + $Spec.File + ' for you')
        }
        return
    }
    if ($m.Success) { $text = [regex]::Replace($text, $pattern, ($Spec.Key + '=' + $value)) }
    else {
        if ($text -and -not $text.EndsWith("`n")) { $text += "`r`n" }
        $text += ($Spec.Key + '=' + $value + "`r`n")
    }
    [System.IO.File]::WriteAllText($file, $text, (New-Object System.Text.UTF8Encoding($false)))
    Fixed ($Spec.Key + ' saved into ' + $Spec.File)
}

# --------------------------------------------------------------------------
#  Import / smoke checks
# --------------------------------------------------------------------------

function Test-Imports { param([string]$PyExe, [string[]]$Modules)
    if (-not $Modules -or $Modules.Count -eq 0) { return }
    $bad = New-Object System.Collections.ArrayList
    foreach ($mod in $Modules) {
        $r = Run -Exe $PyExe -Arguments @('-c', ('import ' + $mod))
        if ($r.Code -ne 0) { [void]$bad.Add($mod) } 
    }
    if ($bad.Count -eq 0) {
        if ($Modules.Count -eq 1) { OK 'the required package imports cleanly' }
        else { OK ('all ' + $Modules.Count + ' required packages import cleanly') }
        return
    }
    Stop-Install ('these packages installed but will not load: ' + ($bad -join ', ')) @(
        'Delete the .venv folder in this project and run the installer again -',
        'that rebuilds the environment from scratch and fixes almost every case of this.')
}

# --------------------------------------------------------------------------
#  Main
# --------------------------------------------------------------------------

$startedAt = Get-Date
try {
    if (Test-Path $LogFile) { Move-Item -LiteralPath $LogFile -Destination ($LogFile + '.old') -Force -ErrorAction SilentlyContinue }
    Log ('installer started for ' + $App.Name)
    Log ('PowerShell ' + $PSVersionTable.PSVersion + ' on ' + [System.Environment]::OSVersion.VersionString)
    Log ('project root: ' + $Root)

    Write-Host ''
    Box -Lines (@(($App.Name + '  -  Installer'), $App.Blurb)) -Colour 'Cyan'
    Line ''
    Line ('  This window installs everything the app needs. Nothing leaves your PC') 'DarkGray'
    Line ('  except package downloads. A full record is written to install.log.') 'DarkGray'

    Step 'Checking this computer'
    if ($App.WindowsOnly -and -not ($env:OS -eq 'Windows_NT')) {
        Stop-Install 'this app only runs on Windows.' @('On Linux or macOS use install.sh instead.')
    }
    OK ('Windows ' + [System.Environment]::OSVersion.Version)
    if ($PSVersionTable.PSVersion.Major -lt 5) {
        Stop-Install 'PowerShell 5.1 or newer is required.' @('Install Windows Management Framework 5.1 from Microsoft, then try again.')
    }
    OK ('PowerShell ' + $PSVersionTable.PSVersion)
    $free = [math]::Round((Get-PSDrive -Name ($Root.Substring(0,1)) -ErrorAction SilentlyContinue).Free / 1GB, 1)
    if ($free -and $free -lt 1) { Warn ('only ' + $free + ' GB free on this drive.') 'Free up some space if the install fails part way.' }
    OK ('project folder: ' + $Root)

    $venvPy = $null
    if ($App.MinPython) {
        Step ('Looking for Python ' + $App.MinPython + ' or newer')
        $python = Find-Python -Min ([version]$App.MinPython)
        if (-not $python) { $python = Install-Python -Min ([version]$App.MinPython) }
        OK ('using Python ' + $python.Version)

        # One body of work, so it can be run a second time on a different Python.
        $installPackages = {
            param($Py)

            if ($App.Venv) {
                Step 'Preparing the private Python environment'
                $script:VenvPy = Ensure-Venv -Python $Py -VenvDir $App.Venv
            } else {
                # No environment of our own: pin down the exact interpreter, so
                # later steps cannot land on a different one than the one chosen.
                $script:VenvPy = $Py.Exe
                if ($Py.Prefix.Count) {
                    $r = Run -Exe $Py.Exe -Arguments ($Py.Prefix + @('-c', 'import sys;print(sys.executable)'))
                    $line = (($r.Output -split "`n") | Where-Object { $_ -match '\.exe\s*$' } | Select-Object -First 1)
                    if ($line) { $script:VenvPy = $line.Trim() }
                }
                OK ('using ' + $script:VenvPy)
            }

            if ($App.Requirements -or ($App.PipExtra -and $App.PipExtra.Count)) {
                Step 'Updating the Python package tools'
                $r = Run -Exe $script:VenvPy -Arguments @('-m', 'pip', 'install', '--upgrade', 'pip', 'setuptools', 'wheel', '--disable-pip-version-check')
                if ($r.Code -eq 0) { OK 'pip, setuptools and wheel are up to date' }
                else { Warn 'pip could not be updated - carrying on with the version that is there.' 'Harmless unless the next step also fails.' }
            }

            if ($App.Requirements -or ($App.PipExtra -and $App.PipExtra.Count)) {
                Step 'Installing the Python packages'
                Info 'first run downloads a few megabytes - give it a minute.'
                if ($App.Requirements) {
                    $req = Join-Path $Root $App.Requirements
                    if (-not (Test-Path $req)) {
                        Stop-Install ($App.Requirements + ' is missing from this folder.') @(
                            'This download is incomplete. Get the whole project again:',
                            ('  git clone ' + $App.Repo))
                    }
                    Invoke-Pip -PyExe $script:VenvPy -PyPrefix @() -PipArgs @('install', '-r', $req) -What ('packages from ' + $App.Requirements)
                }
                if ($App.PipExtra -and $App.PipExtra.Count) {
                    Invoke-Pip -PyExe $script:VenvPy -PyPrefix @() -PipArgs (@('install') + $App.PipExtra) -What ('packages: ' + ($App.PipExtra -join ', '))
                }
            }
        }

        try {
            & $installPackages $python
        } catch {
            $kind = ''
            if ($_.Exception.Data) { $kind = [string]$_.Exception.Data['kind'] }
            if ($kind -ne 'python-mismatch') { throw }

            # The chosen Python is too new (or too old) for one of the packages.
            # Fetching the version that does have ready-made builds is a fix the
            # installer can apply on its own, so try that before giving up.
            Warn ('Python ' + $python.Version + ' is too new for one of the packages this app needs.')
            Info 'trying to fix that by installing Python 3.12 alongside it...'
            $better = Install-Python -Min ([version]$App.MinPython) -Series '3.12' -Quiet
            if (-not $better -or $better.Version -eq $python.Version) { throw }
            Fixed ('switching the install over to Python ' + $better.Version)
            $old = Join-Path $Root $App.Venv
            if ($App.Venv -and (Test-Path $old)) { Remove-Item -LiteralPath $old -Recurse -Force -ErrorAction SilentlyContinue }
            & $installPackages $better
        }
        $venvPy = $script:VenvPy

        if ($App.VerifyImports -and $App.VerifyImports.Count) {
            Step 'Checking that every package really works'
            Test-Imports -PyExe $venvPy -Modules $App.VerifyImports
        }
    }

    if ($App.MinNode) {
        Step ('Looking for Node.js ' + $App.MinNode + ' or newer')
        Ensure-Node -Min ([version]$App.MinNode) | Out-Null

        foreach ($nd in $App.NpmDirs) {
            $dir = Join-Path $Root $nd.Path
            if (-not (Test-Path (Join-Path $dir 'package.json'))) {
                Warn ('no package.json in ' + $nd.Path + ' - skipping.') 'Re-clone the project if you expected one here.'
                continue
            }
            Step ('Installing the Node packages for ' + $nd.Label)
            Info 'this is the slow step - a few minutes on a first run.'
            Invoke-Npm -Dir $dir -What ($nd.Label + ' dependencies')
        }
    }

    if ($App.EnvKeys -and $App.EnvKeys.Count) {
        Step 'Setting up your API key'
        foreach ($spec in $App.EnvKeys) { Ensure-EnvKey -Spec $spec }
    }

    if ($App.ExtraSteps) {
        foreach ($extra in $App.ExtraSteps) {
            Step $extra.Title
            & $extra.Action $venvPy
        }
    }

    if ($App.Launchers) {
        Step 'Writing the launchers'
        foreach ($l in $App.Launchers) { New-Launcher -Name $l.Name -Body $l.Body | Out-Null }
    }

    if ($App.Shortcut) {
        Step 'Putting a shortcut on your Desktop and Start menu'
        $target = Join-Path $Root $App.Shortcut.Target
        $icon = ''
        if ($App.Shortcut.Icon) { $icon = Join-Path $Root $App.Shortcut.Icon }
        New-Shortcut -Name $App.Shortcut.Name -Target $target -Icon $icon -Description $App.Blurb
    }

    # ---------------------------------------------------------------- summary
    $secs = [int]((Get-Date) - $startedAt).TotalSeconds
    Write-Host ''
    Box -Lines (@(('INSTALL COMPLETE  -  ' + $App.Name), ('finished in ' + $secs + ' seconds'))) -Colour 'Green'

    if ($script:Fixed.Count) {
        Write-Host ''
        Line '  Problems found and fixed along the way:' 'Green'
        foreach ($f in $script:Fixed) { Line ('    - ' + $f) 'Green' }
    }
    if ($script:Warnings.Count) {
        Write-Host ''
        Line '  Warnings - the app will run, but read these:' 'Yellow'
        foreach ($w in $script:Warnings) {
            Line ('    - ' + $w.Text) 'Yellow'
            if ($w.Fix) { Line ('      ' + $w.Fix) 'DarkYellow' }
        }
    }

    Write-Host ''
    Line '  How to start it:' 'White'
    foreach ($n in $App.NextSteps) { Line ('    ' + $n) 'Gray' }
    Write-Host ''
    Line ('  Full log: ' + $LogFile) 'DarkGray'
    Write-Host ''
    exit 0

} catch {
    $msg = $_.Exception.Message
    $fix = ''
    if ($_.Exception.Data -and $_.Exception.Data['fix']) { $fix = [string]$_.Exception.Data['fix'] }
    Log ('FAILED: ' + $msg)
    if ($fix) { Log ('FIX: ' + $fix) }
    if ($_.ScriptStackTrace) { Log $_.ScriptStackTrace }

    Write-Host ''
    Box -Lines (@('INSTALL STOPPED  -  nothing is broken, it just did not finish')) -Colour 'Red'
    Write-Host ''
    Line '  What went wrong:' 'Red'
    foreach ($l in ($msg -split "`n")) { Line ('    ' + $l.Trim()) 'White' }
    if ($fix) {
        Write-Host ''
        Line '  How to fix it:' 'Yellow'
        foreach ($l in ($fix -split "`n")) { Line ('    ' + $l) 'Gray' }
    }
    Write-Host ''
    Line '  Still stuck?' 'White'
    Line ('    1. The full technical log is at  ' + $LogFile) 'Gray'
    Line  '    2. See the Troubleshooting table in INSTALL.md' 'Gray'
    if ($App.Issues) { Line ('    3. Open an issue with install.log attached:  ' + $App.Issues) 'Gray' }
    Write-Host ''
    exit 1
}
