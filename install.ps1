param([string]$CodexPath, [switch]$ReplaceMarketplace)
$ErrorActionPreference = 'Stop'
$taskMutex = New-Object Threading.Mutex($false, ('Local\CPAQuotaInstall-' + [Security.Principal.WindowsIdentity]::GetCurrent().User.Value))
$taskLocked = $false
$taskFailed = $false
try {
    try { $taskLocked = $taskMutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $taskLocked = $true }
    if (-not $taskLocked) { throw 'Another plugin installation is running. Try again after it finishes.' }
    if ($env:OS -ne 'Windows_NT') { throw 'This floating panel requires Windows.' }
    $taskPlugin = Join-Path $PSScriptRoot 'plugins\cliproxy-quota'
    . (Join-Path $taskPlugin 'scripts\resolve-node.ps1')
    $taskNode = Resolve-QuotaNode
    if (-not $CodexPath) {
        $taskCodexCommand = Get-Command codex.exe -ErrorAction SilentlyContinue
        if ($taskCodexCommand) { $CodexPath = $taskCodexCommand.Source }
    }
    if (-not $CodexPath) {
        $taskCodexBins = Join-Path $env:LOCALAPPDATA 'OpenAI\Codex\bin'
        $taskCodexFile = Get-ChildItem -Path (Join-Path $taskCodexBins '*\codex.exe') -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if ($taskCodexFile) { $CodexPath = $taskCodexFile.FullName }
    }
    if (-not $CodexPath -or -not (Test-Path -LiteralPath $CodexPath -PathType Leaf)) {
        throw 'Codex CLI was not found. Update Codex desktop or pass -CodexPath with the full codex.exe path.'
    }
    if (-not (Test-Path -LiteralPath (Join-Path $taskPlugin 'src\pet\QuotaPet.exe'))) {
        throw 'QuotaPet.exe is missing. Download the Windows release ZIP or run scripts\package.ps1 first.'
    }
    $taskManifest = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $taskPlugin '.codex-plugin\plugin.json') | ConvertFrom-Json
    $taskVersion = $taskManifest.version
    if ($taskVersion -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid plugin version.' }
    $taskMarketplaces = & $CodexPath plugin marketplace list --json
    if ($LASTEXITCODE -ne 0) { throw 'Failed to read configured marketplaces.' }
    $taskPrevious = ($taskMarketplaces | ConvertFrom-Json).marketplaces | Where-Object name -eq 'cpa-quota'
    if ($taskPrevious -and -not $ReplaceMarketplace) {
        throw 'A CPA Quota marketplace is already configured. Run Install.cmd or pass -ReplaceMarketplace to update it.'
    }
    $taskVersions = Join-Path $env:LOCALAPPDATA 'CodexCLIProxyQuota\marketplaces'
    $taskMarketplace = Join-Path $taskVersions ($taskVersion + '-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force -Path $taskMarketplace | Out-Null
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot '.agents'), (Join-Path $PSScriptRoot 'plugins') -Destination $taskMarketplace -Recurse
    $taskBackup = $null
    if ($taskPrevious) {
        $taskBackup = Join-Path $taskVersions ('rollback-' + [Guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $taskBackup | Out-Null
        Copy-Item -LiteralPath (Join-Path $taskPrevious.root '.agents'), (Join-Path $taskPrevious.root 'plugins') -Destination $taskBackup -Recurse
    }
    Write-Host "Using Node $taskNode"
    $taskChanged = $false
    try {
        if ($taskPrevious) {
            & $CodexPath plugin marketplace remove cpa-quota
            if ($LASTEXITCODE -ne 0) { throw 'Failed to change the configured marketplace.' }
        }
        $taskChanged = $true
        & $CodexPath plugin marketplace add $taskMarketplace
        if ($LASTEXITCODE -ne 0) { throw 'Failed to register the plugin marketplace.' }
        & $CodexPath plugin add cliproxy-quota@cpa-quota
        if ($LASTEXITCODE -ne 0) { throw 'Failed to install the plugin.' }
    }
    catch {
        if ($taskChanged -and $taskBackup) {
            $taskPreviousPreference = $ErrorActionPreference
            try { $ErrorActionPreference = 'Continue'; & $CodexPath plugin marketplace remove cpa-quota 2>$null | Out-Null }
            finally { $ErrorActionPreference = $taskPreviousPreference }
            & $CodexPath plugin marketplace add $taskBackup
            if ($LASTEXITCODE -ne 0) { throw 'Update failed and marketplace recovery failed. Run the previous release installer.' }
            & $CodexPath plugin add cliproxy-quota@cpa-quota
            if ($LASTEXITCODE -ne 0) { throw 'Update failed and plugin recovery failed. Run the previous release installer.' }
        }
        throw
    }
    Write-Host ''
    Write-Host "Installed CPA Quota $taskVersion. Restart Codex desktop."
    Write-Host 'Existing connection settings and appearance preferences are preserved.'
    Write-Host "Installer files are saved in $taskMarketplace. The extracted ZIP folder can be removed."
}
catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    $taskFailed = $true
}
finally {
    if ($taskLocked) { $taskMutex.ReleaseMutex() }
    $taskMutex.Dispose()
}
if ($taskFailed) { exit 1 }
exit 0
