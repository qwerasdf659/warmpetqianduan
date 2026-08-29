<#
.SYNOPSIS
    体检资产管线依赖的两个 Python 环境。换机器、升级 Blender、装不上包时先跑这个。

.DESCRIPTION
    管线跨两个互不相干的解释器，这是最容易踩的一点：

      Blender 自带 Python 3.11  ->  10 个 import bpy 的脚本，用 Blender 自带的 numpy
      系统 Python 3.13          ->  make_2d_assets.py（Pillow）、sync_resources.py

    往系统 Python 里 pip install numpy 不会让 Blender 看见，反过来也一样。
    装错地方的症状是 ModuleNotFoundError，但你明明刚装过——所以要能一眼看清
    哪个解释器缺哪个包。

.EXAMPLE
    tools\doctor.ps1
#>
#Requires -Version 5.1
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

$toolsDir = $PSScriptRoot
$manifest = [IO.File]::ReadAllText((Join-Path $toolsDir 'toolchain.json')) | ConvertFrom-Json
$problems = New-Object System.Collections.Generic.List[string]

function Report {
    param([bool]$Ok, [string]$Label, [string]$Detail, [string]$Fix)
    if ($Ok) {
        Write-Host ('  [ OK ] ' + $Label.PadRight(34) + $Detail) -ForegroundColor Green
    }
    else {
        Write-Host ('  [FAIL] ' + $Label.PadRight(34) + $Detail) -ForegroundColor Red
        $script:problems.Add("$Label -- $Fix")
    }
}

Write-Host ''
Write-Host 'Blender 环境' -ForegroundColor Cyan

$blenderSpec = $manifest.blender
$exe = $null
$override = [Environment]::GetEnvironmentVariable($blenderSpec.envOverride)
if ($override -and (Test-Path $override)) { $exe = $override }
if (-not $exe) {
    foreach ($c in $blenderSpec.searchPaths) { if (Test-Path $c) { $exe = $c; break } }
}
if (-not $exe) {
    $cmd = Get-Command blender -ErrorAction SilentlyContinue
    if ($cmd) { $exe = $cmd.Source }
}

if (-not $exe) {
    Report $false 'blender.exe' '找不到' `
        "装 Blender $($blenderSpec.testedVersion)，或设 `$env:$($blenderSpec.envOverride)"
}
else {
    $first = (& $exe --version 2>&1 | Select-Object -First 1) -as [string]
    $ok = $first -match 'Blender\s+(\d+\.\d+)\.(\d+)'
    $series = if ($ok) { $Matches[1] } else { '?' }
    Report ($series -eq $blenderSpec.requiredSeries) 'blender 版本' `
        "$first`n         $exe" `
        "管线要求 $($blenderSpec.requiredSeries) 系列（实测 $($blenderSpec.testedVersion)）"

    # 在 Blender 自己的解释器里查模块，不能拿系统 Python 的结果代替
    $probe = @'
import sys
print("PYVER", sys.version.split()[0])
for m in ("numpy",):
    try:
        mod = __import__(m)
        print("MOD_OK", m, getattr(mod, "__version__", "?"))
    except Exception as exc:
        print("MOD_FAIL", m, exc)
'@
    $probeFile = Join-Path ([IO.Path]::GetTempPath()) 'warmpet_doctor_probe.py'
    [IO.File]::WriteAllText($probeFile, $probe, [Text.UTF8Encoding]::new($false))
    $out = & $exe --background --factory-startup -noaudio --python $probeFile 2>&1

    $pyver = ($out | Select-String -Pattern '^PYVER (.+)$').Matches.Groups[1].Value
    Report ([bool]$pyver) 'blender 自带 Python' "$pyver（期望 $($blenderSpec.bundledPython)）" '重装 Blender'

    foreach ($name in $blenderSpec.modules.PSObject.Properties.Name) {
        $hit = $out | Select-String -Pattern "^MOD_OK $name (.+)$"
        Report ([bool]$hit) "blender 的 $name" `
            $(if ($hit) { $hit.Matches.Groups[1].Value } else { '缺失' }) `
            "Blender 一般自带 $name；缺了就是安装不完整，重装比手动装省事"
    }
    Remove-Item $probeFile -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host '系统 Python 环境' -ForegroundColor Cyan

$sys = $manifest.systemPython
$py = Get-Command python -ErrorAction SilentlyContinue
if (-not $py) {
    Report $false 'python' '不在 PATH 上' "装 Python >= $($sys.requiredMinimum)"
}
else {
    $v = (& python --version 2>&1) -as [string]
    Report $true 'python' "$v`n         $($py.Source)" ''

    foreach ($pkg in $sys.packages.PSObject.Properties.Name) {
        $imp = if ($pkg -eq 'Pillow') { 'PIL' } else { $pkg }
        $ver = & python -c "import $imp; print(getattr($imp,'__version__','?'))" 2>&1
        $ok = $LASTEXITCODE -eq 0
        Report $ok "系统 python 的 $pkg" $(if ($ok) { $ver } else { '缺失' }) `
            'pip install -r tools/requirements.txt'
    }
}

Write-Host ''
Write-Host 'Cocos' -ForegroundColor Cyan

$cocos = $manifest.cocos
$root = [Environment]::GetEnvironmentVariable($cocos.envOverride)
if (-not $root) { foreach ($c in $cocos.searchPaths) { if (Test-Path $c) { $root = $c; break } } }
Report ([bool]$root -and (Test-Path $root)) "Creator $($cocos.requiredVersion)" `
    $(if ($root) { $root } else { '找不到' }) `
    "装 Creator $($cocos.requiredVersion)，或设 `$env:$($cocos.envOverride)"

Write-Host ''
if ($problems.Count -eq 0) {
    Write-Host '工具链完整，可以跑管线。' -ForegroundColor Green
    exit 0
}
Write-Host "$($problems.Count) 项需要处理：" -ForegroundColor Red
$problems | ForEach-Object { Write-Host "  - $_" -ForegroundColor Yellow }
exit 1
