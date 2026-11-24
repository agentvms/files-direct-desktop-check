
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


$info = Get-Content store-out\build-store.json -Raw | ConvertFrom-Json
Say ("package " + $info.file + " " + $info.bytes + " bytes, identity " + $info.identity.name + " placeholder=" + $info.identity.placeholder)
$msix = Join-Path $PWD ('store-out\' + $info.file)
$pf86 = [Environment]::GetEnvironmentVariable('ProgramFiles(x86)')
$signtool = Get-ChildItem (Join-Path $pf86 'Windows Kits\10\bin\*\x64\signtool.exe') | Sort-Object FullName | Select-Object -Last 1
$cert = New-SelfSignedCertificate -Type Custom -Subject $info.identity.publisher -KeyUsage DigitalSignature -FriendlyName "test" -CertStoreLocation "Cert:\CurrentUser\My" -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3", "2.5.29.19={text}")
$cer = Join-Path $env:RUNNER_TEMP 'test.cer'; Export-Certificate -Cert $cert -FilePath $cer | Out-Null
Import-Certificate -FilePath $cer -CertStoreLocation "Cert:\LocalMachine\TrustedPeople" | Out-Null
$signed = $msix -replace '\.msix$', '-test-signed.msix'; Copy-Item $msix $signed
& $signtool.FullName sign /fd SHA256 /sha1 $cert.Thumbprint $signed | Out-Null
Say ("signtool exit " + $LASTEXITCODE)
Add-AppxPackage -Path $signed
Say ("installed: " + [bool](Get-AppxPackage -Name $info.identity.name))
Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue; Start-Sleep 5
$docs = 'C:\Users\Public\Documents'; New-Item -ItemType Directory -Force $docs | Out-Null
$bytes = New-Object byte[] (2MB); (New-Object Random 7).NextBytes($bytes)
[IO.File]::WriteAllBytes((Join-Path $docs 'Example.pdf'), $bytes)
(New-Object -ComObject Shell.Application).MinimizeAll(); Start-Sleep 1
Start-Process explorer.exe $docs; Start-Sleep 6
$item = $null
for ($t = 0; $t -lt 20 -and -not $item; $t++) { $item = FindAll $root 'Example*' | Where-Object { $_.Current.ControlType.ProgrammaticName -like '*ListItem*' } | Select-Object -First 1; if (-not $item) { Start-Sleep 1 } }
if ($item) {
  $c = Center $item; Click $c[0] $c[1] $false; Start-Sleep 1; Click $c[0] $c[1] $true; Start-Sleep 3
  Shot '2-right-click-menu-store-package'
  [System.Windows.Forms.SendKeys]::SendWait('{ESC}')
} else { Say "NOT MADE: store menu shot: no list item"; Shot 'debug-explorer-store' }
Get-AppxPackage -Name $info.identity.name | Remove-AppxPackage
Say "done"
