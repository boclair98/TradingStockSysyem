$ErrorActionPreference = "Stop"
$moduleRoot = Split-Path -Parent $PSScriptRoot
$outputRoot = Join-Path $moduleRoot "out"
New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null
$sources = Get-ChildItem -Path (Join-Path $moduleRoot "src") -Recurse -Filter "*.java" | ForEach-Object { $_.FullName }
& javac --release 21 -encoding UTF-8 -d $outputRoot $sources
if ($LASTEXITCODE -ne 0) { throw "javac failed" }
& java -ea -cp $outputRoot kr.tradingstocksysyem.venue.VenueCoreTest
if ($LASTEXITCODE -ne 0) { throw "venue core tests failed" }
