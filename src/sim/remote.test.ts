import { describe, expect, it } from 'vitest';
import { BenchBuilder } from './bench';
import { esp32DevKitV1 } from './boards';
import { McuRuntime } from './mcu';
import { Engine } from './engine';
import { DynamicState } from './catalog';
import { NEC_CODES, REMOTE_KEY_KNOB, remoteDefinition } from './remote';
import { renderedSizeMm, wokwiPartFor } from '../ui/wokwi';

describe('remote definition', () => {
  it('is pinless with a 20-key table', () => {
    const def = remoteDefinition();
    expect(def.pins).toEqual([]);
    expect(NEC_CODES).toHaveLength(20);
    expect(NEC_CODES[0]).toEqual({ name: 'power', code: 0xa2 });
    expect(def.knobs).toEqual([REMOTE_KEY_KNOB]);
  });
});

describe('remote selection', () => {
  it('selection box matches the remote artwork', () => {
    const drawn = renderedSizeMm(remoteDefinition());
    expect(drawn.widthMm).toBe(40);
    expect(drawn.heightMm).toBe(83.653);
    expect(wokwiPartFor(remoteDefinition())?.tag).toBe('wokwi-ir-remote');
  });
});

describe('remote transmission', () => {
  function transmissionBench() {
    const builder = new BenchBuilder();
    const esp32 = builder.addPart(esp32DevKitV1(), 0, 0);
    const remote = builder.addPart(remoteDefinition(), 200, 0);
    const mcu = new McuRuntime(esp32.definition);
    const state = new DynamicState();
    const engine = new Engine({ bench: builder.build(), mcu, dynamicState: state });
    engine.rebuild();
    return { engine, remote, state };
  }

  it('transmits the held key code and releases after the window', () => {
    const { engine, remote, state } = transmissionBench();
    state.setKnob(remote.id, REMOTE_KEY_KNOB, 11);
    expect(engine.irCode()).toBe(0);
    state.setPressed(remote.id, true);
    engine.settle();
    expect(engine.irCode()).toBe(0x30);
    state.setPressed(remote.id, false);
    engine.step(0.25);
    expect(engine.irCode()).toBe(0);
  });

  it('follows one code with lowest bench order and mid-hold key moves', () => {
    const builder = new BenchBuilder();
    const esp32 = builder.addPart(esp32DevKitV1(), 0, 0);
    const first = builder.addPart(remoteDefinition(), 200, 0);
    const secondRemote = builder.addPart(remoteDefinition(), 300, 0);
    const mcu = new McuRuntime(esp32.definition);
    const state = new DynamicState();
    const engine = new Engine({ bench: builder.build(), mcu, dynamicState: state });
    engine.rebuild();
    state.setKnob(first.id, REMOTE_KEY_KNOB, 11);
    state.setKnob(secondRemote.id, REMOTE_KEY_KNOB, 12);
    state.setPressed(first.id, true);
    state.setPressed(secondRemote.id, true);
    engine.settle();
    expect(engine.irCode()).toBe(0x30);
    state.setKnob(first.id, REMOTE_KEY_KNOB, 12);
    engine.settle();
    expect(engine.irCode()).toBe(0x18);
  });
});
