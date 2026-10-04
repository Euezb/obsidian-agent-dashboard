# 生成插件内置的塔罗素材:assets/tarot/*.jpg
#
# 来源:Rider-Waite(Smith,1909)公共领域扫描件,取自 GitHub 上的 mixvlad/TarotCards
#      (同一批扫描件也挂在 Wikimedia Commons,但本机访问 upload.wikimedia.org 会超时)。
# 做法:下载 720×1200 母版 → 缩到 400×667、JPEG q72 后写入 assets/tarot/。
#      插件运行时用 FileSystemAdapter.getResourcePath 直接读这些本地文件,不联网。
#
# 用法:pwsh -File work\build-tarot-assets.ps1
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root 'assets\tarot'
$cacheDir = Join-Path $root 'work\tarot-720'
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
New-Item -ItemType Directory -Path $cacheDir -Force | Out-Null

$majors = @(
	'00_Fool', '01_Magician', '02_High_Priestess', '03_Empress', '04_Emperor', '05_Hierophant',
	'06_Lovers', '07_Chariot', '08_Strength', '09_Hermit', '10_Wheel_of_Fortune', '11_Justice',
	'12_Hanged_Man', '13_Death', '14_Temperance', '15_Devil', '16_Tower', '17_Star', '18_Moon',
	'19_Sun', '20_Judgement', '21_World'
)
$suits = @{ Wands = 14; Cups = 14; Swords = 14; Pents = 14 }
$names = @($majors) + @('Cover')
foreach ($suit in $suits.Keys) {
	for ($n = 1; $n -le $suits[$suit]; $n++) { $names += ('{0}{1:d2}' -f $suit, $n) }

}

$base = 'https://raw.githubusercontent.com/mixvlad/TarotCards/main/tarot/rider-waite/720px'
$targetWidth = 400
$quality = 72L
$encoder = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$params = New-Object System.Drawing.Imaging.EncoderParameters 1
$params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), $quality

$total = 0
$ok = 0
$failed = @()
foreach ($name in $names) {
	$total++
	$file = "$name.jpg"
	$cache = Join-Path $cacheDir $file
	$out = Join-Path $outDir $file

	if (-not (Test-Path $cache)) {
		for ($try = 1; $try -le 3; $try++) {
			try {
				Invoke-WebRequest -Uri "$base/$file" -OutFile $cache -TimeoutSec 30 -UserAgent 'Mozilla/5.0' -ErrorAction Stop
				break
			} catch {
				if ($try -eq 3) { $failed += $file; }
				Start-Sleep -Milliseconds 400
			}
		}
	}
	if (-not (Test-Path $cache)) { continue }

	if (-not (Test-Path $out)) {
		$image = [System.Drawing.Image]::FromFile($cache)
		try {
			$height = [int][Math]::Round($image.Height * ($targetWidth / $image.Width))
			$bitmap = New-Object System.Drawing.Bitmap $targetWidth, $height
			$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
			try {
				$graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
				$graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
				$graphics.DrawImage($image, 0, 0, $targetWidth, $height)
			} finally { $graphics.Dispose() }
			$bitmap.Save($out, $encoder, $params)
			$bitmap.Dispose()
		} finally { $image.Dispose() }
	}
	if (Test-Path $out) { $ok++ }
}

"assets: $ok / $total"
if ($failed.Count -gt 0) { "download failed: $($failed -join ', ')" }
$size = (Get-ChildItem $outDir -Filter *.jpg -File | Measure-Object -Property Length -Sum).Sum
"total size: {0:N2} MB" -f ($size / 1MB)
