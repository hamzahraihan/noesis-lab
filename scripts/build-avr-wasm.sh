#!/bin/sh
# Thin entry point kept stable for docs and the wasm leg tests
# (`sh scripts/build-avr-wasm.sh`); all logic lives in build-avr-wasm.mjs:
# up-to-date manifest check, single-flight lock, then wat2wasm + asc from the
# locally-installed devDependencies. Regenerates
# src/features/simulation/avr/wasm/avr-core.wasm and counter.wasm; do not
# hand-edit those binaries — rebuild via this script.
set -e
exec node "$(dirname "$0")/build-avr-wasm.mjs"
