$ErrorActionPreference = "Stop"
$moduleRoot = Split-Path -Parent $PSScriptRoot
$outputRoot = Join-Path $moduleRoot "out"
& (Join-Path $PSScriptRoot "test.ps1")
& java -Xms512m -Xmx512m -cp $outputRoot kr.tradingstocksysyem.venue.VenueCoreBenchmark 100000
if ($LASTEXITCODE -ne 0) { throw "venue core benchmark failed" }
