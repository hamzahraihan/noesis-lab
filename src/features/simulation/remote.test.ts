import { describe, expect, it } from 'vitest';
import { BenchBuilder } from './bench';
import { esp32DevKitV1 } from '@/features/parts';
import { McuRuntime } from './mcu';
import { Engine } from './engine';
import { DynamicState } from '@/features/parts';
import { irReceiverDefinition } from '@/features/parts';
import { sonarDefinition } from './sonar';
import { NEC_CODES, REMOTE_KEY_KNOB, remoteDefinition } from './remote';
import { renderedSizeMm, wokwiPartFor } from '@/ui/wokwi';

describe('remote definition', () => {
  it('is pinless with a 20-key table', () => {
    const def = remoteDefinition();
    expect(def.pins).toEqual([]);
    expect(NEC_CODES).toHaveLength(20);
    expect(NEC_CODES[0]).toEqual({ name: 'power', code: 0xa2 });
    expect(def.knobs).toEqual([REMOTE_KEY_KNOB]);
    expect([REMOTE_KEY_KNOB.min, REMOTE_KEY_KNOB.max, REMOTE_KEY_KNOB.defaultValue]).toEqual([0, 19, 0]);
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

  it('keeps DAT low when a sonar arms mid-transmission', () => {
    const builder = new BenchBuilder();
    const esp32 = builder.addPart(esp32DevKitV1(), 0, 0);
    const receiver = builder.addPart(irReceiverDefinition(), 200, 0);
    const remote = builder.addPart(remoteDefinition(), 300, 0);
    const sonar = builder.addPart(sonarDefinition(), 400, 0);
    const wire = (a: { x: number; y: number }, b: { x: number; y: number }) => builder.addWire(a.x, a.y, b.x, b.y);
    const at = (part: { x: number; y: number; definition: { pins: ReadonlyArray<{ id: string; x: number; y: number }> } }, pinId: string) => {
      const pin = part.definition.pins.find((p) => p.id === pinId)!;
      return { x: part.x + pin.x, y: part.y + pin.y };
    };
    wire(at(receiver, 'VCC'), at(esp32, 'R_3V3'));
    wire(at(receiver, 'GND'), at(esp32, 'L_GND'));
    const mcu = new McuRuntime(esp32.definition);
    const state = new DynamicState();
    const engine = new Engine({ bench: builder.build(), mcu, dynamicState: state });
    engine.rebuild();
    state.setPressed(remote.id, true);
    engine.settle();
    expect(engine.irCode()).not.toBe(0);
    // A sonar arming now must not drop the live transmission flag.
    engine.setSonarMeasuring(sonar.id, true);
    engine.settle();
    const dat = engine.currentNetlist.pinNode.get(`${receiver.id}:DAT`)!;
    expect(engine.voltageOfNet(dat)).toBeLessThan(0.5);
    expect(engine.irCode()).not.toBe(0);
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
