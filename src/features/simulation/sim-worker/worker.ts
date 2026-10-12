/**
 * Sim worker entry: message port, self-paced loop, backpressure. Wiring only.
 * Frames travel via SAB, polled per rAF main-side. Ticks pause past
 * MAX_UNREAD_FRAMES unacked frames until `ack`. `edit` rebuilds, zeroes
 * generation, answers with a `realloc` notice carrying the new buffer.
 */
import { createSimCore, type CoreHandle } from './core';
import { headerView } from './protocol';
import type { Bench } from '../bench';
import type { FirmwareProject } from '../firmware/project';
import type { KnobSpec } from '@/features/parts';
export const MAX_UNREAD_FRAMES = 4;
type Incoming =
  | { id: number; type: 'init'; bench: Bench; firmware: FirmwareProject; execution: 'interpreter' | 'avr' }
  | { id: number; type: 'start' } | { id: number; type: 'stop' } | { id: number; type: 'ping' }
  | { id: number; type: 'press'; partId: string; down: boolean }
  | { id: number; type: 'knob'; partId: string; spec: KnobSpec; value: number }
  | { id: number; type: 'edit'; bench: Bench } | { id: number; type: 'flash'; words: Uint16Array }
  | { id: number; type: 'ack'; generation: number };
let core: CoreHandle | null = null;
let firmware: FirmwareProject | null = null;
let execution: 'interpreter' | 'avr' = 'interpreter';
let running = false;
let unread = 0;
type Port = { postMessage(message: unknown): void };
function handle(port: Port, msg: Incoming): void {
  const ok = (id: number, extra?: Record<string, unknown>): void => port.postMessage({ id, ok: true, ...extra });
  const fail = (id: number, error: string): void => port.postMessage({ id, ok: false, error });
  const detail = (error: unknown): string => (error instanceof Error ? error.message : String(error));
  switch (msg.type) {
    case 'init': {
      const board = msg.bench.parts[0]?.definition;
      if (!board) { fail(msg.id, 'init needs a board part first'); break; }
      try {
        core = createSimCore(board); firmware = msg.firmware; execution = msg.execution; running = false; unread = 0;
        core.rebuild(msg.bench, msg.firmware, msg.execution);
        ok(msg.id, { buffer: core.snapshot(), fault: core.fault });
      } catch (error) { fail(msg.id, detail(error)); }
      break;
    }
    case 'edit': {
      if (!core || !firmware) { fail(msg.id, 'not initialised'); break; }
      try {
        core.rebuild(msg.bench, firmware, execution);
        const buffer = core.snapshot(); headerView(buffer).generation = 0; unread = 0;
        ok(msg.id, { realloc: true, buffer, fault: core.fault });
      } catch (error) { fail(msg.id, detail(error)); }
      break;
    }
    case 'flash': {
      if (!core) { fail(msg.id, 'not initialised'); break; }
      try { core.flash(msg.words); ok(msg.id, { fault: core.fault }); }
      catch (error) { fail(msg.id, detail(error)); }
      break;
    }
    case 'press': case 'knob': {
      if (!core) { fail(msg.id, 'not initialised'); break; }
      try {
        core.applyInput(msg.type === 'press'
          ? { kind: 'press', partId: msg.partId, value: msg.down }
          : { kind: 'knob', partId: msg.partId, value: { spec: msg.spec, value: msg.value } });
        ok(msg.id);
      } catch (error) { fail(msg.id, detail(error)); }
      break;
    }
    case 'start': case 'stop': running = msg.type === 'start'; ok(msg.id); break;
    case 'ack': unread = 0; ok(msg.id); break;
    case 'ping': ok(msg.id, { fault: core?.fault ?? null }); break;
  }
}
if (typeof self !== 'undefined' && 'postMessage' in self) {
  const port = self as unknown as Port & { onmessage: ((event: { data: Incoming }) => void) | null };
  port.onmessage = (event) => handle(port, event.data);
  setInterval(() => {
    if (!running || !core || unread >= MAX_UNREAD_FRAMES) return;
    core.step(16); core.snapshot(); unread += 1;
  }, 16);
}
