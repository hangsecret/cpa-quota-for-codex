param([string]$CodexPath)
$ErrorActionPreference = 'Stop'
try {
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
    $taskMarketplace = Join-Path $env:LOCALAPPDATA 'CodexCLIProxyQuota\marketplace'
    New-Item -ItemType Directory -Force -Path $taskMarketplace | Out-Null
    if ([IO.Path]::GetFullPath($PSScriptRoot) -ne [IO.Path]::GetFullPath($taskMarketplace)) {
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot '.agents'), (Join-Path $PSScriptRoot 'plugins') -Destination $taskMarketplace -Recurse -Force
    }
    Write-Host "Using Node $taskNode"
    & $CodexPath plugin marketplace add $taskMarketplace
    if ($LASTEXITCODE -ne 0) { throw 'Failed to register the plugin marketplace.' }
    & $CodexPath plugin add cliproxy-quota@cpa-quota
    if ($LASTEXITCODE -ne 0) { throw 'Failed to install the plugin.' }
    Write-Host ''
    Write-Host "Installed CPA Quota $taskVersion. Restart Codex desktop."
    Write-Host 'Open the floating panel settings, then enter your CLIProxy management URL and management key.'
    Write-Host "Installer files are saved in $taskMarketplace. The extracted ZIP folder can be removed."
}
catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
