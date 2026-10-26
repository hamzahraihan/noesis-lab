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
import { parseDebugInfo, type CompiledDebugInfo } from '../avr/debug/lines';
import type { Breakpoint, DebugFrame } from '../firmware/debugger';
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
      /**
       * The stops the debugger holds.
       *
       * They ride with the sketch, because a stop that arrives after the
       * program has started is a stop the sketch has already passed.
       */
      stops?: Breakpoint[];
    }
  | { id: number; type: 'start' }
  | { id: number; type: 'stop' }
  | { id: number; type: 'ping' }
  | { id: number; type: 'press'; partId: string; down: boolean }
  | { id: number; type: 'knob'; partId: string; spec: KnobSpec; value: number }
  | { id: number; type: 'edit'; bench: Bench }
  | { id: number; type: 'flash'; words: Uint16Array; debug?: CompiledDebugInfo }
  | { id: number; type: 'speed'; scale: number }
  | { id: number; type: 'ack'; generation: number }
  | { id: number; type: 'faults' }
  | { id: number; type: 'debug-stops'; stops: Breakpoint[] }
  | { id: number; type: 'debug-resume' }
  | { id: number; type: 'debug-step'; mode: 'over' | 'into' };
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
/**
 * The frame the program is stopped on, as the page last heard it.
 *
 * The frame is pushed when the program stops and again when it stops
 * somewhere new, so a bench that is stopped is not posting the same frame
 * sixty times a second.
 */
let pausedFrame: DebugFrame | null = null;
type Port = { postMessage(message: unknown): void };
function handle(port: Port, msg: Incoming): void {
  const debugStatus = (): Record<string, unknown> => ({
    debugWatchable: core?.debugWatchable() ?? false,
    debugCompiled: core?.debugCompiled() ?? false,
  });
  const ok = (id: number, extra?: Record<string, unknown>): void =>
    port.postMessage({ id, ok: true, ...debugStatus(), ...extra });
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
        pausedFrame = null;
        // The stops are set before the rebuild, so the runner the rebuild
        // builds is watched from its first statement.
        core.setStops(msg.stops ?? []);
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
        // The page already parsed the toolchain response, but this is a second
        // realm boundary: never let a malformed row reach the core's lookup.
        const debug = msg.debug === undefined ? undefined : parseDebugInfo(msg.debug);
        if (msg.debug !== undefined && debug === null) throw new Error('malformed debug rows');
        core.flash(msg.words, debug ?? undefined);
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
      /*
       * The rows are the per-part script faults; the fault text is the
       * firmware's own verdict, latched when a sketch raised an error it did
       * not catch. Both travel together, so the page can say why the sketch
       * stopped rather than showing a bench that has quietly gone quiet.
       */
      ok(msg.id, { rows: core?.faults() ?? [], fault: core?.fault ?? null });
      break;
    case 'debug-stops':
      /*
       * The stops the person set on the sketch. The worker holds them
       * because the program runs here: a stop the page kept would be a stop
       * nothing could honour.
       */
      core?.setStops(msg.stops);
      ok(msg.id);
      break;
    case 'debug-resume':
      core?.resumeDebug();
      ok(msg.id);
      break;
    case 'debug-step':
      core?.stepDebug(msg.mode);
      ok(msg.id);
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
    /*
     * The program stopped. The page has to hear about it, because the
     * program is not moving and the panel that says where it is has nothing
     * to show until it does. The frame is pushed rather than polled, so the
     * stop appears as soon as it happens -- and it is pushed again when the
     * frame changes, because a step stops somewhere new.
     */
    if (core.debugPaused()) {
      const frame = core.debugFrame();
      if (frame !== pausedFrame) {
        pausedFrame = frame;
        port.postMessage({
          type: 'debug-paused',
          frame,
          debugWatchable: core.debugWatchable(),
          debugCompiled: core.debugCompiled(),
        });
      }
    } else if (pausedFrame !== null) {
      pausedFrame = null;
      port.postMessage({ type: 'debug-resumed' });
    }
  }, TICK_MS);
}
