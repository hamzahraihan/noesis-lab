# Static-host isolation requirements (sim worker offload)

The worker simulation path moves the engine off the UI thread and shares
every frame through a `SharedArrayBuffer` snapshot
(`src/features/simulation/sim-worker/protocol.ts`). Shared memory is only
constructed in a cross-origin-isolated page, so **every static host serving
the app must send these two response headers on all responses**:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

The dev and preview servers already do this (`vite.config.ts`
`server.headers` / `preview.headers`). Any production host (Pages, Netlify,
S3+CloudFront, nginx, …) needs the equivalent configuration, or the worker
path stays dark in production while working fine locally.

## Without the headers

`SharedArrayBuffer` construction throws without isolation. Startup probes
for exactly that: `createWorkerClient`
(`src/features/bench/simulations/worker-client.ts`) allocates a one-cell
snapshot before spawning anything, and on failure calls `onFallback` with
`sim worker unavailable: shared memory failed (…)` and returns null. The
bench (`src/features/bench/components/Bench.tsx`) then runs the in-page
`Simulation` exactly as before — same firmware, same glass. No user action
is needed; the worker path is silently off and the status seam reports the
fallback reason.

## Toolchain CDN

Worker compiles fetch the AVR toolchain from a CDN, and `require-corp`
blocks responses that lack a `Cross-Origin-Resource-Policy` header. Task 1
verified the pinned CDN sends one:

```
CDN_BASE = 'https://cdn.jsdelivr.net/npm/@horang-corp/avr-gcc-wasm@0.2.0/'
  (src/features/simulation/avr/toolchain/cache.ts:15)
cross-origin-resource-policy: cross-origin
```

so COEP `require-corp` does not break worker compiles. If the toolchain
origin ever changes, re-run the Task 1 gate (`curl -sI <CDN_BASE> | grep -i
cross-origin-resource-policy`) before shipping.

## Verify a host

```bash
curl -sI https://<host>/ | grep -i "cross-origin"
# expect:
#   Cross-Origin-Opener-Policy: same-origin
#   Cross-Origin-Embedder-Policy: require-corp
```

then load the app and check `self.crossOriginIsolated === true` in the
console. If it is `false`, the headers are missing somewhere in the chain
and the bench is running in-page.
