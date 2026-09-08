<#
.SYNOPSIS
  把生成的设计稿归档到 docs/，按项目命名规范取序号，并保证「定稿」标签唯一。

.DESCRIPTION
  三件手工做容易出错的事，这里一次做完：
    1. 序号：自动取同前缀已有文件的最大序号 + 1，不用去数目录。
    2. 定稿唯一：带 -Final 时，先把同前缀旧文件名里的「定稿-」摘掉，
       避免出现两个定稿（人接手时分不清哪版是最终）。旧版本不删，留作对比。
    3. 中文文件名：PowerShell 默认控制台编码会把中文打成乱码，这里强制 UTF-8，
       否则归档完看不清自己存了什么。

.EXAMPLE
  pwsh archive-mockup.ps1 -In C:\tmp\gen.png -Label "进度条版" -Final
  # -> docs/首页设计稿-9-定稿-进度条版.png，并摘掉旧定稿的标签

.EXAMPLE
  pwsh archive-mockup.ps1 -In C:\tmp\sheet.png -Prefix "" -NoSeq -Label "宠物花色表-猫狗各5款"
  # -> docs/宠物花色表-猫狗各5款.png（规格表不进迭代序号）
#>
[CmdletBinding()]
param(
  # 源图路径（GenerateImage 的产物）
  [Parameter(Mandatory = $true)][string]$In,

  # 描述部分，如「进度条版」。最终名 = <Prefix>-<序号>-[定稿-]<Label>
  [Parameter(Mandatory = $true)][string]$Label,

  # 文件名前缀。规格表这类传 "" 表示不加前缀
  [string]$Prefix = '首页设计稿',

  # 归档目录，相对仓库根或绝对路径
  [string]$Docs = 'docs',

  # 标记为新定稿：先摘掉同前缀旧文件的「定稿-」标签
  [switch]$Final,

  # 带前缀但不加序号，如「首页设计稿-备选-xxx」
  [switch]$NoSeq,

  # 用 Label 当完整文件名，前缀和序号都不加（规格表用）。
  # 不用 -Prefix "" 是因为 Windows PowerShell 的 -File 调用会把空串当缺参数。
  [switch]$Raw
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

if (-not (Test-Path -LiteralPath $In)) { throw "源图不存在：$In" }
if (-not (Test-Path -LiteralPath $Docs)) { throw "归档目录不存在：$Docs（请在仓库根目录运行）" }

# ---- 组装目标文件名 ----

$finalTag = if ($Final) { '定稿-' } else { '' }

if ($Raw) {
  $name = $Label
}
elseif ($NoSeq) {
  $name = "$Prefix-$finalTag$Label"
}
else {
  # 从已有文件名里取最大序号：<Prefix>-<数字>-...
  $seq = 0
  Get-ChildItem -LiteralPath $Docs -Filter "$Prefix-*.png" -ErrorAction SilentlyContinue | ForEach-Object {
    if ($_.BaseName -match "^$([regex]::Escape($Prefix))-(\d+)") {
      $n = [int]$Matches[1]
      if ($n -gt $seq) { $seq = $n }
    }
  }
  $name = "$Prefix-$($seq + 1)-$finalTag$Label"
}

$dest = Join-Path $Docs "$name.png"

# ---- 定稿唯一：摘掉旧定稿的标签 ----

if ($Final -and -not $Raw) {
  Get-ChildItem -LiteralPath $Docs -Filter "$Prefix-*定稿-*.png" -ErrorAction SilentlyContinue | ForEach-Object {
    $stripped = $_.Name -replace '定稿-', ''
    if ($stripped -ne $_.Name) {
      Rename-Item -LiteralPath $_.FullName -NewName $stripped -Force
      Write-Host "摘掉旧定稿标签：$($_.Name) -> $stripped"
    }
  }
}

Copy-Item -LiteralPath $In -Destination $dest -Force
Write-Host "已归档：$dest"

# ---- 汇报：这些图会进 git，体积要看得见 ----

Write-Host ''
$pngs = Get-ChildItem -LiteralPath $Docs -Filter '*.png' | Sort-Object Name
$pngs | Select-Object Name, @{ n = 'MB'; e = { [math]::Round($_.Length / 1MB, 2) } } | Format-Table -AutoSize
'合计 {0} MB（{1} 张）— docs/*.png 会进 git，迭代中间版攒多了记得清' -f
  [math]::Round(($pngs | Measure-Object Length -Sum).Sum / 1MB, 1), $pngs.Count
