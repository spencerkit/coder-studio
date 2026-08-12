[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$PreviousInstaller,
  [Parameter(Mandatory = $true)][string]$CandidateInstaller,
  [Parameter(Mandatory = $true)][string]$CandidateTag,
  [Parameter(Mandatory = $true)][string]$ChannelUrl,
  [Parameter(Mandatory = $true)][string]$PreviousShellVersion,
  [Parameter(Mandatory = $true)][string]$PreviousRuntimeVersion,
  [Parameter(Mandatory = $true)][string]$ExpectedShellVersion,
  [Parameter(Mandatory = $true)][string]$ExpectedRuntimeVersion,
  [Parameter(Mandatory = $true)][AllowEmptyString()][string]$ExpectedComponents,
  [Parameter(Mandatory = $true)][string]$PublicKeyPath,
  [Parameter(Mandatory = $true)]
  [ValidateSet(
    'fresh-native',
    'fresh-wsl',
    'runtime-only',
    'combined',
    'wsl',
    'wsl-combined',
    'runtime-health-rollback',
    'interrupted-download',
    'restart-journal-recovery',
    'external-sidecar-browser'
  )]
  [string]$Scenario,
  [Parameter(Mandatory = $true)][string]$ReportPath,
  [string]$ExpectedRuntimeAfterRestart = '',
  [string]$CommitSha = '',
  [string]$ChannelSignatureDigest = '',
  [string]$WslDistro = '',
  [switch]$KeepOnFailure
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Resolve-RequiredFile([string]$Path, [string]$Label) {
  $resolved = [System.IO.Path]::GetFullPath($Path)
  if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) {
    throw "$Label does not exist: $resolved"
  }
  return $resolved
}

function Assert-Authenticode([string]$Path, [string]$Label) {
  $signature = Get-AuthenticodeSignature -LiteralPath $Path
  if ($signature.Status -ne 'Valid') {
    throw "$Label is not Authenticode-valid: $Path ($($signature.Status))"
  }
}

function Get-FreeTcpPort {
  $listener = [System.Net.Sockets.TcpListener]::new(
    [System.Net.IPAddress]::Loopback,
    0
  )
  $listener.Start()
  try {
    return ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
  } finally {
    $listener.Stop()
  }
}

function Wait-Cdp([int]$Port, [int]$TimeoutSeconds = 90) {
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  $lastError = $null
  while ([DateTime]::UtcNow -lt $deadline) {
    try {
      $pages = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json" -TimeoutSec 2
      if ($pages.Count -gt 0) {
        return $pages
      }
    } catch {
      $lastError = $_
    }
    Start-Sleep -Milliseconds 250
  }
  throw "Timed out waiting for installed Desktop CDP on port $Port. $lastError"
}

function Stop-AcceptanceDesktop([string]$Executable, [string]$UserDataDirectory) {
  $escapedExecutable = [Regex]::Escape($Executable)
  $escapedUserData = [Regex]::Escape($UserDataDirectory)
  $processes = Get-CimInstance Win32_Process | Where-Object {
    $_.ExecutablePath -match "^$escapedExecutable$" -and
    $_.CommandLine -match $escapedUserData
  }
  foreach ($process in $processes) {
    Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
  }
}

function Start-AcceptanceDesktop(
  [string]$Executable,
  [string]$UserDataDirectory,
  [int]$CdpPort,
  [string]$ScenarioName,
  [string]$Distro
) {
  $arguments = @(
    "--remote-debugging-port=$CdpPort",
    "--user-data-dir=$UserDataDirectory",
    "--coder-studio-environment-root=$UserDataDirectory"
  )
  if ($ScenarioName -in @('fresh-wsl', 'wsl', 'wsl-combined')) {
    $arguments += '--coder-studio-environment-target=wsl'
    $arguments += "--coder-studio-wsl-distro=$Distro"
  } else {
    $arguments += '--coder-studio-environment-target=native'
  }
  return Start-Process -FilePath $Executable -ArgumentList $arguments -PassThru
}

function Write-JsonAtomic([string]$Path, [object]$Value) {
  $destination = [System.IO.Path]::GetFullPath($Path)
  $directory = Split-Path -Parent $destination
  New-Item -ItemType Directory -Path $directory -Force | Out-Null
  $temporary = "$destination.$PID.$([Guid]::NewGuid().ToString('N')).tmp"
  try {
    $Value | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $temporary -Encoding UTF8
    Move-Item -LiteralPath $temporary -Destination $destination -Force
  } finally {
    Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
  }
}

function Preserve-AcceptanceEvidence(
  [string]$ReportFile,
  [string]$DriverStandardOut,
  [string]$DriverStandardError,
  [string]$UserDataDirectory,
  [string]$JournalFile
) {
  $resolvedReport = [System.IO.Path]::GetFullPath($ReportFile)
  $reportDirectory = Split-Path -Parent $resolvedReport
  $reportBaseName = [System.IO.Path]::GetFileNameWithoutExtension($resolvedReport)
  $evidenceDirectory = Join-Path $reportDirectory "$reportBaseName.evidence"
  New-Item -ItemType Directory -Path $evidenceDirectory -Force | Out-Null

  $sources = [System.Collections.Generic.List[string]]::new()
  foreach ($source in @($DriverStandardOut, $DriverStandardError, $JournalFile)) {
    if ($source -and (Test-Path -LiteralPath $source -PathType Leaf)) {
      $sources.Add([System.IO.Path]::GetFullPath($source))
    }
  }
  if (Test-Path -LiteralPath $UserDataDirectory -PathType Container) {
    Get-ChildItem -LiteralPath $UserDataDirectory -Recurse -File | Where-Object {
      $_.Name -match '(?i)(update|electron).*\.log$'
    } | ForEach-Object {
      $sources.Add($_.FullName)
    }
  }

  $preservedPaths = [System.Collections.Generic.List[string]]::new()
  $seenSources = [System.Collections.Generic.HashSet[string]]::new(
    [StringComparer]::OrdinalIgnoreCase
  )
  $index = 0
  foreach ($source in $sources) {
    if (-not $seenSources.Add($source)) { continue }
    $index += 1
    $destinationName = '{0:D2}-{1}' -f $index, [System.IO.Path]::GetFileName($source)
    $destination = Join-Path $evidenceDirectory $destinationName
    Copy-Item -LiteralPath $source -Destination $destination -Force
    $preservedPaths.Add([System.IO.Path]::GetFullPath($destination))
  }

  if (Test-Path -LiteralPath $resolvedReport -PathType Leaf) {
    $report = Get-Content -LiteralPath $resolvedReport -Raw | ConvertFrom-Json
    $report.logPaths = @($preservedPaths)
    Write-JsonAtomic $resolvedReport $report
  }
}

function Read-JournalIdentity([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    return $null
  }
  try {
    $journal = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
    return "$($journal.planId):$($journal.status)"
  } catch {
    return $null
  }
}

$previousInstallerPath = Resolve-RequiredFile $PreviousInstaller 'Previous installer'
$candidateInstallerPath = Resolve-RequiredFile $CandidateInstaller 'Candidate installer'
$publicKeyFile = Resolve-RequiredFile $PublicKeyPath 'Desktop acceptance public key'
Assert-Authenticode $previousInstallerPath 'Previous installer'
Assert-Authenticode $candidateInstallerPath 'Candidate installer'
$isFreshInstall = $Scenario -in @('fresh-native', 'fresh-wsl')
$isWslScenario = $Scenario -in @('fresh-wsl', 'wsl', 'wsl-combined')

$runId = "coder-studio-installed-acceptance-$([Guid]::NewGuid().ToString('N'))"
$runRoot = Join-Path ([System.IO.Path]::GetTempPath()) $runId
$installDirectory = Join-Path $runRoot 'installation'
$userDataDirectory = Join-Path $runRoot 'user-data'
$controlPath = Join-Path $runRoot 'interruption-control.json'
$driverOut = Join-Path $runRoot 'driver.stdout.log'
$driverErr = Join-Path $runRoot 'driver.stderr.log'
$journalPath = Join-Path $userDataDirectory 'desktop-update-plan.json'
$wslMarkerPath = "/tmp/$runId-npm-invoked"
$desktopExecutable = Join-Path $installDirectory 'Coder Studio.exe'
$cdpPort = Get-FreeTcpPort
$driverProcess = $null
$desktopProcess = $null
$failed = $true

try {
  New-Item -ItemType Directory -Path $runRoot -Force | Out-Null
  New-Item -ItemType Directory -Path $userDataDirectory -Force | Out-Null

  $installArguments = @('/S', "/D=$installDirectory")
  $bootstrapInstallerPath = if ($isFreshInstall) { $candidateInstallerPath } else { $previousInstallerPath }
  $installer = Start-Process -FilePath $bootstrapInstallerPath -ArgumentList $installArguments -Wait -PassThru
  if ($installer.ExitCode -ne 0) {
    throw "Bootstrap NSIS installer exited with $($installer.ExitCode)"
  }
  if (-not (Test-Path -LiteralPath $desktopExecutable -PathType Leaf)) {
    throw "Installed Desktop executable is missing: $desktopExecutable"
  }
  Assert-Authenticode $desktopExecutable 'Installed Desktop executable'

  if ($isWslScenario) {
    if (-not $WslDistro.StartsWith('coder-studio-acceptance-', [StringComparison]::Ordinal)) {
      throw 'WSL installed acceptance requires a disposable distro named coder-studio-acceptance-*'
    }
    & wsl.exe -d $WslDistro -u root -- sh -lc "rm -f '$wslMarkerPath'; printf '%s\n' '#!/bin/sh' 'touch $wslMarkerPath' 'printf %s\\n WSL_NPM_MUST_NOT_RUN >&2' 'exit 97' > /usr/local/bin/npm; chmod 755 /usr/local/bin/npm"
    if ($LASTEXITCODE -ne 0) {
      throw 'Unable to install the disposable WSL npm marker'
    }
  }

  $env:CODER_STUDIO_DESKTOP_ACCEPTANCE = '1'
  $env:CODER_STUDIO_DESKTOP_CHANNEL_URL = ([Uri]$ChannelUrl).AbsoluteUri
  $env:CODER_STUDIO_FACTORY_RELEASE_BASE_URL = ([Uri]::new([Uri]$ChannelUrl, '.')).AbsoluteUri
  $env:CODER_STUDIO_DESKTOP_PUBLIC_KEY_FILE = $publicKeyFile
  $env:CODER_STUDIO_DESKTOP_STATE_DIR = Join-Path $userDataDirectory 'data'
  $env:CODER_STUDIO_DESKTOP_UPLOADS_DIR = Join-Path $userDataDirectory 'uploads'
  if ($isFreshInstall) {
    $factoryRuntime = Join-Path $installDirectory 'resources/factory-runtime'
    $factoryEvidence = Join-Path $userDataDirectory 'factory-runtime'
    New-Item -ItemType Directory -Path $factoryEvidence -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $factoryRuntime 'runtime.manifest.json') -Destination (Join-Path $factoryEvidence 'runtime.manifest.json') -Force
  }
  if ($Scenario -eq 'runtime-health-rollback') {
    $env:CODER_STUDIO_DESKTOP_FAIL_RUNTIME_VERSION = $ExpectedRuntimeVersion
  } else {
    Remove-Item Env:CODER_STUDIO_DESKTOP_FAIL_RUNTIME_VERSION -ErrorAction SilentlyContinue
  }

  $initialScenario = if (
    $isWslScenario -and
    @($ExpectedComponents.Split(',')) -contains 'runtime:win32-x64'
  ) {
    'runtime-only'
  } else {
    $Scenario
  }
  $desktopProcess = Start-AcceptanceDesktop $desktopExecutable $userDataDirectory $cdpPort $initialScenario $WslDistro
  $pages = Wait-Cdp $cdpPort
  $sidecarUrl = ''
  foreach ($page in $pages) {
    if ($page.type -eq 'page' -and $page.url -match '^https?://') {
      $sidecarUrl = ([Uri]$page.url).GetLeftPart([System.UriPartial]::Authority)
      break
    }
  }

  $driverArgs = @(
    'exec', 'tsx', 'scripts/verify-desktop-installed-update.ts',
    '--cdp-url', "http://127.0.0.1:$cdpPort",
    '--scenario', $Scenario,
    '--components', $ExpectedComponents,
    '--previous-shell-version', $PreviousShellVersion,
    '--previous-runtime-version', $PreviousRuntimeVersion,
    '--target-shell-version', $ExpectedShellVersion,
    '--target-runtime-version', $ExpectedRuntimeVersion,
    '--report', ([System.IO.Path]::GetFullPath($ReportPath)),
    '--control', $controlPath,
    '--user-data-dir', $userDataDirectory,
    '--release-tag', $CandidateTag
  )
  if ($ExpectedRuntimeAfterRestart) {
    $driverArgs += @('--expected-runtime-after', $ExpectedRuntimeAfterRestart)
  }
  if ($CommitSha) {
    $driverArgs += @('--commit-sha', $CommitSha)
  }
  if ($ChannelSignatureDigest) {
    $driverArgs += @('--channel-signature-digest', $ChannelSignatureDigest)
  }
  if ($sidecarUrl) {
    $driverArgs += @('--sidecar-url', $sidecarUrl)
  }
  if ($isWslScenario) {
    $driverArgs += @('--wsl-distro', $WslDistro, '--wsl-marker-path', $wslMarkerPath)
  }

  $driverProcess = Start-Process -FilePath 'pnpm.cmd' -ArgumentList $driverArgs -PassThru -NoNewWindow -RedirectStandardOutput $driverOut -RedirectStandardError $driverErr
  $handledInterruptions = [System.Collections.Generic.HashSet[string]]::new(
    [StringComparer]::Ordinal
  )
  while (-not $driverProcess.HasExited) {
    if (Test-Path -LiteralPath $controlPath -PathType Leaf) {
      try {
        $control = Get-Content -LiteralPath $controlPath -Raw | ConvertFrom-Json
        $phase = [string]$control.phase
        if ($control.status -eq 'requested' -and -not $handledInterruptions.Contains($phase)) {
          $journalBefore = Read-JournalIdentity $journalPath
          Stop-AcceptanceDesktop $desktopExecutable $userDataDirectory
          $restartScenario = if ($phase -eq 'wsl-follow') {
            if ($Scenario -eq 'wsl-combined') {
              $env:CODER_STUDIO_DESKTOP_CHANNEL_URL = 'http://127.0.0.1:1/desktop-channel.json'
            }
            'wsl'
          } else {
            $Scenario
          }
          $desktopProcess = Start-AcceptanceDesktop $desktopExecutable $userDataDirectory $cdpPort $restartScenario $WslDistro
          Wait-Cdp $cdpPort | Out-Null
          $journalAfter = Read-JournalIdentity $journalPath
          Write-JsonAtomic $controlPath @{
            schemaVersion = 1
            phase = $control.phase
            status = 'relaunched'
            journalRecovered = ($null -ne $journalBefore -and $journalBefore -eq $journalAfter)
          }
          $handledInterruptions.Add($phase) | Out-Null
        }
      } catch {
        # The driver replaces this file atomically; retry partial observations.
      }
    }
    Start-Sleep -Milliseconds 200
    $driverProcess.Refresh()
  }
  if ($driverProcess.ExitCode -ne 0) {
    $stdout = if (Test-Path -LiteralPath $driverOut) { Get-Content -LiteralPath $driverOut -Raw } else { '' }
    $stderr = if (Test-Path -LiteralPath $driverErr) { Get-Content -LiteralPath $driverErr -Raw } else { '' }
    throw "Installed Desktop driver failed with $($driverProcess.ExitCode).`n$stdout`n$stderr"
  }
  if (-not (Test-Path -LiteralPath ([System.IO.Path]::GetFullPath($ReportPath)) -PathType Leaf)) {
    throw 'Installed Desktop driver did not produce its JSON report'
  }
  $failed = $false
} finally {
  Stop-AcceptanceDesktop $desktopExecutable $userDataDirectory
  Preserve-AcceptanceEvidence `
    ([System.IO.Path]::GetFullPath($ReportPath)) `
    $driverOut `
    $driverErr `
    $userDataDirectory `
    $journalPath
  if (Test-Path -LiteralPath (Join-Path $installDirectory 'Uninstall Coder Studio.exe')) {
    Start-Process -FilePath (Join-Path $installDirectory 'Uninstall Coder Studio.exe') -ArgumentList '/S' -Wait -ErrorAction SilentlyContinue | Out-Null
  }
  if ($isWslScenario -and $WslDistro.StartsWith('coder-studio-acceptance-', [StringComparison]::Ordinal)) {
    & wsl.exe -d $WslDistro -u root -- sh -lc "rm -f '$wslMarkerPath' /usr/local/bin/npm" 2>$null
  }
  if (-not ($failed -and $KeepOnFailure)) {
    Remove-Item -LiteralPath $runRoot -Recurse -Force -ErrorAction SilentlyContinue
  } else {
    Write-Warning "Installed acceptance evidence retained at $runRoot"
  }
}
