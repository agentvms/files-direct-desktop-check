
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing, UIAutomationClient, UIAutomationTypes
Add-Type @"
using System; using System.Runtime.InteropServices;
public class Disp {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Ansi)]
  public struct DEVMODE {
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string dmDeviceName;
    public short dmSpecVersion, dmDriverVersion, dmSize, dmDriverExtra; public int dmFields;
    public int dmPositionX, dmPositionY, dmDisplayOrientation, dmDisplayFixedOutput;
    public short dmColor, dmDuplex, dmYResolution, dmTTOption, dmCollate;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string dmFormName;
    public short dmLogPixels; public int dmBitsPerPel, dmPelsWidth, dmPelsHeight, dmDisplayFlags, dmDisplayFrequency;
    public int dmICMMethod, dmICMIntent, dmMediaType, dmDitherType, dmReserved1, dmReserved2, dmPanningWidth, dmPanningHeight;
  }
  [DllImport("user32.dll")] public static extern bool EnumDisplaySettings(string d, int m, ref DEVMODE dm);
  [DllImport("user32.dll")] public static extern int ChangeDisplaySettings(ref DEVMODE dm, int flags);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int hh, bool r);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(int f, int dx, int dy, int d, int e);
}
"@
$Shots = Join-Path $PWD 'shots'
New-Item -ItemType Directory -Force $Shots | Out-Null
function Say($t) { Write-Host ("[shots] " + $t) }
function Shot($name) {
  $s = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $bmp = New-Object Drawing.Bitmap $s.Width, $s.Height
  $g = [Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($s.Location, [Drawing.Point]::Empty, $s.Size)
  $f = Join-Path $Shots ($name + '.png'); $bmp.Save($f, [Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $bmp.Dispose()
  Say ("saved " + $name + ".png " + $s.Width + "x" + $s.Height)
}
function Click($x, $y, $right) {
  [Disp]::SetCursorPos([int]$x, [int]$y); Start-Sleep -Milliseconds 300
  if ($right) { [Disp]::mouse_event(8,0,0,0,0); [Disp]::mouse_event(16,0,0,0,0) } else { [Disp]::mouse_event(2,0,0,0,0); [Disp]::mouse_event(4,0,0,0,0) }
}
function FindAll($root, $like) {
  $cond = [Windows.Automation.Condition]::TrueCondition
  $all = $root.FindAll([Windows.Automation.TreeScope]::Descendants, $cond)
  foreach ($e in $all) { if ($e.Current.Name -like $like) { $e } }
}
function Center($e) { $r = $e.Current.BoundingRectangle; @(($r.X + $r.Width / 2), ($r.Y + $r.Height / 2)) }
$root = [Windows.Automation.AutomationElement]::RootElement

$dm = New-Object Disp+DEVMODE; $dm.dmSize = [int][Runtime.InteropServices.Marshal]::SizeOf($dm)
[void][Disp]::EnumDisplaySettings($null, -1, [ref]$dm)
foreach ($want in @(@(1920,1080), @(1600,900), @(1366,768))) {
  $dm.dmPelsWidth = $want[0]; $dm.dmPelsHeight = $want[1]; $dm.dmFields = 0x80000 -bor 0x100000
  $r = [Disp]::ChangeDisplaySettings([ref]$dm, 0); Say ("set " + ($want -join 'x') + " -> " + $r); if ($r -eq 0) { break }
}
Start-Sleep 2
(New-Object -ComObject Shell.Application).MinimizeAll(); Start-Sleep 2



$Raw = Join-Path $PWD 'raw'; New-Item -ItemType Directory -Force $Raw | Out-Null
$Out = Join-Path $PWD 'listing'; New-Item -ItemType Directory -Force $Out | Out-Null
function Grab() {
  $s = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $bmp = New-Object Drawing.Bitmap $s.Width, $s.Height
  $g = [Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($s.Location, [Drawing.Point]::Empty, $s.Size); $g.Dispose()
  return $bmp
}
function Compose($src, $rx, $ry, $rw, $rh, $scale, $name) {
  $src.Save((Join-Path $Raw ($name + '-raw.png')), [Drawing.Imaging.ImageFormat]::Png)
  $rx = [Math]::Max(0, [int]$rx); $ry = [Math]::Max(0, [int]$ry)
  $rw = [Math]::Min([int]$rw, $src.Width - $rx); $rh = [Math]::Min([int]$rh, $src.Height - $ry)
  $canvas = New-Object Drawing.Bitmap 1920, 1080
  $g = [Drawing.Graphics]::FromImage($canvas)
  $g.SmoothingMode = 'AntiAlias'; $g.InterpolationMode = 'HighQualityBicubic'; $g.PixelOffsetMode = 'HighQuality'
  $bg = New-Object Drawing.Drawing2D.LinearGradientBrush ((New-Object Drawing.Point 0, 0), (New-Object Drawing.Point 1920, 1080), [Drawing.Color]::FromArgb(236, 241, 246), [Drawing.Color]::FromArgb(206, 220, 236))
  $g.FillRectangle($bg, 0, 0, 1920, 1080)
  $dw = [int]($rw * $scale); $dh = [int]($rh * $scale)
  $dx = [int]((1920 - $dw) / 2); $dy = [int]((1080 - $dh) / 2)
  for ($i = 18; $i -ge 1; $i--) { $sh = New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb(5, 20, 40, 70)); $g.FillRectangle($sh, $dx - $i, $dy - $i + 8, $dw + 2 * $i, $dh + 2 * $i) }
  $g.DrawImage($src, (New-Object Drawing.Rectangle $dx, $dy, $dw, $dh), (New-Object Drawing.Rectangle $rx, $ry, $rw, $rh), [Drawing.GraphicsUnit]::Pixel)
  $g.Dispose()
  $canvas.Save((Join-Path $Out ($name + '.png')), [Drawing.Imaging.ImageFormat]::Png)
  Say ("composed " + $name + ".png from " + $rw + "x" + $rh + " at scale " + $scale)
  $canvas.Dispose(); $src.Dispose()
}
function WindowRect($class, $title) {
  $cond = New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ClassNameProperty, $class)
  $els = $root.FindAll([Windows.Automation.TreeScope]::Children, $cond)
  foreach ($e in $els) { if (-not $title -or $e.Current.Name -like $title) { return $e } }
  return $null
}

# the stand-in service that answers as the public address, on this machine only
$hostName = 'files.tnyforge.com'
$pfx = Join-Path $env:RUNNER_TEMP 'stub.pfx'; $pfxPass = 'standin'
$cert = New-SelfSignedCertificate -DnsName $hostName -CertStoreLocation Cert:\CurrentUser\My -NotAfter (Get-Date).AddDays(2)
Export-PfxCertificate -Cert $cert -FilePath $pfx -Password (ConvertTo-SecureString $pfxPass -AsPlainText -Force) | Out-Null
$cer = Join-Path $env:RUNNER_TEMP 'stub.cer'; Export-Certificate -Cert $cert -FilePath $cer | Out-Null
Import-Certificate -FilePath $cer -CertStoreLocation Cert:\LocalMachine\Root | Out-Null
$b64 = [Convert]::ToBase64String($cert.RawData, 'InsertLineBreaks')
$pem = Join-Path $env:RUNNER_TEMP 'stub.pem'; [IO.File]::WriteAllText($pem, "-----BEGIN CERTIFICATE-----" + [Environment]::NewLine + $b64 + [Environment]::NewLine + "-----END CERTIFICATE-----" + [Environment]::NewLine)
Add-Content -Path (Join-Path $env:SystemRoot 'System32\drivers\etc\hosts') -Value ("127.0.0.1 " + $hostName)
$env:NODE_EXTRA_CA_CERTS = $pem
$psi = New-Object Diagnostics.ProcessStartInfo; $psi.FileName = (Get-Command node).Source
$psi.Arguments = '"' + (Join-Path $PWD 'scripts\stub-rooms.mjs') + '"'; $psi.RedirectStandardInput = $true; $psi.RedirectStandardOutput = $true; $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true
$psi.EnvironmentVariables['FD_STUB_PORT'] = '443'; $psi.EnvironmentVariables['FD_STUB_PFX'] = $pfx; $psi.EnvironmentVariables['FD_STUB_PFX_PASS'] = $pfxPass; $psi.EnvironmentVariables['FD_STUB_CODE'] = '482913057'
$stub = [Diagnostics.Process]::Start($psi); Say ("stub: " + $stub.StandardOutput.ReadLine())
$origin = 'https://' + $hostName
# nothing may leave this machine: the public name must answer with the stand-in page, or the run stops
$check = ''
try { $check = (Invoke-WebRequest -Uri ($origin + '/') -UseBasicParsing -TimeoutSec 20).Content } catch { Say ("probe error: " + $_.Exception.Message) }
Say ("name answers with: " + $check.Substring(0, [Math]::Min(60, $check.Length)))
if ($check -notlike '*stand-in*') { Say "ABORT: the public name does not answer from this machine; nothing was started"; $stub.StandardInput.Close(); exit 1 }

# files
$docs = 'C:\Users\Public\Documents'; New-Item -ItemType Directory -Force $docs | Out-Null
$bytes = New-Object byte[] (2MB); (New-Object Random 7).NextBytes($bytes)
[IO.File]::WriteAllBytes((Join-Path $docs 'Example.pdf'), $bytes)
$big = Join-Path $docs 'Holiday-video.mp4'; $b2 = New-Object byte[] (1MB); (New-Object Random 9).NextBytes($b2)
$fs = [IO.File]::OpenWrite($big); for ($i = 0; $i -lt 1500; $i++) { $fs.Write($b2, 0, $b2.Length) }; $fs.Close()

# the released installer, for the tray and the window
$setup = Join-Path $env:RUNNER_TEMP 'setup.exe'
Invoke-WebRequest -Uri 'https://github.com/agentvms/files-direct-cli/releases/download/v0.2.1/files-direct-setup-0.2.1-win-x64.exe' -OutFile $setup
Say ("installer sha256 " + (Get-FileHash $setup).Hash)
$p = Start-Process $setup -ArgumentList '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART' -PassThru; [void]$p.WaitForExit(180000)
$app = Join-Path $env:LOCALAPPDATA 'Programs\Files Direct'; $exe = Join-Path $app 'Files Direct.exe'
Start-Sleep 5
(New-Object -ComObject Shell.Application).MinimizeAll(); Start-Sleep 1

# tray menu
function TrayIcon() { FindAll $root 'Files Direct*' | Where-Object { $_.Current.ControlType.ProgrammaticName -like '*Button*' } | Select-Object -First 1 }
$task = $root.FindFirst([Windows.Automation.TreeScope]::Children, (New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ClassNameProperty, 'Shell_TrayWnd')))
$tray = TrayIcon
if (-not $tray) {
  $chev = FindAll $task '*Show Hidden*' | Select-Object -First 1
  if (-not $chev) { $chev = FindAll $task '*Notification Chevron*' | Select-Object -First 1 }
  if ($chev) { $c = Center $chev; Click $c[0] $c[1] $false; Start-Sleep 2; $tray = TrayIcon }
}
if ($tray) {
  $c = Center $tray; Click $c[0] $c[1] $true; Start-Sleep 2
  $img = Grab
  $m = $null
  foreach ($e in $root.FindAll([Windows.Automation.TreeScope]::Children, [Windows.Automation.Condition]::TrueCondition)) {
    $b = $e.Current.BoundingRectangle
    if ($b.Width -gt 80 -and $b.Width -lt 450 -and $b.Height -gt 80 -and $b.Height -lt 450 -and -not $e.Current.IsOffscreen) { Say ("top-level candidate: " + $e.Current.ClassName + " | " + $e.Current.Name + " | " + $b.X + "," + $b.Y + " " + $b.Width + "x" + $b.Height); if (-not $m -and ($e.Current.ClassName -like 'WindowsForms10*' -or $e.Current.ClassName -eq '#32768')) { $m = $e } }
  }
  if ($m) { $r = $m.Current.BoundingRectangle; Say ("tray menu rect " + $r.X + "," + $r.Y + " " + $r.Width + "x" + $r.Height); Compose $img $r.X $r.Y $r.Width $r.Height 3.4 '1-tray-menu' }
  else { Say "NOT MADE: 1-tray-menu: the menu window was not found"; $img.Dispose() }
  [System.Windows.Forms.SendKeys]::SendWait('{ESC}'); Start-Sleep 1; [System.Windows.Forms.SendKeys]::SendWait('{ESC}')
} else { Say "NOT MADE: 1-tray-menu: icon not found" }

# the window, from the entry the right-click runs, over the stand-in service that answers as the public address
$env:FILES_DIRECT_ORIGIN = $origin
Start-Process $exe -ArgumentList ('verb "' + $big + '"')
$url = $null
for ($t = 0; $t -lt 60 -and -not $url; $t++) {
  $cmd = (Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*--app=http://127.0.0.1:*' } | ForEach-Object { $_.CommandLine }) -join ' '
  if ($cmd -match '--app=(http://127\.0\.0\.1:\d+/w/[\w-]+/)') { $url = $Matches[1] } else { Start-Sleep 1 }
}
Say ("window address: " + $url)
function WinShot($name, $height) {
  $w = WindowRect 'Chrome_WidgetWin_1' 'Files Direct*'
  if (-not $w) { Say ("NOT MADE: " + $name + ": app window not found"); return }
  [void][Disp]::MoveWindow([IntPtr]$w.Current.NativeWindowHandle, 700, 150, 520, $height, $true); Start-Sleep 2
  $r = $w.Current.BoundingRectangle
  $img = Grab
  Say ("window rect " + $r.X + "," + $r.Y + " " + $r.Width + "x" + $r.Height)
  Compose $img ($r.X + 8) ($r.Y + 1) ($r.Width - 16) ($r.Height - 9) 1.45 $name
}
if ($url) {
  $waiting = $null
  for ($t = 0; $t -lt 40 -and -not $waiting; $t++) { try { $s = Invoke-RestMethod ($url + 'state'); if ($s.phase -eq 'waiting' -and $s.link) { $waiting = $s } } catch {}; if (-not $waiting) { Start-Sleep 1 } }
  Start-Sleep 2
  $w = WindowRect 'Chrome_WidgetWin_1' 'Files Direct*'
  if ($w) { [void][Disp]::MoveWindow([IntPtr]$w.Current.NativeWindowHandle, 700, 150, 520, 600, $true); Start-Sleep 2 }
  Say ("link shown: " + $waiting.link)
  WinShot '3-window-link-qr-code' 560
  if ($waiting) {
    $to = 'C:\Users\Public\Received'; New-Item -ItemType Directory -Force $to | Out-Null
    $node = Join-Path $app 'node.exe'; $engine = Join-Path $app 'files-direct.mjs'
    $recv = Start-Process $node -ArgumentList ('"' + $engine + '" receive "' + $waiting.link + '" --to "' + $to + '" --json') -PassThru -WindowStyle Hidden
    $n = 0; $phases = @()
    for ($t = 0; $t -lt 600; $t++) {
      try { $s = Invoke-RestMethod ($url + 'state') } catch { Start-Sleep -Milliseconds 300; continue }
      if ($phases[-1] -ne $s.phase) { $phases += $s.phase; Say ("phase: " + $s.phase) }
      if ($s.phase -eq 'transferring' -and $n -lt 4) { $n++; if ($n -eq 3) { WinShot '4-transfer-running' 380 }; Start-Sleep -Milliseconds 600; continue }
      if ($s.phase -eq 'done' -or $s.phase -eq 'failed' -or $s.phase -eq 'cancelled') { Start-Sleep 2; WinShot '5-transfer-finished' 340; break }
      Start-Sleep -Milliseconds 300
    }
    Say ("phases seen: " + ($phases -join ','))
  }
}
$w = WindowRect 'Chrome_WidgetWin_1' 'Files Direct*'; if ($w) { try { $w.GetCurrentPattern([Windows.Automation.WindowPattern]::Pattern).Close() } catch {} }
$un = Join-Path $app 'unins000.exe'; if (Test-Path $un) { $u = Start-Process $un -ArgumentList '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART' -PassThru; [void]$u.WaitForExit(120000) }

# the Store package with the real identity, for the first Windows 11 menu
$info = Get-Content store-out\build-store.json -Raw | ConvertFrom-Json
Say ("package " + $info.file + " " + $info.bytes + " bytes, identity " + $info.identity.name + " placeholder=" + $info.identity.placeholder)
$msix = Join-Path $PWD ('store-out\' + $info.file)
$pf86 = [Environment]::GetEnvironmentVariable('ProgramFiles(x86)')
$signtool = Get-ChildItem (Join-Path $pf86 'Windows Kits\10\bin\*\x64\signtool.exe') | Sort-Object FullName | Select-Object -Last 1
$tc = New-SelfSignedCertificate -Type Custom -Subject $info.identity.publisher -KeyUsage DigitalSignature -FriendlyName "test" -CertStoreLocation "Cert:\CurrentUser\My" -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3", "2.5.29.19={text}")
$tcer = Join-Path $env:RUNNER_TEMP 'test.cer'; Export-Certificate -Cert $tc -FilePath $tcer | Out-Null
Import-Certificate -FilePath $tcer -CertStoreLocation "Cert:\LocalMachine\TrustedPeople" | Out-Null
$signed = $msix -replace '\.msix$', '-test-signed.msix'; Copy-Item $msix $signed
& $signtool.FullName sign /fd SHA256 /sha1 $tc.Thumbprint $signed | Out-Null
Add-AppxPackage -Path $signed
Say ("installed: " + [bool](Get-AppxPackage -Name $info.identity.name))
Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue; Start-Sleep 5
(New-Object -ComObject Shell.Application).MinimizeAll(); Start-Sleep 1
Start-Process explorer.exe $docs; Start-Sleep 6
$item = $null
for ($t = 0; $t -lt 20 -and -not $item; $t++) { $item = FindAll $root 'Example*' | Where-Object { $_.Current.ControlType.ProgrammaticName -like '*ListItem*' } | Select-Object -First 1; if (-not $item) { Start-Sleep 1 } }
if ($item) {
  $c = Center $item; Click $c[0] $c[1] $false; Start-Sleep 1; Click $c[0] $c[1] $true; Start-Sleep 3
  $img = Grab
  $e = WindowRect 'CabinetWClass' $null
  if ($e) { $r = $e.Current.BoundingRectangle; Say ("explorer rect " + $r.X + "," + $r.Y + " " + $r.Width + "x" + $r.Height); Compose $img ($r.X + 8) ($r.Y + 1) ($r.Width - 16) ($r.Height - 9) 1.3 '2-right-click-menu' }
  else { Say "NOT MADE: 2-right-click-menu: explorer window not found"; $img.Dispose() }
  [System.Windows.Forms.SendKeys]::SendWait('{ESC}')
} else { Say "NOT MADE: 2-right-click-menu: no list item" }
Get-AppxPackage -Name $info.identity.name | Remove-AppxPackage
$stub.StandardInput.Close()
Say "done"
