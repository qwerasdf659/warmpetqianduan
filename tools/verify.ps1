<#
.SYNOPSIS
    全量验收：工具链 + 产物一致性 + 模型契约 + 客户端类型。

.DESCRIPTION
    改完模型、贴图或脚本之后跑这一条。四道关按「越便宜越靠前」排：

      1. doctor            两个 Python 环境齐不齐
      2. sync --check      assets/resources 是不是 assets-src 的当前产物
      3. inspect_fbx       每个出包模型过不过 28 骨架契约和预算
      4. typecheck         客户端 TS 有没有调引擎上不存在的方法

    任何一关挂了就停在那里——后面几关的结果在前面不成立时没有意义。

.PARAMETER SkipTypes
    跳过第 4 关。只动了模型没动脚本时用，能省十几秒的 npx 拉取。

.EXAMPLE
    tools\verify.ps1

.EXAMPLE
    tools\verify.ps1 -SkipTypes
#>
#Requires -Version 5.1
[CmdletBinding()]
param(
    [switch]$SkipTypes
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

$toolsDir = $PSScriptRoot
$repoRoot = Split-Path -Parent $toolsDir
Push-Location $repoRoot

$stage = 0
function Step {
    param([string]$Name, [scriptblock]$Body)
    $script:stage++
    Write-Host ''
    Write-Host "[$script:stage] $Name" -ForegroundColor Cyan
    & $Body
    if ($LASTEXITCODE -ne 0) {
        Write-Host ''
        Write-Host "在「$Name」这一步失败（退出码 $LASTEXITCODE），后面几步没跑。" -ForegroundColor Red
        Pop-Location
        exit $LASTEXITCODE
    }
}

try {
    Step '工具链' { & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $toolsDir 'doctor.ps1') }

    Step '产物与 assets-src 一致' { & python (Join-Path $toolsDir 'sync_resources.py') --check }

    # 出包模型清单以 BUILD.json 为准，不在这里再写一遍
    $manifestPath = Join-Path $repoRoot 'assets-src/BUILD.json'
    $models = ([IO.File]::ReadAllText($manifestPath) | ConvertFrom-Json).models
    foreach ($shipped in $models.PSObject.Properties.Name) {
        $src = $models.$shipped.builtFrom
        # 配饰的预算和宠物不同，不传 --kind 会报两条假失败
        $kind = if ($src -match '/accessory/') { 'accessory' } else { 'pet' }
        Step "契约校验 $src (--kind $kind)" {
            & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $toolsDir 'blender.ps1') `
                inspect_fbx.py --file $src --kind $kind
        }
    }

    if (-not $SkipTypes) {
        Step '客户端类型检查' { & node (Join-Path $repoRoot '_research/typecheck.mjs') }
    }

    Write-Host ''
    Write-Host '全部通过。' -ForegroundColor Green
}
finally {
    Pop-Location
}
