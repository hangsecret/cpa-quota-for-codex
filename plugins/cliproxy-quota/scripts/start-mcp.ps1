$ErrorActionPreference = 'Stop'
$OutputEncoding = [Console]::InputEncoding = [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
. (Join-Path $PSScriptRoot 'resolve-node.ps1')
$taskNode = Resolve-QuotaNode
$taskServer = Join-Path (Split-Path -Parent $PSScriptRoot) 'src\server.mjs'
$ErrorActionPreference = 'Continue'
& $taskNode --disable-warning=ExperimentalWarning $taskServer
exit $LASTEXITCODE
