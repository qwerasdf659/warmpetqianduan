# 写接口探测（仅联调核对用，不参与小游戏打包）
$ErrorActionPreference = 'Continue'
$BASE = 'https://ocqeeuitbygc.sealosbja.site'

function Req($method, $path, $obj, $token) {
    $headers = @{ 'Content-Type' = 'application/json' }
    if ($token) { $headers['Authorization'] = "Bearer $token" }
    try {
        if ($null -ne $obj) {
            $body = ($obj | ConvertTo-Json -Compress -Depth 6)
            return Invoke-RestMethod -Uri "$BASE$path" -Method $method -Headers $headers -Body $body
        }
        return Invoke-RestMethod -Uri "$BASE$path" -Method $method -Headers $headers
    } catch {
        $r = $_.Exception.Response
        if ($r) {
            $sr = New-Object System.IO.StreamReader($r.GetResponseStream())
            return ("ERR " + $r.StatusCode.value__ + " " + $sr.ReadToEnd())
        }
        return "ERR $($_.Exception.Message)"
    }
}
function Show($label, $r) {
    Write-Output ""
    Write-Output "=== $label ==="
    if ($r -is [string]) { Write-Output $r } else { Write-Output ($r | ConvertTo-Json -Depth 6 -Compress) }
}

$login = Req 'Post' '/auth/login' @{ code = 'mock:probe' } $null
$token = $login.token
Write-Output "=== LOGIN === userId=$($login.userId)"

Show 'GET /pet/state (auto-create)' (Req 'Get' '/pet/state' $null $token)

$bid = "feed:probe:$([DateTimeOffset]::Now.ToUnixTimeMilliseconds())"
Show 'POST /pet/feed (1st)' (Req 'Post' '/pet/feed' @{ bizId = $bid } $token)
Show 'POST /pet/feed (replay same bizId)' (Req 'Post' '/pet/feed' @{ bizId = $bid } $token)
Show 'POST /pet/feed (new bizId -> expect 429 cooldown)' (Req 'Post' '/pet/feed' @{ bizId = "$bid-2" } $token)

Show 'POST /pet/feed (unknown field -> expect 400)' (Req 'Post' '/pet/feed' @{ bizId = "$bid-3"; timestamp = 123 } $token)

Show 'POST /ad/token ad_reward' (Req 'Post' '/ad/token' @{ scene = 'ad_reward' } $token)
$adt = Req 'Post' '/ad/token' @{ scene = 'ad_reward' } $token
Show 'POST /ad/verify' (Req 'Post' '/ad/verify' @{ bizId = "ad:probe:$([DateTimeOffset]::Now.ToUnixTimeMilliseconds())"; adToken = $adt.nonce } $token)

Show 'POST /daily/checkin' (Req 'Post' '/daily/checkin' @{ bizId = "ci:probe:$([DateTimeOffset]::Now.ToUnixTimeMilliseconds())" } $token)

$rs = Req 'Post' '/race/start' @{ bizId = "rs:probe:$([DateTimeOffset]::Now.ToUnixTimeMilliseconds())"; trackKey = 'meadow' } $token
Show 'POST /race/start' $rs
if ($rs.raceId) {
    Show 'POST /race/settle' (Req 'Post' '/race/settle' @{ bizId = "rt:probe:$([DateTimeOffset]::Now.ToUnixTimeMilliseconds())"; raceId = $rs.raceId } $token)
}

Show 'POST /wardrobe/equip skin_default' (Req 'Post' '/wardrobe/equip' @{ itemKey = 'skin_default' } $token)
Show 'POST /home/place (no stock -> expect 400)' (Req 'Post' '/home/place' @{ itemKey = 'furn_sofa' } $token)
Show 'GET /pet/state?petId=1&foo=2 (expect 400)' (Req 'Get' '/pet/state?foo=2' $null $token)
Show 'GET /wallet (no token -> expect 401)' (Req 'Get' '/wallet' $null 'bad.token.here')
