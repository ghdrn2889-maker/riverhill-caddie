# 카톡 PC 방 창 읽기 — 지정한 단톡방 창만 찍어 글자를 뽑아 서버로 보낸다.
#
#  왜 PC인가: 폰 알림은 단톡방 이름 대신 '보낸 사람 이름'만 실어 보낸다. 그래서 방으로 거를 수가 없고,
#   리버힐 컨트리클럽 방 메시지가 통째로 버려지고 있었다(실측 8/16: 그 방에서 온 것 0건).
#   PC 카톡은 창 제목이 곧 방 이름이라 이 문제가 사라진다.
#
#  ★사생활: 화이트리스트에 적힌 방 창만 찍는다. 개인 대화창은 열려 있어도 절대 안 찍는다.
#   (폰 방식은 모든 알림을 서버로 보낸 뒤 버리는 구조라 오히려 이보다 나빴다.)
#
#  OCR은 윈도우 내장(Windows.Media.Ocr)을 쓴다 — 무료·로컬·한국어 지원. 판독 비용 0.
#  Windows PowerShell 5.1로 실행해야 한다(pwsh는 WinRT 타입을 못 부른다):
#    powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools\kakao-pc-capture.ps1
param(
  [string[]] $Rooms  = @('리버힐 컨트리클럽', '리버힐3부', '1조톡방'),
  [string]   $Server = $env:RIVERHILL_INGEST_URL,   # 예: https://ada-b850m-force.tail4c9a37.ts.net
  [string]   $Token  = $env:RIVERHILL_INGEST_TOKEN,
  [string]   $OutDir = "$env:LOCALAPPDATA\riverhill-kakao",
  [switch]   $DryRun                                 # 서버로 안 보내고 화면에만 출력
)

$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
Add-Type -AssemblyName System.Drawing

# ── 창 열거·캡처 ──────────────────────────────────────────────────────
if (-not ('RhWin' -as [type])) {
Add-Type -TypeDefinition @'
using System; using System.Text; using System.Runtime.InteropServices;
public class RhWin {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint f);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr h);
  public struct RECT { public int L, T, R, B; }
  static StringBuilder acc; static uint want;
  static bool Cb(IntPtr h, IntPtr l) {
    if (!IsWindowVisible(h)) return true;
    uint pid; GetWindowThreadProcessId(h, out pid);
    if (pid != want) return true;
    var sb = new StringBuilder(512); GetWindowText(h, sb, 512);
    if (sb.Length > 0) acc.Append(h.ToInt64()).Append('\t').Append(sb).Append('\n');
    return true;
  }
  public static string Find(uint pid) { want = pid; acc = new StringBuilder(); EnumWindows(Cb, IntPtr.Zero); return acc.ToString(); }
}
'@ -ReferencedAssemblies System.Drawing }

function Capture-Window([IntPtr]$h, [string]$path) {
  $r = New-Object RhWin+RECT
  [void][RhWin]::GetWindowRect($h, [ref]$r)
  # ★화면 배율 보정 — GetWindowRect는 논리 픽셀을 주는데 PrintWindow는 실제 픽셀로 그린다.
  #  200% 배율에서 이걸 빼먹으면 창의 왼쪽 위 1/4만 찍힌다.
  $s = [RhWin]::GetDpiForWindow($h) / 96.0
  [int]$w = [Math]::Round(($r.R - $r.L) * $s); [int]$ht = [Math]::Round(($r.B - $r.T) * $s)
  if ($w -lt 100 -or $ht -lt 100) { return $null }
  $bmp = New-Object System.Drawing.Bitmap -ArgumentList $w, $ht
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $hdc = $g.GetHdc()
  [void][RhWin]::PrintWindow($h, $hdc, 2)   # 2 = PW_RENDERFULLCONTENT (가속 렌더 창도 잡힘)
  $g.ReleaseHdc($hdc); $g.Dispose()
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  return $path
}

# ── 윈도우 내장 OCR ───────────────────────────────────────────────────
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Await($op, $type) {
  $t = $asTaskGeneric.MakeGenericMethod($type).Invoke($null, @($op))
  $t.Wait(-1) | Out-Null
  $t.Result
}
[void][Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
[void][Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
[void][Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
[void][Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]

$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage((New-Object Windows.Globalization.Language 'ko'))
if (-not $engine) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }
if (-not $engine) { throw 'OCR 엔진 없음 — 설정 > 시간 및 언어 > 언어에서 한국어 기본 기능(OCR)을 설치하세요.' }

# ★OCR 전에 확대한다 — 윈도우 OCR은 글자가 작으면 눈에 띄게 틀린다.
#  실측: 원본 크기에선 '가배치'를 '가배지'로 읽었다. 하필 우리가 제일 정확해야 하는 단어다
#  (가배치표를 본배치표로 착각하면 엉뚱한 배치가 회원 화면에 뜬다).
function Upscale([string]$src, [int]$factor = 3) {
  $img = [System.Drawing.Image]::FromFile($src)
  $dst = [IO.Path]::ChangeExtension($src, ".x$factor.png")
  $bmp = New-Object System.Drawing.Bitmap -ArgumentList ([int]($img.Width * $factor)), ([int]($img.Height * $factor))
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.DrawImage($img, 0, 0, $bmp.Width, $bmp.Height)
  $g.Dispose(); $bmp.Save($dst, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose(); $img.Dispose()
  return $dst
}

function Ocr-File([string]$path) {
  $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($path)) ([Windows.Storage.StorageFile])
  $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  $dec = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $sb = Await ($dec.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $res = Await ($engine.RecognizeAsync($sb)) ([Windows.Media.Ocr.OcrResult])
  # 줄 단위로 뽑는다 — 카톡은 한 줄이 한 메시지에 가까워 줄바꿈이 의미를 갖는다.
  ($res.Lines | ForEach-Object { $_.Text }) -join "`n"
}

# ── 본작업 ────────────────────────────────────────────────────────────
$proc = Get-Process -Name KakaoTalk -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $proc) { Write-Host '카카오톡 PC가 실행중이 아닙니다.'; exit 0 }

$stateFile = Join-Path $OutDir 'seen.json'
$seen = @{}
if (Test-Path $stateFile) { try { (Get-Content $stateFile -Raw | ConvertFrom-Json).PSObject.Properties | ForEach-Object { $seen[$_.Name] = $_.Value } } catch {} }

foreach ($line in ([RhWin]::Find([uint32]$proc.Id) -split "`n" | Where-Object { $_ })) {
  $parts = $line -split "`t", 2
  $h = [IntPtr][int64]$parts[0]
  $title = $parts[1].Trim()
  # ★화이트리스트에 없는 창은 찍지도 않는다(개인 대화 보호)
  if ($Rooms -notcontains $title) { continue }
  $safe = ($title -replace '[^가-힣A-Za-z0-9]', '')
  $png = Join-Path $OutDir "$safe.png"
  if (-not (Capture-Window $h $png)) { continue }
  $big = Upscale $png 3
  $text = (Ocr-File $big).Trim()
  Remove-Item $big -ErrorAction SilentlyContinue
  if (-not $text) { Write-Host "[$title] 글자 없음"; continue }

  # 같은 화면을 반복해서 보내지 않는다 — 카톡 창은 안 바뀌어도 계속 떠 있다.
  $hash = [System.BitConverter]::ToString(
    [System.Security.Cryptography.SHA1]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($text))).Replace('-', '').Substring(0, 16)
  if ($seen[$title] -eq $hash) { Write-Host "[$title] 화면 그대로 → 전송 안 함"; continue }
  $seen[$title] = $hash

  Write-Host "[$title] $($text.Length)자"
  if ($DryRun -or -not $Server) {
    Write-Host '--- OCR 결과 ---'; Write-Host $text; Write-Host '----------------'
    continue
  }
  $body = @{ text = $text; room = $title; sender = ''; source = '카톡PC' } | ConvertTo-Json -Compress
  try {
    $r = Invoke-RestMethod -Uri "$Server/api/ingest" -Method Post -ContentType 'application/json; charset=utf-8' `
      -Headers @{ 'x-token' = $Token } -Body ([Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 30
    Write-Host "  → 전송 완료"
  } catch { Write-Host "  → 전송 실패: $($_.Exception.Message)" }
}
$seen | ConvertTo-Json -Compress | Set-Content -Path $stateFile -Encoding UTF8
