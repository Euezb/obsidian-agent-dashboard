# 把当前构建发到每个 vault 的插件目录。
#
# 为什么要写成脚本:同一个插件在两个 vault 里各有一份副本(见 AGENTS.md),
# 只更新一份就会出现「关掉再打开没变化」——2026-09-30 已经踩过一次。
#
# 用法:
#   pwsh -File work/deploy.ps1              # 构建 + 部署
#   pwsh -File work/deploy.ps1 -SkipBuild   # 只用现有的 main.js 部署
#   pwsh -File work/deploy.ps1 -WithAssets  # 连 assets/tarot 一起复制(素材有变动时)
param(
	[switch]$SkipBuild,
	[switch]$WithAssets
)

$ErrorActionPreference = "Stop"
$root = "<source root>"
$targets = @(
	@{ Vault = "Obsidian Vault"; Path = "<vault A>\.obsidian\plugins\agent-dashboard" },
	@{ Vault = "提示词测试脚本"; Path = "<vault B>\.obsidian\plugins\agent-dashboard" }
)

if (-not $SkipBuild) {
	Write-Host "构建…"
	pushd $root
	try {
		npm run build
	} finally {
		popd
	}
}

$stamp = Get-Date -Format "yyyyMMdd-HHmm"
$sourceHash = (Get-FileHash "$root\main.js").Hash
$version = (Get-Content "$root\manifest.json" -Raw | ConvertFrom-Json).version
$rows = @()

foreach ($entry in $targets) {
	$target = $entry.Path
	if (-not (Test-Path $target)) {
		Write-Warning "跳过(目录不存在):$target"
		continue
	}
	$backup = Join-Path $target ".backup-$stamp"
	New-Item -ItemType Directory -Force -Path $backup | Out-Null
	foreach ($name in @("main.js", "manifest.json", "styles.css")) {
		$existing = Join-Path $target $name
		if (Test-Path $existing) { Copy-Item $existing -Destination $backup -Force }
	}
	Copy-Item "$root\main.js", "$root\manifest.json", "$root\styles.css" -Destination $target -Force
	if ($WithAssets) {
		New-Item -ItemType Directory -Force -Path "$target\assets" | Out-Null
		Copy-Item "$root\assets\tarot" -Destination "$target\assets\" -Recurse -Force
	}
	$rows += [pscustomobject]@{
		Vault   = $entry.Vault
		Version = (Get-Content "$target\manifest.json" -Raw | ConvertFrom-Json).version
		Same    = ((Get-FileHash "$target\main.js").Hash -eq $sourceHash)
		Backup  = Split-Path $backup -Leaf
	}
}

Write-Host ""
$rows | Format-Table -AutoSize
Write-Host ("源版本:{0}  main.js {1}" -f $version, $sourceHash.Substring(0, 16))
if (($rows | Where-Object { -not $_.Same }).Count -gt 0) {
	throw "有目标没有写成同一份 main.js,部署不完整。"
}
Write-Host "两个 vault 都已更新。在 Obsidian 里把 Agent Dashboard 关掉再打开即生效。"
