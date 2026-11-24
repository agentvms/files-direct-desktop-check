
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

$setup = Join-Path $env:RUNNER_TEMP 'setup.exe'
Invoke-WebRequest -Uri 'https://github.com/agentvms/files-direct-cli/releases/download/v0.2.1/files-direct-setup-0.2.1-win-x64.exe' -OutFile $setup
Say ("installer " + (Get-Item $setup).Length + " bytes, sha256 " + (Get-FileHash $setup).Hash)
$p = Start-Process $setup -ArgumentList '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART' -Wait -PassThru
Say ("installer exit " + $p.ExitCode)
$app = Join-Path $env:LOCALAPPDATA 'Programs\Files Direct'
if (-not (Test-Path $app)) { Say "app folder not at $app"; Get-ChildItem (Join-Path $env:LOCALAPPDATA 'Programs') | ForEach-Object { Say $_.FullName } }
$exe = Join-Path $app 'Files Direct.exe'
Start-Sleep 5
Say ("tray program running: " + [bool](Get-Process -Name 'Files Direct' -ErrorAction SilentlyContinue))

$psi = New-Object Diagnostics.ProcessStartInfo; $psi.FileName = (Get-Command node).Source
$psi.Arguments = '"' + (Join-Path $PWD 'scripts\stub-rooms.mjs') + '"'; $psi.RedirectStandardInput = $true; $psi.RedirectStandardOutput = $true; $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true
$psi.EnvironmentVariables['FD_STUB_PORT'] = '9911'
$stub = [Diagnostics.Process]::Start($psi); $line = $stub.StandardOutput.ReadLine(); Say ("stub: " + $line)
$origin = 'http://127.0.0.1:9911'

$docs = 'C:\Users\Public\Documents'; New-Item -ItemType Directory -Force $docs | Out-Null
$bytes = New-Object byte[] (2MB); (New-Object Random 7).NextBytes($bytes)
[IO.File]::WriteAllBytes((Join-Path $docs 'Example.pdf'), $bytes)
$big = Join-Path $docs 'Holiday-video.mp4'; $b2 = New-Object byte[] (1MB); (New-Object Random 9).NextBytes($b2)
$fs = [IO.File]::OpenWrite($big); for ($i = 0; $i -lt 1500; $i++) { $fs.Write($b2, 0, $b2.Length) }; $fs.Close()
Say ("big file " + (Get-Item $big).Length)

Start-Process explorer.exe $docs; Start-Sleep 6
$item = $null
for ($t = 0; $t -lt 20 -and -not $item; $t++) { $item = FindAll $root 'Example*' | Where-Object { $_.Current.ControlType.ProgrammaticName -like '*ListItem*' } | Select-Object -First 1; if (-not $item) { Start-Sleep 1 } }
if ($item) {
  $c = Center $item; Click $c[0] $c[1] $false; Start-Sleep 1; Click $c[0] $c[1] $true; Start-Sleep 2
  Shot '2-right-click-menu'
  [System.Windows.Forms.SendKeys]::SendWait('{ESC}'); Start-Sleep 1
} else { Say "NOT MADE: 2-right-click-menu: no list item named Example in Explorer"; Shot 'debug-explorer' }
Get-Process explorer | Where-Object { $_.MainWindowTitle } | ForEach-Object { try { $_.CloseMainWindow() | Out-Null } catch {} }
(New-Object -ComObject Shell.Application).MinimizeAll(); Start-Sleep 1

$tray = $null
$task = $root.FindFirst([Windows.Automation.TreeScope]::Children, (New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ClassNameProperty, 'Shell_TrayWnd')))
function TrayIcon() { FindAll $root 'Files Direct*' | Where-Object { $_.Current.ControlType.ProgrammaticName -like '*Button*' } | Select-Object -First 1 }
$tray = TrayIcon
if (-not $tray) {
  $chev = FindAll $task '*Show Hidden*' | Select-Object -First 1
  if (-not $chev) { $chev = FindAll $task '*Notification Chevron*' | Select-Object -First 1 }
  if ($chev) { $c = Center $chev; Click $c[0] $c[1] $false; Start-Sleep 2; $tray = TrayIcon } else { Say "no chevron found" }
}
if ($tray) {
  $c = Center $tray; Click $c[0] $c[1] $true; Start-Sleep 2
  Shot '1-tray-menu'
  [System.Windows.Forms.SendKeys]::SendWait('{ESC}'); Start-Sleep 1; [System.Windows.Forms.SendKeys]::SendWait('{ESC}')
} else {
  Say "NOT MADE: 1-tray-menu: the tray icon was not found by UI Automation"; Shot 'debug-tray'
  FindAll $task '*' | ForEach-Object { Say ("taskbar element: " + $_.Current.ControlType.ProgrammaticName + " | " + $_.Current.Name) }
}

$env:FILES_DIRECT_ORIGIN = $origin
Start-Process $exe -ArgumentList ('verb "' + $big + '"')
$url = $null
for ($t = 0; $t -lt 60 -and -not $url; $t++) {
  $cmd = (Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*--app=http://127.0.0.1:*' } | ForEach-Object { $_.CommandLine }) -join ' '
  if ($cmd -match '--app=(http://127\.0\.0\.1:\d+/w/[\w-]+/)') { $url = $Matches[1] } else { Start-Sleep 1 }
}
Say ("window address: " + $url)
if ($url) {
  $waiting = $null
  for ($t = 0; $t -lt 40 -and -not $waiting; $t++) { try { $s = Invoke-RestMethod ($url + 'state'); if ($s.phase -eq 'waiting' -and $s.link) { $waiting = $s } } catch {}; if (-not $waiting) { Start-Sleep 1 } }
  Start-Sleep 3
  Shot '3-window-link-qr-code'
  if ($waiting) {
    Say ("link: " + $waiting.link)
    $to = 'C:\Users\Public\Received'; New-Item -ItemType Directory -Force $to | Out-Null
    $node = Join-Path $app 'node.exe'; $engine = Join-Path $app 'files-direct.mjs'
    $recv = Start-Process $node -ArgumentList ('"' + $engine + '" receive "' + $waiting.link + '" --to "' + $to + '" --json') -PassThru -WindowStyle Hidden
    $n = 0; $phases = @()
    for ($t = 0; $t -lt 600; $t++) {
      try { $s = Invoke-RestMethod ($url + 'state') } catch { Start-Sleep -Milliseconds 300; continue }
      if ($phases[-1] -ne $s.phase) { $phases += $s.phase; Say ("phase: " + $s.phase) }
      if ($s.phase -ne 'waiting' -and $s.phase -ne 'done' -and $s.phase -ne 'failed' -and $n -lt 6) { $n++; if ($n -eq 3) { Shot '4-transfer-running' }; Start-Sleep -Milliseconds 700; continue }
      if ($s.phase -eq 'done' -or $s.phase -eq 'failed' -or $s.phase -eq 'cancelled') { Start-Sleep 2; Shot '5-transfer-finished'; Say ("final: " + ($s | ConvertTo-Json -Compress -Depth 4)); break }
      Start-Sleep -Milliseconds 300
    }
    Say ("phases seen: " + ($phases -join ','))
  }
}
Shot 'zz-last'
$stub.StandardInput.Close()
$un = Join-Path $app 'unins000.exe'; if (Test-Path $un) { Start-Process $un -ArgumentList '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART' -Wait }
Say "done"
