# 接口探测脚本（仅联调核对用，不参与小游戏打包）
$ErrorActionPreference = 'Continue'
$BASE = 'https://ocqeeuitbygc.sealosbja.site'

function Post-Json($path, $obj, $token) {
    $headers = @{ 'Content-Type' = 'application/json' }
    if ($token) { $headers['Authorization'] = "Bearer $token" }
    $body = ($obj | ConvertTo-Json -Compress -Depth 6)
    try {
        return Invoke-RestMethod -Uri "$BASE$path" -Method Post -Headers $headers -Body $body
    } catch {
        $r = $_.Exception.Response
        if ($r) {
            $sr = New-Object System.IO.StreamReader($r.GetResponseStream())
            return ("ERR " + $r.StatusCode.value__ + " " + $sr.ReadToEnd())
        }
        return "ERR $($_.Exception.Message)"
    }
}

function Get-Json($path, $token) {
    $headers = @{ 'Authorization' = "Bearer $token" }
    try {
        return Invoke-RestMethod -Uri "$BASE$path" -Method Get -Headers $headers
    } catch {
        $r = $_.Exception.Response
        if ($r) {
            $sr = New-Object System.IO.StreamReader($r.GetResponseStream())
            return ("ERR " + $r.StatusCode.value__ + " " + $sr.ReadToEnd())
        }
        return "ERR $($_.Exception.Message)"
    }
}

$login = Post-Json '/auth/login' @{ code = 'mock:mid' } $null
$token = $login.token
Write-Output "=== LOGIN === userId=$($login.userId)"

$gets = @(
    '/pet/state', '/pet/list', '/pet/offline',
    '/wallet', '/wallet/ledger?page=1&pageSize=3',
    '/daily',
    '/race/tracks',
    '/wardrobe',
    '/items/consumables',
    '/home',
    '/dex',
    '/gacha', '/gacha/history?page=1&pageSize=3',
    '/exchange', '/exchange/orders?page=1&pageSize=3',
    '/address',
    '/promo/redemptions?page=1&pageSize=3'
)

foreach ($p in $gets) {
    Write-Output ""
    Write-Output "=== GET $p ==="
    $r = Get-Json $p $token
    if ($r -is [string]) { Write-Output $r }
    else { Write-Output ($r | ConvertTo-Json -Depth 6 -Compress) }
}
