/**
 * Sim worker entry: message port, self-paced loop, backpressure. Wiring only.
 * Frames travel via SAB, polled per rAF main-side. Ticks pause on an unread
 * backlog only while the reader is also stale (no `ack` within
 * ACK_STALE_MS, i.e. a hidden tab) — a slow-but-alive reader must never
 * starve the sim, since the buffer overwrites and it always reads latest.
 * `edit` rebuilds, zeroes generation, answers with a `realloc` notice
 * carrying the new buffer.
 */
import { createSimCore, type CoreHandle } from './core';
import { clearReportedFaults } from '../scripted/diagnostics';
import { ACK_STALE_MS, headerView, shouldThrottle } from './protocol';
import type { Bench } from '../bench';
import type { FirmwareProject } from '../firmware/project';
import type { KnobSpec } from '@/features/parts';

/** Simulated milliseconds one self-paced tick advances, before the multiplier. */
const TICK_MS = 16;

export const MAX_UNREAD_FRAMES = 4;
type Incoming =
  | {
      id: number;
      type: 'init';
      bench: Bench;
      firmware: FirmwareProject;
      execution: 'interpreter' | 'avr' | 'rp2040' | 'esp32';
      wasm?: boolean;
      /** Whether this bench's network may bridge to real hosts. */
      liveNetwork?: boolean;
    }
  | { id: number; type: 'start' }
  | { id: number; type: 'stop' }
  | { id: number; type: 'ping' }
  | { id: number; type: 'press'; partId: string; down: boolean }
  | { id: number; type: 'knob'; partId: string; spec: KnobSpec; value: number }
  | { id: number; type: 'edit'; bench: Bench }
  | { id: number; type: 'flash'; words: Uint16Array }
  | { id: number; type: 'speed'; scale: number }
  | { id: number; type: 'ack'; generation: number }
  | { id: number; type: 'faults' };
let core: CoreHandle | null = null;
let firmware: FirmwareProject | null = null;
let execution: 'interpreter' | 'avr' | 'rp2040' | 'esp32' = 'interpreter';
let wasm = false;
let running = false;
/**
 * Fast-forward multiplier for the tick budget: 1 is real time, 2 buys twice
 * the sketch time per tick. Kept across `edit` rebuilds so the operator's
 * choice survives a recompile; a page reload starts a fresh worker at 1.
 */
let speed = 1;
let unread = 0;
let lastAckMs = 0;
type Port = { postMessage(message: unknown): void };
function handle(port: Port, msg: Incoming): void {
  const ok = (id: number, extra?: Record<string, unknown>): void =>
    port.postMessage({ id, ok: true, ...extra });
  const fail = (id: number, error: string): void => port.postMessage({ id, ok: false, error });
  const detail = (error: unknown): string =>
    error instanceof Error ? error.message : String(error);
  switch (msg.type) {
    case 'init': {
      const board = msg.bench.parts[0]?.definition;
      if (!board) {
        fail(msg.id, 'init needs a board part first');
        break;
      }
      try {
        // A fresh run is the operator's retry: the previous run's rows are gone.
        clearReportedFaults();
        core = createSimCore(board, undefined, { liveNetwork: msg.liveNetwork ?? false });
        firmware = msg.firmware;
        execution = msg.execution;
        wasm = msg.wasm ?? false;
        running = false;
        unread = 0;
        core.rebuild(msg.bench, msg.firmware, msg.execution, wasm);
        ok(msg.id, { buffer: core.snapshot(), fault: core.fault });
      } catch (error) {
        fail(msg.id, detail(error));
      }
      break;
    }
    case 'edit': {
      if (!core || !firmware) {
        fail(msg.id, 'not initialised');
        break;
      }
      try {
        core.rebuild(msg.bench, firmware, execution, wasm);
        const buffer = core.snapshot();
        headerView(buffer).generation = 0;
        unread = 0;
        ok(msg.id, { realloc: true, buffer, fault: core.fault });
      } catch (error) {
        fail(msg.id, detail(error));
      }
      break;
    }
    case 'flash': {
      if (!core) {
        fail(msg.id, 'not initialised');
        break;
      }
      try {
        core.flash(msg.words);
        ok(msg.id, { fault: core.fault });
      } catch (error) {
        fail(msg.id, detail(error));
      }
      break;
    }
    case 'press':
    case 'knob': {
      if (!core) {
        fail(msg.id, 'not initialised');
        break;
      }
      try {
        core.applyInput(
          msg.type === 'press'
            ? { kind: 'press', partId: msg.partId, value: msg.down }
            : { kind: 'knob', partId: msg.partId, value: { spec: msg.spec, value: msg.value } },
        );
        ok(msg.id);
      } catch (error) {
        fail(msg.id, detail(error));
      }
      break;
    }
    case 'start':
    case 'stop':
      running = msg.type === 'start';
      ok(msg.id);
      break;
    case 'speed':
      speed = Number.isFinite(msg.scale) && msg.scale > 0 ? msg.scale : 1;
      ok(msg.id);
      break;
    case 'ack':
      unread = 0;
      lastAckMs = Date.now();
      ok(msg.id);
      break;
    case 'ping':
      ok(msg.id, { fault: core?.fault ?? null });
      break;
    case 'faults':
      ok(msg.id, { rows: core?.faults() ?? [] });
      break;
  }
}
if (typeof self !== 'undefined' && 'postMessage' in self) {
  const port = self as unknown as Port & {
    onmessage: ((event: { data: Incoming }) => void) | null;
  };
  port.onmessage = (event) => handle(port, event.data);
  setInterval(() => {
    if (!running || !core) return;
    if (
      shouldThrottle({
        unread,
        maxUnread: MAX_UNREAD_FRAMES,
        nowMs: Date.now(),
        lastAckMs,
        staleMs: ACK_STALE_MS,
      })
    )
      return;
    // The core clamps each slice, so even a runaway multiplier steps at most
    // one MAX_FRAME_MS slice per tick.
    core.step(TICK_MS * speed);
    core.snapshot();
    unread += 1;
  }, TICK_MS);
}
