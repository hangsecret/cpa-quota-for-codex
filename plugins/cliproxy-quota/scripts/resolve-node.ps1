function Resolve-QuotaNode {
    $taskCandidates = @()
    if ($env:CPA_QUOTA_NODE) {
        $taskCandidates = @($env:CPA_QUOTA_NODE)
    }
    else {
        $taskProfile = [Environment]::GetFolderPath('UserProfile')
        $taskCandidates += Join-Path $taskProfile '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
        $taskPathNode = Get-Command node.exe -ErrorAction SilentlyContinue
        if ($taskPathNode) { $taskCandidates += $taskPathNode.Source }
    }
    foreach ($taskCandidate in ($taskCandidates | Select-Object -Unique)) {
        if (-not (Test-Path -LiteralPath $taskCandidate -PathType Leaf)) { continue }
        $taskPreviousPreference = $ErrorActionPreference
        try {
            $ErrorActionPreference = 'Continue'
            & $taskCandidate --disable-warning=ExperimentalWarning -e "const [major,minor]=process.versions.node.split('.').map(Number); if(major<22||(major===22&&minor<13))process.exit(1);require('node:sqlite');" 2>$null | Out-Null
            $taskCompatible = $LASTEXITCODE -eq 0
        }
        finally { $ErrorActionPreference = $taskPreviousPreference }
        if ($taskCompatible) { return $taskCandidate }
    }
    throw 'Node.js 22.13+ with node:sqlite is required. Install Node.js LTS, or set CPA_QUOTA_NODE to a compatible node.exe path.'
}
