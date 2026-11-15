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
 * Level transitions in a trace, in capture order.
 *
 * The decoders below work from the edges the solver recorded, the same way
 * `decodeUart` does -- what an instrument on the bench would see, including
 * the transitions firmware never meant to produce.
 */
interface Edge {
  readonly t: number;
  readonly rising: boolean;
}

function edgesOf(samples: readonly TraceSample[], low: number): Edge[] {
  const edges: Edge[] = [];
  let level = samples[0].v > low;
  for (let i = 1; i < samples.length; i++) {
    const next = samples[i].v > low;
    if (next !== level) {
      edges.push({ t: samples[i].t, rising: next });
      level = next;
    }
  }
  return edges;
}

/** A frame open or close, or one byte shifted out on one of the data lines. */
export interface SpiEvent {
  readonly t: number;
  readonly type: 'frame-start' | 'byte' | 'frame-end';
  /** Which data line the byte travelled on; absent for frame boundaries. */
  readonly line?: 'mosi' | 'miso';
  /** The shifted byte, MSB first; absent for frame boundaries. */
  readonly value?: number;
}

/**
 * Decodes an SPI capture (mode 0: the receiver samples on the rising clock).
 *
 * The chip select is what makes a frame a frame: a falling edge opens one and
 * a rising edge closes it, and clock pulses outside a selected frame are not
 * decoded -- the slave is not listening, so the wire carries noise as far as
 * the protocol is concerned. With no `cs` trace at all the capture is treated
 * as one long selected frame, which is what a bench without a slave-select
 * line can honestly report. Bytes are timestamped at the rising edge that
 * sampled their last bit, so an event's `t` is the moment the byte was whole.
 */
export function decodeSpi(
  trace: {
    readonly sck: readonly TraceSample[];
    readonly cs?: readonly TraceSample[];
    readonly mosi?: readonly TraceSample[];
    readonly miso?: readonly TraceSample[];
  },
  highVolts = 3.3,
): SpiEvent[] {
  const events: SpiEvent[] = [];
  const { sck, cs, mosi, miso } = trace;
  if (sck.length < 2) return events;

  const low = highVolts / 2;
  const hasCs = cs !== undefined && cs.length >= 2;

  /*
   * One merged timeline so a chip-select edge lands between the clock edges
   * it belongs between: a frame that closes mid-byte drops the partial byte,
   * which is what the slave's SPI port does.
   */
  const timeline: { t: number; kind: 'cs-down' | 'cs-up' | 'sck-rise' }[] = [];
  if (hasCs) {
    for (const edge of edgesOf(cs, low)) {
      timeline.push({ t: edge.t, kind: edge.rising ? 'cs-up' : 'cs-down' });
    }
  }
  for (const edge of edgesOf(sck, low)) {
    if (edge.rising) timeline.push({ t: edge.t, kind: 'sck-rise' });
  }
  timeline.sort((a, b) => a.t - b.t);

  let selectedFrame = hasCs ? cs[0].v <= low : true;
  let bitCount = 0;
  let mosiByte = 0;
  let misoByte = 0;

  for (const step of timeline) {
    if (step.kind === 'cs-down') {
      events.push({ t: step.t, type: 'frame-start' });
      selectedFrame = true;
      bitCount = 0;
      mosiByte = 0;
      misoByte = 0;
      continue;
    }
    if (step.kind === 'cs-up') {
      events.push({ t: step.t, type: 'frame-end' });
      selectedFrame = false;
      bitCount = 0;
      mosiByte = 0;
      misoByte = 0;
      continue;
    }
    if (!selectedFrame) continue;

    if (mosi && mosi.length >= 1) {
      const v = sampleAt(mosi, step.t);
      if (v > low) mosiByte |= 1 << (7 - bitCount);
    }
    if (miso && miso.length >= 1) {
      const v = sampleAt(miso, step.t);
      if (v > low) misoByte |= 1 << (7 - bitCount);
    }
    bitCount++;
    if (bitCount === 8) {
      if (mosi && mosi.length >= 1) {
        events.push({ t: step.t, type: 'byte', line: 'mosi', value: mosiByte });
      }
      if (miso && miso.length >= 1) {
        events.push({ t: step.t, type: 'byte', line: 'miso', value: misoByte });
      }
      bitCount = 0;
      mosiByte = 0;
      misoByte = 0;
    }
  }

  return events;
}

/** One decoded I²C transaction event: a phase of it, timestamped at capture. */
export interface I2cEvent {
  readonly t: number;
  readonly type:
    | 'start'
    | 'repeated-start'
    | 'address'
    | 'data'
    | 'ack'
    | 'nack'
    | 'stop';
  /** The 7-bit address for `address` events, the shifted byte for `data`. */
  readonly value?: number;
  /** For `address` events: true when the read/write bit asked for a read. */
  readonly read?: boolean;
}

/**
 * Decodes an I²C capture (open-drain: idle is high, MSB first, ACK is the
 * ninth clock with SDA low).
 *
 * A start or repeated start is SDA falling while SCL is high; a stop is SDA
 * rising while SCL is high. The first byte after either is an address (7-bit,
 * top seven bits, with the read/write bit kept aside); every byte after that
 * is data. Each event is timestamped at the wire transition or clock edge
 * that produced it. Clock stretching is honoured implicitly -- bits are read
 * on SCL's rising edges however long the line was held low -- and 10-bit
 * addressing is reported as the two bytes it is made of.
 */
export function decodeI2c(
  trace: {
    readonly sda: readonly TraceSample[];
    readonly scl: readonly TraceSample[];
  },
  highVolts = 3.3,
): I2cEvent[] {
  const events: I2cEvent[] = [];
  const { sda, scl } = trace;
  if (sda.length < 2 || scl.length < 2) return events;

  const low = highVolts / 2;
  let sclLevel = scl[0].v > low;
  let active = false;
  let expectingAddress = false;
  let bitCount = 0;
  let byte = 0;

  const timeline: { t: number; line: 'sda' | 'scl'; rising: boolean }[] = [
    ...edgesOf(sda, low).map((edge) => ({ ...edge, line: 'sda' as const })),
    ...edgesOf(scl, low).map((edge) => ({ ...edge, line: 'scl' as const })),
  ].sort((a, b) => a.t - b.t);

  for (const step of timeline) {
    if (step.line === 'scl') {
      sclLevel = step.rising;
      if (!step.rising || !active) continue;

      const v = sampleAt(sda, step.t);
      const bit = v > low ? 1 : 0;
      if (bitCount < 8) {
        byte = (byte << 1) | bit;
        bitCount++;
        if (bitCount === 8) {
          if (expectingAddress) {
            events.push({
              t: step.t,
              type: 'address',
              value: (byte >> 1) & 0x7f,
              read: (byte & 1) === 1,
            });
            expectingAddress = false;
          } else {
            events.push({ t: step.t, type: 'data', value: byte });
          }
        }
        continue;
      }
      /*
       * The ninth clock is the ACK. SDA low means the receiver pulled it
       * down; high means nobody answered.
       */
      events.push({ t: step.t, type: bit === 0 ? 'ack' : 'nack' });
      bitCount = 0;
      byte = 0;
      continue;
    }

    // SDA edge.
    if (step.rising) {
      if (active && sclLevel) {
        events.push({ t: step.t, type: 'stop' });
        active = false;
        bitCount = 0;
        byte = 0;
      }
      continue;
    }
    if (!sclLevel) continue; // data line moved while the clock was low: a bit, not a start
    events.push({ t: step.t, type: active ? 'repeated-start' : 'start' });
    active = true;
    expectingAddress = true;
    bitCount = 0;
    byte = 0;
  }

  return events;
}

/**
 * A capture as CSV: the time and the voltage at every sample.
 *
 * The scope's capture is what the solver produced, so the table is the
 * measurement rather than the sketch's own account of it -- which is the
 * point of putting a scope next to a sketch in the first place.
 */
export function scopeToCsv(samples: readonly TraceSample[]): string {
  const lines = ['time_ms,volts'];
  for (const sample of samples) {
    lines.push(`${sample.t},${sample.v}`);
  }
  return lines.join('\n');
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
