# dewhite.ps1 - key a flat background color to transparent (default white).
# Distance-based chroma key with a soft feather band. Suits small/medium part images.
#
# Usage:
#   pwsh dewhite.ps1 -in <file-or-dir> -out <dir>
#   pwsh dewhite.ps1 -in parts_raw -out parts -bgR 255 -bgG 0 -bgB 255 -tol 40
#
# -tol      : pixels within this color distance of the bg become fully transparent
# -feather  : extra distance band beyond -tol where alpha ramps 0..original (soft edge)
param(
  [Parameter(Mandatory = $true)][string]$in,
  [Parameter(Mandatory = $true)][string]$out,
  [int]$bgR = 255,
  [int]$bgG = 255,
  [int]$bgB = 255,
  [int]$tol = 24,
  [int]$feather = 24
)
Add-Type -AssemblyName System.Drawing

function Convert-One([string]$src, [string]$dst) {
  $bmp = New-Object System.Drawing.Bitmap($src)
  $w = $bmp.Width
  $h = $bmp.Height
  $res = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  for ($y = 0; $y -lt $h; $y++) {
    for ($x = 0; $x -lt $w; $x++) {
      $p = $bmp.GetPixel($x, $y)
      $dr = $p.R - $bgR
      $dg = $p.G - $bgG
      $db = $p.B - $bgB
      $dist = [Math]::Sqrt(($dr * $dr) + ($dg * $dg) + ($db * $db))
      $a = $p.A
      if ($dist -le $tol) {
        $a = 0
      }
      elseif ($dist -lt ($tol + $feather)) {
        $t = ($dist - $tol) / [double]$feather   # 0 at tol, 1 at tol+feather
        $a = [int][Math]::Round($p.A * $t)
      }
      $res.SetPixel($x, $y, [System.Drawing.Color]::FromArgb($a, $p.R, $p.G, $p.B))
    }
  }
  $res.Save($dst, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  $res.Dispose()
}

if (!(Test-Path $out)) { New-Item -ItemType Directory -Force -Path $out | Out-Null }

if (Test-Path $in -PathType Container) {
  Get-ChildItem $in -Filter *.png | ForEach-Object {
    Convert-One $_.FullName (Join-Path $out $_.Name)
    Write-Output ("dewhite: " + $_.Name)
  }
}
else {
  $name = [IO.Path]::GetFileName($in)
  Convert-One $in (Join-Path $out $name)
  Write-Output ("dewhite: " + $name)
}
