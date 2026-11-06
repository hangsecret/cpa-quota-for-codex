$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskPlugin = Join-Path $taskRoot 'plugins\cliproxy-quota'
$taskManifest = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $taskPlugin '.codex-plugin\plugin.json') | ConvertFrom-Json
$taskVersion = $taskManifest.version
if ($taskVersion -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid plugin version.' }
& (Join-Path $taskPlugin 'src\pet\build.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Panel build failed.' }
$taskOutput = Join-Path $taskRoot 'dist'
New-Item -ItemType Directory -Force -Path $taskOutput | Out-Null
$taskArchivePath = Join-Path $taskOutput "cpa-quota-for-codex-$taskVersion-windows.zip"
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$taskArchiveFile = [IO.File]::Open($taskArchivePath, [IO.FileMode]::Create)
$taskArchive = New-Object IO.Compression.ZipArchive($taskArchiveFile, [IO.Compression.ZipArchiveMode]::Create)
try {
$taskFiles = @(Get-Item -LiteralPath (Join-Path $taskRoot 'README.md'), (Join-Path $taskRoot 'CHANGELOG.md'), (Join-Path $taskRoot 'Install.cmd'), (Join-Path $taskRoot 'install.ps1'))
    $taskFiles += Get-ChildItem -LiteralPath (Join-Path $taskRoot '.agents'), $taskPlugin -Recurse -File -Force |
        Where-Object { $_.Name -notlike '*.test.*' }
    foreach ($taskFile in $taskFiles) {
        $taskEntry = $taskFile.FullName.Substring($taskRoot.Length + 1).Replace('\', '/')
        [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($taskArchive, $taskFile.FullName, $taskEntry) | Out-Null
    }
}
finally { $taskArchive.Dispose(); $taskArchiveFile.Dispose() }
$taskHash = (Get-FileHash -LiteralPath $taskArchivePath -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText((Join-Path $taskOutput 'SHA256SUMS.txt'), "$taskHash  $([IO.Path]::GetFileName($taskArchivePath))`n", (New-Object Text.UTF8Encoding($false)))
$taskNotes = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $taskRoot 'CHANGELOG.md')
$taskNotes = [regex]::Match($taskNotes, ('(?s)## ' + [regex]::Escape($taskVersion) + '\s*\r?\n(.*?)(?=\r?\n## |\z)')).Groups[1].Value.Trim()
if (-not $taskNotes) { throw 'Release notes for the current version are missing.' }
$taskUpdate = @{ version = $taskVersion; sha256 = $taskHash; notes = $taskNotes
    downloadUrl = "https://github.com/hangsecret/cpa-quota-for-codex/releases/download/v$taskVersion/cpa-quota-for-codex-$taskVersion-windows.zip" }
[IO.File]::WriteAllText((Join-Path $taskOutput 'update.json'), ($taskUpdate | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
Write-Output $taskArchivePath
