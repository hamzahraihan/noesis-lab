import { describe, expect, it } from 'vitest';
import {
  ProbeDeck,
  Waveform,
  decodeUart,
  measureDutyCycle,
  measureFrequency,
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