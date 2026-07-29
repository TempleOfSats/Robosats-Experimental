$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$binaries = @(
  (Join-Path $root "desktop\arti-sidecar\target\release\robosats-arti.exe"),
  (Join-Path $root "desktop\src-tauri\target\release\robosats-exp-desktop.exe")
)

$missing = @($binaries | Where-Object { -not (Test-Path $_ -PathType Leaf) })
if ($missing.Count -gt 0) {
  throw "Expected Windows binaries were not produced: $($missing -join ', ')"
}

$dumpbinCommand = Get-Command "dumpbin.exe" -ErrorAction SilentlyContinue
if ($dumpbinCommand) {
  $dumpbin = $dumpbinCommand.Source
} else {
  $vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
  if (-not (Test-Path $vswhere -PathType Leaf)) {
    throw "Could not locate dumpbin.exe or vswhere.exe."
  }

  $visualStudio = & $vswhere `
    -latest `
    -products * `
    -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
    -property installationPath
  if (-not $visualStudio) {
    throw "Could not locate Visual Studio C++ build tools."
  }

  $dumpbin = Get-ChildItem `
    (Join-Path $visualStudio "VC\Tools\MSVC\*\bin\Hostx64\x64\dumpbin.exe") `
    -File |
    Sort-Object FullName -Descending |
    Select-Object -First 1 -ExpandProperty FullName
  if (-not $dumpbin) {
    throw "Could not locate dumpbin.exe in the Visual Studio installation."
  }
}

$forbiddenRuntime = "(?im)^\s*(?:VCRUNTIME|MSVCP|CONCRT|ucrtbase|api-ms-win-crt)[^\s]*\.dll\s*$"

foreach ($binary in $binaries) {
  $dependencies = (& $dumpbin /DEPENDENTS $binary 2>&1 | Out-String)
  if ($LASTEXITCODE -ne 0) {
    throw "dumpbin.exe failed while inspecting $binary.`n$dependencies"
  }

  $matches = [regex]::Matches($dependencies, $forbiddenRuntime) |
    ForEach-Object { $_.Value.Trim() } |
    Sort-Object -Unique
  if ($matches.Count -gt 0) {
    throw "$binary dynamically imports Microsoft C runtime libraries: $($matches -join ', ')"
  }

  Write-Host "Static Microsoft CRT linkage verified: $binary"
}
