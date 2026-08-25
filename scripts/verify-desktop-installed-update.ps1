[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$PreviousInstaller,
  [Parameter(Mandatory = $true)][string]$CandidateInstaller,
  [Parameter(Mandatory = $true)][string]$CandidateTag,
  [Parameter(Mandatory = $true)][string]$ChannelUrl,
  [string]$ProductChannelUrl = '',
  [Parameter(Mandatory = $true)][string]$PreviousShellVersion,
  [Parameter(Mandatory = $true)][string]$PreviousRuntimeVersion,
  [Parameter(Mandatory = $true)][string]$ExpectedShellVersion,
  [Parameter(Mandatory = $true)][string]$ExpectedRuntimeVersion,
  [string]$ExpectedComponents = '',
  [Parameter(Mandatory = $true)][string]$PublicKeyPath,
  [Parameter(Mandatory = $true)]
  [ValidateSet(
    'fresh-native',
    'fresh-wsl',
    'legacy-current',
    'legacy-wsl-current',
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
  [switch]$SkipAuthenticode,
  [switch]$AllowFailedFrozenState,
  [switch]$PinLegacyShellUpdaterToChannel,
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

function Set-LegacyShellUpdaterFeed([string]$InstallDirectory, [string]$ChannelUrl) {
  $appUpdatePath = Join-Path $InstallDirectory 'resources/app-update.yml'
  if (-not (Test-Path -LiteralPath $appUpdatePath -PathType Leaf)) {
    throw "Installed Desktop updater config is missing: $appUpdatePath"
  }
  $existingConfig = Get-Content -LiteralPath $appUpdatePath -Raw
  $cacheLine = [regex]::Match($existingConfig, '(?m)^updaterCacheDirName:\s*.+$').Value.Trim()
  $releaseBaseUrl = ([Uri]::new([Uri]$ChannelUrl, '.')).AbsoluteUri
  $content = @(
    'provider: generic'
    "url: $releaseBaseUrl"
    'channel: latest'
  )
  if ($cacheLine) {
    $content += $cacheLine
  }
  ($content -join "`n") + "`n" | Set-Content -LiteralPath $appUpdatePath -Encoding utf8
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

function Stop-CdpPortOwner([int]$Port) {
  if ($Port -le 0) { return }
  try {
    $owners = @(
      Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique
    )
  } catch {
    $owners = @()
  }
  foreach ($owner in $owners) {
    if ($null -ne $owner -and $owner -gt 0) {
      Stop-Process -Id $owner -Force -ErrorAction SilentlyContinue
    }
  }
}

function Get-ProcessesForExecutable([string]$Executable) {
  $escapedExecutable = [Regex]::Escape($Executable)
  return @(
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
      $_.ExecutablePath -match "^$escapedExecutable$"
    }
  )
}

function Stop-AcceptanceDesktop([string]$Executable, [string]$UserDataDirectory, [int]$CdpPort = 0) {
  $escapedUserData = [Regex]::Escape($UserDataDirectory)
  $processes = Get-ProcessesForExecutable $Executable | Where-Object {
    $_.CommandLine -match $escapedUserData
  }
  foreach ($process in $processes) {
    Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
  }
  Stop-CdpPortOwner $CdpPort
}

function Wait-ForUpdateOwnerLeaseExpiry {
  # Crash recovery must wait past the proper-lockfile owner lease's 10-second stale window.
  Start-Sleep -Seconds 11
}

function Stop-InstalledDesktopExecutable([string]$Executable, [int]$CdpPort = 0) {
  foreach ($process in @(Get-ProcessesForExecutable $Executable)) {
    Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
  }
  Stop-CdpPortOwner $CdpPort
}

function Start-AcceptanceDesktop(
  [string]$Executable,
  [string]$UserDataDirectory,
  [int]$CdpPort,
  [string]$ScenarioName,
  [string]$Distro,
  [string]$StandardOut,
  [string]$StandardError
) {
  $arguments = @(
    "--remote-debugging-port=$CdpPort",
    "--user-data-dir=$UserDataDirectory",
    "--coder-studio-environment-root=$UserDataDirectory"
  )
  if ($ScenarioName -in @('fresh-wsl', 'legacy-wsl-current', 'wsl', 'wsl-combined')) {
    $arguments += '--coder-studio-environment-target=wsl'
    $arguments += "--coder-studio-wsl-distro=$Distro"
  } else {
    $arguments += '--coder-studio-environment-target=native'
  }
  return Start-Process -FilePath $Executable -ArgumentList $arguments -PassThru `
    -RedirectStandardOutput $StandardOut -RedirectStandardError $StandardError
}

function Get-SidecarUrl([object[]]$Pages) {
  foreach ($page in $Pages) {
    if ($page.type -eq 'page' -and $page.url -match '^https?://') {
      return ([Uri]$page.url).GetLeftPart([System.UriPartial]::Authority)
    }
  }
  return ''
}

function Test-ShellVersionMatch([string]$ObservedVersion, [string]$ExpectedVersion) {
  if ([string]::IsNullOrWhiteSpace($ObservedVersion) -or [string]::IsNullOrWhiteSpace($ExpectedVersion)) {
    return $false
  }
  return $ObservedVersion -eq $ExpectedVersion -or
    $ObservedVersion.StartsWith("$ExpectedVersion.", [StringComparison]::Ordinal)
}

function Get-InstalledDesktopShellVersion([string]$InstallDirectory, [string]$Executable) {
  $buildInfoPath = Join-Path $InstallDirectory 'resources/build-info.json'
  if (Test-Path -LiteralPath $buildInfoPath -PathType Leaf) {
    try {
      $buildInfo = Get-Content -LiteralPath $buildInfoPath -Raw | ConvertFrom-Json
      if ($buildInfo.shellVersion) {
        return [string]$buildInfo.shellVersion
      }
    } catch {
      # Fall through to file metadata when build-info.json is missing or incomplete.
    }
  }
  if (Test-Path -LiteralPath $Executable -PathType Leaf) {
    try {
      $versionInfo = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($Executable)
      foreach ($candidate in @($versionInfo.ProductVersion, $versionInfo.FileVersion)) {
        if (-not [string]::IsNullOrWhiteSpace($candidate)) {
          return [string]$candidate
        }
      }
    } catch {
      # Ignore metadata read failures and let the caller retry.
    }
  }
  return $null
}

function Wait-ForInstalledShellVersion(
  [string]$InstallDirectory,
  [string]$Executable,
  [string]$ExpectedVersion,
  [int]$TimeoutSeconds = 20
) {
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  $lastObservedVersion = $null
  while ([DateTime]::UtcNow -lt $deadline) {
    $lastObservedVersion = Get-InstalledDesktopShellVersion $InstallDirectory $Executable
    if (Test-ShellVersionMatch $lastObservedVersion $ExpectedVersion) {
      return $lastObservedVersion
    }
    Start-Sleep -Milliseconds 500
  }
  throw "Timed out waiting for installed Desktop Shell version $ExpectedVersion. Observed: $lastObservedVersion"
}

function Get-InstallerProcesses([string]$InstallerFileName) {
  if ([string]::IsNullOrWhiteSpace($InstallerFileName)) {
    return @()
  }
  $escapedInstallerName = [Regex]::Escape($InstallerFileName)
  $installerBaseName = [System.IO.Path]::GetFileNameWithoutExtension($InstallerFileName)
  $escapedInstallerBaseName = [Regex]::Escape($installerBaseName)
  return @(
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
      ($_.Name -match "^$escapedInstallerName$") -or
      ($_.Name -match "^$escapedInstallerBaseName$") -or
      ($_.ExecutablePath -and [System.IO.Path]::GetFileName($_.ExecutablePath) -match "^$escapedInstallerName$")
    }
  )
}

function Stop-InstallerProcesses([string]$InstallerFileName) {
  foreach ($process in @(Get-InstallerProcesses $InstallerFileName)) {
    Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
  }
}

function Start-SilentInstaller([string]$InstallerPath, [string]$InstallDirectory) {
  $installerArguments = @('/S', "/D=$InstallDirectory")
  $installerProcess = Start-Process -FilePath $InstallerPath -ArgumentList $installerArguments -PassThru
  $installerProcess.Handle | Out-Null
  return $installerProcess
}

function Wait-ForInstalledShellInstall(
  [string]$InstallDirectory,
  [string]$Executable,
  [string]$ExpectedVersion,
  [string]$InstallerFileName,
  [int]$TimeoutSeconds = 180,
  [int]$CdpPort = 0
) {
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  $lastObservedVersion = $null
  $lastInstallerCount = 0
  while ([DateTime]::UtcNow -lt $deadline) {
    Stop-InstalledDesktopExecutable $Executable $CdpPort
    $lastObservedVersion = Get-InstalledDesktopShellVersion $InstallDirectory $Executable
    $lastInstallerCount = @(Get-InstallerProcesses $InstallerFileName).Count
    if ($lastInstallerCount -eq 0 -and (Test-ShellVersionMatch $lastObservedVersion $ExpectedVersion)) {
      return $lastObservedVersion
    }
    Start-Sleep -Milliseconds 500
  }
  throw "Timed out waiting for the Desktop Shell installer to settle at version $ExpectedVersion. Observed: $lastObservedVersion. Installer processes: $lastInstallerCount"
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
  [string]$JournalFile,
  [string]$FailureFile,
  [string]$DesktopStandardOut,
  [string]$DesktopStandardError
) {
  $resolvedReport = [System.IO.Path]::GetFullPath($ReportFile)
  $reportDirectory = Split-Path -Parent $resolvedReport
  $reportBaseName = [System.IO.Path]::GetFileNameWithoutExtension($resolvedReport)
  $evidenceDirectory = Join-Path $reportDirectory "$reportBaseName.evidence"
  New-Item -ItemType Directory -Path $evidenceDirectory -Force | Out-Null

  $sources = [System.Collections.Generic.List[string]]::new()
  foreach ($source in @(
    $DriverStandardOut,
    $DriverStandardError,
    $JournalFile,
    $FailureFile,
    $DesktopStandardOut,
    $DesktopStandardError
  )) {
    if ($source -and (Test-Path -LiteralPath $source -PathType Leaf)) {
      $sources.Add([System.IO.Path]::GetFullPath($source))
    }
  }
  if (Test-Path -LiteralPath $UserDataDirectory -PathType Container) {
    Get-ChildItem -LiteralPath $UserDataDirectory -Recurse -File | Where-Object {
      $_.Name -match '(?i)(update|electron).*\.log$' -or
      $_.Name -in @('main.log', 'backend.log')
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
$candidateInstallerName = [System.IO.Path]::GetFileName($candidateInstallerPath)
$publicKeyFile = Resolve-RequiredFile $PublicKeyPath 'Desktop acceptance public key'
if (-not $SkipAuthenticode) {
  Assert-Authenticode $previousInstallerPath 'Previous installer'
  Assert-Authenticode $candidateInstallerPath 'Candidate installer'
}
$isFreshInstall = $Scenario -in @('fresh-native', 'fresh-wsl')
$isWslScenario = $Scenario -in @('fresh-wsl', 'legacy-wsl-current', 'wsl', 'wsl-combined')

$runId = "coder-studio-installed-acceptance-$([Guid]::NewGuid().ToString('N'))"
$runRoot = Join-Path ([System.IO.Path]::GetTempPath()) $runId
$installDirectory = Join-Path $runRoot 'installation'
$userDataDirectory = Join-Path $runRoot 'user-data'
$controlPath = Join-Path $runRoot 'interruption-control.json'
$driverOut = Join-Path $runRoot 'driver.stdout.log'
$driverErr = Join-Path $runRoot 'driver.stderr.log'
$desktopOut = Join-Path $runRoot 'desktop.stdout.log'
$desktopErr = Join-Path $runRoot 'desktop.stderr.log'
$failurePath = Join-Path $runRoot 'acceptance.failure.log'
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
  if (-not $SkipAuthenticode) {
    Assert-Authenticode $desktopExecutable 'Installed Desktop executable'
  }
  if ($PinLegacyShellUpdaterToChannel) {
    Set-LegacyShellUpdaterFeed $installDirectory $ChannelUrl
  }

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
  if ($ProductChannelUrl) {
    $env:CODER_STUDIO_PRODUCT_CHANNEL_URL = ([Uri]$ProductChannelUrl).AbsoluteUri
  } else {
    Remove-Item Env:CODER_STUDIO_PRODUCT_CHANNEL_URL -ErrorAction SilentlyContinue
  }
  $env:CODER_STUDIO_FACTORY_RELEASE_BASE_URL = ([Uri]::new([Uri]$ChannelUrl, '.')).AbsoluteUri
  $env:CODER_STUDIO_DESKTOP_PUBLIC_KEY_FILE = $publicKeyFile
  $env:CODER_STUDIO_DESKTOP_STATE_DIR = Join-Path $userDataDirectory 'data'
  $env:CODER_STUDIO_DESKTOP_UPLOADS_DIR = Join-Path $userDataDirectory 'uploads'
  if ($isFreshInstall) {
    $factoryRuntime = Join-Path $installDirectory 'resources/factory-runtime'
    $factoryEvidence = Join-Path $userDataDirectory 'factory-runtime'
    New-Item -ItemType Directory -Path $factoryEvidence -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $factoryRuntime 'manifest.json') -Destination (Join-Path $factoryEvidence 'runtime.manifest.json') -Force
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
  $desktopProcess = Start-AcceptanceDesktop $desktopExecutable $userDataDirectory $cdpPort $initialScenario $WslDistro $desktopOut $desktopErr
  $desktopProcess.Handle | Out-Null
  # A fresh WSL launch downloads, verifies, and installs both Engine and Runtime before it
  # creates a page. Keep native and subsequent restart checks at the stricter default.
  $startupTimeoutSeconds = if ($isWslScenario) { 300 } else { 90 }
  $pages = Wait-Cdp $cdpPort $startupTimeoutSeconds
  $sidecarUrl = Get-SidecarUrl $pages

  $driverArgs = @(
    'exec', 'tsx', 'scripts/verify-desktop-installed-update.ts',
    '--cdp-url', "http://127.0.0.1:$cdpPort",
    '--scenario', $Scenario,
    '--previous-shell-version', $PreviousShellVersion,
    '--previous-runtime-version', $PreviousRuntimeVersion,
    '--target-shell-version', $ExpectedShellVersion,
    '--target-runtime-version', $ExpectedRuntimeVersion,
    '--report', ([System.IO.Path]::GetFullPath($ReportPath)),
    '--control', $controlPath,
    '--user-data-dir', $userDataDirectory,
    '--release-tag', $CandidateTag
  )
  if ($ExpectedComponents) {
    $driverArgs += @('--components', $ExpectedComponents)
  }
  if ($ExpectedRuntimeAfterRestart) {
    $driverArgs += @('--expected-runtime-after', $ExpectedRuntimeAfterRestart)
  }
  if ($CommitSha) {
    $driverArgs += @('--commit-sha', $CommitSha)
  }
  if ($ChannelSignatureDigest) {
    $driverArgs += @('--channel-signature-digest', $ChannelSignatureDigest)
  }
  if ($AllowFailedFrozenState) {
    $driverArgs += @('--allow-failed-frozen-state', 'true')
  }
  if ($sidecarUrl) {
    $driverArgs += @('--sidecar-url', $sidecarUrl)
  }
  if ($isWslScenario) {
    $driverArgs += @('--wsl-distro', $WslDistro, '--wsl-marker-path', $wslMarkerPath)
  }

  $driverProcess = Start-Process -FilePath 'pnpm.cmd' -ArgumentList $driverArgs -PassThru -NoNewWindow -RedirectStandardOutput $driverOut -RedirectStandardError $driverErr
  # Windows PowerShell 5.1 can return a null ExitCode after redirected Start-Process
  # output unless the process handle is opened before the process exits.
  $driverProcess.Handle | Out-Null
  $handledInterruptions = [System.Collections.Generic.HashSet[string]]::new(
    [StringComparer]::Ordinal
  )
  $restartAfterInstallArmed = $false
  $restartAfterInstallArmedAt = $null
  $restartAfterInstallHandled = $false
  while (-not $driverProcess.HasExited) {
    if (Test-Path -LiteralPath $controlPath -PathType Leaf) {
      try {
        $control = Get-Content -LiteralPath $controlPath -Raw | ConvertFrom-Json
        $phase = [string]$control.phase
        if ($phase -eq 'install-restart' -and $control.status -eq 'armed') {
          $restartAfterInstallArmed = $true
          if ($null -eq $restartAfterInstallArmedAt) {
            $restartAfterInstallArmedAt = [DateTime]::UtcNow
          }
        } elseif ($control.status -eq 'requested' -and -not $handledInterruptions.Contains($phase)) {
          $journalBefore = Read-JournalIdentity $journalPath
          Stop-AcceptanceDesktop $desktopExecutable $userDataDirectory $cdpPort
          Wait-ForUpdateOwnerLeaseExpiry
          $restartScenario = if ($phase -eq 'wsl-follow') {
            if ($Scenario -eq 'wsl-combined') {
              $env:CODER_STUDIO_DESKTOP_CHANNEL_URL = 'http://127.0.0.1:1/desktop-channel.json'
            }
            'wsl'
          } else {
            $Scenario
          }
          $desktopProcess = Start-AcceptanceDesktop $desktopExecutable $userDataDirectory $cdpPort $restartScenario $WslDistro $desktopOut $desktopErr
          $desktopProcess.Handle | Out-Null
          $restartTimeoutSeconds = if ($phase -eq 'wsl-follow') { 300 } else { 90 }
          $restartPages = Wait-Cdp $cdpPort $restartTimeoutSeconds
          $restartSidecarUrl = Get-SidecarUrl $restartPages
          $sidecarUrl = $restartSidecarUrl
          $journalAfter = Read-JournalIdentity $journalPath
          # A fully reconciled plan is cleared during startup; the recovered state is
          # validated by the driver before this evidence is accepted.
          $journalRecovered = $null -ne $journalBefore -and (
            $null -eq $journalAfter -or $journalBefore -eq $journalAfter
          )
          Write-JsonAtomic $controlPath @{
            schemaVersion = 1
            phase = $control.phase
            status = 'relaunched'
            journalRecovered = $journalRecovered
            cdpUrl = "http://127.0.0.1:$cdpPort"
            sidecarUrl = $restartSidecarUrl
          }
          $handledInterruptions.Add($phase) | Out-Null
        }
      } catch {
        # The driver replaces this file atomically; retry partial observations.
      }
    }
    if ($restartAfterInstallArmed -and -not $restartAfterInstallHandled -and $null -ne $desktopProcess) {
      $desktopProcess.Refresh()
      if (-not $desktopProcess.HasExited -and $null -ne $restartAfterInstallArmedAt -and [DateTime]::UtcNow -ge $restartAfterInstallArmedAt.AddSeconds(15)) {
        Stop-AcceptanceDesktop $desktopExecutable $userDataDirectory $cdpPort
        Start-Sleep -Seconds 1
        $desktopProcess.Refresh()
      }
      if ($desktopProcess.HasExited) {
        if ($PinLegacyShellUpdaterToChannel) {
          Stop-InstallerProcesses $candidateInstallerName
          Start-Sleep -Seconds 1
          Start-SilentInstaller $candidateInstallerPath $installDirectory | Out-Null
        }
        Wait-ForInstalledShellInstall `
          $installDirectory `
          $desktopExecutable `
          $ExpectedShellVersion `
          $candidateInstallerName `
          180 `
          $cdpPort | Out-Null
        $restartDeadline = [DateTime]::UtcNow.AddSeconds(60)
        $relaunchError = $null
        while ([DateTime]::UtcNow -lt $restartDeadline) {
          try {
            Stop-InstalledDesktopExecutable $desktopExecutable $cdpPort
            $cdpPort = Get-FreeTcpPort
            $desktopProcess = Start-AcceptanceDesktop $desktopExecutable $userDataDirectory $cdpPort $initialScenario $WslDistro $desktopOut $desktopErr
            $desktopProcess.Handle | Out-Null
            $restartPages = Wait-Cdp $cdpPort 15
            $restartSidecarUrl = Get-SidecarUrl $restartPages
            $sidecarUrl = $restartSidecarUrl
            Write-JsonAtomic $controlPath @{
              schemaVersion = 1
              phase = 'install-restart'
              status = 'relaunched'
              cdpUrl = "http://127.0.0.1:$cdpPort"
              sidecarUrl = $restartSidecarUrl
            }
            $restartAfterInstallHandled = $true
            break
          } catch {
            $relaunchError = $_
            Start-Sleep -Seconds 1
          }
        }
        if (-not $restartAfterInstallHandled) {
          throw "Timed out relaunching the installed Desktop after Shell update. $relaunchError"
        }
      }
    }
    Start-Sleep -Milliseconds 200
    $driverProcess.Refresh()
  }
  $driverProcess.WaitForExit()
  if ($driverProcess.ExitCode -ne 0) {
    $stdout = if (Test-Path -LiteralPath $driverOut) { Get-Content -LiteralPath $driverOut -Raw } else { '' }
    $stderr = if (Test-Path -LiteralPath $driverErr) { Get-Content -LiteralPath $driverErr -Raw } else { '' }
    throw "Installed Desktop driver failed with $($driverProcess.ExitCode).`n$stdout`n$stderr"
  }
  if (-not (Test-Path -LiteralPath ([System.IO.Path]::GetFullPath($ReportPath)) -PathType Leaf)) {
    throw 'Installed Desktop driver did not produce its JSON report'
  }
  $failed = $false
} catch {
  $failureDetails = [System.Collections.Generic.List[string]]::new()
  $failureDetails.Add(($_ | Out-String).TrimEnd())
  if ($null -ne $desktopProcess) {
    try {
      $desktopProcess.Refresh()
      $failureDetails.Add("Desktop process id: $($desktopProcess.Id)")
      $failureDetails.Add("Desktop process exited: $($desktopProcess.HasExited)")
    } catch {
      $failureDetails.Add("Unable to inspect Desktop process: $($_.Exception.Message)")
    }
  }
  $failureDetails | Set-Content -LiteralPath $failurePath -Encoding UTF8
  throw
} finally {
  Stop-AcceptanceDesktop $desktopExecutable $userDataDirectory $cdpPort
  Preserve-AcceptanceEvidence `
    ([System.IO.Path]::GetFullPath($ReportPath)) `
    $driverOut `
    $driverErr `
    $userDataDirectory `
    $journalPath `
    $failurePath `
    $desktopOut `
    $desktopErr
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
