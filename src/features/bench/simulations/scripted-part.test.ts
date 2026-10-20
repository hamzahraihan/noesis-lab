import { describe, expect, it } from 'vitest';
import { esp32DevKitV1, partDefinitionById, useCustomPartsStore } from '@/features/parts';
import { circuitFileText, readCircuitFile } from '../utils/circuit-file';
import { Simulation } from './simulation';

/**
 * The scripting half, wired end to end: a part file, the validator, the store,
 * the bench, the runtime loading behind it, and the netlist that changes when it
 * arrives.
 *
 * The two-phase assertion is the point. Before the runtime loads, the part reads
 * zero -- the safe state -- and its divider is a short to ground. After it loads,
 * the same part reads what its script says, and the engine rebuilt the netlist
 * without anyone asking it to.
 */
const probeFile = JSON.stringify({
  version: 1,
  parts: [
    {
      id: 'soil-probe',
      name: 'Soil moisture probe',
      category: 'input',
      widthMm: 20,
      heightMm: 12,
      bodyColour: '#5b6b4a',
      legendColour: '#f2f2ee',
      component: { kind: 'scripted', bus: 'analog' },
      script: '({ analog: () => 0.5 })',
      pins: [
        { id: 'AOUT', label: 'OUT', x: 0, y: 6 },
        { id: 'VCC', label: 'VCC', x: 10, y: 6 },
        { id: 'GND', label: 'GND', x: 20, y: 6, net: 'GND' },
      ],
    },
  ],
});

/**
 * The same part, but answering what the operator turned: the knob is the
 * script's input, and the fraction it returns is what the bench solves.
 */
const knobbedFile = JSON.stringify({
  version: 1,
  parts: [
    {
      id: 'scripted-knob',
      name: 'Knobbed probe',
      category: 'input',
      widthMm: 20,
      heightMm: 12,
      bodyColour: '#5b6b4a',
      legendColour: '#f2f2ee',
      component: { kind: 'scripted', bus: 'analog' },
      script: '({ analog: (state) => state.knobs.moisture / 100 })',
      knobs: [{ id: 'moisture', label: 'Moisture', min: 0, max: 100, step: 1, defaultValue: 40 }],
      pins: [
        { id: 'AOUT', label: 'OUT', x: 0, y: 6 },
        { id: 'VCC', label: 'VCC', x: 10, y: 6 },
        { id: 'GND', label: 'GND', x: 20, y: 6, net: 'GND' },
      ],
    },
  ],
});

const MOISTURE = { id: 'moisture', label: 'Moisture', min: 0, max: 100, step: 1, defaultValue: 40 };

/** The scripted part's divider resistance, as the netlist currently has it. */
function dividerOhms(simulation: Simulation): number {
  const divider = simulation.engine.currentNetlist.elements.find(
    (element) => element.kind === 'resistor' && element.label === 'divider',
  );
  if (divider?.kind !== 'resistor') throw new Error('no scripted divider on the netlist');
  return divider.ohms;
}

describe('a scripted part on a bench', () => {
  it('reads zero until the runtime arrives, then what its script says', async () => {
    const outcome = useCustomPartsStore.getState().import(probeFile, 'soil-probe.json');
    expect(outcome.refused).toEqual([]);
    const definition = partDefinitionById('soil-probe');
    expect(definition).toBeDefined();
    if (definition === undefined) return;

    const simulation = new Simulation(esp32DevKitV1());
    simulation.addPart(definition, 0, 0);

    // Before the runtime: the safe state, a short to ground rather than a
    // plausible mid-rail number.
    expect(dividerOhms(simulation)).toBeLessThan(1);

    // The signal the bench exposes: it resolves once the runtime is installed.
    await simulation.scriptedReady();
    // Installing the sampler marks the netlist stale, exactly as a wire edit
    // does; settling is what reads the part's new value. A loaded bench reaches
    // here through its own step, and an idle one through the same call.
    simulation.engine.settle();

    // A fraction of 0.5 is 10k over 10k: half the rail.
    expect(dividerOhms(simulation)).toBeCloseTo(10_000, 6);

    // Leave the world as found: the store is module state, and the next test
    // file in this worker would otherwise inherit an imported part.
    useCustomPartsStore.getState().clear();
  });

  it('answers what the operator turned, at every position of the knob', async () => {
    const outcome = useCustomPartsStore.getState().import(knobbedFile, 'scripted-knob.json');
    expect(outcome.refused).toEqual([]);
    const definition = partDefinitionById('scripted-knob');
    expect(definition).toBeDefined();
    if (definition === undefined) return;

    const simulation = new Simulation(esp32DevKitV1());
    simulation.addPart(definition, 0, 0);
    await simulation.scriptedReady();
    /* The knob is the script's input, and the script's answer is the divider's
     * ratio -- which is what the solver reads. The default is 40, so a bench
     * nobody has touched reads that. */
    simulation.engine.settle();
    expect(dividerOhms(simulation)).toBeCloseTo(6_667, 0);

    // Three positions: the low rail, the middle, the high rail. Written against
    // the ratio the script computes rather than against a number copied out of
    // a run, so a change in the solver's arithmetic shows up here.
    for (const [moisture, fraction] of [
      [0, 0],
      [50, 0.5],
      [100, 1],
    ] as const) {
      simulation.setKnob('p1', MOISTURE, moisture);
      simulation.engine.settle();
      const expected =
        fraction <= 0.001 ? 1e-3 : fraction >= 0.999 ? 1e9 : (10_000 * fraction) / (1 - fraction);
      expect(dividerOhms(simulation)).toBeCloseTo(expected, 3);
    }

    useCustomPartsStore.getState().clear();
  });

  it('opens on a machine that never imported the part, because the circuit carries it', async () => {
    const outcome = useCustomPartsStore.getState().import(probeFile, 'soil-probe.json');
    expect(outcome.refused).toEqual([]);
    const definition = partDefinitionById('soil-probe');
    expect(definition).toBeDefined();
    if (definition === undefined) return;

    // Authoring: the import is how the part is written, the placement is what
    // makes the circuit responsible for it.
    const authored = new Simulation(esp32DevKitV1());
    // A bench is a board and its parts: the board first, then the import.
    expect(
      authored.loadCircuit({
        version: 1,
        parts: [{ id: 'board', type: 'esp32-devkit-v1', x: 0, y: 0, rotation: 0 }],
        wires: [],
      }),
    ).toEqual([]);
    authored.addPart(definition, 0, 0);
    expect(authored.document.definitions?.map((entry) => entry.id)).toEqual(['soil-probe']);
    const text = circuitFileText(authored.document);

    // The other machine: nothing imported at all.
    useCustomPartsStore.getState().clear();
    expect(partDefinitionById('soil-probe')).toBeUndefined();
    const doc = readCircuitFile(text, 'noesis-esp32-circuit.json');

    const opened = new Simulation(esp32DevKitV1());
    expect(opened.loadCircuit(doc)).toEqual([]);
    await opened.scriptedReady();
    opened.engine.settle();
    // The script ran, from the definition the file brought: half the rail.
    expect(dividerOhms(opened)).toBeCloseTo(10_000, 6);
  });

  it('shows a throwing script as one Problems row, and only while it faults', async () => {
    const throwingFile = JSON.stringify({
      version: 1,
      parts: [
        {
          id: 'throwing-probe',
          name: 'Throwing probe',
          category: 'input',
          widthMm: 20,
          heightMm: 12,
          bodyColour: '#5b6b4a',
          legendColour: '#f2f2ee',
          component: { kind: 'scripted', bus: 'analog' },
          script: '({ analog: () => { throw new Error("no sensor"); } })',
          pins: [
            { id: 'AOUT', label: 'OUT', x: 0, y: 6 },
            { id: 'VCC', label: 'VCC', x: 10, y: 6 },
            { id: 'GND', label: 'GND', x: 20, y: 6, net: 'GND' },
          ],
        },
      ],
    });
    const outcome = useCustomPartsStore.getState().import(throwingFile, 'throwing-probe.json');
    expect(outcome.refused).toEqual([]);
    const definition = partDefinitionById('throwing-probe');
    if (definition === undefined) throw new Error('the throwing probe did not import');

    const simulation = new Simulation(esp32DevKitV1());
    const part = simulation.addPart(definition, 0, 0);
    await simulation.scriptedReady();
    simulation.engine.settle();

    // The row names the part and carries the script's own message.
    expect(simulation.faults()).toEqual([{ partId: part.id, fault: 'Error: no sensor' }]);
  });
});
