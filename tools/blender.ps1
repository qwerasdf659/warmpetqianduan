<#
.SYNOPSIS
    资产管线里所有 Blender 脚本的唯一入口。

.DESCRIPTION
    解析 blender.exe 的位置、断言版本、套上无头运行必需的那串开关，
    再把参数原样转给脚本。

    存在的理由：规则文档以前把调用写成 `blender ... --python tools/xxx.py`，
    那串省略号里藏着四个不能漏的开关（漏 --factory-startup 会让本机偏好设置
    污染产物，漏 --python-exit-code 1 会让脚本抛异常了还返回 0），
    以及一个没人钉过的版本号。

.EXAMPLE
    tools\blender.ps1 build_skeleton.py --out assets-src/pet --species cat

.EXAMPLE
    tools\blender.ps1 inspect_fbx.py --file assets-src/pet/pet_cat.glb

.EXAMPLE
    # 负值参数必须写等号形式，否则 argparse 会把它当成下一个选项
    tools\blender.ps1 inspect_source.py --file x.glb "--forward=-y"

.EXAMPLE
    # 换机器 / 装在别处
    $env:WARMPET_BLENDER = 'D:\blender-4.5.10\blender.exe'
    tools\blender.ps1 inspect_fbx.py --file assets-src/pet/pet_cat.glb

.NOTES
    版本要求写在 tools/toolchain.json，不在这个文件里。
#>
#Requires -Version 5.1
[CmdletBinding()]
param(
    # 相对 tools/ 的脚本名，例如 build_skeleton.py
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Script,

    # 原样转给脚本的参数（`--` 之后的部分由本脚本补）
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ScriptArgs
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$toolsDir = $PSScriptRoot
$repoRoot = Split-Path -Parent $toolsDir
# 用 .NET 读而不是 Get-Content：PowerShell 5.1 的 Get-Content 默认按 ANSI 解码，
# 会把 toolchain.json 里的中文注释读成乱码，然后 ConvertFrom-Json 报一个
# 完全看不出是编码问题的 ArgumentException。
$manifest = [IO.File]::ReadAllText((Join-Path $toolsDir 'toolchain.json')) | ConvertFrom-Json

function Resolve-BlenderExe {
    param($Spec)

    $override = [Environment]::GetEnvironmentVariable($Spec.envOverride)
    if ($override) {
        if (-not (Test-Path $override)) {
            throw "$($Spec.envOverride) 指向 '$override'，但那里没有文件。"
        }
        return $override
    }

    foreach ($candidate in $Spec.searchPaths) {
        if (Test-Path $candidate) { return $candidate }
    }

    $onPath = Get-Command blender -ErrorAction SilentlyContinue
    if ($onPath) { return $onPath.Source }

    throw @"
找不到 Blender。管线需要 $($Spec.requiredSeries) 系列（实测 $($Spec.testedVersion)）。

找过这些位置：
$($Spec.searchPaths -join "`n")
以及 PATH 上的 blender。

装在别处就设环境变量：
  `$env:$($Spec.envOverride) = 'D:\path\to\blender.exe'
"@
}

function Assert-BlenderVersion {
    param([string]$Exe, $Spec)

    # --version 会连带打 build date/hash，只要第一行
    $firstLine = (& $Exe --version 2>&1 | Select-Object -First 1) -as [string]
    if ($firstLine -notmatch 'Blender\s+(\d+)\.(\d+)\.(\d+)') {
        throw "认不出 Blender 版本，--version 打的是：$firstLine"
    }
    $series = "$($Matches[1]).$($Matches[2])"
    $full = "$($Matches[1]).$($Matches[2]).$($Matches[3])"

    if ($series -ne $Spec.requiredSeries) {
        throw @"
Blender 版本不对：找到 $full，管线要求 $($Spec.requiredSeries) 系列（实测 $($Spec.testedVersion)）。

$($Spec.why)

跨系列跑出来的产物不会报错，只会静默地和契约对不上——
真要升级，先跑一遍 tools\verify.ps1 确认三个 GLB 都还能过 inspect_fbx。
"@
    }
    return $full
}

$exe = Resolve-BlenderExe -Spec $manifest.blender
$version = Assert-BlenderVersion -Exe $exe -Spec $manifest.blender

$scriptPath = Join-Path $toolsDir $Script
if (-not (Test-Path $scriptPath)) {
    throw "tools/ 下没有 '$Script'。可用的脚本：`n" +
          ((Get-ChildItem $toolsDir -Filter *.py | ForEach-Object { '  ' + $_.Name }) -join "`n")
}

Write-Host "[blender $version] $Script $($ScriptArgs -join ' ')" -ForegroundColor DarkGray

# --factory-startup   不读本机偏好设置和插件，保证换机器产物一致
# --python-exit-code  脚本里抛未捕获异常时返回 1，否则 Blender 一律返回 0
$blenderArgs = @(
    '--background'
    '--factory-startup'
    '-noaudio'
    '--python-exit-code', '1'
    '--python', $scriptPath
    '--'
)
if ($ScriptArgs) { $blenderArgs += $ScriptArgs }

Push-Location $repoRoot
try {
    & $exe @blenderArgs
    $code = $LASTEXITCODE
}
finally {
    Pop-Location
}

exit $code
