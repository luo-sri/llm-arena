# 一键安装包全流程验证：静默安装 → 启动 → HTTP/数据库验证 → 卸载 → 残留检查
$Product = "多模型评测竞技场"
$SetupExe = Get-ChildItem "$PSScriptRoot\..\release\*.exe" | Where-Object { $_.Name -match "安装包" } | Select-Object -First 1

if (-not $SetupExe) { Write-Output "FAIL: 未找到安装包"; exit 1 }
Write-Output "=== 测试安装包: $($SetupExe.Name) ==="

$installDir = "$env:LOCALAPPDATA\Programs\llm-arena"
$appDataDir = "$env:APPDATA\llm-arena"
$desktopLnk = "$env:USERPROFILE\Desktop\$Product.lnk"
$mainExe = "$installDir\$Product.exe"

# 1. 静默安装
Write-Output "`n[1] 静默安装 (/S)..."
$p = Start-Process -FilePath $SetupExe.FullName -ArgumentList "/S" -PassThru -Wait
Write-Output "    安装进程退出码: $($p.ExitCode)"
if (-not (Test-Path $mainExe)) { Write-Output "FAIL: 主程序未安装"; exit 1 }
Write-Output "    PASS: $mainExe 存在"

# 2. 启动应用并等待 HTTP 就绪
Write-Output "`n[2] 启动应用..."
Start-Process $mainExe
$ready = $false
foreach ($i in 1..40) {
  Start-Sleep -Seconds 1
  try {
    $resp = Invoke-WebRequest -Uri "http://127.0.0.1:38712/" -UseBasicParsing -TimeoutSec 2
    if ($resp.StatusCode -eq 200 -and $resp.Content -match "root") { $ready = $true; break }
  } catch {}
}
if ($ready) { Write-Output "    PASS: HTTP 服务就绪 (127.0.0.1:38712 状态 200)" }
else { Write-Output "WARN: HTTP 38712 未就绪，继续检查进程" }

$proc = Get-Process $Product -ErrorAction SilentlyContinue
if ($proc) { Write-Output "    PASS: 进程运行中 (PID $($proc.Id -join ','))" } else { Write-Output "FAIL: 进程未运行" }

# 3. 数据库自动初始化验证（Electron userData 以包名为目录）
$dbPath = "$appDataDir\data\llm-eval.db"
if (Test-Path $dbPath) { Write-Output "    PASS: 用户数据自动建库 ($dbPath)" }
else { Write-Output "WARN: 数据库未生成于 $dbPath" }

# 4. API 烟雾测试（题库自动种子）
try {
  $api = Invoke-WebRequest -Uri 'http://127.0.0.1:38712/api/trpc/questions.list?input=%7B%22json%22%3A%7B%7D%7D' -UseBasicParsing -TimeoutSec 15
  if ($api.StatusCode -eq 200 -and $api.Content -match "bankVersion") { Write-Output "    PASS: tRPC API 正常返回题库数据" }
  else { Write-Output "WARN: API 状态 $($api.StatusCode)" }
} catch { Write-Output "WARN: API 调用失败: $($_.Exception.Message)" }

# 5. 桌面快捷方式
if (Test-Path $desktopLnk) { Write-Output "    PASS: 桌面快捷方式已创建" }
else {
  $oneDrive = "$env:USERPROFILE\OneDrive\Desktop\$Product.lnk"
  if (Test-Path $oneDrive) { Write-Output "    PASS: 桌面快捷方式已创建（OneDrive 桌面）" }
  else { Write-Output "WARN: 未找到桌面快捷方式" }
}

# 6. 关闭并静默卸载
Write-Output "`n[3] 关闭应用并静默卸载..."
Stop-Process -Name $Product -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
$uninst = Get-ChildItem $installDir -Filter "Uninstall*" | Select-Object -First 1
if ($uninst) {
  Write-Output "    卸载器: $($uninst.Name)"
  $p2 = Start-Process -FilePath $uninst.FullName -ArgumentList "/S" -PassThru -Wait
  Write-Output "    卸载进程退出码: $($p2.ExitCode)"
} else { Write-Output "FAIL: 未找到卸载器"; exit 1 }

# 7. 残留检查（等待文件句柄释放）
Write-Output "`n[4] 卸载残留检查..."
Start-Sleep -Seconds 4
$leftover = @()
if (Test-Path $installDir) { $leftover += "安装目录: $installDir" }
if (Test-Path $appDataDir) { $leftover += "用户数据: $appDataDir" }
if (Test-Path "$env:APPDATA\$Product") { $leftover += "用户数据(中文名): $env:APPDATA\$Product" }
if (Test-Path "$env:LOCALAPPDATA\llm-arena-updater") { $leftover += "更新器缓存: $env:LOCALAPPDATA\llm-arena-updater" }
if ((Test-Path $desktopLnk) -or (Test-Path "$env:USERPROFILE\OneDrive\Desktop\$Product.lnk")) { $leftover += "桌面快捷方式" }
$startMenu = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\$Product.lnk"
if (Test-Path $startMenu) { $leftover += "开始菜单快捷方式" }
$reg = Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*", "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*" -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match $Product }
if ($reg) { $leftover += "注册表卸载项: $($reg.PSChildName)" }
if ($leftover.Count -eq 0) { Write-Output "    PASS: 卸载干净，无任何残留" }
else { $leftover | ForEach-Object { Write-Output "    残留: $_" } }

Write-Output "`n=== 验证完成 ==="
