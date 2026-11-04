// Generated from native/abi/part-state.schema.json — DO NOT EDIT
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
