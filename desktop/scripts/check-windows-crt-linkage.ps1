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

# VCRUNTIME/MSVCP/CONCRT/VCOMP are distributed by the Visual C++
# Redistributable and caused the clean-machine VCRUNTIME140_1.dll failure.
# ucrtbase.dll and api-ms-win-crt-*.dll are different: they are Universal CRT
# operating-system components on the supported Windows 10/11 targets.
$redistributableRuntime = "(?im)^[ \t]*(?:(?:VCRUNTIME|MSVCP|CONCRT|VCOMP)\d+(?:_\d+)*|MSVCR\d+)[^\s]*\.dll[ \t]*$"
$systemUcrt = "(?im)^[ \t]*(?:ucrtbase|api-ms-win-crt[^\s]*)\.dll[ \t]*$"

$mustReject = @(
  "VCRUNTIME140.dll",
  "VCRUNTIME140_1.dll",
  "MSVCP140_ATOMIC_WAIT.dll",
  "CONCRT140.dll",
  "VCOMP140.dll",
  "MSVCR120.dll"
)
$mustAllow = @(
  "api-ms-win-crt-convert-l1-1-0.dll",
  "api-ms-win-crt-runtime-l1-1-0.dll",
  "ucrtbase.dll",
  "msvcrt.dll",
  "KERNEL32.dll"
)
foreach ($dependency in $mustReject) {
  if (-not [regex]::IsMatch($dependency, $redistributableRuntime)) {
    throw "CRT linkage policy must reject $dependency"
  }
}
foreach ($dependency in $mustAllow) {
  if ([regex]::IsMatch($dependency, $redistributableRuntime)) {
    throw "CRT linkage policy must allow $dependency"
  }
}

foreach ($binary in $binaries) {
  $dependencies = (& $dumpbin /DEPENDENTS $binary 2>&1 | Out-String)
  if ($LASTEXITCODE -ne 0) {
    throw "dumpbin.exe failed while inspecting $binary.`n$dependencies"
  }

  $matches = [regex]::Matches($dependencies, $redistributableRuntime) |
    ForEach-Object { $_.Value.Trim() } |
    Sort-Object -Unique
  if ($matches.Count -gt 0) {
    throw "$binary requires Visual C++ Redistributable libraries: $($matches -join ', ')"
  }

  $ucrtMatches = [regex]::Matches($dependencies, $systemUcrt) |
    ForEach-Object { $_.Value.Trim() } |
    Sort-Object -Unique
  if ($ucrtMatches.Count -gt 0) {
    Write-Host "Windows Universal CRT OS imports: $($ucrtMatches -join ', ')"
  }

  Write-Host "No Visual C++ Redistributable dependency: $binary"
}
