$ErrorActionPreference = 'Stop'
$taskFramework = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
$taskOutput = Join-Path $PSScriptRoot 'QuotaPet.exe'
$taskIcon = Join-Path $PSScriptRoot 'quota-icon.ico'
& (Join-Path $taskFramework 'csc.exe') /nologo /target:winexe "/out:$taskOutput" `
    "/win32icon:$taskIcon" "/resource:$taskIcon,QuotaPet.Icon" `
    "/reference:$taskFramework\WPF\PresentationFramework.dll" `
    "/reference:$taskFramework\WPF\PresentationCore.dll" `
    "/reference:$taskFramework\WPF\WindowsBase.dll" `
    "/reference:$taskFramework\System.Xaml.dll" `
    /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll /reference:Microsoft.CSharp.dll `
    (Join-Path $PSScriptRoot 'QuotaPet.cs') (Join-Path $PSScriptRoot 'PetPreferences.cs') (Join-Path $PSScriptRoot 'CodexLifetime.cs')
if ($LASTEXITCODE -ne 0) { throw '桌面面板编译失败。' }
$taskOutput
