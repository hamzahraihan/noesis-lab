import { describe, expect, it } from 'vitest';
import { BenchBuilder } from './bench';
import { esp32DevKitV1 } from '@/sim/boards';
import { McuRuntime } from './mcu';
import { Engine } from './engine';
import { SD_CARD_BYTES, microsdDefinition } from './sdcard';
import { renderedSizeMm, wokwiPartFor } from '@/ui/wokwi';

describe('microsd definition', () => {
  it('exposes the seven breakout pins', () => {
    const def = microsdDefinition();
    expect(def.pins.map((p) => p.id)).toEqual(['CD', 'DO', 'GND', 'SCK', 'VCC', 'DI', 'CS']);
    expect([def.widthMm, def.heightMm]).toEqual([21.6, 20.4]);
    expect(SD_CARD_BYTES).toBe(1048576);
  });

  it('selection box matches the card artwork', () => {
    const drawn = renderedSizeMm(microsdDefinition());
    expect(drawn.widthMm).toBe(21.6);
    expect(drawn.heightMm).toBe(20.4);
    expect(wokwiPartFor(microsdDefinition())?.tag).toBe('wokwi-microsd-card');
  });
});

describe('microsd file store', () => {
  function cardBench() {
    const builder = new BenchBuilder();
    const esp32 = builder.addPart(esp32DevKitV1(), 0, 0);
    const card = builder.addPart(microsdDefinition(), 200, 0);
    const mcu = new McuRuntime(esp32.definition);
    const engine = new Engine({ bench: builder.build(), mcu });
    engine.rebuild();
    return { engine, card };
  }

  it('reads back what was written and reports missing as empty', () => {
    const { engine, card } = cardBench();
    expect(engine.sdBegin(card.id)).toBe(true);
    expect(engine.sdRead(card.id, 'nope.txt')).toBe('');
    expect(engine.sdWrite(card.id, 'log.txt', 'hi')).toBe(2);
    expect(engine.sdRead(card.id, 'log.txt')).toBe('hi');
    expect(engine.sdExists(card.id, 'log.txt')).toBe(1);
  });

  it('replaces on overwrite and recounts bytes', () => {
    const { engine, card } = cardBench();
    engine.sdWrite(card.id, 'a.txt', 'aaa');
    expect(engine.sdWrite(card.id, 'a.txt', 'b')).toBe(1);
    expect(engine.sdBytes(card.id)).toBe(1);
    expect(engine.sdRead(card.id, 'a.txt')).toBe('b');
  });

  it('refuses writes past the cap and keeps the old text', () => {
    const { engine, card } = cardBench();
    engine.sdWrite(card.id, 'a.txt', 'kept');
    expect(engine.sdWrite(card.id, 'big.txt', 'x'.repeat(SD_CARD_BYTES))).toBe(0);
    expect(engine.sdRead(card.id, 'a.txt')).toBe('kept');
    expect(engine.sdExists(card.id, 'big.txt')).toBe(0);
  });

  it('stores separator and empty names verbatim', () => {
    const { engine, card } = cardBench();
    expect(engine.sdWrite(card.id, 'a/b.txt', 'x')).toBe(1);
    expect(engine.sdRead(card.id, 'a/b.txt')).toBe('x');
    expect(engine.sdWrite(card.id, '', 'y')).toBe(1);
    expect(engine.sdRead(card.id, '')).toBe('y');
  });

  it('clears files when the card leaves the bench', () => {
    const builder = new BenchBuilder();
    const esp32 = builder.addPart(esp32DevKitV1(), 0, 0);
    const card = builder.addPart(microsdDefinition(), 200, 0);
    const mcu = new McuRuntime(esp32.definition);
    const engine = new Engine({ bench: builder.build(), mcu });
    engine.rebuild();
    engine.sdWrite(card.id, 'log.txt', 'hi');
    builder.removePart(card.id);
    engine.rebuild(builder.build());
    expect(engine.sdRead(card.id, 'log.txt')).toBe('');
  });

  it('fails closed for unknown part ids', () => {
    const { engine } = cardBench();
    expect(engine.sdBegin('p999')).toBe(false);
    expect(engine.sdWrite('p999', 'a.txt', 'x')).toBe(0);
    expect(engine.sdRead('p999', 'a.txt')).toBe('');
    expect(engine.sdExists('p999', 'a.txt')).toBe(0);
    expect(engine.sdRemove('p999', 'a.txt')).toBe(0);
  });
});
