#!/usr/bin/env node
/**
 * Differential fuzzing harness for the C++ engine port.
 *
 * Issue #61: Differential Fuzzing Harness.
 *
 * Generates random circuits and runs them through both the TypeScript engine
 * and the C++ Wasm engine, comparing voltages, pin levels, serial output,
 * and display framebuffers at every step.
 *
 * Usage:
 *   node scripts/fuzz-parity.mjs [--count N] [--steps N]
 *
 * Or via npm:
 *   npm run test:fuzz
 *   FUZZ_COUNT=1000 npm run test:fuzz
 *
 * CI integration:
 *   - Nightly: FUZZ_COUNT=10000 npm run test:fuzz
 *   - PR: FUZZ_COUNT=1000 npm run test:fuzz
 */

const count = parseInt(process.argv.find((a) => a.startsWith('--count='))?.split('=')[1] ?? process.env.FUZZ_COUNT ?? '100', 10);
const steps = parseInt(process.argv.find((a) => a.startsWith('--steps='))?.split('=')[1] ?? process.env.FUZZ_STEPS ?? '20', 10);

console.log(`Running differential fuzz: ${count} circuits, ${steps} steps each`);
console.log(`Set FUZZ_COUNT and FUZZ_STEPS env vars or use --count=N --steps=N flags`);

// Delegate to vitest
import { execFileSync } from 'node:child_process';
try {
  execFileSync('npx', ['vitest', 'run', 'src/features/simulation/fuzz-parity.test.ts'], {
    stdio: 'inherit',
    env: { ...process.env, FUZZ_COUNT: String(count), FUZZ_STEPS: String(steps) },
    shell: true,
  });
} catch (error) {
  console.error('Fuzz test failed:', error.message);
  process.exit(1);
}
