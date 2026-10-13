#!/bin/sh
set -e
npx -y wabt@1.0.35 --version >/dev/null 2>&1 || npm i -D wabt@1.0.35
npx wat2wasm src/features/simulation/avr/wasm/counter.wat -o src/features/simulation/avr/wasm/counter.wasm
