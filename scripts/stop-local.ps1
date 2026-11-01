# 停止一键启动起的那个服务（只认这个项目起的 node，不动别的进程）。
# 由仓库根目录的 stop-lab.cmd 调用。
param([int]$Port = 3000)

$ErrorActionPreference = 'Stop'
$pidFile = Join-Path $env:TEMP 'ai-learning-lab.pid'

function Test-Lab {
    param([int]$p)
    try {
        $r = Invoke-WebRequest "http://127.0.0.1:$p" -UseBasicParsing -TimeoutSec 2
        return $r.StatusCode -eq 200
    } catch {
        return $false
    }
}

$stopped = $false

if (Test-Path $pidFile) {
    $serverPid = 0
    [void][int]::TryParse((Get-Content $pidFile -Raw).Trim(), [ref]$serverPid)
    if ($serverPid -gt 0) {
        $proc = Get-Process -Id $serverPid -ErrorAction SilentlyContinue
        if ($proc -and $proc.ProcessName -eq 'node') {
            Stop-Process -Id $serverPid -Force
            $stopped = $true
            Write-Host "已停止（PID $serverPid）"
        }
    }
    Remove-Item $pidFile -ErrorAction SilentlyContinue
}

# 兜底：`next start` 可能留下子进程，按端口收尾（只杀 node）
Start-Sleep -Milliseconds 300
$conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($conn) {
    $proc = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
    if ($proc -and $proc.ProcessName -eq 'node') {
        Stop-Process -Id $proc.Id -Force
        $stopped = $true
        Write-Host "已停止仍在监听 $Port 的 node 进程（PID $($proc.Id)）"
    } else {
        Write-Host "端口 $Port 被 $($proc.ProcessName) 占着，不是本项目的 node，没有动它。" -ForegroundColor Yellow
    }
}

if (-not $stopped -and -not (Test-Lab $Port)) {
    Write-Host '没有在运行。'
}
