@echo off
:: Windows companion to .mise-bin/zig-cc — same translation logic.
:: cargo's cc-rs on Windows invokes the path from CC_wasm32_unknown_unknown / RIPGIT_WASM_CC;
:: it tries the bare name first, then with .cmd / .exe extensions on PATHEXT lookups,
:: AND it checks the executable type. The bash script confused Win32's loader
:: ("not a valid Win32 application"), so we ship this .cmd alongside.
::
:: Translation: --target=wasm32-unknown-unknown → --target=wasm32-freestanding
:: (Rust calls it `unknown-unknown`; zig calls it `freestanding`.)

setlocal enabledelayedexpansion
set "args="
:loop
if "%~1"=="" goto :run
set "arg=%~1"
if "!arg!"=="--target=wasm32-unknown-unknown" (
  set "args=!args! --target=wasm32-freestanding"
) else if "!arg!"=="--target=wasm32-wasi" (
  set "args=!args! --target=wasm32-wasi"
) else (
  set "args=!args! %1"
)
shift
goto :loop

:run
zig cc%args%
endlocal
