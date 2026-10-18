/**
 * Signal capture and decoding.
 *
 * A probe watches one net and records what the solver saw there, which is the
 * only honest source for a waveform: the display and the serial monitor both
 * read the same solved voltages, so a scope drawing from them cannot disagree
 * with the rest of the bench.
 *
 * Records are a fixed ring. A bench runs indefinitely and a growing buffer would
 * eventually cost more than the solve that produced it.
 */

export interface TraceSample {
  /** Simulated time in milliseconds. */
  readonly t: number;
  /** Volts on the net. */
  readonly v: number;
}

/** Samples kept per probe before the oldest are overwritten. */
export const TRACE_CAPACITY = 4096;

/**
 * A single probe's rolling record of one net.
 */
export class Waveform {
  private readonly times = new Float64Array(TRACE_CAPACITY);
  private readonly volts = new Float64Array(TRACE_CAPACITY);
  private count = 0;
  private head = 0;

  append(timeMs: number, volts: number): void {
    this.times[this.head] = timeMs;
    this.volts[this.head] = volts;
    this.head = (this.head + 1) % TRACE_CAPACITY;
    if (this.count < TRACE_CAPACITY) this.count++;
  }

  get length(): number {
    return this.count;
  }

  /** Samples oldest first. */
  toArray(): TraceSample[] {
    const samples: TraceSample[] = [];
    const start = this.count === TRACE_CAPACITY ? this.head : 0;
    for (let i = 0; i < this.count; i++) {
      const index = (start + i) % TRACE_CAPACITY;
      samples.push({ t: this.times[index], v: this.volts[index] });
    }
    return samples;
  }

  clear(): void {
    this.count = 0;
    this.head = 0;
  }
}

/**
 * Tracks which nets have probes and keeps a waveform for each.
 *
 * Recording only watched nets is what keeps capture cheap: solving a bench costs
 * the same either way, but storing samples for every net would not.
 */
export class ProbeDeck {
  private readonly waveforms = new Map<number, Waveform>();

  watch(net: number): void {
    if (!this.waveforms.has(net)) this.waveforms.set(net, new Waveform());
  }

  unwatch(net: number): void {
    this.waveforms.delete(net);
  }

  isWatched(net: number): boolean {
    return this.waveforms.has(net);
  }

  get watchedNets(): number[] {
    return [...this.waveforms.keys()];
  }

  waveform(net: number): Waveform | undefined {
    return this.waveforms.get(net);
  }

  capture(timeMs: number, voltageOf: (net: number) => number): void {
    for (const net of this.waveforms.keys()) {
      this.waveforms.get(net)!.append(timeMs, voltageOf(net));
    }
  }

  clear(): void {
    for (const waveform of this.waveforms.values()) waveform.clear();
  }
}

/** Index of the last sample at or before `timeMs`, or -1 past the end. */
function indexAtTime(samples: readonly TraceSample[], timeMs: number): number {
  let low = 0;
  let high = samples.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (samples[middle].t <= timeMs) low = middle;
    else high = middle - 1;
  }
  return low;
}

/** Voltage of the trace at a time, or -1 when the trace does not reach it. */
function sampleAt(samples: readonly TraceSample[], timeMs: number): number {
  if (timeMs < samples[0].t || timeMs > samples[samples.length - 1].t) return -1;
  return samples[indexAtTime(samples, timeMs)].v;
}

/**
 * Decodes 8N1 UART from a captured waveform.
 *
 * The protocol has no clock line, so the decoder has to find the start bit
 * itself and step at the baud rate. That is why this is worth computing rather
 * than asking the bus model what it sent: it is what an instrument on the bench
 * would actually see, wrong baud rate included.
 */
export function decodeUart(
  samples: readonly TraceSample[],
  baud: number,
  highVolts = 3.3,
): { byte: number; timeMs: number }[] {
  const frames: { byte: number; timeMs: number }[] = [];
  if (samples.length < 2 || baud <= 0) return frames;

  const low = highVolts / 2;
  const bitMs = 1000 / baud;

  let index = 1;
  while (index < samples.length) {
    const previous = samples[index - 1];
    const current = samples[index];
    // A start bit is a high-to-low transition while the line was idle.
    if (previous.v <= low || current.v > low) {
      index++;
      continue;
    }

    const bitAt = (offset: number): number => sampleAt(samples, current.t + offset * bitMs);

    let value = 0;
    let complete = true;
    for (let bit = 0; bit < 8; bit++) {
      const level = bitAt(bit + 1);
      if (level < 0) {
        complete = false;
        break;
      }
      if (level > low) value |= 1 << bit;
    }

    // The stop bit must read high. Anything else means this falling edge was a
    // data bit rather than a frame -- the normal case, since a 1-to-0 data
    // transition is indistinguishable from a start bit by eye alone.
    if (complete && bitAt(9) > low) {
      frames.push({ byte: value, timeMs: current.t });
      // Skip the whole frame so its own edges are not read as more starts.
      index = indexAtTime(samples, current.t + 10 * bitMs) + 1;
      continue;
    }

    index++;
  }

  return frames;
}

/**
 * Frequency of the trace, in hertz.
 *
 * Measured from the captured edges rather than assumed, so it reflects the PWM
 * the firmware actually produced.
 */
export function measureFrequency(samples: readonly TraceSample[], highVolts = 3.3): number {
  if (samples.length < 4) return 0;

  const low = highVolts / 2;
  const edges: number[] = [];
  for (let i = 1; i < samples.length; i++) {
    if (samples[i - 1].v <= low !== samples[i].v <= low) edges.push(samples[i].t);
  }
  if (edges.length < 2) return 0;

  // Edges alternate, so consecutive ones sit half a period apart.
  const span = edges[edges.length - 1] - edges[0];
  const periodMs = (2 * span) / (edges.length - 1);
  return periodMs > 0 ? 1000 / periodMs : 0;
}

/**
 * Fraction of the trace spent above the logic threshold, as a percentage.
 *
 * Weighted by the time between samples rather than by counting them: captures
 * are not evenly spaced, and counting makes the answer depend on where the
 * solver happened to take its samples instead of on the signal itself.
 */
export function measureDutyCycle(samples: readonly TraceSample[], highVolts = 3.3): number {
  if (samples.length < 2) return 0;

  const low = highVolts / 2;
  let highTime = 0;
  let totalTime = 0;

  for (let i = 1; i < samples.length; i++) {
    const span = samples[i].t - samples[i - 1].t;
    if (span <= 0) continue;
    totalTime += span;
    if (samples[i].v > low) highTime += span;
  }

  return totalTime > 0 ? (highTime / totalTime) * 100 : 0;
}
