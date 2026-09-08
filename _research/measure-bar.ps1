Add-Type -AssemblyName System.Drawing
$path = (Resolve-Path "_research\poster.png").ProviderPath
$bmp = [System.Drawing.Bitmap]::FromFile($path)
$W = $bmp.Width; $H = $bmp.Height
$out = @()

# search central-ish region to avoid the corner buttons; rely on the caramel
# rim+fill of the capsule (the surrounding rug is cream, not orange)
$xa = [int]($W * 0.20); $xb = [int]($W * 0.80)
$ya = [int]($H * 0.84); $yb = [int]($H * 0.94)

function IsBar($p) {
  $orange = ($p.R -gt 175 -and $p.G -ge 95 -and $p.G -le 185 -and $p.B -lt 140 -and ($p.R - $p.B) -gt 70 -and ($p.R - $p.G) -gt 25)
  return $orange
}

$minX = $W; $minY = $H; $maxX = 0; $maxY = 0; $count = 0
for ($y = $ya; $y -lt $yb; $y++) {
  for ($x = $xa; $x -lt $xb; $x++) {
    if (IsBar $bmp.GetPixel($x, $y)) {
      $count++
      if ($x -lt $minX) { $minX = $x }
      if ($x -gt $maxX) { $maxX = $x }
      if ($y -lt $minY) { $minY = $y }
      if ($y -gt $maxY) { $maxY = $y }
    }
  }
}
$out += "count=$count box=($minX,$minY)-($maxX,$maxY)"
$out += "fracL=$([math]::Round($minX/$W,4)) fracR=$([math]::Round($maxX/$W,4)) fracT=$([math]::Round($minY/$H,4)) fracB=$([math]::Round($maxY/$H,4))"
$out += "centerX=$([math]::Round((($minX+$maxX)/2)/$W,4)) centerY=$([math]::Round((($minY+$maxY)/2)/$H,4)) wFrac=$([math]::Round(($maxX-$minX)/$W,4)) hFrac=$([math]::Round(($maxY-$minY)/$H,4))"

# orange-fill only (to sanity-check the 62% fill end)
$oMaxX = 0; $oMinX = $W
for ($y = $minY; $y -le $maxY; $y++) {
  for ($x = $xa; $x -lt $xb; $x++) {
    $p = $bmp.GetPixel($x, $y)
    if ($p.R -gt 190 -and $p.G -ge 110 -and $p.G -le 180 -and $p.B -lt 120 -and ($p.R - $p.B) -gt 80) {
      if ($x -lt $oMinX) { $oMinX = $x }
      if ($x -gt $oMaxX) { $oMaxX = $x }
    }
  }
}
$out += "orangeL=$([math]::Round($oMinX/$W,4)) orangeR=$([math]::Round($oMaxX/$W,4))"
$bmp.Dispose()
$out | Set-Content -Encoding ASCII "_research\bar-measure.txt"
$out | ForEach-Object { Write-Output $_ }
