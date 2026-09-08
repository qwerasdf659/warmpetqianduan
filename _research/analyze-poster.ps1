Add-Type -AssemblyName System.Drawing
$path = (Resolve-Path "_research\poster.png").ProviderPath
$bmp = [System.Drawing.Bitmap]::FromFile($path)
$W = $bmp.Width; $H = $bmp.Height
$out = @()
$out += "size=${W}x${H}"

# --- locate the caramel/orange progress bar in the lower area (fy > 0.82) ---
$minX = $W; $minY = $H; $maxX = 0; $maxY = 0; $count = 0
$y0 = [int]($H * 0.82)
for ($y = $y0; $y -lt $H; $y += 2) {
  for ($x = 0; $x -lt $W; $x += 2) {
    $p = $bmp.GetPixel($x, $y)
    if ($p.R -gt 170 -and $p.G -ge 80 -and $p.G -le 180 -and $p.B -lt 135 -and ($p.R - $p.B) -gt 70) {
      $count++
      if ($x -lt $minX) { $minX = $x }
      if ($x -gt $maxX) { $maxX = $x }
      if ($y -lt $minY) { $minY = $y }
      if ($y -gt $maxY) { $maxY = $y }
    }
  }
}
$out += "bar_px count=$count box=($minX,$minY)-($maxX,$maxY)"
if ($count -gt 0) {
  $fxL = [math]::Round($minX / $W, 4); $fxR = [math]::Round($maxX / $W, 4)
  $fyT = [math]::Round($minY / $H, 4); $fyB = [math]::Round($maxY / $H, 4)
  $cxF = [math]::Round((($minX + $maxX) / 2) / $W, 4)
  $cyF = [math]::Round((($minY + $maxY) / 2) / $H, 4)
  $wF = [math]::Round(($maxX - $minX) / $W, 4)
  $hF = [math]::Round(($maxY - $minY) / $H, 4)
  $out += "bar_frac xL=$fxL xR=$fxR yT=$fyT yB=$fyB centerX=$cxF centerY=$cyF w=$wF h=$hF"
}

function AvgBand($yStart, $yEnd) {
  $r = 0; $g = 0; $b = 0; $n = 0
  for ($y = $yStart; $y -lt $yEnd; $y += 2) {
    for ($x = 0; $x -lt $W; $x += 8) {
      $p = $bmp.GetPixel($x, $y); $r += $p.R; $g += $p.G; $b += $p.B; $n++
    }
  }
  return "$([int]($r/$n)),$([int]($g/$n)),$([int]($b/$n))"
}
$out += "topband=$(AvgBand 0 12)"
$out += "bottomband=$(AvgBand ($H-12) $H)"
$bmp.Dispose()
$out | Set-Content -Encoding ASCII "_research\poster-analysis.txt"
$out | ForEach-Object { Write-Output $_ }
