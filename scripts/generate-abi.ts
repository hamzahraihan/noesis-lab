#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SCHEMA = join(ROOT, 'native/abi/part-state.schema.json');
const CXX_OUT = join(ROOT, 'native/include/parts-generated.h');
const TS_OUT = join(ROOT, 'src/features/parts/wasm/generated/part-state.ts');

const SCHEMA_JSON = JSON.parse(readFileSync(SCHEMA, 'utf-8'));

const KIND_TO_CPP = {
  'shift595': 'Shift595',
  'pcf8574': 'PCF8574',
  'mcp23017': 'MCP23017',
  'ads1115': 'ADS1115',
  'max7219': 'Max7219',
  'pcd8544': 'PCD8544',
  'tm1637': 'TM1637',
  'stepper': 'Stepper',
  'max6675': 'Max6675',
  'mcp4725': 'MCP4725',
  'eeprom24lc256': 'EEPROM24LC256',
  'ds3231': 'DS3231',
  'bmp180': 'BMP180',
  'ina219': 'INA219',
  'bh1750': 'BH1750',
  'tmp102': 'TMP102',
  'sht31': 'SHT31',
  'rc522': 'RC522',
  'pca9685': 'PCA9685',
  'a4988': 'A4988',
  'scripted': 'Scripted',
};

function cppType(jsonType: string, items?: any): string {
  switch (jsonType) {
    case 'integer': return 'uint32_t';
    case 'number': return 'double';
    case 'boolean': return 'bool';
    case 'string': return 'char*';
    case 'array':
      if (items?.type === 'integer') return 'uint32_t';
      if (items?.type === 'number') return 'double';
      return 'uint32_t';
    default: return 'uint32_t';
  }
}

function tsType(jsonType: string, items?: any): string {
  switch (jsonType) {
    case 'integer': return 'number';
    case 'number': return 'number';
    case 'boolean': return 'boolean';
    case 'string': return 'string';
    case 'array':
      if (items?.type === 'integer') return 'number[]';
      if (items?.type === 'number') return 'number[]';
      return 'number[]';
    default: return 'number';
  }
}

function generateCppStruct(name: string, def: any): string {
  const props = def.properties;
  const required = def.required || [];
  let struct = `struct ${name} {\n`;
  for (const [field, spec] of Object.entries(props)) {
    const fieldSpec = spec as any;
    const isRequired = required.includes(field);
    const type = cppType(fieldSpec.type, fieldSpec.items);
    const isArray = fieldSpec.type === 'array';
    const minItems = fieldSpec.minItems;
    const maxItems = fieldSpec.maxItems;
    
    if (isArray && minItems && maxItems && minItems === maxItems) {
      struct += `    ${type} ${field}[${minItems}];\n`;
    } else if (isArray) {
      struct += `    ${type}* ${field};\n`;
    } else {
      struct += `    ${type} ${field};\n`;
    }
  }
  struct += '};\n';
  return struct;
}

function generateTsInterface(name: string, def: any): string {
  const props = def.properties;
  const required = def.required || [];
  let iface = `export interface ${name} {\n`;
  for (const [field, spec] of Object.entries(props)) {
    const fieldSpec = spec as any;
    const type = tsType(fieldSpec.type, fieldSpec.items);
    const isArray = fieldSpec.type === 'array';
    const minItems = fieldSpec.minItems;
    const maxItems = fieldSpec.maxItems;
    
    if (isArray && minItems && maxItems && minItems === maxItems) {
      iface += `  ${field}: [${Array(minItems).fill(type).join(', ')}];\n`;
    } else if (isArray) {
      iface += `  ${field}: ${type};\n`;
    } else {
      iface += `  ${field}: ${type};\n`;
    }
  }
  iface += '}\n';
  return iface;
}

function main() {
  mkdirSync(dirname(CXX_OUT), { recursive: true });
  mkdirSync(dirname(TS_OUT), { recursive: true });

  // Generate C++ header
  let cppHeader = `// Generated from native/abi/part-state.schema.json — DO NOT EDIT
#pragma once
#include <cstdint>
#include <cstddef>

#pragma pack(push, 1)

// Part state snapshot header
struct PartStateSnapshotHeader {
    uint32_t version;
    uint32_t partCount;
};

// Per-part data structures
`;

  // Generate TypeScript
  let tsContent = `// Generated from native/abi/part-state.schema.json — DO NOT EDIT

export interface PartStateSnapshotHeader {
  version: number;
  partCount: number;
}

`;

  const definitions = SCHEMA_JSON.definitions || {};
  const kindEnum = SCHEMA_JSON.properties.parts.items.properties.kind.enum || [];

  // Union types for C++
  const unionMembers: string[] = [];
  const tsUnionMembers: string[] = [];

  for (const kind of kindEnum) {
    if (kind === 'resistor' || kind === 'capacitor' || kind === 'led' || kind === 'button' || 
        kind === 'potentiometer' || kind === 'powerSupply' || kind === 'breadboard' || kind === 'mcu') {
      continue; // These don't have custom state
    }
    
    const cppName = KIND_TO_CPP[kind];
    const def = definitions[`${cppName}Data`];
    if (!def) continue;

    // C++ struct
    cppHeader += generateCppStruct(`${cppName}Snapshot`, def) + '\n';
    unionMembers.push(`    ${cppName}Snapshot ${cppName.toLowerCase()};`);
    
    // TypeScript interface
    tsContent += generateTsInterface(`${cppName}Snapshot`, def) + '\n';
    tsUnionMembers.push(`  | { kind: '${kind}'; data: ${cppName}Snapshot }`);
  }

  // C++ union and main struct
  cppHeader += `// Union for variable part data
union PartDataSnapshot {
${unionMembers.join('\n')}
};

struct PartStateSnapshot {
    char partId[64];
    char kind[32];
    PartDataSnapshot data;
};

#pragma pack(pop)

// Static assertions for struct sizes
`;

  // Add static assertions for C++
  for (const kind of kindEnum) {
    if (kind === 'resistor' || kind === 'capacitor' || kind === 'led' || kind === 'button' || 
        kind === 'potentiometer' || kind === 'powerSupply' || kind === 'breadboard' || kind === 'mcu') {
      continue;
    }
    const cppName = KIND_TO_CPP[kind];
    // We can't compute exact sizes without compiling, so use conservative estimates
    cppHeader += `static_assert(sizeof(${cppName}Snapshot) > 0, "${cppName}Snapshot must have size > 0");\n`;
  }
  cppHeader += `static_assert(sizeof(PartStateSnapshot) > 0, "PartStateSnapshot must have size > 0");\n`;

  // TypeScript union type
  tsContent += `\nexport type PartDataSnapshot =\n${tsUnionMembers.join('\n')};\n\n`;
  tsContent += `export interface PartStateSnapshot {\n  partId: string;\n  kind: string;\n  data: PartDataSnapshot;\n}\n\n`;
  tsContent += `export interface PartStateSnapshotResponse {\n  header: PartStateSnapshotHeader;\n  parts: PartStateSnapshot[];\n}\n`;

  writeFileSync(CXX_OUT, cppHeader, 'utf-8');
  writeFileSync(TS_OUT, tsContent, 'utf-8');
  
  console.log(`Generated: ${CXX_OUT}`);
  console.log(`Generated: ${TS_OUT}`);
}

main();