// Generated from native/abi/part-state.schema.json — DO NOT EDIT

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

  // HC-SR04 ultrasonic ranger
  sonar_echo_us: number;

  // NeoPixel / addressable LED strip (pixel buffer, up to 4 pixels in snapshot)
  neopixel_count: number;
  neopixel_pixel0_r: number;
  neopixel_pixel0_g: number;
  neopixel_pixel0_b: number;
  neopixel_pixel1_r: number;
  neopixel_pixel1_g: number;
  neopixel_pixel1_b: number;
  neopixel_pixel2_r: number;
  neopixel_pixel2_g: number;
  neopixel_pixel2_b: number;
  neopixel_pixel3_r: number;
  neopixel_pixel3_g: number;
  neopixel_pixel3_b: number;

  // Scripted I2C slave: register file
  scripted_reg_ptr: number;
  scripted_reg_0: number;
  scripted_reg_1: number;
  scripted_reg_2: number;
  scripted_reg_3: number;
  scripted_reg_4: number;
  scripted_reg_5: number;
  scripted_reg_6: number;
  scripted_reg_7: number;
}

export interface PartStateSnapshotResponse {
  header: PartStateSnapshotHeader;
  parts: PartStateSnapshot[];
}
