import { describe, expect, it } from 'vitest';
import {
  ProbeDeck,
  Waveform,
  decodeI2c,
  decodeSpi,
  decodeUart,
  measureDutyCycle,
  measureFrequency,
  scopeToCsv,
  type TraceSample,
} from './probe';
/** Builds a square wave of the given frequency, sampled every `stepMs`. */
function squareWave(
  frequencyHz: number,
  durationMs: number,
  stepMs = 0.05,
  highVolts = 3.3,
  duty = 0.5,
): TraceSample[] {
  const samples: TraceSample[] = [];
  const period = 1000 / frequencyHz;
  for (let t = 0; t <= durationMs; t += stepMs) {
    samples.push({ t, v: (t % period) / period < duty ? highVolts : 0 });
  }
  return samples;
}

/** Builds one UART frame holding `byte`, sampled finely enough to decode. */
function uartFrame(byte: number, startMs: number, baud = 9600): TraceSample[] {
  const bitMs = 1000 / baud;
  const bits = [0];
  for (let i = 0; i < 8; i++) bits.push((byte >> i) & 1);
  bits.push(1); // stop

  const samples: TraceSample[] = [];
  // A real line idles high, and the decoder needs that preceding high level to
  // recognise the fall into a start bit.
  samples.push({ t: startMs - 0.2, v: 3.3 });
  const stepMs = bitMs / 40;
  for (let bit = 0; bit < bits.length; bit++) {
    for (let t = 0; t < bitMs; t += stepMs) {
      samples.push({ t: startMs + bit * bitMs + t, v: bits[bit] ? 3.3 : 0 });
    }
  }
  return samples;
}

describe('waveform capture', () => {
  it('keeps samples oldest first', () => {
    const waveform = new Waveform();
    waveform.append(0, 1);
    waveform.append(1, 2);
    waveform.append(2, 3);

    expect(waveform.toArray()).toEqual([
      { t: 0, v: 1 },
      { t: 1, v: 2 },
      { t: 2, v: 3 },
    ]);
  });

  it('drops the oldest samples once full', () => {
    const waveform = new Waveform();
    // Fill well past capacity so the wrap is definitely exercised.
    for (let i = 0; i < 5000; i++) waveform.append(i, i);

    const samples = waveform.toArray();
    expect(samples).toHaveLength(4096);
    expect(samples[0].t).toBe(5000 - 4096);
    expect(samples[samples.length - 1].t).toBe(4999);
  });

  it('records only watched nets', () => {
    const deck = new ProbeDeck();
    const voltage = (net: number) => net * 1.5;
    deck.watch(3);

    deck.capture(10, voltage);

    expect(deck.isWatched(3)).toBe(true);
    expect(deck.isWatched(4)).toBe(false);
    expect(deck.waveform(3)!.toArray()).toEqual([{ t: 10, v: 4.5 }]);
    expect(deck.waveform(4)).toBeUndefined();
  });

  it('forgets a net when the probe is lifted', () => {
    const deck = new ProbeDeck();
    deck.watch(7);
    deck.unwatch(7);
    deck.capture(1, () => 0);
    expect(deck.waveform(7)).toBeUndefined();
  });
});

describe('frequency and duty measurement', () => {
  it('measures the frequency of a square wave', () => {
    const samples = squareWave(1000, 20);
    expect(measureFrequency(samples)).toBeGreaterThan(950);
    expect(measureFrequency(samples)).toBeLessThan(1050);
  });

  it('measures a PWM duty as the fraction of time spent high', () => {
    expect(measureDutyCycle(squareWave(1000, 40, 0.05, 3.3, 0.5))).toBeGreaterThan(45);
    expect(measureDutyCycle(squareWave(1000, 40, 0.05, 3.3, 0.5))).toBeLessThan(55);
    expect(measureDutyCycle(squareWave(1000, 40, 0.05, 3.3, 0.25))).toBeLessThan(32);
  });

  it('reports nothing for a flat line', () => {
    const flat: TraceSample[] = Array.from({ length: 20 }, (_, i) => ({ t: i, v: 3.3 }));
    expect(measureFrequency(flat)).toBe(0);
    expect(measureDutyCycle(flat)).toBe(100);
  });

  it('returns zero rather than throwing on an empty trace', () => {
    expect(measureFrequency([])).toBe(0);
    expect(decodeUart([], 9600)).toEqual([]);
  });

  it('recovers several bytes in sequence', () => {
    // At 9600 baud a frame is 10.4 ms, so the second must start well clear.
    const samples = [...uartFrame(0x48, 2, 9600), ...uartFrame(0x69, 14, 9600)];
    expect(decodeUart(samples, 9600).map((frame) => frame.byte)).toEqual([0x48, 0x69]);
  });
});

describe('UART decoding', () => {
  it('recovers a byte sent on the wire', () => {
    const frames = decodeUart(uartFrame(0x41, 5, 9600), 9600);
    expect(frames).toHaveLength(1);
    expect(frames[0].byte).toBe(0x41);
  });

  it('recovers several bytes in sequence', () => {
    // At 9600 baud a frame is 10.4 ms, so the second must start well clear.
    const samples = [...uartFrame(0x48, 2, 9600), ...uartFrame(0x69, 14, 9600)];
    expect(decodeUart(samples, 9600).map((frame) => frame.byte)).toEqual([0x48, 0x69]);
  });

  it('reads the least significant bit first, as the wire carries it', () => {
    // 0b10000001 and 0b00000001 differ only in which end the mark sits.
    const lowMark = decodeUart(uartFrame(0x01, 2, 9600), 9600);
    const highMark = decodeUart(uartFrame(0x80, 2, 9600), 9600);
    expect(lowMark[0].byte).toBe(0x01);
    expect(highMark[0].byte).toBe(0x80);
  });

  it('reports garbage at the wrong baud rate rather than pretending', () => {
    const samples = uartFrame(0x41, 5, 9600);
    const wrong = decodeUart(samples, 19200);
    // Either nothing decodes cleanly, or what decodes is not the byte sent.
    expect(wrong.every((frame) => frame.byte !== 0x41)).toBe(true);
  });

  it('ignores a line that never returns high', () => {
    const held: TraceSample[] = Array.from({ length: 200 }, (_, i) => ({ t: i * 0.05, v: 0 }));
    expect(decodeUart(held, 9600)).toEqual([]);
  });
});

describe('a capture as a table', () => {
  it('names the columns and carries every sample', () => {
    const csv = scopeToCsv([
      { t: 0, v: 0 },
      { t: 1.5, v: 3.3 },
    ]);
    expect(csv).toBe('time_ms,volts\n0,0\n1.5,3.3');
  });

  it('is a header and nothing else when there was no capture', () => {
    expect(scopeToCsv([])).toBe('time_ms,volts');
  });
});

/** Builds one I²C transaction from phases, with a sparse sample at every transition. */
type I2cPhase =
  | { kind: 'start' }
  | { kind: 'byte'; wire: number; ack: boolean }
  | { kind: 'stop' };

function i2cCapture(
  phases: readonly I2cPhase[],
  halfPeriodMs = 0.005,
): { sda: TraceSample[]; scl: TraceSample[] } {
  const sda: TraceSample[] = [{ t: 0, v: 3.3 }];
  const scl: TraceSample[] = [{ t: 0, v: 3.3 }];
  let t = 0;
  let sdaLevel = true;
  let sclLevel = true;
  const setSda = (level: boolean): void => {
    if (level === sdaLevel) return;
    t += 0.0005;
    sdaLevel = level;
    sda.push({ t, v: level ? 3.3 : 0 });
  };
  const setScl = (level: boolean): void => {
    if (level === sclLevel) return;
    t += halfPeriodMs;
    sclLevel = level;
    scl.push({ t, v: level ? 3.3 : 0 });
  };
  // One bit on the wire: SDA settles while SCL is low, SCL rises, bits are sampled there.
  const bit = (b: number): void => {
    setSda(b === 1);
    setScl(true);
    setScl(false);
  };

  for (const phase of phases) {
    if (phase.kind === 'start') {
      // Idle-high setup, so a repeated start works: release the data line,
      // raise the clock, then fall it -- the start condition.
      setSda(true);
      setScl(true);
      setSda(false);
      setScl(false);
      continue;
    }
    if (phase.kind === 'stop') {
      setSda(false);
      setScl(true);
      setSda(true);
      continue;
    }
    for (let i = 7; i >= 0; i--) bit((phase.wire >> i) & 1);
    bit(phase.ack ? 0 : 1);
  }
  t += halfPeriodMs;
  sda.push({ t, v: sdaLevel ? 3.3 : 0 });
  scl.push({ t, v: sclLevel ? 3.3 : 0 });
  return { sda, scl };
}

/** Builds one SPI capture: mode 0, MSB first, one frame per call when `framed`. */
function spiCapture(
  bytes: { mosi?: readonly number[]; miso?: readonly number[]; framed?: boolean },
  halfPeriodMs = 0.005,
): {
  sck: TraceSample[];
  cs?: TraceSample[];
  mosi?: TraceSample[];
  miso?: TraceSample[];
} {
  const { mosi = [], miso = [], framed = true } = bytes;
  const sck: TraceSample[] = [{ t: 0, v: 0 }];
  const cs: TraceSample[] = [{ t: 0, v: 3.3 }];
  const mosiTrace: TraceSample[] = [{ t: 0, v: 0 }];
  const misoTrace: TraceSample[] = [{ t: 0, v: 0 }];
  let t = 0;
  let sckLevel = false;
  let csLevel = true;
  let mosiLevel = false;
  let misoLevel = false;
  const setSck = (level: boolean): void => {
    if (level === sckLevel) return;
    t += halfPeriodMs;
    sckLevel = level;
    sck.push({ t, v: level ? 3.3 : 0 });
  };
  const setCs = (level: boolean): void => {
    if (level === csLevel) return;
    t += 0.0005;
    csLevel = level;
    cs.push({ t, v: level ? 3.3 : 0 });
  };
  const setMosi = (level: boolean): void => {
    if (level === mosiLevel) return;
    t += 0.0005;
    mosiLevel = level;
    mosiTrace.push({ t, v: level ? 3.3 : 0 });
  };
  const setMiso = (level: boolean): void => {
    if (level === misoLevel) return;
    t += 0.0005;
    misoLevel = level;
    misoTrace.push({ t, v: level ? 3.3 : 0 });
  };

  if (framed) setCs(false);
  const count = Math.max(mosi.length, miso.length);
  for (let i = 0; i < count; i++) {
    const mosiByte = mosi[i] ?? 0;
    const misoByte = miso[i] ?? 0;
    for (let b = 7; b >= 0; b--) {
      setMosi(((mosiByte >> b) & 1) === 1);
      setMiso(((misoByte >> b) & 1) === 1);
      setSck(true); // the receiver samples on the rising edge
      setSck(false);
    }
  }
  if (framed) setCs(true);
  t += halfPeriodMs;
  sck.push({ t, v: 0 });
  cs.push({ t, v: csLevel ? 3.3 : 0 });
  mosiTrace.push({ t, v: mosiLevel ? 3.3 : 0 });
  misoTrace.push({ t, v: misoLevel ? 3.3 : 0 });
  return {
    sck,
    cs: framed ? cs : undefined,
    mosi: mosi.length > 0 ? mosiTrace : undefined,
    miso: miso.length > 0 ? misoTrace : undefined,
  };
}

describe('SPI decoding', () => {
  it('recovers a full-duplex byte with its frame boundaries', () => {
    const cap = spiCapture({ mosi: [0x9f], miso: [0xab] });
    const events = decodeSpi(cap);

    expect(events.map((event) => event.type)).toEqual([
      'frame-start',
      'byte',
      'byte',
      'frame-end',
    ]);
    const mosi = events.find((event) => event.line === 'mosi');
    const miso = events.find((event) => event.line === 'miso');
    expect(mosi?.value).toBe(0x9f);
    expect(miso?.value).toBe(0xab);
    // The byte completes on the clock edge that sampled its last bit, so the
    // boundaries enclose it and all events carry a finite capture time.
    expect(events[0].t).toBeLessThan(mosi!.t);
    expect(events[3].t).toBeGreaterThan(mosi!.t);
    for (const event of events) expect(Number.isFinite(event.t)).toBe(true);
  });

  it('timestamps events in capture order across bytes', () => {
    const cap = spiCapture({ mosi: [0xde, 0xad] });
    const times = decodeSpi(cap).map((event) => event.t);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('decodes without a chip select as one open frame', () => {
    const cap = spiCapture({ mosi: [0x42], framed: false });
    const events = decodeSpi(cap);
    expect(events.map((event) => event.type)).toEqual(['byte']);
    expect(events[0].value).toBe(0x42);
  });

  it('ignores clock pulses outside a selected frame', () => {
    const sck: TraceSample[] = [{ t: 0, v: 0 }];
    const cs: TraceSample[] = [{ t: 0, v: 3.3 }];
    const mosiTrace: TraceSample[] = [{ t: 0, v: 3.3 }];
    let t = 0;
    const clock = (): void => {
      t += 0.005;
      sck.push({ t, v: 3.3 });
      t += 0.005;
      sck.push({ t, v: 0 });
    };
    for (let i = 0; i < 8; i++) clock(); // eight stray clocks with CS high
    t += 0.0005;
    cs.push({ t, v: 0 }); // the frame opens
    for (let i = 0; i < 8; i++) clock(); // one real byte
    t += 0.0005;
    cs.push({ t, v: 3.3 }); // the frame closes
    t += 0.005;
    mosiTrace.push({ t, v: 3.3 }); // the solver keeps sampling after the frame closes

    const events = decodeSpi({ sck, cs, mosi: mosiTrace });
    expect(events.map((event) => event.type)).toEqual(['frame-start', 'byte', 'frame-end']);
    expect(events[1].value).toBe(0xff); // MOSI sat high the whole time
  });

  it('reports nothing when there is no clock', () => {
    expect(decodeSpi({ sck: [] })).toEqual([]);
  });
});

describe('I2C decoding', () => {
  it('recovers a write transaction: start, address, ACK, data, ACK, stop', () => {
    const cap = i2cCapture([
      { kind: 'start' },
      { kind: 'byte', wire: (0x3c << 1) | 0, ack: true },
      { kind: 'byte', wire: 0x5a, ack: true },
      { kind: 'stop' },
    ]);
    const events = decodeI2c(cap);

    expect(events.map((event) => event.type)).toEqual([
      'start',
      'address',
      'ack',
      'data',
      'ack',
      'stop',
    ]);
    expect(events[1].value).toBe(0x3c);
    expect(events[1].read).toBe(false);
    expect(events[3].value).toBe(0x5a);
  });

  it('keeps the read bit and reports a NAK as no answer', () => {
    const cap = i2cCapture([
      { kind: 'start' },
      { kind: 'byte', wire: (0x3c << 1) | 1, ack: false },
      { kind: 'stop' },
    ]);
    const events = decodeI2c(cap);

    expect(events.map((event) => event.type)).toEqual(['start', 'address', 'nack', 'stop']);
    expect(events[1].read).toBe(true);
  });

  it('treats a start without a stop as a repeated start', () => {
    const cap = i2cCapture([
      { kind: 'start' },
      { kind: 'byte', wire: (0x3c << 1) | 0, ack: true },
      { kind: 'start' },
      { kind: 'byte', wire: (0x3c << 1) | 1, ack: true },
      { kind: 'byte', wire: 0x7b, ack: false },
      { kind: 'stop' },
    ]);
    const events = decodeI2c(cap);

    expect(events.map((event) => event.type)).toEqual([
      'start',
      'address',
      'ack',
      'repeated-start',
      'address',
      'ack',
      'data',
      'nack',
      'stop',
    ]);
    expect(events[4].read).toBe(true);
    expect(events[6].value).toBe(0x7b);
  });

  it('timestamps events in capture order', () => {
    const cap = i2cCapture([
      { kind: 'start' },
      { kind: 'byte', wire: 0x78, ack: true },
      { kind: 'byte', wire: 0xa5, ack: true },
      { kind: 'stop' },
    ]);
    const times = decodeI2c(cap).map((event) => event.t);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    for (const t of times) expect(Number.isFinite(t)).toBe(true);
  });

  it('reports nothing when a trace is missing', () => {
    expect(decodeI2c({ sda: [], scl: [{ t: 0, v: 3.3 }] })).toEqual([]);
    expect(decodeI2c({ sda: [{ t: 0, v: 3.3 }], scl: [] })).toEqual([]);
  });
});
