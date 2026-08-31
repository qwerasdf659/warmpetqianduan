param(
  [string]$wall,
  [string]$floor,
  [string]$out
)
Add-Type -AssemblyName System.Drawing

$W = 720
$H = 1280
$bmp = New-Object System.Drawing.Bitmap($W, $H)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality

function Draw-Cover($gfx, $imgPath, $dx, $dy, $dw, $dh) {
  $img = [System.Drawing.Image]::FromFile($imgPath)
  $scale = [Math]::Max($dw / $img.Width, $dh / $img.Height)
  $sw = $img.Width * $scale
  $sh = $img.Height * $scale
  $ox = $dx + ($dw - $sw) / 2
  $oy = $dy + ($dh - $sh) / 2
  $state = $gfx.Save()
  $rect = New-Object System.Drawing.RectangleF($dx, $dy, $dw, $dh)
  $gfx.SetClip($rect)
  $gfx.DrawImage($img, [single]$ox, [single]$oy, [single]$sw, [single]$sh)
  $gfx.Restore($state)
  $img.Dispose()
}

# wall covers the top (back plane, includes window + counter)
Draw-Cover $g $wall 0 0 720 830
# floor covers the bottom, overlapping the wall's lower edge so there is no seam
Draw-Cover $g $floor 0 770 720 510

$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$ep = New-Object System.Drawing.Imaging.EncoderParameters(1)
$ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]90)
$bmp.Save($out, $codec, $ep)
$g.Dispose()
$bmp.Dispose()
Write-Output ("done: " + $out)
