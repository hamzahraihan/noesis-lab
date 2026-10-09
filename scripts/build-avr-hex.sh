#!/usr/bin/env bash
set -euo pipefail
# Requires: arduino-cli + arduino:avr core installed.
# Usage: bash scripts/build-avr-hex.sh
node scripts/stage-avr-sketch.mjs
arduino-cli compile --fqbn arduino:avr:uno \
  --build-property compiler.cpp.extra_flags="-I src/features/simulation/avr/shim" \
  --output-dir .avr-stage/build .avr-stage/alarm
python3 - <<'EOF'
import hashlib, json
order = ['alarm.ino', 'config.h', 'button.h', 'button.cpp', 'clock.h', 'clock.cpp', 'alarmtone.h', 'alarmtone.cpp']
def entry(name):
    raw = open(f'.avr-stage/alarm/{name}', 'rb').read()
    return raw if name == 'alarm.ino' else (name + '\n').encode() + raw
blob = b'\n'.join(entry(n) for n in order)
hexraw = open('.avr-stage/build/alarm.ino.hex', 'rb').read()
json.dump({"file": "alarm-clock-uno.hex", "sha256": hashlib.sha256(hexraw).hexdigest(), "sourcesHash": hashlib.sha256(blob).hexdigest()}, open('src/features/simulation/avr/hex/manifest.json', 'w'), indent=2)
EOF
cp .avr-stage/build/alarm.ino.hex src/features/simulation/avr/hex/alarm-clock-uno.hex
