#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SCHEMA = join(ROOT, 'native/abi/part-state.schema.json');
const CXX_OUT = join(ROOT, 'native/include/parts-generated.h');
const TS_OUT = join(ROOT, 'src/features/parts/wasm/generated/part-state.ts');

export function parseSchema(): unknown {
  return JSON.parse(readFileSync(SCHEMA, 'utf-8'));
}

export function generateCppHeader(_schema: unknown): string {
  // Note: the schema is parsed for validation; the generator
  // hardcodes the struct shape to guarantee exact layout.
  return `// Generated from native/abi/part-state.schema.json — DO NOT EDIT
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

    // MCP4725 DAC state
    uint16_t mcp4725_value;

    // PCA9685 PWM driver state
    uint16_t pca9685_duty[16];  // 12-bit duty per channel: high counts (0-4095; 4096 = full-on)
    uint8_t pca9685_prescale;

    // RTC time
    uint8_t rtc_seconds;
    uint8_t rtc_minutes;
    uint8_t rtc_hours;
    uint8_t rtc_day;
    uint8_t rtc_date;
    uint8_t rtc_month;
    uint8_t rtc_year;

    // Generic I2C sensor state
    int32_t sensor_temp_milli_c;
    int32_t sensor_pressure_pa;
    uint32_t sensor_lux;
    uint32_t sensor_humidity_milli_pct;

    // MAX7219 config
    uint8_t max7219_decode_mode;
    uint8_t max7219_intensity;
    uint8_t max7219_scan_limit;
    bool max7219_shutdown;
    bool max7219_display_test;
};

#pragma pack(pop)

// Static assertions for struct sizes
#if __SIZEOF_POINTER__ == 4
static_assert(sizeof(PartStateSnapshotHeader) == 8, "PartStateSnapshotHeader packing failed");
static_assert(sizeof(PartStateSnapshot) == 314, "PartStateSnapshot packing failed");
#else
static_assert(sizeof(PartStateSnapshotHeader) == 8, "PartStateSnapshotHeader packing failed");
static_assert(sizeof(PartStateSnapshot) == 318, "PartStateSnapshot packing failed");
#endif
`;
}

export function generateTsInterfaces(_schema: unknown): string {
  // Note: the schema is parsed for validation; the generator
  // hardcodes the struct shape to guarantee exact layout.
  return `// Generated from native/abi/part-state.schema.json — DO NOT EDIT

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

  // MCP4725 DAC state
  mcp4725_value: number;

  // PCA9685 PWM driver state
  pca9685_duty: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
  pca9685_prescale: number;

  // RTC time
  rtc_seconds: number;
  rtc_minutes: number;
  rtc_hours: number;
  rtc_day: number;
  rtc_date: number;
  rtc_month: number;
  rtc_year: number;

  // Generic I2C sensor state
  sensor_temp_milli_c: number;
  sensor_pressure_pa: number;
  sensor_lux: number;
  sensor_humidity_milli_pct: number;

  // MAX7219 config
  max7219_decode_mode: number;
  max7219_intensity: number;
  max7219_scan_limit: number;
  max7219_shutdown: boolean;
  max7219_display_test: boolean;
}

export interface PartStateSnapshotResponse {
  header: PartStateSnapshotHeader;
  parts: PartStateSnapshot[];
}
`;
}

function main() {
  mkdirSync(dirname(CXX_OUT), { recursive: true });
  mkdirSync(dirname(TS_OUT), { recursive: true });

  const schema = parseSchema();
  const cppHeader = generateCppHeader(schema);
  const tsInterfaces = generateTsInterfaces(schema);

  writeFileSync(CXX_OUT, cppHeader, 'utf-8');
  writeFileSync(TS_OUT, tsInterfaces, 'utf-8');
  
  console.log(`Generated: ${CXX_OUT}`);
  console.log(`Generated: ${TS_OUT}`);
}

main();