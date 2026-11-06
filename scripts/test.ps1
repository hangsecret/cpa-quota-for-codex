$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskPlugin = Join-Path $taskRoot 'plugins\cliproxy-quota'
. (Join-Path $taskPlugin 'scripts\resolve-node.ps1')
$taskNode = Resolve-QuotaNode
$taskTests = @(Get-ChildItem -LiteralPath (Join-Path $taskPlugin 'src') -Filter '*.test.mjs' | ForEach-Object { $_.FullName })
& $taskNode --disable-warning=ExperimentalWarning --test @taskTests
if ($LASTEXITCODE -ne 0) { throw 'Node tests failed.' }
$taskFramework = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
$taskNative = Join-Path $taskPlugin 'src\pet'
$taskOutput = Join-Path $taskRoot 'work'
New-Item -ItemType Directory -Force -Path $taskOutput | Out-Null
$taskPreferencesTest = Join-Path $taskOutput 'PetPreferences.test.exe'
& (Join-Path $taskFramework 'csc.exe') /nologo "/out:$taskPreferencesTest" `
    "/reference:$taskFramework\WPF\WindowsBase.dll" /reference:System.Web.Extensions.dll `
    (Join-Path $taskNative 'PetPreferences.cs') (Join-Path $taskNative 'PetPreferences.test.cs')
if ($LASTEXITCODE -ne 0) { throw 'Preferences test compilation failed.' }
& $taskPreferencesTest
if ($LASTEXITCODE -ne 0) { throw 'Preferences tests failed.' }
$taskLifetimeTest = Join-Path $taskOutput 'CodexLifetime.test.exe'
& (Join-Path $taskFramework 'csc.exe') /nologo "/out:$taskLifetimeTest" `
    (Join-Path $taskNative 'CodexLifetime.cs') (Join-Path $taskNative 'CodexLifetime.test.cs')
if ($LASTEXITCODE -ne 0) { throw 'Lifetime test compilation failed.' }
& $taskLifetimeTest
if ($LASTEXITCODE -ne 0) { throw 'Lifetime tests failed.' }
