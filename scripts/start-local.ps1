# 一键启动：没在跑就起（生产模式），已经在跑就直接开浏览器。
# 由仓库根目录的 start-lab.cmd 双击调用；也可以直接：
#   powershell -ExecutionPolicy Bypass -File scripts\start-local.ps1
param(
    [switch]$NoBrowser,
    [int]$Port = 3000
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Test-Lab {
    param([int]$p)
    try {
        $r = Invoke-WebRequest "http://127.0.0.1:$p" -UseBasicParsing -TimeoutSec 2
        return $r.StatusCode -eq 200
    } catch {
        return $false
    }
}

function Find-Node {
    foreach ($candidate in @('D:\tools\nodejs\node.exe', 'C:\Program Files\nodejs\node.exe')) {
        if (Test-Path $candidate) { return $candidate }
    }
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    throw '找不到 node.exe：先装 Node.js 24'
}

function Find-Npm {
    foreach ($candidate in @('D:\tools\nodejs\npm.cmd', 'C:\Program Files\nodejs\npm.cmd')) {
        if (Test-Path $candidate) { return $candidate }
    }
    return 'npm.cmd'
}

if (Test-Lab $Port) {
    Write-Host "已经在运行：http://127.0.0.1:$Port"
} else {
    if (-not (Test-Path (Join-Path $root '.next\BUILD_ID'))) {
        Write-Host '第一次启动（或刚改过代码），先做生产构建，大约 40 秒…'
        & (Find-Npm) run build
        if ($LASTEXITCODE -ne 0) {
            Write-Host '构建失败，先看上面报错；不要带着半成品启动。' -ForegroundColor Red
            exit 1
        }
    }

    $node = Find-Node
    $log = Join-Path $env:TEMP 'ai-learning-lab.log'
    $proc = Start-Process -FilePath $node `
        -ArgumentList 'node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', "$Port" `
        -WorkingDirectory $root -PassThru -WindowStyle Hidden `
        -RedirectStandardOutput $log -RedirectStandardError "$log.err"
    Set-Content -Path (Join-Path $env:TEMP 'ai-learning-lab.pid') -Value $proc.Id -Encoding ascii

    $ready = $false
    for ($i = 0; $i -lt 60; $i++) {
        if (Test-Lab $Port) { $ready = $true; break }
        Start-Sleep -Milliseconds 500
    }

    if (-not $ready) {
        Write-Host "没能起来（端口 $Port）。看日志：" -ForegroundColor Red
        Write-Host "  $log"
        Write-Host "  $log.err"
        Write-Host '常见原因：3000 被别的进程占了，或 .next 是坏的 —— 先跑 stop-lab.cmd 再试。'
        exit 1
    }
    Write-Host "已启动：http://127.0.0.1:$Port  （停止用 stop-lab.cmd）"
}

if (-not $NoBrowser) {
    Start-Process "http://127.0.0.1:$Port"
}
