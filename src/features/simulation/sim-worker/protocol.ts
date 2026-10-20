/**
 * Shared-memory snapshot protocol for the sim worker offload.
 *
 * Pure layout math only: no Worker globals, no engine imports, no DOM.
 *
 * Buffer layout (byte offsets):
 *   header (64 B): magic u32@0, version u32@4, generation u32@8, timeMs f64@16,
 *     fault u32@24, overflow u32@28, serial head (read index) u32@32,
 *     serial tail (buffered count) u32@36, dims u32@40/44/48/52, reserved@56..64
 *   then: net f64s, pinNode u32s, display bytes, tft frame bytes (fixed size),
 *   serial ring bytes.
 *
 * The tft frame is a fixed-size sub-region for the colour panel (Task 7): a
 * width u32, a height u32, then visible-order RGB565 bytes (big-endian per
 * pixel, row-major) sized for the largest panel RAM (320x480). Fixed rather
 * than a layout dim so it never triggers a realloc and old `layoutFor` calls
 * keep working; a zero width/height means no TFT on the bench.
 *
 * Version history: 1 = header/net/pinNode/display/serial; 2 = tft frame
 * inserted between display and serial (serial base shifts; SHM is
 * session-ephemeral so no migration path is kept).
 *
 * The header is self-describing: allocSnapshot stores the region dims in it,
 * so every view can be opened from the buffer alone (an explicit layout may
 * still be passed and takes precedence). Every open checks magic+version.
 *
 * Serial ring: head is the read index, tail is the buffered count
 * (0..capacity). Pushing into a full ring overwrites the oldest byte,
 * advances head, and sets the sticky overflow flag. Draining returns the
 * buffered bytes oldest-first and empties the ring (overflow stays set
 * until cleared explicitly via `header.overflow = 0`).
 */

export const SNAP_MAGIC = 0x53494d57; // 'SIMW'
export const SNAP_VERSION = 2;

export interface SnapshotLayout {
  headerBytes: number;
  netFloats: number;
  pinNodeUints: number;
  displayBytes: number;
  serialBytes: number;
}

export interface SnapshotHeader {
  readonly magic: number;
  readonly version: number;
  generation: number;
  timeMs: number;
  fault: number;
  overflow: number;
  bump(): void;
  serialPush(byte: number): void;
  serialDrain(): number[];
}

export interface NetView {
  readonly length: number;
  readonly array: Float64Array;
  read(i: number): number;
  write(i: number, v: number): void;
}

export interface PinNodeView {
  readonly length: number;
  readonly array: Uint32Array;
  read(i: number): number;
  write(i: number, v: number): void;
}

export interface DisplayView {
  readonly length: number;
  readonly array: Uint8Array;
  read(i: number): number;
  write(i: number, v: number): void;
}

/**
 * One colour-TFT frame: visible width/height plus visible-order RGB565 bytes
 * (big-endian per pixel, row-major from the top-left of what a user sees, so
 * rotation is already applied by the writer).
 */
export interface TftFrame {
  readonly width: number;
  readonly height: number;
  readonly rgb565: Uint8Array;
}

export interface TftView {
  readonly length: number;
  readonly array: Uint8Array;
  read(i: number): number;
  write(i: number, v: number): void;
  writeFrame(width: number, height: number, rgb565: Uint8Array): void;
  readFrame(): TftFrame;
}

export interface SerialRing {
  readonly capacity: number;
  readonly length: number;
  push(byte: number): void;
  drain(): number[];
}

const HEADER_BYTES = 64;
const OFF_HEAD = 32;
const OFF_TAIL = 36;

/**
 * Largest TFT RAM behind any panel we model: the 3.2" ILI9341 holds
 * 320x480 pixels of 16-bit colour. Do not shrink this to a visible size —
 * the same RAM reads out as 480x320 or 320x480 depending on rotation, and
 * the region must hold either way up.
 */
export const TFT_MAX_WIDTH = 320;
export const TFT_MAX_HEIGHT = 480;
export const TFT_MAX_PIXELS = TFT_MAX_WIDTH * TFT_MAX_HEIGHT;
/** Width u32 + height u32 ahead of the pixel bytes. */
export const TFT_HEADER_BYTES = 8;
/** Fixed frame size: header plus one RGB565 word per largest-panel pixel. */
export const TFT_FRAME_BYTES = TFT_HEADER_BYTES + TFT_MAX_PIXELS * 2;

/**
 * How long without a consumed-frame `ack` before the worker treats the
 * reader as gone (hidden tab) and pauses stepping. A slow-but-alive
 * reader acks every consumed frame — even at 5fps that is every 200 ms —
 * so render slowness alone never trips this; only an actually absent
 * reader does. Count-only backpressure turned main-thread jank into sim
 * slowdown (low fps *and* low ratio); the buffer is overwrite-latest, so
 * an unread backlog is harmless dropped frames, not lost data.
 */
export const ACK_STALE_MS = 250;

/**
 * Whether the worker's self-paced tick should pause. Pauses only on an
 * unread backlog *plus* a stale reader. A backlog with fresh acks means
 * the reader is alive but slower than the tick — stepping on, since the
 * snapshot buffer overwrites and the reader always sees the latest frame.
 */
export function shouldThrottle(opts: {
  readonly unread: number;
  readonly maxUnread: number;
  readonly nowMs: number;
  readonly lastAckMs: number;
  readonly staleMs: number;
}): boolean {
  if (opts.unread < opts.maxUnread) return false;
  return opts.nowMs - opts.lastAckMs > opts.staleMs;
}

interface Dims {
  netFloats: number;
  pinNodeUints: number;
  displayBytes: number;
  serialBytes: number;
}

interface Resolved extends Dims {
  netBase: number;
  pinBase: number;
  displayBase: number;
  tftBase: number;
  serialBase: number;
  total: number;
}

export function layoutFor(
  nodeCount: number,
  terminalCount: number,
  displayBytes: number,
  serialBytes = 4096,
): SnapshotLayout {
  return {
    headerBytes: HEADER_BYTES,
    netFloats: Math.max(0, Math.floor(nodeCount)),
    pinNodeUints: Math.max(0, Math.floor(terminalCount)),
    displayBytes: Math.max(0, Math.floor(displayBytes)),
    serialBytes: Math.max(0, Math.floor(serialBytes)),
  };
}

function regionOffsets(d: Dims): Omit<Resolved, keyof Dims> {
  const netBase = HEADER_BYTES;
  const pinBase = netBase + d.netFloats * 8;
  const displayBase = pinBase + d.pinNodeUints * 4;
  /*
   * The colour panel's region is read as 32-bit words, so it starts on a word
   * boundary. A display region of an odd length -- an OLED's frame and its
   * flags are 1025 bytes -- would otherwise push the frame off one, and the
   * view would refuse to exist.
   */
  const tftBase = (displayBase + d.displayBytes + 3) & ~3;
  const serialBase = tftBase + TFT_FRAME_BYTES;
  return { netBase, pinBase, displayBase, tftBase, serialBase, total: serialBase + d.serialBytes };
}

function assertOpen(buf: SharedArrayBuffer): void {
  const words = new Uint32Array(buf, 0, 2);
  if (words[0] !== SNAP_MAGIC || words[1] !== SNAP_VERSION) {
    throw new Error('snapshot version mismatch');
  }
}

function readDims(buf: SharedArrayBuffer): Dims {
  const words = new Uint32Array(buf, 0, 14);
  return {
    netFloats: words[10],
    pinNodeUints: words[11],
    displayBytes: words[12],
    serialBytes: words[13],
  };
}

function resolve(buf: SharedArrayBuffer, layout?: SnapshotLayout): Resolved {
  assertOpen(buf);
  const dims: Dims = layout ?? readDims(buf);
  const offsets = regionOffsets(dims);
  if (buf.byteLength < offsets.total) throw new Error('snapshot buffer too small');
  return { ...dims, ...offsets };
}

export function allocSnapshot(layout: SnapshotLayout): SharedArrayBuffer {
  const dims: Dims = {
    netFloats: layout.netFloats,
    pinNodeUints: layout.pinNodeUints,
    displayBytes: layout.displayBytes,
    serialBytes: layout.serialBytes,
  };
  const buf = new SharedArrayBuffer(regionOffsets(dims).total);
  const words = new Uint32Array(buf, 0, 14);
  words[0] = SNAP_MAGIC;
  words[1] = SNAP_VERSION;
  words[10] = dims.netFloats;
  words[11] = dims.pinNodeUints;
  words[12] = dims.displayBytes;
  words[13] = dims.serialBytes;
  return buf;
}

function checkIndex(i: number, length: number): void {
  if (!Number.isInteger(i) || i < 0 || i >= length)
    throw new RangeError(`index ${i} out of bounds (length ${length})`);
}

function makeRing(buf: SharedArrayBuffer, serialBase: number, cap: number): SerialRing {
  const head = new Uint32Array(buf, OFF_HEAD, 1);
  const tail = new Uint32Array(buf, OFF_TAIL, 1);
  const overflow = new Uint32Array(buf, 28, 1);
  const bytes = new Uint8Array(buf, serialBase, cap);
  return {
    get capacity(): number {
      return cap;
    },
    get length(): number {
      return Math.min(tail[0], cap);
    },
    push(byte: number): void {
      const v = byte & 0xff;
      if (cap === 0) {
        overflow[0] = 1;
        return;
      }
      const count = tail[0];
      if (count >= cap) {
        bytes[head[0]] = v;
        head[0] = (head[0] + 1) % cap;
        overflow[0] = 1;
      } else {
        bytes[(head[0] + count) % cap] = v;
        tail[0] = count + 1;
      }
    },
    drain(): number[] {
      const count = Math.min(tail[0], cap);
      const out = new Array<number>(count);
      for (let k = 0; k < count; k++) out[k] = bytes[(head[0] + k) % cap];
      head[0] = 0;
      tail[0] = 0;
      return out;
    },
  };
}

export function headerView(buf: SharedArrayBuffer, layout?: SnapshotLayout): SnapshotHeader {
  const d = resolve(buf, layout);
  const words = new Uint32Array(buf, 0, 10);
  const time = new Float64Array(buf, 16, 1);
  const ring = makeRing(buf, d.serialBase, d.serialBytes);
  return {
    get magic(): number {
      return words[0];
    },
    get version(): number {
      return words[1];
    },
    get generation(): number {
      return words[2];
    },
    set generation(v: number) {
      words[2] = v >>> 0;
    },
    get timeMs(): number {
      return time[0];
    },
    set timeMs(v: number) {
      time[0] = v;
    },
    get fault(): number {
      return words[6];
    },
    set fault(v: number) {
      words[6] = v >>> 0;
    },
    get overflow(): number {
      return words[7];
    },
    set overflow(v: number) {
      words[7] = v >>> 0;
    },
    bump(): void {
      words[2] = (words[2] + 1) >>> 0;
    },
    serialPush(byte: number): void {
      ring.push(byte);
    },
    serialDrain(): number[] {
      return ring.drain();
    },
  };
}

export function netView(buf: SharedArrayBuffer, layout?: SnapshotLayout): NetView {
  const d = resolve(buf, layout);
  const array = new Float64Array(buf, d.netBase, d.netFloats);
  return {
    get length(): number {
      return array.length;
    },
    array,
    read(i: number): number {
      checkIndex(i, array.length);
      return array[i];
    },
    write(i: number, v: number): void {
      checkIndex(i, array.length);
      array[i] = v;
    },
  };
}

export function pinNodeView(buf: SharedArrayBuffer, layout?: SnapshotLayout): PinNodeView {
  const d = resolve(buf, layout);
  const array = new Uint32Array(buf, d.pinBase, d.pinNodeUints);
  return {
    get length(): number {
      return array.length;
    },
    array,
    read(i: number): number {
      checkIndex(i, array.length);
      return array[i];
    },
    write(i: number, v: number): void {
      checkIndex(i, array.length);
      array[i] = v >>> 0;
    },
  };
}

export function displayView(buf: SharedArrayBuffer, layout?: SnapshotLayout): DisplayView {
  const d = resolve(buf, layout);
  const array = new Uint8Array(buf, d.displayBase, d.displayBytes);
  return {
    get length(): number {
      return array.length;
    },
    array,
    read(i: number): number {
      checkIndex(i, array.length);
      return array[i];
    },
    write(i: number, v: number): void {
      checkIndex(i, array.length);
      array[i] = v & 0xff;
    },
  };
}

export function serialRing(buf: SharedArrayBuffer, layout?: SnapshotLayout): SerialRing {
  const d = resolve(buf, layout);
  return makeRing(buf, d.serialBase, d.serialBytes);
}

export function tftView(buf: SharedArrayBuffer, layout?: SnapshotLayout): TftView {
  const d = resolve(buf, layout);
  const array = new Uint8Array(buf, d.tftBase, TFT_FRAME_BYTES);
  const dims = new Uint32Array(buf, d.tftBase, 2);
  return {
    get length(): number {
      return array.length;
    },
    array,
    read(i: number): number {
      checkIndex(i, array.length);
      return array[i];
    },
    write(i: number, v: number): void {
      checkIndex(i, array.length);
      array[i] = v & 0xff;
    },
    writeFrame(width: number, height: number, rgb565: Uint8Array): void {
      const w = Math.max(0, Math.floor(width));
      const h = Math.max(0, Math.floor(height));
      dims[0] = w >>> 0;
      dims[1] = h >>> 0;
      const capacity = TFT_FRAME_BYTES - TFT_HEADER_BYTES;
      const count = Math.min(rgb565.length, capacity);
      array.set(rgb565.subarray(0, count), TFT_HEADER_BYTES);
      array.fill(0, TFT_HEADER_BYTES + count);
    },
    readFrame(): TftFrame {
      const w = dims[0] ?? 0;
      const h = dims[1] ?? 0;
      const capacity = TFT_FRAME_BYTES - TFT_HEADER_BYTES;
      const count = Math.max(0, Math.min(Math.floor(w) * Math.floor(h), TFT_MAX_PIXELS)) * 2;
      return {
        width: w,
        height: h,
        rgb565: array.slice(TFT_HEADER_BYTES, TFT_HEADER_BYTES + Math.min(count, capacity)),
      };
    },
  };
}
