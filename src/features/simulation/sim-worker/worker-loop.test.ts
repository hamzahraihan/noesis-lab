import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { boardOption } from '@/features/learn/boardRegistry';
import { headerView } from './protocol';
import type { Bench } from '../bench';
import type { FirmwareProject } from '../firmware/project';

/*
 * The worker entry has no test of its own: every other sim-worker test drives
 * `createSimCore` directly and never touches the message handler or the timer
 * chain. That is the layer where the run can die silently -- a `start` with no
 * timer, a paused batch that never re-arms, an exception that ends stepping
 * without a word -- so it is exercised here through a fake `self` port.
 */

type Reply = {
  id: number;
  ok?: boolean;
  error?: string;
  buffer?: SharedArrayBuffer;
  fault?: string | null;
  type?: string;
};

type FakeSelf = {
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage: (message: unknown) => void;
};

const uno = boardOption('uno').make();

const blink: FirmwareProject = {
  language: 'arduino-cpp',
  activeName: 'main.ino',
  files: [
    {
      name: 'main.ino',
      content:
        'void setup() { pinMode(13, OUTPUT); }\nvoid loop() { digitalWrite(13, HIGH); delay(50); digitalWrite(13, LOW); delay(50); }\n',
    },
  ],
};

function bench(): Bench {
  return {
    parts: [{ id: 'board', definition: uno, x: 0, y: 0, rotation: 0, terminals: {} }],
    wires: [],
    terminals: [],
    revision: 0,
  } as unknown as Bench;
}

let self: FakeSelf;
let replies: Reply[];
let seq = 0;

/** Boots a fresh copy of the worker entry and returns its message pump. */
async function bootWorker(): Promise<(message: unknown) => void> {
  vi.resetModules();
  replies = [];
  seq = 0;
  self = {
    onmessage: null,
    postMessage: (message) => replies.push(message as Reply),
  };
  (globalThis as unknown as { self: FakeSelf }).self = self;
  await import('./worker');
  const handler = self.onmessage;
  if (handler === null) throw new Error('worker did not install a message handler');
  return (message) => handler({ data: message });
}

function send(sendFn: (message: unknown) => void, message: Record<string, unknown>): number {
  const id = ++seq;
  sendFn({ id, type: 'init', ...message });
  return id;
}

function lastInit(replies: Reply[]): Reply {
  const init = replies.find((reply) => reply.buffer !== undefined);
  if (init === undefined) throw new Error('no init reply');
  return init;
}

function frame(reply: Reply): { generation: number; timeMs: number } {
  const header = headerView(reply.buffer as SharedArrayBuffer);
  return { generation: header.generation, timeMs: header.timeMs };
}

/**
 * Plays the page's half of the contract: advance wall-clock time, and consume
 * each published frame with an `ack`, the way the per-rAF `poll()` does. A
 * reader that never acks is throttled on purpose, so a harness that skips this
 * measures the backpressure rather than the loop.
 */
function runWall(
  pump: (message: unknown) => void,
  init: Reply,
  ms: number,
  sliceMs = 16,
): void {
  for (let elapsed = 0; elapsed < ms; elapsed += sliceMs) {
    vi.advanceTimersByTime(sliceMs);
    pump({ id: ++seq, type: 'ack', generation: frame(init).generation });
  }
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as unknown as { self?: FakeSelf }).self;
});

describe('sim worker loop', () => {
  it('advances the clock once started and stops on stop', async () => {
    const pump = await bootWorker();
    send(pump, { bench: bench(), firmware: blink, execution: 'interpreter', stops: [] });
    const init = lastInit(replies);
    const before = frame(init);

    pump({ id: ++seq, type: 'start' });
    runWall(pump, init, 200);
    const after = frame(init);
    expect(after.timeMs).toBeGreaterThan(before.timeMs);
    expect(after.generation).toBeGreaterThan(before.generation);

    pump({ id: ++seq, type: 'stop' });
    const atStop = frame(init);
    runWall(pump, init, 200);
    expect(frame(init).timeMs).toBe(atStop.timeMs);
  });

  it('keeps stepping across 1x and 2x without a gap', async () => {
    const pump = await bootWorker();
    send(pump, { bench: bench(), firmware: blink, execution: 'interpreter', stops: [] });
    const init = lastInit(replies);
    pump({ id: ++seq, type: 'start' });

    runWall(pump, init, 100);
    const realtime = frame(init).timeMs;
    expect(realtime).toBeGreaterThan(0);

    pump({ id: ++seq, type: 'speed', speed: 'fast' });
    runWall(pump, init, 100);
    const fast = frame(init).timeMs;
    expect(fast).toBeGreaterThan(realtime);

    pump({ id: ++seq, type: 'speed', speed: 'realtime' });
    const before = frame(init).timeMs;
    runWall(pump, init, 100);
    expect(frame(init).timeMs).toBeGreaterThan(before);
  });

  it('runs a max batch and keeps the chain alive across many batches', async () => {
    const pump = await bootWorker();
    send(pump, { bench: bench(), firmware: blink, execution: 'interpreter', stops: [] });
    const init = lastInit(replies);
    pump({ id: ++seq, type: 'speed', speed: 'max' });
    pump({ id: ++seq, type: 'start' });

    const before = frame(init).timeMs;
    // Each timer hop is one bounded batch; drain a second of timer time.
    runWall(pump, init, 1000, 4);
    const after = frame(init).timeMs;
    expect(after).toBeGreaterThan(before + 500);
  });

  it('still steps when start arrives before the core exists', async () => {
    // The client queues `start` behind the init handshake, so this is not the
    // normal order -- but the loop must not depend on it. A start the core
    // cannot serve must leave a live timer behind, not a dead bench.
    const pump = await bootWorker();
    pump({ id: ++seq, type: 'start' });
    send(pump, { bench: bench(), firmware: blink, execution: 'interpreter', stops: [] });
    const init = lastInit(replies);

    pump({ id: ++seq, type: 'start' });
    const before = frame(init).timeMs;
    runWall(pump, init, 200);
    expect(frame(init).timeMs).toBeGreaterThan(before);
  });
});
