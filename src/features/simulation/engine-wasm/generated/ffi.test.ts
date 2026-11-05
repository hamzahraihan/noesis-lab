import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..', '..', '..');
const SCHEMA_PATH = join(ROOT, 'native/abi/engine-ffi.schema.json');
const FFI_TYPES = join(ROOT, 'src/features/simulation/engine-wasm/generated/ffi.ts');
const FFI_CXX = join(ROOT, 'native/include/ffi-generated.h');

function readJson(path: string): Record<string, any> {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

const schema = readJson(SCHEMA_PATH);

describe('FFI Schema Round-trip', () => {
  it('schema file exists and is valid JSON', () => {
    expect(schema.version).toBe(1);
    expect(schema.definitions).toBeDefined();
    expect(schema.definitions.EngineCommand).toBeDefined();
    expect(schema.definitions.EngineEvent).toBeDefined();
  });

  it('declares the C entry points the Wasm module exports', () => {
    expect(schema.ffi?.exports?.length).toBeGreaterThan(0);
    const names = schema.ffi.exports.map((entry: { name: string }) => entry.name);
    expect(names).toEqual([
      'engine_create',
      'engine_step',
      'engine_set_pin',
      'engine_set_knob',
      'engine_get_state',
      'engine_get_voltages',
      'engine_get_serial',
      'engine_destroy',
    ]);
    for (const entry of schema.ffi.exports) {
      expect(entry.returns).toBeTypeOf('string');
      expect(entry.parameters).toBeInstanceOf(Array);
    }
  });

  it('generated TypeScript file exists', () => {
    const tsText = readFileSync(FFI_TYPES, 'utf-8');
    expect(tsText).toContain('FFI_PROTOCOL_VERSION');
    expect(tsText).toContain('FFICommandType');
    expect(tsText).toContain('FFIEventType');
    expect(tsText).toContain('FFIPartStateSnapshot');
    expect(tsText).toContain('FFICircuitSnapshot');
    expect(tsText).toContain('FFI_EXPORTED_FUNCTIONS');
  });

  it('generated C++ header exists', () => {
    const cxxText = readFileSync(FFI_CXX, 'utf-8');
    expect(cxxText).toContain('FFI_PROTOCOL_VERSION');
    expect(cxxText).toContain('FFICommandType');
    expect(cxxText).toContain('FFIEventType');
    expect(cxxText).toContain('FFIPartStateSnapshot');
    expect(cxxText).toContain('static_assert');
  });

  it('command types match between schema and generated TS', () => {
    const tsText = readFileSync(FFI_TYPES, 'utf-8');
    const commandTypes = Object.keys(schema.definitions.EngineCommand.discriminator.mapping);
    for (const cmd of commandTypes) {
      expect(tsText).toContain(cmd);
    }
  });

  it('event types match between schema and generated TS', () => {
    const tsText = readFileSync(FFI_TYPES, 'utf-8');
    const eventTypes = Object.keys(schema.definitions.EngineEvent.discriminator.mapping);
    for (const evt of eventTypes) {
      expect(tsText).toContain(evt);
    }
  });

  it('PartStateSnapshot fields match between schema and generated TS', () => {
    const tsText = readFileSync(FFI_TYPES, 'utf-8');
    const partStateProps = schema.definitions.PartStateSnapshot.properties;
    for (const prop of Object.keys(partStateProps)) {
      // Generated TS uses snake_case to match the C++ struct layout.
      expect(tsText).toContain(prop);
    }
  });

  it('declares every schema entry point in the generated header', () => {
    const cxxText = readFileSync(FFI_CXX, 'utf-8');
    for (const entry of schema.ffi.exports) {
      expect(cxxText).toContain(entry.name);
    }
  });

  it('exports the schema entry point names from the generated TS', () => {
    const tsText = readFileSync(FFI_TYPES, 'utf-8');
    for (const entry of schema.ffi.exports) {
      expect(tsText).toContain(`"${entry.name}"`);
    }
  });

  it('C++ struct packing assertions cover the ambiguous layouts', () => {
    const cxxText = readFileSync(FFI_CXX, 'utf-8');

    expect(cxxText).toContain('static_assert(sizeof(FFICommandHeader) == 4');
    // Packed: header(4) + two u32 offsets.
    expect(cxxText).toContain('static_assert(sizeof(FFILoadCircuitCommand) == 12');
    expect(cxxText).toContain('static_assert(sizeof(FFIStepCommand) == 16');
    // Packed: header(4) + four u32 fields + one double.
    expect(cxxText).toContain('static_assert(sizeof(FFISetKnobCommand) == 28');
    expect(cxxText).toContain('static_assert(sizeof(FFIFramebufferDescriptor) == 22');
    expect(cxxText).toContain('static_assert(sizeof(FFISolvedEvent) == 28');
    // Packed: the u64 cycles field is not 8-byte aligned.
    expect(cxxText).toContain('static_assert(sizeof(FFIDebuggerStateEvent) == 42');
    expect(cxxText).toContain('static_assert(sizeof(FFIPartStateSnapshot) == 314');
  });

  it('schema version field exists for evolution', () => {
    expect(schema.version).toBeDefined();
    expect(typeof schema.version).toBe('number');
  });
});
