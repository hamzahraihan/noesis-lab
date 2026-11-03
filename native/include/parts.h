/**
 * Part Interfaces for C++ Engine (Phase 4)
 *
 * Defines the ABI for part models and bus controllers.
 * Matches TypeScript interfaces in src/features/parts/devices/device.ts
 * and bus models in src/features/simulation/bus/
 */

#ifndef PARTS_H
#define PARTS_H

#include "solver.h"
#include <stddef.h>
#include <stdint.h>
#include "parts-generated.h"

#ifdef __cplusplus
extern "C" {
#endif

// ============================================================================
// Part Kinds (matches TypeScript component kinds)
// ============================================================================

typedef enum {
    PART_KIND_PASSIVE = 0,           // Resistor, capacitor, etc. (handled by solver)
    PART_KIND_MCU = 1,               // Microcontroller (handled by AVR core)
    PART_KIND_POWER_SUPPLY = 2,      // Adjustable voltage source
    PART_KIND_RELAY = 3,             // Electromechanical relay
    PART_KIND_SERVO = 4,             // RC servo
    PART_KIND_STEPPER = 5,           // Stepper motor
    PART_KIND_STEPPER_DRIVER = 6,    // A4988 driver
    PART_KIND_SHIFT_REGISTER = 7,    // 74HC595
    PART_KIND_DISPLAY_I2C = 8,       // SSD1306, etc.
    PART_KIND_DISPLAY_SPI = 9,       // ILI9341, PCD8544, MAX7219
    PART_KIND_DISPLAY_7SEG = 10,     // TM1637, multiplexed 7-seg
    PART_KIND_DISPLAY_LCD = 11,      // HD44780 (character LCD)
    PART_KIND_I2C_EXPANDER = 12,     // PCF8574, MCP23017
    PART_KIND_PWM_DRIVER = 13,       // PCA9685
    PART_KIND_RTC = 14,              // DS1307, DS3231
    PART_KIND_SENSOR_I2C = 15,       // BH1750, BMP180, SHT31, etc.
    PART_KIND_DAC = 16,              // MCP4725
    PART_KIND_ADC = 17,              // ADS1115
    PART_KIND_THERMOCOUPLE = 18,     // MAX6675
    PART_KIND_RFID = 19,             // MFRC522
    PART_KIND_NEOPIXEL = 20,         // Addressable LEDs
    PART_KIND_SONAR = 21,            // HC-SR04
    PART_KIND_DHT = 22,              // DHT11/22
    PART_KIND_DS18B20 = 23,          // 1-Wire temperature
    PART_KIND_ENCODER = 24,          // Rotary encoder
    PART_KIND_BUTTON = 25,           // Push button
    PART_KIND_POTENTIOMETER = 26,    // Potentiometer
    PART_KIND_REMOTE = 27,           // IR remote
    PART_KIND_DIALER = 28,           // Rotary dialer
    PART_KIND_SD_CARD = 29,          // SD card
    PART_KIND_SCRIPTED = 30,         // Scripted part (QuickJS)
    PART_KIND_UNKNOWN = 255
} PartKind;

// ============================================================================
// I2C Bus Interface
// ============================================================================

typedef enum {
    I2C_RESULT_OK = 0,
    I2C_RESULT_NACK = 1,
    I2C_RESULT_ERROR = 2
} I2CResult;

typedef struct {
    uint8_t address;
    uint8_t byte;
    bool is_control_byte;
} I2CWriteOp;

typedef struct {
    uint8_t address;
    uint8_t count;
    uint8_t data[32];  // Max read size
    uint8_t length;
} I2CReadOp;

typedef struct {
    uint8_t address;
    uint8_t bytes[32];
    uint8_t length;
    bool acknowledged;
    uint32_t micros;
} I2CTransaction;

// I2C Bus Controller - implemented in C++, called from firmware interpreter
// These functions are the C++ side of the I2C bus model

// Initialize I2C bus with given SDA/SCL pin indices (for validation)
extern "C" void i2c_bus_init(uint32_t sda_net, uint32_t scl_net);

// Called by firmware: Wire.begin()
extern "C" void i2c_bus_begin(uint8_t sda, uint8_t scl);

// Called by firmware: Wire.beginTransmission()
extern "C" void i2c_bus_begin_transmission(uint8_t address);

// Called by firmware: Wire.write()
extern "C" void i2c_bus_write(uint8_t byte);

// Called by firmware: Wire.endTransmission() -> returns acknowledged
extern "C" bool i2c_bus_end_transmission(void);

// Called by firmware: Wire.requestFrom()
extern "C" uint8_t i2c_bus_request_from(uint8_t address, uint8_t count);

// Called by firmware: Wire.read()
extern "C" int8_t i2c_bus_read(void);

// Called by firmware: Wire.available()
extern "C" uint8_t i2c_bus_available(void);

// Register an I2C device at address (returns device handle)
typedef void* I2CDeviceHandle;
extern "C" I2CDeviceHandle i2c_bus_register_device(uint8_t address, uint32_t part_id);

// Write byte to device (called from bus when delivering)
extern "C" bool i2c_device_receive(I2CDeviceHandle handle, uint8_t byte, bool is_control_byte);

// Read bytes from device
extern "C" uint8_t i2c_device_read(I2CDeviceHandle handle, uint8_t* buffer, uint8_t count);

// ============================================================================
// SPI Bus Interface
// ============================================================================

typedef struct {
    uint8_t value;
    bool data_select;
} SpiByte;

typedef struct {
    SpiByte bytes[256];
    uint16_t length;
    bool acknowledged;
    uint32_t micros;
} SpiTransfer;

// SPI Bus Controller
extern "C" void spi_bus_init(uint32_t cs_net, uint32_t mosi_net, uint32_t miso_net, uint32_t sck_net);

extern "C" void spi_bus_begin(void);
extern "C" void spi_bus_end(void);
extern "C" uint8_t spi_bus_transfer(uint8_t byte, bool data_select, bool chip_selected);

// SPI Device Handle
typedef void* SPIPartHandle;
extern "C" SPIPartHandle spi_bus_register_display(uint32_t part_id, uint32_t cs_net, uint32_t dc_net);
extern "C" SPIPartHandle spi_bus_register_shift_register(uint32_t part_id, uint32_t cs_net);
extern "C" SPIPartHandle spi_bus_register_thermocouple(uint32_t part_id, uint32_t cs_net);
extern "C" SPIPartHandle spi_bus_register_card_reader(uint32_t part_id, uint32_t cs_net);

// SPI Device callbacks
extern "C" void spi_display_receive(SPIPartHandle handle, uint8_t byte, bool data_select, bool chip_selected);
extern "C" void spi_shift_register_receive(SPIPartHandle handle, uint8_t byte, bool data_select, bool chip_selected);
extern "C" void spi_card_reader_receive(SPIPartHandle handle, uint8_t byte);
extern "C" int16_t spi_thermocouple_receive(SPIPartHandle handle);
extern "C" void spi_pcd8544_receive(void* ctx, uint8_t byte, bool data_select, bool chip_selected);

// ============================================================================
// Part Stamping Interface
// ============================================================================

// Part handle for engine
typedef void* PartHandle;

// Explicitly construct the module's global STL containers. Needed with
// -Wl,--no-entry, where emcc emits no automatic global constructors.
extern "C" void init_globals(void);

// Register a part instance and return its handle. part_stamp applies the
// previous solve's solution to every registered part.
extern "C" PartHandle part_register(uint32_t part_id, PartKind kind, const char* definition_json);
extern "C" void part_stamp(PartHandle handle, const SolverSolution* solution, double time_ms);

// Static buffer for part_get_state return value (thread-local for wasm single-threaded use)
extern "C" PartStateSnapshot* part_get_state(PartHandle handle);

// Part-specific setters (called from engine when conditions change)
extern "C" void part_set_knob(PartHandle handle, const char* knob_name, double value);
extern "C" void part_set_pin_level(PartHandle handle, uint32_t pin_index, bool high);
extern "C" void part_set_i2c_address(PartHandle handle, uint8_t address);

// Special part types
extern "C" PartHandle part_create_relay(uint32_t part_id, double coil_ohms, double contact_ohms);
extern "C" PartHandle part_create_servo(uint32_t part_id);
extern "C" PartHandle part_create_stepper(uint32_t part_id, double step_angle_deg);
extern "C" PartHandle part_create_stepper_driver(uint32_t part_id, double output_ohms);
extern "C" PartHandle part_create_shift_register(uint32_t part_id);
extern "C" PartHandle part_create_display_i2c(uint32_t part_id, uint8_t address, uint16_t width, uint16_t height);
extern "C" PartHandle part_create_display_spi(uint32_t part_id, uint16_t width, uint16_t height, bool has_dc);
extern "C" PartHandle part_create_display_pcd8544(uint32_t part_id);
extern "C" PartHandle part_create_7segment(uint32_t part_id, uint8_t digits);
extern "C" PartHandle part_create_lcd(uint32_t part_id, uint8_t cols, uint8_t rows);
extern "C" PartHandle part_create_i2c_expander(uint32_t part_id, uint8_t ports, uint8_t address);
extern "C" PartHandle part_create_pwm_driver(uint32_t part_id, uint8_t channels);
extern "C" PartHandle part_create_rtc(uint32_t part_id, bool is_ds3231);
extern "C" PartHandle part_create_sensor_i2c(uint32_t part_id, uint8_t type, uint8_t address);
extern "C" PartHandle part_create_dac(uint32_t part_id, uint8_t address, uint8_t bits);
extern "C" PartHandle part_create_adc(uint32_t part_id, uint8_t address, uint8_t channels);
extern "C" PartHandle part_create_thermocouple(uint32_t part_id);
extern "C" PartHandle part_create_rfid(uint32_t part_id, uint8_t address);
extern "C" PartHandle part_create_neopixel(uint32_t part_id, uint16_t count);
extern "C" PartHandle part_create_sonar(uint32_t part_id);
extern "C" PartHandle part_create_button(uint32_t part_id);
extern "C" PartHandle part_create_potentiometer(uint32_t part_id, double max_ohms);
extern "C" PartHandle part_create_power_supply(uint32_t part_id, double initial_volts);

// ============================================================================
// Bus State Snapshots
// ============================================================================

typedef struct {
    // I2C bus state
    uint8_t i2c_address;
    uint8_t i2c_payload[32];
    uint8_t i2c_payload_len;
    bool i2c_transmitting;
    uint8_t i2c_read_buffer[32];
    uint8_t i2c_read_len;
    uint32_t i2c_transactions_count;
    
    // SPI bus state
    bool spi_selected;
    SpiByte spi_payload[256];
    uint16_t spi_payload_len;
    bool spi_saw_byte;
    uint32_t spi_transfers_count;
} BusStateSnapshot;

extern "C" void bus_get_state(BusStateSnapshot* out);
extern "C" void bus_reset(void);

#ifdef __cplusplus
}
#endif

#endif // PARTS_H