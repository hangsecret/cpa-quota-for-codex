param(
    [Parameter(Mandatory = $true)][string]$Archive,
    [Parameter(Mandatory = $true)][string]$Destination,
    [Parameter(Mandatory = $true)][string]$ExpectedVersion
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$taskDestination = [IO.Path]::GetFullPath($Destination).TrimEnd('\') + '\'
$taskZip = [IO.Compression.ZipFile]::OpenRead($Archive)
try {
    $taskExpandedSize = 0L
    if ($taskZip.Entries.Count -gt 1000) { throw 'The update archive has too many entries.' }
    foreach ($taskEntry in $taskZip.Entries) {
        $taskExpandedSize += $taskEntry.Length
        if ($taskExpandedSize -gt 157286400) { throw 'The expanded update archive is too large.' }
        $taskPath = [IO.Path]::GetFullPath((Join-Path $taskDestination $taskEntry.FullName))
        if (-not $taskPath.StartsWith($taskDestination, [StringComparison]::OrdinalIgnoreCase)) {
            throw 'The update archive contains an invalid path.'
        }
    }
}
finally { $taskZip.Dispose() }
[IO.Compression.ZipFile]::ExtractToDirectory($Archive, $Destination)
$taskManifestPath = Join-Path $Destination 'plugins\cliproxy-quota\.codex-plugin\plugin.json'
$taskManifest = Get-Content -Raw -Encoding UTF8 -LiteralPath $taskManifestPath | ConvertFrom-Json
if ($taskManifest.name -ne 'cliproxy-quota' -or $taskManifest.version -ne $ExpectedVersion) {
    throw 'The update archive version does not match the release.'
}
& (Join-Path $Destination 'install.ps1') -ReplaceMarketplace
if ($LASTEXITCODE -ne 0) { throw 'The update installer failed.' }
