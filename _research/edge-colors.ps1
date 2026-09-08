Add-Type -AssemblyName System.Drawing
$path = (Resolve-Path "_research\poster.png").ProviderPath
$bmp = [System.Drawing.Bitmap]::FromFile($path)
$W = $bmp.Width; $H = $bmp.Height

function Patch($xa, $xb, $ya, $yb) {
  $r = 0; $g = 0; $b = 0; $n = 0
  for ($y = [int]($ya * $H); $y -lt [int]($yb * $H); $y += 1) {
    for ($x = [int]($xa * $W); $x -lt [int]($xb * $W); $x += 2) {
      $p = $bmp.GetPixel($x, $y); $r += $p.R; $g += $p.G; $b += $p.B; $n++
    }
  }
  if ($n -eq 0) { return "n/a" }
  return "$([int]($r/$n)),$([int]($g/$n)),$([int]($b/$n))"
}
$out = @()
$out += "top_center=$(Patch 0.40 0.60 0.00 0.02)"
$out += "top_full=$(Patch 0.00 1.00 0.00 0.015)"
$out += "bottom_center=$(Patch 0.40 0.60 0.985 1.00)"
$out += "bottom_full=$(Patch 0.00 1.00 0.985 1.00)"
$out += "left_mid=$(Patch 0.00 0.03 0.40 0.60)"
$out += "right_mid=$(Patch 0.97 1.00 0.40 0.60)"
$bmp.Dispose()
$out | Set-Content -Encoding ASCII "_research\edge-colors.txt"
$out | ForEach-Object { Write-Output $_ }
