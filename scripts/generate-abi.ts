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

function main() {
  mkdirSync(dirname(CXX_OUT), { recursive: true });
  mkdirSync(dirname(TS_OUT), { recursive: true });

  const def = SCHEMA_JSON.definitions.PartStateSnapshot;
  const props = def.properties;
  const required = def.required || [];

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

// Complete part state snapshot matching C++ PartStateSnapshot struct (packed, no padding)
struct PartStateSnapshot {
    char partId[64];
    char kind[32];
    
    // Display framebuffers
    uint8_t* framebuffer;
    uint32_t framebuffer_size;
    uint16_t width;
    uint16_t height;
    
    // Servo angle (0-180)
    uint8_t servo_angle;
    
    // Stepper angle (0-360 degrees * 10 for 0.1 deg precision)
    int16_t stepper_angle_deci_deg;
    
    // Stepper driver output states
    uint8_t stepper_driver_outputs[4];  // 1A, 1B, 2A, 2B
    
    // 7-segment display state
    uint8_t seven_seg_digits[8];
    uint8_t seven_seg_colon;
    
    // Character LCD state
    uint8_t lcd_chars[80];
    uint8_t lcd_rows;
    uint8_t lcd_cols;
    
    // Shift register outputs
    uint8_t shift_register_outputs[8];

    // Relay contact state (true = contact closed)
    bool relay_contacts_closed;

    // Button pressed state (true = pressed)
    bool button_pressed;

    // Potentiometer wiper position, 0.0 - 1.0
    double pot_wiper;
    
    // RF ID card presence
    bool rfid_card_present;
    
    // Thermocouple temperature (0.25 degree steps)
    int16_t thermocouple_temp_quarter_deg;

    // PCF8574 I2C expander state
    uint8_t pcf8574_output_reg;
    uint8_t pcf8574_input_reg;

    // MCP23017 I2C expander state
    uint8_t mcp23017_iodira;
    uint8_t mcp23017_iodirb;
    uint8_t mcp23017_gpioa;
    uint8_t mcp23017_gpiob;
    uint8_t mcp23017_olata;
    uint8_t mcp23017_olatb;

    // ADS1115 ADC state
    uint16_t ads1115_config;
    int16_t ads1115_conversion;
    bool ads1115_conversion_ready;

    // Shift register (74HC595) state
    uint8_t shift595_shift_reg;
    uint8_t shift595_storage_reg;
    bool shift595_outputs_enabled;

    // PCD8544 (Nokia 5110) state
    uint8_t pcd8544_x;
    uint8_t pcd8544_y;
    bool pcd8544_vertical;
    bool pcd8544_extended;
    bool pcd8544_powerDown;
    bool pcd8544_blanked;
    bool pcd8544_inverse;
    uint8_t pcd8544_vop;
};

#pragma pack(pop)

// Static assertions for struct sizes
static_assert(sizeof(PartStateSnapshot) > 0, "PartStateSnapshot must have size > 0");
`;

  // Generate TypeScript
  let tsContent = `// Generated from native/abi/part-state.schema.json — DO NOT EDIT

export interface PartStateSnapshotHeader {
  version: number;
  partCount: number;
}

// Complete part state snapshot matching C++ PartStateSnapshot struct (packed, no padding)
export interface PartStateSnapshot {
  partId: string;
  kind: string;
  
  // Display framebuffers
  framebuffer: number;
  framebuffer_size: number;
  width: number;
  height: number;
  
  // Servo angle (0-180)
  servo_angle: number;
  
  // Stepper angle (0-360 degrees * 10 for 0.1 deg precision)
  stepper_angle_deci_deg: number;
  
  // Stepper driver output states
  stepper_driver_outputs: [number, number, number, number];
  
  // 7-segment display state
  seven_seg_digits: [number, number, number, number, number, number, number, number];
  seven_seg_colon: number;
  
  // Character LCD state
  lcd_chars: [number, number, number, number, number, number, number, number, number, number,
    number, number, number, number, number, number, number, number, number, number,
    number, number, number, number, number, number, number, number, number, number,
    number, number, number, number, number, number, number, number, number, number,
    number, number, number, number, number, number, number, number, number, number,
    number, number, number, number, number, number, number, number, number, number,
    number, number, number, number, number, number, number, number, number, number,
    number, number, number, number, number, number, number, number, number, number];
  lcd_rows: number;
  lcd_cols: number;
  
  // Shift register outputs
  shift_register_outputs: [number, number, number, number, number, number, number, number];

  // Relay contact state (true = contact closed)
  relay_contacts_closed: boolean;

  // Button pressed state (true = pressed)
  button_pressed: boolean;

  // Potentiometer wiper position, 0.0 - 1.0
  pot_wiper: number;
  
  // RF ID card presence
  rfid_card_present: boolean;
  
  // Thermocouple temperature (0.25 degree steps)
  thermocouple_temp_quarter_deg: number;

  // PCF8574 I2C expander state
  pcf8574_output_reg: number;
  pcf8574_input_reg: number;

  // MCP23017 I2C expander state
  mcp23017_iodira: number;
  mcp23017_iodirb: number;
  mcp23017_gpioa: number;
  mcp23017_gpiob: number;
  mcp23017_olata: number;
  mcp23017_olatb: number;

  // ADS1115 ADC state
  ads1115_config: number;
  ads1115_conversion: number;
  ads1115_conversion_ready: boolean;

  // Shift register (74HC595) state
  shift595_shift_reg: number;
  shift595_storage_reg: number;
  shift595_outputs_enabled: boolean;

  // PCD8544 (Nokia 5110) state
  pcd8544_x: number;
  pcd8544_y: number;
  pcd8544_vertical: boolean;
  pcd8544_extended: boolean;
  pcd8544_powerDown: boolean;
  pcd8544_blanked: boolean;
  pcd8544_inverse: boolean;
  pcd8544_vop: number;
}

export interface PartStateSnapshotResponse {
  header: PartStateSnapshotHeader;
  parts: PartStateSnapshot[];
}
`;

  writeFileSync(CXX_OUT, cppHeader, 'utf-8');
  writeFileSync(TS_OUT, tsContent, 'utf-8');
  
  console.log(`Generated: ${CXX_OUT}`);
  console.log(`Generated: ${TS_OUT}`);
}

main();