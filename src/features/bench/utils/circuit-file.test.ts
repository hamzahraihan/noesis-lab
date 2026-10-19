import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CIRCUITS } from '@/features/learn/circuits';
import {
  CIRCUIT_FILE_MAX_BYTES,
  UNREADABLE_FILE_NOTICE,
  circuitFileName,
  circuitFileText,
  readCircuitFile,
} from './circuit-file';

/**
 * The shipped file's bytes, line endings normalised.
 *
 * A checkout on a machine with `core.autocrlf` writes CRLF for the same blob,
 * so the pin is the file's *format* — two-space JSON, sorted keys, a trailing
 * newline — not the byte value of `\n`, which belongs to the working copy.
 */
function shippedCircuitText(id: string): string {
  return readFileSync(
    join(__dirname, '..', '..', 'learn', 'circuits', `${id}.json`),
    'utf8',
  ).replace(/\r\n/g, '\n');
}

describe('circuitFileText', () => {
  /*
   * The headline: what Save circuit writes is what the repository stores. A
   * downloaded circuit can be renamed and committed, and a committed circuit
   * opened on the bench, without either side being rewritten first.
   */
  it('writes every shipped circuit exactly as the repository stores it', () => {
    // The ids come from the directory, not a literal count: a new circuit must
    // be registered *and* written in the canonical form, and a file nobody
    // registered is as wrong as a registration with no file.
    const onDisk = readdirSync(join(__dirname, '..', '..', 'learn', 'circuits'))
      .filter((name) => name.endsWith('.json'))
      .map((name) => name.slice(0, -'.json'.length))
      .sort();
    const ids = Object.keys(CIRCUITS).sort();
    expect(ids).toEqual(onDisk);
    for (const id of ids) {
      expect(circuitFileText(CIRCUITS[id as keyof typeof CIRCUITS]), `${id}.json`).toBe(
        shippedCircuitText(id),
      );
    }
  });

  it('reads back as a document', () => {
    const doc = CIRCUITS['1.1'];
    expect(readCircuitFile(circuitFileText(doc), '1.1.json')).toEqual(doc);
  });
});

describe('readCircuitFile', () => {
  it('names the file when the text is not JSON at all', () => {
    expect(() => readCircuitFile('<html>', 'notes.json')).toThrow(/notes\.json: not JSON/);
  });

  it('names the file when the JSON is not a circuit', () => {
    expect(() => readCircuitFile('{"hello":1}', 'thing.json')).toThrow(/thing\.json:/);
  });

  it('names the file when a part type does not exist', () => {
    const bad = JSON.stringify({
      version: 1,
      parts: [{ id: 'x', type: 'no-such-part', x: 0, y: 0 }],
      wires: [],
    });
    expect(() => readCircuitFile(bad, 'handed-in.json')).toThrow(
      /handed-in\.json: unknown part type/,
    );
  });

  it('names the file when the version is one it cannot read', () => {
    const ahead = JSON.stringify({ version: 2, parts: [], wires: [] });
    expect(() => readCircuitFile(ahead, 'tomorrow.json')).toThrow(
      /tomorrow\.json: unsupported circuit version: 2/,
    );
  });

  /*
   * A boardless document parses: what refuses it is the bench, because the pin
   * model belongs to the board (`Simulation.loadCircuit`). Pinned here so the
   * split of duties is visible: this module is the format gate, not the bench's.
   */
  it('parses a boardless document and leaves the refusal to the bench', () => {
    const boardless = {
      version: 1,
      parts: [{ id: 'led', type: 'led-red', x: 0, y: 0, rotation: 0 }],
      wires: [],
    };
    expect(readCircuitFile(JSON.stringify(boardless), 'led.json').parts).toHaveLength(1);
  });
});

describe('circuit file vocabulary', () => {
  it('names a download for its board', () => {
    expect(circuitFileName('uno')).toBe('noesis-uno-circuit.json');
    expect(circuitFileName('esp32')).toBe('noesis-esp32-circuit.json');
  });

  it('caps an upload far above anything the bench can hold', () => {
    expect(CIRCUIT_FILE_MAX_BYTES).toBeGreaterThan(circuitFileText(CIRCUITS['4.2']).length * 10);
  });

  it('says what happened when a file cannot be read', () => {
    expect(UNREADABLE_FILE_NOTICE).toMatch(/^That circuit file could not be read/);
  });
  it('carries a circuit’s own part through the file, and reads it back without an import', () => {
    const probe = {
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
    } as const;
    const doc = {
      version: 1,
      parts: [{ id: 'probe', type: 'soil-probe', x: 0, y: 0, rotation: 0 }],
      wires: [],
      definitions: [probe],
    };

    const text = circuitFileText(doc as never);
    expect(text).toContain('"soil-probe"');

    // The other machine: nothing imported, and the file still means what it said.
    const back = readCircuitFile(text, 'noesis-esp32-circuit.json');
    expect(back.parts[0]?.type).toBe('soil-probe');
    expect(back.definitions?.[0]?.id).toBe('soil-probe');
  });
});
