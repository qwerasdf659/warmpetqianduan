Add-Type -AssemblyName System.Drawing
$src = (Resolve-Path "_research\poster.png").ProviderPath
$bmp = [System.Drawing.Bitmap]::FromFile($src)

$destDir = Join-Path (Get-Location) "assets\boot"
if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Path $destDir | Out-Null }
$dest = Join-Path $destDir "loading.jpg"

$tw = 900; $th = 1350
$canvas = New-Object System.Drawing.Bitmap($tw, $th)
$g = [System.Drawing.Graphics]::FromImage($canvas)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.DrawImage($bmp, (New-Object System.Drawing.Rectangle(0, 0, $tw, $th)))
$g.Dispose()

$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq "image/jpeg" }
$ep = New-Object System.Drawing.Imaging.EncoderParameters(1)
$ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [int64]88)
$canvas.Save($dest, $codec, $ep)
$canvas.Dispose(); $bmp.Dispose()
Write-Output ("saved {0} bytes={1} KB={2}" -f $dest, (Get-Item $dest).Length, [math]::Round((Get-Item $dest).Length/1KB,1))
