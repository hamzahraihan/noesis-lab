/**
 * Part Models and Bus Logic C++ Implementation (Phase 4)
 *
 * Implements ~50 component kinds and I2C/SPI/UART bus models.
 * Each part has a stamp(netlist, timeMs) method called each solve.
 */

#include "parts.h"
#include "solver.h"
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <unordered_map>
#include <vector>

namespace engine {

// ============================================================================

// ============================================================================
// Display Constants
// ============================================================================

// PCD8544 (Nokia 5110) constants
constexpr uint16_t PCD8544_WIDTH = 84;
constexpr uint16_t PCD8544_HEIGHT = 48;
constexpr uint8_t PCD8544_BANKS = 6;  // 48/8 = 6 banks
constexpr uint16_t PCD8544_FRAME_BYTES = PCD8544_WIDTH * PCD8544_BANKS;


// Debug counters for SPI debugging


// Device-Specific Context Structures
// ============================================================================

// Common base so owned contexts can be destroyed through a typed pointer.
// Deleting a void* is undefined behaviour and skips destructors, which leaks
// the framebuffers held by the display contexts.
enum class PartContextType : uint8_t {
    NONE = 0,
    PCF8574,
    MCP23017,
    PCA9685,
    SSD1306,
    ADS1115,
    MCP4725,
    BH1750,
    BMP180,
    SHT31,
    TMP102,
    EEPROM,
    MAX6675,
    MFRC522,
    ILI9341,
    MAX7219,
    PCD8544,
    HD44780,
    SERVO,
    STEPPER,
    STEPPER_DRIVER,
    POWER_SUPPLY,
    RELAY,
    BUTTON,
    POTENTIOMETER,
    SHIFT_REGISTER,
    RTC,
    SONAR,
    DHT,
    DS18B20,
    NEOPIXEL,
    SCRIPTED,
};

struct PartContext {
    virtual ~PartContext() = default;
    virtual PartContextType type() const = 0;
};

// PCF8574 - 8-bit I/O expander with quasi-bidirectional pins
struct PCF8574Context : PartContext {
    uint8_t output_reg = 0xFF;  // All pins high (weak pull-up) at reset
    uint8_t input_reg = 0xFF;   // Input latch
    PartContextType type() const override { return PartContextType::PCF8574; }
};

// MCP23017 - 16-bit I/O expander with full bidirectional ports
struct MCP23017Context : PartContext {
    // Register map (bank 0, sequential)
    uint8_t iodira = 0xFF;   // Port A direction (1=input)
    uint8_t iodirb = 0xFF;   // Port B direction
    uint8_t ipola = 0x00;    // Port A polarity inversion
    uint8_t ipolb = 0x00;    // Port B polarity inversion
    uint8_t gpinta = 0x00;   // Port A interrupt-on-change
    uint8_t gpintb = 0x00;   // Port B interrupt-on-change
    uint8_t defvala = 0x00;  // Port A default compare value
    uint8_t defvalb = 0x00;  // Port B default compare value
    uint8_t intcona = 0x00;  // Port A interrupt control
    uint8_t intconb = 0x00;  // Port B interrupt control
    uint8_t iocona = 0x00;   // Port A IOCON
    uint8_t ioconb = 0x00;   // Port B IOCON
    uint8_t gppua = 0x00;    // Port A pull-up resistor
    uint8_t gppub = 0x00;    // Port B pull-up resistor
    uint8_t intfa = 0x00;    // Port A interrupt flag
    uint8_t intfb = 0x00;    // Port B interrupt flag
    uint8_t intcapa = 0x00;  // Port A captured value
    uint8_t intcapb = 0x00;  // Port B captured value
    uint8_t gpioa = 0x00;    // Port A GPIO
    uint8_t gpiob = 0x00;    // Port B GPIO
    uint8_t olata = 0x00;    // Port A output latch
    uint8_t olatb = 0x00;    // Port B output latch
    
    uint8_t reg_ptr = 0x00;  // Current register pointer
    bool seqop = false;      // Sequential operation mode
    PartContextType type() const override { return PartContextType::MCP23017; }
};

// PCA9685 - 16-channel 12-bit PWM driver
struct PCA9685Context : PartContext {
    uint8_t mode1 = 0x11;  // SLEEP | ALLCALL (TS parity)
    uint8_t mode2 = 0x04;  // Totem-pole outputs
    uint8_t prescale = 0x1E;  // Default ~200Hz
    uint8_t led_on_l[16] = {0};
    uint8_t led_on_h[16] = {0};
    uint8_t led_off_l[16] = {0};
    uint8_t led_off_h[16] = {0};
    uint8_t all_led_on_l = 0;
    uint8_t all_led_on_h = 0;
    uint8_t all_led_off_l = 0;
    uint8_t all_led_off_h = 0;
    uint8_t reg_ptr = 0x00;
    bool auto_increment = false;
    PartContextType type() const override { return PartContextType::PCA9685; }
};

// SSD1306 - OLED display controller
struct SSD1306Context : PartContext {
    uint8_t width;
    uint8_t height;
    uint8_t pages;
    std::vector<uint8_t> framebuffer;
    uint8_t column_start = 0;
    uint8_t column_end = 127;
    uint8_t page_start = 0;
    uint8_t page_end = 7;
    uint8_t cursor_column = 0;  // Current write position (separate from window)
    uint8_t cursor_page = 0;
    uint8_t display_on = 0;
    uint8_t contrast = 0x7F;
    uint8_t charge_pump = 0x10;
    uint8_t memory_mode = 0x00;  // Horizontal addressing
    uint8_t com_pins = 0x02;
    uint8_t com_scan_dir = 0xC0;
    bool segmentRemap = false;
    uint8_t display_offset = 0x00;
    uint8_t display_clock_div = 0x80;
    uint8_t precharge = 0xF1;
    uint8_t vcom_detect = 0x40;
    uint8_t reg_ptr = 0x00;
    bool expecting_data = false;  // After 0x40 (data) vs 0x00 (command)
    // Command state machine
    uint8_t cmd_args[16];
    uint8_t cmd_arg_count = 0;
    uint8_t expected_args = 0;
    PartContextType type() const override { return PartContextType::SSD1306; }
};

// ADS1115 - 16-bit ADC
struct ADS1115Context : PartContext {
    uint16_t config = 0x8583;  // Default: AIN0, +/-6.144V, single-shot, 128SPS
    uint16_t lo_thresh = 0x8000;
    uint16_t hi_thresh = 0x7FFF;
    uint16_t conversion = 0x0000;
    uint8_t reg_ptr = 0x00;
    uint32_t conversion_start = 0;
    bool conversion_ready = true;
    // Simulated input voltages (from knobs)
    double input_voltage[4] = {0.0, 0.0, 0.0, 0.0};
    // 16-bit register write assembly (two bytes per register)
    uint8_t write_first_byte = 0;
    bool have_first_byte = false;
    PartContextType type() const override { return PartContextType::ADS1115; }
};

// MCP4725 - 12-bit DAC
struct MCP4725Context : PartContext {
    uint16_t dac_value = 0x0000;  // 12-bit value
    uint8_t power_down = 0x00;
    bool eeprom_write = false;
    uint8_t reg_ptr = 0x00;
    bool multi_byte = false;
    uint8_t write_buffer[3];
    uint8_t write_count = 0;
    PartContextType type() const override { return PartContextType::MCP4725; }
};

// BH1750 - Light sensor (I2C)
struct BH1750Context : PartContext {
    uint16_t counts = 0;
    bool powered = false;
    uint8_t mode = 0;  // 0=down, 1=continuous, 2=one-shot
    uint8_t resolution = 0;  // 0=high, 1=high2, 2=low
    uint32_t conversion_start_ms = 0;
    bool conversion_ready = false;
    PartContextType type() const override { return PartContextType::BH1750; }
};

// BMP180 - Pressure/temperature sensor (I2C)
struct BMP180Context : PartContext {
    int32_t raw_temperature = 0;
    int32_t raw_pressure = 101325;
    uint8_t oss = 0;  // oversampling setting
    uint8_t holding = 0;  // 0=temperature, 1=pressure
    uint8_t pointer = 0xF6;
    bool stale = true;
    // Calibration coefficients (from BMP180_CALIBRATION)
    int16_t ac1 = 408;
    int16_t ac2 = -300;
    int16_t ac3 = -400;
    uint16_t ac4 = 32741;
    uint16_t ac5 = 6400;
    uint16_t ac6 = 1004;
    int16_t b1 = -6190;
    int16_t b2 = 4;
    int16_t mb = -32768;
    int16_t mc = -5361;
    int16_t md = 2000;
    PartContextType type() const override { return PartContextType::BMP180; }
};

// SHT31 - Temperature/humidity sensor (I2C)
struct SHT31Context : PartContext {
    uint16_t raw_temperature = 0;
    uint16_t raw_humidity = 0;
    bool heater = false;
    uint16_t command_high = 0;
    bool have_command_high = false;
    // Knob-set values (in milli-Celsius and milli-percent)
    int32_t knob_temp_milli_c = 21000;  // Default 21°C
    int32_t knob_humidity_milli_pct = 45000;  // Default 45%
    PartContextType type() const override { return PartContextType::SHT31; }
};

// TMP102 - Temperature sensor (I2C)
struct TMP102Context : PartContext {
    int16_t temperature_counts = 0;
    uint16_t config = 0x60A0;
    uint16_t t_low = 0x4B00;
    uint16_t t_high = 0x5000;
    uint8_t pointer = 0x00;
    uint8_t byte_index = 0;
    PartContextType type() const override { return PartContextType::TMP102; }
};

// EEPROM 24LC256 (I2C)
struct EEPROM24LC256Context : PartContext {
    static constexpr uint32_t EEPROM_SIZE = 32768;
    static constexpr uint32_t EEPROM_PAGE_SIZE = 64;
    std::vector<uint8_t> bytes;
    uint16_t pointer = 0;
    uint8_t high = 0;
    uint8_t address_bytes = 0;
    EEPROM24LC256Context() : bytes(EEPROM_SIZE, 0) {}
    PartContextType type() const override { return PartContextType::EEPROM; }
};

// MAX6675 - Thermocouple (SPI)
struct MAX6675Context : PartContext {
    int16_t temp_quarter_deg = 0;  // Temperature in 0.25°C steps
    bool fault = false;  // Open thermocouple detection
    uint8_t sent = 0;      // Bytes handed out in current transaction
    PartContextType type() const override { return PartContextType::MAX6675; }
};

// MFRC522 - RFID reader (SPI)
struct MFRC522Context : PartContext {
    enum State { IDLE, AUTHENTICATING, TRANSCEIVING, CALCULATING_CRC } state = IDLE;
    uint8_t fifo[64];
    uint8_t fifo_level = 0;
    uint8_t command = 0x00;
    uint8_t reg_ptr = 0x00;
    uint8_t uid[4] = {0x12, 0x34, 0x56, 0x78};  // Default card UID
    bool card_present = true;
    uint8_t key_a[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};
    uint8_t key_b[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};
    PartContextType type() const override { return PartContextType::MFRC522; }
};

// ILI9341 - TFT display (SPI)
struct ILI9341Context : PartContext {
    uint16_t width;
    uint16_t height;
    std::vector<uint8_t> framebuffer;  // RGB565 as byte stream (2 bytes per pixel, high byte first) - matches TS Uint8Array
    uint8_t reg_ptr = 0x00;
    bool data_mode = false;  // DC pin state
    // Command state machine
    uint8_t cmd_args[16];
    uint8_t cmd_arg_count = 0;
    uint8_t expected_args = 0;
    // Streaming pixel state
    bool streaming = false;
    uint16_t column_start = 0;
    uint16_t column_end = 0;
    uint16_t page_start = 0;
    uint16_t page_end = 0;
    uint16_t cursor_column = 0;
    uint16_t cursor_page = 0;
    uint8_t madctl = 0;
    bool expect_high_byte = true;
    PartContextType type() const override { return PartContextType::ILI9341; }
};

// MAX7219 - 8x8 LED matrix (SPI)
struct MAX7219Context : PartContext {
    uint8_t decode_mode = 0x00;
    uint8_t intensity = 0x00;
    uint8_t scan_limit = 0x07;
    uint8_t shutdown = 0x01; // power-up: shut down (matches TS oracle / datasheet)
    uint8_t display_test = 0x00;
    uint8_t digit_data[8] = {0};
    uint16_t shift = 0;
    uint8_t bits = 0;
    PartContextType type() const override { return PartContextType::MAX7219; }
};

// PCD8544 - Nokia 5110 LCD (SPI)
struct PCD8544Context : PartContext {
    uint16_t width = 84;
    uint16_t height = 48;
    std::vector<uint8_t> framebuffer;  // 1 bit per pixel
    uint8_t reg_ptr = 0x00;
    bool data_mode = false;
    
    // Position and addressing mode state
    uint8_t x = 0;
    uint8_t y = 0;
    bool vertical = false;
    bool extended = false;
    
    // Display state
    bool powerDown = false;
    bool blanked = true;
    bool inverse = false;
    uint8_t vop = 0;
    
    PartContextType type() const override { return PartContextType::PCD8544; }
};

// HD44780 - Character LCD (parallel/I2C)
struct HD44780Context : PartContext {
    uint8_t rows = 2;
    uint8_t cols = 16;
    uint8_t chars[80] = {0};  // Max 4x20 = 80 chars
    uint8_t cursor = 0;       // Knob handler cursor position
    PartContextType type() const override { return PartContextType::HD44780; }
};

// Servo - RC servo motor
struct ServoContext : PartContext {
    uint8_t current_angle = 90;  // 0-180 degrees
    bool pin_high = false;
    bool was_pin_high = false;
    uint32_t pulse_start_ms = 0;
    PartContextType type() const override { return PartContextType::SERVO; }
};

// Stepper - Stepper motor
struct StepperContext : PartContext {
    int16_t current_angle_deci_deg = 0;  // 0-3600 (0.1 degree steps)
    int32_t angle_accumulator = 0;        // Signed accumulator in deci-degrees
    // Pin state: 0=A+, 1=A-, 2=B+, 3=B-
    bool pin_state[4] = {false, false, false, false};
    int8_t prev_a = 0;
    int8_t prev_b = 0;
    double step_angle_deg = 7.5;
    PartContextType type() const override { return PartContextType::STEPPER; }
};

// StepperDriver - A4988/Driver
struct StepperDriverContext : PartContext {
    uint8_t coil_outputs[4] = {0, 0, 0, 0};  // 1A, 1B, 2A, 2B
    // TS state from a4988.ts
    int8_t fine_position = 0;            // 0..63 (1/16-step units)
    uint8_t active_microsteps = 1;
    uint8_t pending_microsteps = 1;
    bool previous_step = false;
    bool enabled = false;  // ENABLE pin defaults high (active low -> disabled)
    bool asleep = false;
    bool in_reset = false;
    // Pin state: 0=STEP, 1=DIR, 2=ENABLE, 3=RESET, 4=SLEEP, 5=MS1, 6=MS2, 7=MS3
    bool pin_state[8] = {false, false, false, false, false, false, false, false};
    PartContextType type() const override { return PartContextType::STEPPER_DRIVER; }
};

// ============================================================================
// Core Discrete Part Context Structures
// ============================================================================

// Power Supply - Adjustable voltage source with current limit
struct PowerSupplyContext : PartContext {
    double voltage = 5.0;           // Output voltage (V)
    double current_limit = 1.0;     // Current limit (A)
    double series_resistance = 0.01; // Internal series resistance (ohm)
    bool enabled = true;            // Enable pin state
    int32_t pos_net = -1;           // Positive terminal net
    int32_t neg_net = -1;           // Negative terminal net
    int32_t en_net = -1;            // Enable pin net
    int32_t vsource_idx = -1;       // Voltage source index in solver
    PartContextType type() const override { return PartContextType::POWER_SUPPLY; }
};

// Relay - Electromechanical relay with coil and contacts
struct RelayContext : PartContext {
    double coil_resistance = 100.0;    // Coil resistance (ohm)
    double coil_inductance = 0.1;      // Coil inductance (H)
    double contact_resistance = 0.05;  // Contact resistance when closed (ohm)
    double pull_in_voltage = 3.0;      // Voltage to pull in (V)
    double drop_out_voltage = 1.0;     // Voltage to drop out (V)
    bool coil_energized = false;       // Current coil state
    bool contacts_closed = false;      // Current contact state
    int32_t coil_pos_net = -1;         // Coil positive terminal
    int32_t coil_neg_net = -1;         // Coil negative terminal
    int32_t com_net = -1;              // Common contact
    int32_t no_net = -1;               // Normally open contact
    int32_t nc_net = -1;               // Normally closed contact
    int32_t coil_vsource_idx = -1;     // Coil voltage source index
    int32_t contact_g_idx = -1;        // Contact conductance index
    PartContextType type() const override { return PartContextType::RELAY; }
};

// Button - Debounced push button
struct ButtonContext : PartContext {
    bool pressed = false;              // Current pressed state
    bool last_state = false;           // Last raw state
    uint32_t debounce_ms = 10;         // Debounce time (ms)
    uint32_t last_change_time = 0;     // Last state change time
    bool pull_up = true;               // Internal pull-up enabled
    int32_t pin_net = -1;              // Button pin net
    int32_t gnd_net = -1;              // Ground net
    int32_t pullup_vsource_idx = -1;   // Pull-up voltage source
    int32_t switch_g_idx = -1;         // Switch conductance index
    PartContextType type() const override { return PartContextType::BUTTON; }
};

// Potentiometer - 3-terminal voltage divider
struct PotentiometerContext : PartContext {
    double max_resistance = 10000.0;   // Total resistance (ohm)
    double wiper_position = 0.5;       // Wiper position 0.0-1.0
    int32_t terminal_a_net = -1;       // Terminal A (one end)
    int32_t terminal_b_net = -1;       // Terminal B (other end)
    int32_t wiper_net = -1;            // Wiper terminal
    int32_t g_upper_idx = -1;          // Upper resistance conductance
    int32_t g_lower_idx = -1;          // Lower resistance conductance
    PartContextType type() const override { return PartContextType::POTENTIOMETER; }
};

// Shift Register 74HC595 - Serial-in, parallel-out
struct ShiftRegisterContext : PartContext {
    uint8_t shift_reg = 0x00;          // Shift register
    uint8_t storage_reg = 0x00;        // Storage register (output)
    uint8_t bit_count = 0;             // Bits shifted in current transfer
    bool ds_level = false;             // Current DS pin level, sampled on SHCP rise
    bool outputs_enabled = true;       // OE is active low, so this inverts it
    int32_t ds_net = -1;               // Data input (DS)
    int32_t shcp_net = -1;             // Shift clock (SHCP)
    int32_t stcp_net = -1;             // Storage clock (STCP)
    int32_t oe_net = -1;               // Output enable (OE, active low)
    int32_t q_net[8];                  // Output pins Q0-Q7
    int32_t vcc_net = -1;              // VCC
    int32_t gnd_net = -1;              // GND
    bool last_shcp = false;            // Last SHCP state for edge detection
    bool last_stcp = false;            // Last STCP state for edge detection
    PartContextType type() const override { return PartContextType::SHIFT_REGISTER; }
};

// RTC - DS1307/DS3231 Real-Time Clock (I2C)
struct RTCContext : PartContext {
    bool is_ds3231 = false;            // DS3231 vs DS1307
    uint8_t seconds = 0;
    uint8_t minutes = 0;
    uint8_t hours = 0;
    uint8_t day = 1;
    uint8_t date = 1;
    uint8_t month = 1;
    uint8_t year = 0;
    uint8_t control = 0x00;            // Control register
    uint8_t control2 = 0x00;           // DS3231 control2
    uint8_t status = 0x00;             // DS3231 status
    uint8_t aging = 0x00;              // DS3231 aging offset
    uint8_t temp_msb = 0x00;           // DS3231 temp MSB
    uint8_t temp_lsb = 0x00;           // DS3231 temp LSB
    uint8_t alarm1[4] = {0};           // DS3231 Alarm 1
    uint8_t alarm2[3] = {0};           // DS3231 Alarm 2
    uint8_t reg_ptr = 0x00;            // Current register pointer
    uint32_t last_update_ms = 0;       // Last time update
    // I2C
    int32_t sda_net = -1;
    int32_t scl_net = -1;
    int32_t vcc_net = -1;
    int32_t gnd_net = -1;
    PartContextType type() const override { return PartContextType::RTC; }
};

// HC-SR04 ultrasonic ranger
struct SonarContext : PartContext {
    double distance_cm = 100.0;        // knob-driven target distance (2..400 cm)
    uint16_t echo_us = 5800;           // echo pulse width; echo_us = round(distance_cm * 58)
    PartContextType type() const override { return PartContextType::SONAR; }
};

// DHT22 temperature/humidity sensor (knob-driven; one-wire timing not modelled)
struct DHTContext : PartContext {
    int32_t temp_milli_c = 25000;
    int32_t humidity_milli_pct = 50000;
    PartContextType type() const override { return PartContextType::DHT; }
};

// DS18B20 temperature sensor (knob-driven; one-wire timing not modelled)
struct DS18B20Context : PartContext {
    int32_t temp_milli_c = 22000;
    PartContextType type() const override { return PartContextType::DS18B20; }
};

// NeoPixel / addressable LED strip: pixel buffer driven by knob, up to 4 pixels
// tracked in the snapshot. Colours are clamped to 0-255 per channel.
struct NeoPixelContext : PartContext {
    int32_t pixel_count = 0;
    uint8_t pixels[24];  // 8 pixels * 3 channels (R,G,B); snapshot reads first 4
    PartContextType type() const override { return PartContextType::NEOPIXEL; }

    void set_pixel(int index, int r, int g, int b) {
        if (index < 0 || index >= 8) return;
        int base = index * 3;
        if (r >= 0) pixels[base] = static_cast<uint8_t>(std::clamp(r, 0, 255));
        if (g >= 0) pixels[base + 1] = static_cast<uint8_t>(std::clamp(g, 0, 255));
        if (b >= 0) pixels[base + 2] = static_cast<uint8_t>(std::clamp(b, 0, 255));
        if (index + 1 > pixel_count) pixel_count = static_cast<int32_t>(index + 1);
    }
};

// Scripted I2C slave: a register file whose read/write semantics are defined
// by a QuickJS script on the TS side. The C++ model stores written bytes in
// the register file and returns them on read, mirroring a script that echoes
// its registers.
struct ScriptedContext : PartContext {
    uint8_t reg_ptr = 0;           // I2C register pointer (control byte)
    uint8_t regs[256] = {0};       // Register file, one byte per address
    PartContextType type() const override { return PartContextType::SCRIPTED; }
};

// ============================================================================
// Global State
// ============================================================================

struct PartInstance {
    PartKind kind;
    uint32_t part_id;
    void* impl;
};

static std::unordered_map<uint32_t, PartInstance> g_parts;
static std::vector<PartInstance*> g_part_order;

static uint32_t g_i2c_sda_net = 0;
static uint32_t g_i2c_scl_net = 0;
static bool g_i2c_transmitting = false;
static uint8_t g_i2c_address = 0;
static uint8_t g_i2c_payload[32];
static uint8_t g_i2c_payload_len = 0;
static uint8_t g_i2c_read_buffer[32];
static uint8_t g_i2c_read_len = 0;
static uint32_t g_i2c_transaction_count = 0;

struct I2CDeviceImpl {
    uint8_t address;
    uint32_t part_id;
    bool (*receive)(void* ctx, uint8_t byte, bool is_control);
    void (*read)(void* ctx, uint8_t* buffer, uint8_t count, uint8_t* out_len);
    void* ctx;
};

static std::vector<I2CDeviceImpl> g_i2c_devices;

// SPI Bus State
static uint32_t g_spi_cs_net = 0;
static uint32_t g_spi_mosi_net = 0;
static uint32_t g_spi_miso_net = 0;
static uint32_t g_spi_sck_net = 0;
static bool g_spi_selected = false;
static bool g_spi_saw_byte = false;
static SpiByte g_spi_payload[256];
static uint16_t g_spi_payload_len = 0;
static uint32_t g_spi_transfer_count = 0;

// Track the last time part_stamp was called, for parts that need time
// but only receive it in part_stamp (e.g., servo pulse width)
static uint32_t g_last_stamp_time_ms = 0;

struct SPIPartImpl {
    uint32_t part_id;
    uint32_t cs_net;
    uint32_t dc_net;  // For displays
    // Function pointers
    void (*receive)(void* ctx, uint8_t byte, bool data_select, bool chip_selected);
    void (*latch)(void* ctx);  // Called when chip-select rises (end of transaction)
    // MISO read callback - returns byte to send back on MISO
    uint8_t (*read)(void* ctx, bool data_select, bool chip_selected);
    void* ctx;
};

static std::vector<SPIPartImpl> g_spi_parts;

// Part implementations - every context here is owned and freed by bus_reset()
static std::vector<PartContext*> g_part_impls;

// Returns the enum constant name for a PartKind, used to stamp snapshot
// identity. Covers every value declared in native/include/parts.h.
static const char* part_kind_name(PartKind k) {
    switch (k) {
        case PART_KIND_PASSIVE: return "PART_KIND_PASSIVE";
        case PART_KIND_MCU: return "PART_KIND_MCU";
        case PART_KIND_POWER_SUPPLY: return "PART_KIND_POWER_SUPPLY";
        case PART_KIND_RELAY: return "PART_KIND_RELAY";
        case PART_KIND_SERVO: return "PART_KIND_SERVO";
        case PART_KIND_STEPPER: return "PART_KIND_STEPPER";
        case PART_KIND_STEPPER_DRIVER: return "PART_KIND_STEPPER_DRIVER";
        case PART_KIND_SHIFT_REGISTER: return "PART_KIND_SHIFT_REGISTER";
        case PART_KIND_DISPLAY_I2C: return "PART_KIND_DISPLAY_I2C";
        case PART_KIND_DISPLAY_SPI: return "PART_KIND_DISPLAY_SPI";
        case PART_KIND_DISPLAY_7SEG: return "PART_KIND_DISPLAY_7SEG";
        case PART_KIND_DISPLAY_LCD: return "PART_KIND_DISPLAY_LCD";
        case PART_KIND_I2C_EXPANDER: return "PART_KIND_I2C_EXPANDER";
        case PART_KIND_PWM_DRIVER: return "PART_KIND_PWM_DRIVER";
        case PART_KIND_RTC: return "PART_KIND_RTC";
        case PART_KIND_SENSOR_I2C: return "PART_KIND_SENSOR_I2C";
        case PART_KIND_DAC: return "PART_KIND_DAC";
        case PART_KIND_ADC: return "PART_KIND_ADC";
        case PART_KIND_THERMOCOUPLE: return "PART_KIND_THERMOCOUPLE";
        case PART_KIND_RFID: return "PART_KIND_RFID";
        case PART_KIND_NEOPIXEL: return "PART_KIND_NEOPIXEL";
        case PART_KIND_SONAR: return "PART_KIND_SONAR";
        case PART_KIND_DHT: return "PART_KIND_DHT";
        case PART_KIND_DS18B20: return "PART_KIND_DS18B20";
        case PART_KIND_ENCODER: return "PART_KIND_ENCODER";
        case PART_KIND_BUTTON: return "PART_KIND_BUTTON";
        case PART_KIND_POTENTIOMETER: return "PART_KIND_POTENTIOMETER";
        case PART_KIND_REMOTE: return "PART_KIND_REMOTE";
        case PART_KIND_DIALER: return "PART_KIND_DIALER";
        case PART_KIND_SD_CARD: return "PART_KIND_SD_CARD";
        case PART_KIND_SCRIPTED: return "PART_KIND_SCRIPTED";
        case PART_KIND_UNKNOWN: return "PART_KIND_UNKNOWN";
        default: return "PART_KIND_UNKNOWN";
    }
}

// Explicitly construct global STL containers (needed when using -Wl,--no-entry
// with emcc or when using clang++ -nostdlib without automatic constructor calls).
extern "C" void init_globals() {
    new (&g_parts) std::unordered_map<uint32_t, PartInstance>();
    new (&g_part_order) std::vector<PartInstance*>();
    new (&g_i2c_devices) std::vector<I2CDeviceImpl>();
    new (&g_spi_parts) std::vector<SPIPartImpl>();
    new (&g_part_impls) std::vector<PartContext*>();
}

// ============================================================================
// Utility Functions
// ============================================================================

inline double voltageOfNet(const SolverSolution* sol, int32_t net) {
    if (net >= 0 && net < sol->sourceCount + 100) {  // Approximate node count
        return sol->voltages[net];
    }
    return 0.0;
}

// ============================================================================
// I2C Bus Implementation
// ============================================================================

extern "C" void i2c_bus_init(uint32_t sda_net, uint32_t scl_net) {
    g_i2c_sda_net = sda_net;
    g_i2c_scl_net = scl_net;
    g_i2c_transmitting = false;
    g_i2c_payload_len = 0;
    g_i2c_read_len = 0;
}

extern "C" void i2c_bus_begin(uint8_t sda, uint8_t scl) {
    // Validate pins match bus nets if needed
    g_i2c_transmitting = false;
    g_i2c_payload_len = 0;
    g_i2c_read_len = 0;
}

extern "C" void i2c_bus_begin_transmission(uint8_t address) {
    g_i2c_transmitting = true;
    g_i2c_address = address & 0x7f;
    g_i2c_payload_len = 0;
}

extern "C" void i2c_bus_write(uint8_t byte) {
    if (g_i2c_transmitting && g_i2c_payload_len < 32) {
        g_i2c_payload[g_i2c_payload_len++] = byte;
    }
}

extern "C" bool i2c_bus_end_transmission(void) {
    if (!g_i2c_transmitting) return false;
    g_i2c_transmitting = false;
    
    bool acknowledged = false;
    for (uint8_t i = 0; i < g_i2c_payload_len; ++i) {
        for (auto& dev : g_i2c_devices) {
            if (dev.address == g_i2c_address) {
                if (dev.receive(dev.ctx, g_i2c_payload[i], i == 0)) {
                    acknowledged = true;
                }
            }
        }
    }
    
    g_i2c_transaction_count++;
    return acknowledged;
}

extern "C" uint8_t i2c_bus_request_from(uint8_t address, uint8_t count) {
    for (auto& dev : g_i2c_devices) {
        if (dev.address == (address & 0x7f)) {
            dev.read(dev.ctx, g_i2c_read_buffer, count, &g_i2c_read_len);
            return g_i2c_read_len;
        }
    }
    g_i2c_read_len = 0;
    return 0;
}

extern "C" int8_t i2c_bus_read(void) {
    if (g_i2c_read_len > 0) {
        return g_i2c_read_buffer[--g_i2c_read_len];
    }
    return -1;
}

extern "C" uint8_t i2c_bus_available(void) {
    return g_i2c_read_len;
}

extern "C" void* i2c_bus_register_device(uint8_t address, uint32_t part_id) {
    I2CDeviceImpl impl;
    impl.address = address & 0x7f;
    impl.part_id = part_id;
    impl.receive = nullptr;
    impl.read = nullptr;
    impl.ctx = nullptr;
    g_i2c_devices.push_back(impl);
    return &g_i2c_devices.back();
}

extern "C" bool i2c_device_receive(void* handle, uint8_t byte, bool is_control_byte) {
    I2CDeviceImpl* dev = static_cast<I2CDeviceImpl*>(handle);
    if (dev->receive) return dev->receive(dev->ctx, byte, is_control_byte);
    return false;
}

extern "C" uint8_t i2c_device_read(void* handle, uint8_t* buffer, uint8_t count) {
    I2CDeviceImpl* dev = static_cast<I2CDeviceImpl*>(handle);
    if (dev->read) {
        uint8_t out_len = 0;
        dev->read(dev->ctx, buffer, count, &out_len);
        return out_len;
    }
    return 0;
}

// ============================================================================
// SPI Bus Implementation
// ============================================================================

extern "C" void spi_bus_init(uint32_t cs_net, uint32_t mosi_net, uint32_t miso_net, uint32_t sck_net) {
    g_spi_cs_net = cs_net;
    g_spi_mosi_net = mosi_net;
    g_spi_miso_net = miso_net;
    g_spi_sck_net = sck_net;
    g_spi_selected = false;
    g_spi_saw_byte = false;
    g_spi_payload_len = 0;
}

extern "C" void spi_bus_begin(void) {
    g_spi_selected = true;
    g_spi_saw_byte = false;
    g_spi_payload_len = 0;
}

extern "C" void spi_bus_end(void) {
    // Call latch on all SPI parts before clearing selection
    for (auto& part : g_spi_parts) {
        if (part.latch) {
            part.latch(part.ctx);
        }
    }
    g_spi_selected = false;
    g_spi_saw_byte = false;
    g_spi_payload_len = 0;
}

extern "C" uint8_t spi_bus_transfer(uint8_t byte, bool data_select, bool chip_selected) {
    // Nothing is clocked onto the bus while no transaction is open, so a call
    // here is not a transfer. g_spi_transfer_count is the same counter
    // bus_get_state() reports and bus_reset() clears.
    if (!g_spi_selected) return 0;

    g_spi_transfer_count++;

    if (g_spi_payload_len < 256) {
        g_spi_payload[g_spi_payload_len++] = {byte, data_select};
    }
    
    // Deliver to registered SPI parts
    for (auto& part : g_spi_parts) {
        if (part.receive) {
            part.receive(part.ctx, byte, data_select, chip_selected);
        }
    }
    
    // Return MISO data from the first part that has a read callback
    for (auto& part : g_spi_parts) {
        if (part.read && chip_selected) {
            return part.read(part.ctx, data_select, chip_selected);
        }
    }
    return 0;
}

// ============================================================================
// I2C Device Callback Implementations
// ============================================================================

// PCF8574 callbacks
static bool pcf8574_receive(void* ctx, uint8_t byte, bool is_control) {
    PCF8574Context* dev = static_cast<PCF8574Context*>(ctx);
    if (is_control) {
        // PCF8574 has no register pointer - first byte after address is data
        dev->output_reg = byte;
        return true;
    }
    dev->output_reg = byte;
    return true;
}

static void pcf8574_read(void* ctx, uint8_t* buffer, uint8_t count, uint8_t* out_len) {
    PCF8574Context* dev = static_cast<PCF8574Context*>(ctx);
    // Reading returns the input latch (pin state)
    buffer[0] = dev->input_reg;
    *out_len = 1;
}

// MCP23017 callbacks
static bool mcp23017_receive(void* ctx, uint8_t byte, bool is_control) {
    MCP23017Context* dev = static_cast<MCP23017Context*>(ctx);
    if (is_control) {
        dev->reg_ptr = byte & 0x1F;
        return true;
    }
    
    uint8_t reg = dev->reg_ptr;
    switch (reg) {
        case 0x00: dev->iodira = byte; break;
        case 0x01: dev->iodirb = byte; break;
        case 0x02: dev->ipola = byte; break;
        case 0x03: dev->ipolb = byte; break;
        case 0x04: dev->gpinta = byte; break;
        case 0x05: dev->gpintb = byte; break;
        case 0x06: dev->defvala = byte; break;
        case 0x07: dev->defvalb = byte; break;
        case 0x08: dev->intcona = byte; break;
        case 0x09: dev->intconb = byte; break;
        case 0x0A: dev->iocona = byte; dev->seqop = (byte & 0x20) != 0; break;
        case 0x0B: dev->ioconb = byte; break;
        case 0x0C: dev->gppua = byte; break;
        case 0x0D: dev->gppub = byte; break;
        case 0x0E: break;  // Read-only
        case 0x0F: break;  // Read-only
        case 0x10: break;  // Read-only
        case 0x11: break;  // Read-only
        case 0x12: dev->gpioa = byte; dev->olata = byte; break;
        case 0x13: dev->gpiob = byte; dev->olatb = byte; break;
        case 0x14: dev->olata = byte; break;
        case 0x15: dev->olatb = byte; break;
    }
    
    // SEQOP=0 (default) means sequential operation ENABLED (auto-increment).
// seqop flag is true when SEQOP=1 (sequential disabled).
// So we increment when seqop is false (sequential enabled).
    if (!dev->seqop) {
        dev->reg_ptr = (dev->reg_ptr + 1) & 0x1F;
    }
    return true;
}

static void mcp23017_read(void* ctx, uint8_t* buffer, uint8_t count, uint8_t* out_len) {
    MCP23017Context* dev = static_cast<MCP23017Context*>(ctx);
    uint8_t len = std::min<uint8_t>(count, 32);
    for (uint8_t i = 0; i < len; ++i) {
        uint8_t reg = (dev->reg_ptr + i) & 0x1F;
        switch (reg) {
            case 0x00: buffer[i] = dev->iodira; break;
            case 0x01: buffer[i] = dev->iodirb; break;
            case 0x02: buffer[i] = dev->ipola; break;
            case 0x03: buffer[i] = dev->ipolb; break;
            case 0x04: buffer[i] = dev->gpinta; break;
            case 0x05: buffer[i] = dev->gpintb; break;
            case 0x06: buffer[i] = dev->defvala; break;
            case 0x07: buffer[i] = dev->defvalb; break;
            case 0x08: buffer[i] = dev->intcona; break;
            case 0x09: buffer[i] = dev->intconb; break;
            case 0x0A: buffer[i] = dev->iocona; break;
            case 0x0B: buffer[i] = dev->ioconb; break;
            case 0x0C: buffer[i] = dev->gppua; break;
            case 0x0D: buffer[i] = dev->gppub; break;
            case 0x0E: buffer[i] = dev->intfa; break;
            case 0x0F: buffer[i] = dev->intfb; break;
            case 0x10: buffer[i] = dev->intcapa; break;
            case 0x11: buffer[i] = dev->intcapb; break;
            case 0x12: buffer[i] = dev->gpioa; break;
            case 0x13: buffer[i] = dev->gpiob; break;
            case 0x14: buffer[i] = dev->olata; break;
            case 0x15: buffer[i] = dev->olatb; break;
            default: buffer[i] = 0x00;
        }
    }
    *out_len = len;
    if (dev->seqop) {
        dev->reg_ptr = (dev->reg_ptr + len) & 0x1F;
    }
}

// PCA9685 callbacks
static bool pca9685_receive(void* ctx, uint8_t byte, bool is_control) {
    PCA9685Context* dev = static_cast<PCA9685Context*>(ctx);
    if (is_control) {
        dev->reg_ptr = byte;
        dev->auto_increment = (dev->mode1 & 0x20) != 0;  // RE-derive per transaction, per TS
        return true;
    }
    
    uint8_t reg = dev->reg_ptr;
    switch (reg) {
        case 0x00: dev->mode1 = byte; break;  // auto_increment only set on control byte, per TS
        case 0x01: dev->mode2 = byte; break;
        case 0xFE: {
            // Datasheet: prescaler only writable while oscillator asleep (MODE1 SLEEP bit)
            if (dev->mode1 & 0x10) dev->prescale = byte;
            break;
        }
        default:
            if (reg >= 0x06 && reg <= 0x45) {
                uint8_t idx = (reg - 0x06) / 4;
                uint8_t offset = (reg - 0x06) % 4;
                if (idx < 16) {
                    switch (offset) {
                        case 0: dev->led_on_l[idx] = byte; break;
                        case 1: dev->led_on_h[idx] = byte; break;
                        case 2: dev->led_off_l[idx] = byte; break;
                        case 3: dev->led_off_h[idx] = byte; break;
                    }
                }
            } else if (reg == 0xFA) { dev->all_led_on_l = byte; }
            else if (reg == 0xFB) { dev->all_led_on_h = byte; }
            else if (reg == 0xFC) { dev->all_led_off_l = byte; }
            else if (reg == 0xFD) { dev->all_led_off_h = byte; }
    }

    // ALL_LED fan-out: datasheet says writing ALL_LED* mirrors into all 16 channels
    if (reg >= 0xFA && reg <= 0xFD) {
        uint8_t offset = reg - 0xFA;
        for (int ch = 0; ch < 16; ch++) {
            switch (offset) {
                case 0: dev->led_on_l[ch] = byte; break;
                case 1: dev->led_on_h[ch] = byte; break;
                case 2: dev->led_off_l[ch] = byte; break;
                case 3: dev->led_off_h[ch] = byte; break;
            }
        }
    }

    if (dev->auto_increment) {
        dev->reg_ptr++;
    }
    return true;
}

static void pca9685_read(void* ctx, uint8_t* buffer, uint8_t count, uint8_t* out_len) {
    PCA9685Context* dev = static_cast<PCA9685Context*>(ctx);
    uint8_t len = std::min<uint8_t>(count, 32);
    for (uint8_t i = 0; i < len; ++i) {
        uint8_t reg = dev->reg_ptr + i;
        switch (reg) {
            case 0x00: buffer[i] = dev->mode1; break;
            case 0x01: buffer[i] = dev->mode2; break;
            case 0xFE: buffer[i] = dev->prescale; break;
            default:
                if (reg >= 0x06 && reg <= 0x45) {
                    uint8_t idx = (reg - 0x06) / 4;
                    uint8_t offset = (reg - 0x06) % 4;
                    if (idx < 16) {
                        switch (offset) {
                            case 0: buffer[i] = dev->led_on_l[idx]; break;
                            case 1: buffer[i] = dev->led_on_h[idx]; break;
                            case 2: buffer[i] = dev->led_off_l[idx]; break;
                            case 3: buffer[i] = dev->led_off_h[idx]; break;
                        }
                    } else { buffer[i] = 0; }
                } else if (reg == 0xFA) { buffer[i] = dev->all_led_on_l; }
                else if (reg == 0xFB) { buffer[i] = dev->all_led_on_h; }
                else if (reg == 0xFC) { buffer[i] = dev->all_led_off_l; }
                else if (reg == 0xFD) { buffer[i] = dev->all_led_off_h; }
                else { buffer[i] = 0; }
        }
    }
    *out_len = len;
    if (dev->auto_increment) {
        dev->reg_ptr += len;
    }
}

// SSD1306 callbacks
static bool ssd1306_receive(void* ctx, uint8_t byte, bool is_control) {
    SSD1306Context* dev = static_cast<SSD1306Context*>(ctx);
    if (is_control) {
        // Control byte: ONLY determines data stream mode (TS parity).
        // Bit 6 set = data stream, clear = command stream.
        // Do NOT process as command here — TS receive() returns immediately.
        dev->expecting_data = (byte & 0x40) != 0;
        return true;
    }
    
    if (dev->expecting_data) {
        uint16_t page = dev->cursor_page;
        uint16_t col = dev->cursor_column;
        size_t idx = page * dev->width + col;
        if (idx < dev->framebuffer.size()) {
            dev->framebuffer[idx] = byte;
        }
        // Advance cursor per horizontal addressing mode (0x00)
        dev->cursor_column++;
        if (dev->cursor_column > dev->column_end) {
            dev->cursor_column = dev->column_start;
            dev->cursor_page++;
            if (dev->cursor_page > dev->page_end) {
                dev->cursor_page = dev->page_start;
            }
        }
        return true;
    }
    
    // Command processing (when not in data stream and no pending args)
    if (dev->expected_args == 0) {
        dev->reg_ptr = byte;
        dev->cmd_arg_count = 0;
        // Single-byte commands
        if (byte == 0xAE) { dev->display_on = 0; return true; }
        if (byte == 0xAF) { dev->display_on = 1; return true; }
        if (byte == 0xA0) { dev->segmentRemap = false; return true; }
        if (byte == 0xA1) { dev->segmentRemap = true; return true; }
        if (byte == 0xA4 || byte == 0xA6) { return true; }
        if (byte == 0xC8) { dev->com_scan_dir = 0xC8; return true; }
        if (byte == 0x40) { return true; }  // display start line (ignored)
        if (byte >= 0xB0 && byte <= 0xB7) {
            dev->cursor_page = byte & 0x07;
            return true;
        }
        if (byte <= 0x0F) {
            dev->cursor_column = (dev->cursor_column & 0xF0) | (byte & 0x0F);
            return true;
        }
        if (byte >= 0x10 && byte <= 0x1F) {
            dev->cursor_column = (dev->cursor_column & 0x0F) | ((byte & 0x0F) << 4);
            return true;
        }
        // Multi-argument commands
        if (byte == 0x20) { dev->expected_args = 1; return true; }
        if (byte == 0x21) { dev->expected_args = 2; return true; }
        if (byte == 0x22) { dev->expected_args = 2; return true; }
        if (byte == 0xAD || byte == 0x81 || byte == 0x8D || byte == 0xA8 || byte == 0xD3 || byte == 0xD5 || byte == 0xD8 || byte == 0xD9 || byte == 0xDA || byte == 0xDB) {
            dev->expected_args = 1;
            return true;
        }
        if (byte == 0x15 || byte == 0x16) { dev->expected_args = 1; return true; }
        // Unknown command: ignore
        return true;
    }
    
    if (dev->expected_args > 0) {
        if (dev->cmd_arg_count < 16) {
            dev->cmd_args[dev->cmd_arg_count++] = byte;
            dev->expected_args--;
        }
        if (dev->expected_args == 0) {
            switch (dev->reg_ptr) {
                case 0x20: if (dev->cmd_arg_count >= 1) dev->memory_mode = dev->cmd_args[0] & 0x03; break;
                case 0x21: if (dev->cmd_arg_count >= 2) { dev->column_start = dev->cmd_args[0]; dev->column_end = dev->cmd_args[1]; } break;
                case 0x22: if (dev->cmd_arg_count >= 2) { dev->page_start = dev->cmd_args[0]; dev->page_end = dev->cmd_args[1]; } break;
                case 0xAD: if (dev->cmd_arg_count >= 1) dev->charge_pump = dev->cmd_args[0]; break;
                case 0x81: if (dev->cmd_arg_count >= 1) dev->contrast = dev->cmd_args[0]; break;
                case 0x8D: if (dev->cmd_arg_count >= 1) dev->charge_pump = dev->cmd_args[0]; break;
                case 0xA8: if (dev->cmd_arg_count >= 1) dev->pages = dev->cmd_args[0]; break;
                case 0xC8: if (dev->cmd_arg_count >= 1) dev->com_scan_dir = dev->cmd_args[0]; break;
                case 0xD3: if (dev->cmd_arg_count >= 1) dev->display_offset = dev->cmd_args[0]; break;
                case 0xD5: if (dev->cmd_arg_count >= 1) dev->display_clock_div = dev->cmd_args[0]; break;
                case 0xD8: if (dev->cmd_arg_count >= 1) dev->com_pins = dev->cmd_args[0]; break;
                case 0xD9: if (dev->cmd_arg_count >= 1) dev->precharge = dev->cmd_args[0]; break;
                case 0xDA: if (dev->cmd_arg_count >= 1) dev->com_pins = dev->cmd_args[0]; break;
                case 0xDB: if (dev->cmd_arg_count >= 1) dev->vcom_detect = dev->cmd_args[0]; break;
                case 0x15: if (dev->cmd_arg_count >= 1) { dev->column_start = dev->cmd_args[0]; dev->cursor_column = dev->column_start; } break;
                case 0x16: if (dev->cmd_arg_count >= 1) { dev->page_start = dev->cmd_args[0]; dev->cursor_page = dev->page_start; } break;
            }
        }
        return true;
    }
    
    switch (dev->reg_ptr) {
        case 0x00: dev->column_start = (dev->column_start & 0xF0) | (byte & 0x0F); dev->cursor_column = dev->column_start; break;
        case 0x10: dev->column_start = (dev->column_start & 0x0F) | ((byte & 0x0F) << 4); dev->cursor_column = dev->column_start; break;
        case 0xB0: case 0xB1: case 0xB2: case 0xB3:
        case 0xB4: case 0xB5: case 0xB6: case 0xB7:
            dev->page_start = dev->reg_ptr & 0x07;
            dev->cursor_page = dev->page_start;
            break;
    }
    return true;
}

static void ssd1306_read(void* ctx, uint8_t* buffer, uint8_t count, uint8_t* out_len) {
    *out_len = 0;
}

// ADS1115 callbacks
static bool ads1115_receive(void* ctx, uint8_t byte, bool is_control) {
    ADS1115Context* dev = static_cast<ADS1115Context*>(ctx);
    if (is_control) {
        dev->reg_ptr = byte & 0x03;
        dev->have_first_byte = false;
        return true;
    }
    
    if (!dev->have_first_byte) {
        dev->write_first_byte = byte;
        dev->have_first_byte = true;
        return true;
    }
    
    uint16_t value = (static_cast<uint16_t>(dev->write_first_byte) << 8) | byte;
    dev->have_first_byte = false;
    
    switch (dev->reg_ptr) {
        case 0x01:
            dev->config = value;
            if (value & 0x8000) {
                dev->conversion_ready = true;
                uint16_t mux = (value >> 12) & 0x07;
                uint16_t pga = (value >> 9) & 0x07;
                double fsr = 6.144;
                if (pga == 0) fsr = 6.144;
                else if (pga == 1) fsr = 4.096;
                else if (pga == 2) fsr = 2.048;
                else if (pga == 3) fsr = 1.024;
                else if (pga == 4) fsr = 0.512;
                else if (pga == 5) fsr = 0.256;
                
                int channel = 0;
                if (mux == 0x00) channel = 0;
                else if (mux == 0x01) channel = 1;
                else if (mux == 0x02) channel = 2;
                else if (mux == 0x03) channel = 3;
                else if (mux == 0x04) channel = 0;
                else if (mux == 0x05) channel = 1;
                else if (mux == 0x06) channel = 2;
                else if (mux == 0x07) channel = 3;
                
                double vin = dev->input_voltage[channel];
                int16_t raw = static_cast<int16_t>((vin / fsr) * 32767.0);
                dev->conversion = static_cast<uint16_t>(raw);
            }
            break;
        case 0x02: dev->lo_thresh = value; break;
        case 0x03: dev->hi_thresh = value; break;
    }
    return true;
}

static void ads1115_read(void* ctx, uint8_t* buffer, uint8_t count, uint8_t* out_len) {
    ADS1115Context* dev = static_cast<ADS1115Context*>(ctx);
    uint8_t len = std::min<uint8_t>(count, 2);
    uint16_t value = 0;
    
    switch (dev->reg_ptr) {
        case 0x00: value = dev->conversion; break;
        case 0x01: value = dev->config; break;
        case 0x02: value = dev->lo_thresh; break;
        case 0x03: value = dev->hi_thresh; break;
    }
    
    if (len >= 2) {
        buffer[0] = static_cast<uint8_t>(value >> 8);
        buffer[1] = static_cast<uint8_t>(value & 0xFF);
        *out_len = 2;
    } else {
        buffer[0] = static_cast<uint8_t>(value >> 8);
        *out_len = 1;
    }
}

// MCP4725 callbacks
static bool mcp4725_receive(void* ctx, uint8_t byte, bool is_control) {
    MCP4725Context* dev = static_cast<MCP4725Context*>(ctx);
    if (is_control) {
        dev->reg_ptr = byte;
        dev->write_count = 0;
        return true;
    }

    if (dev->reg_ptr == 0x40 || dev->reg_ptr == 0x60) {
        if (dev->write_count < 3) {
            dev->write_buffer[dev->write_count++] = byte;
        }
        if (dev->write_count >= 2) {
            dev->dac_value = (static_cast<uint16_t>(dev->write_buffer[0]) << 4) | (dev->write_buffer[1] >> 4);
            dev->power_down = (dev->write_buffer[1] >> 1) & 0x03;
            if (dev->write_count == 3) {
                dev->eeprom_write = (dev->write_buffer[2] & 0x80) != 0;
            }
        }
    }
    return true;
}

static void mcp4725_read(void* ctx, uint8_t* buffer, uint8_t count, uint8_t* out_len) {
    MCP4725Context* dev = static_cast<MCP4725Context*>(ctx);
    uint8_t len = std::min<uint8_t>(count, 3);
    buffer[0] = (dev->dac_value >> 4) & 0xFF;
    buffer[1] = (dev->dac_value << 4) | (dev->power_down << 1) | 0x01;
    buffer[2] = 0x00;
    *out_len = len;
}

// BH1750 - Light sensor I2C callbacks
static bool bh1750_receive(void* ctx, uint8_t byte, bool is_control) {
    BH1750Context* dev = static_cast<BH1750Context*>(ctx);
    if (is_control) return true;
    
    uint8_t cmd = byte & 0xFF;
    switch (cmd) {
        case 0x00: dev->powered = false; dev->mode = 0; dev->conversion_ready = false; break;
        case 0x01: dev->powered = true; dev->mode = 0; break;
        case 0x07: dev->counts = 0; dev->powered = false; dev->mode = 0; dev->conversion_ready = false; break;
        case 0x10: dev->powered = true; dev->mode = 1; dev->resolution = 0; dev->conversion_ready = true; break;
        case 0x11: dev->powered = true; dev->mode = 1; dev->resolution = 1; dev->conversion_ready = true; break;
        case 0x13: dev->powered = true; dev->mode = 1; dev->resolution = 2; dev->conversion_ready = true; break;
        case 0x20: dev->powered = true; dev->mode = 2; dev->resolution = 0; dev->conversion_ready = true; break;
        case 0x21: dev->powered = true; dev->mode = 2; dev->resolution = 1; dev->conversion_ready = true; break;
        case 0x23: dev->powered = true; dev->mode = 2; dev->resolution = 2; dev->conversion_ready = true; break;
        default: break;
    }
    return true;
}

static void bh1750_read(void* ctx, uint8_t* buffer, uint8_t count, uint8_t* out_len) {
    BH1750Context* dev = static_cast<BH1750Context*>(ctx);
    uint8_t len = std::min<uint8_t>(count, 2);
    
    if (dev->mode == 1 && dev->powered) dev->conversion_ready = true;
    
    if (dev->conversion_ready) {
        buffer[0] = static_cast<uint8_t>(dev->counts >> 8);
        buffer[1] = static_cast<uint8_t>(dev->counts & 0xFF);
        *out_len = 2;
    } else {
        buffer[0] = 0xFF; buffer[1] = 0xFF;
        *out_len = 2;
    }
}

// BMP180 - Pressure/temperature sensor I2C callbacks
static bool bmp180_receive(void* ctx, uint8_t byte, bool is_control) {
    BMP180Context* dev = static_cast<BMP180Context*>(ctx);
    if (is_control) { dev->pointer = byte & 0xFF; return true; }
    
    uint8_t reg = dev->pointer;
    dev->pointer = (dev->pointer + 1) & 0xFF;
    
    if (reg == 0xF4) {
        if (byte == 0x2E) { dev->holding = 0; }
        else if ((byte & 0x1F) == 0x34) { dev->oss = (byte >> 6) & 0x03; dev->holding = 1; }
    } else if (reg == 0xE0 && byte == 0xB6) {
        dev->oss = 0; dev->holding = 0; dev->pointer = 0xF6;
    }
    return true;
}

static void bmp180_read(void* ctx, uint8_t* buffer, uint8_t count, uint8_t* out_len) {
    BMP180Context* dev = static_cast<BMP180Context*>(ctx);
    if (dev->stale) {
        dev->raw_temperature = 27898; dev->raw_pressure = 101325; dev->stale = false;
    }
    
    if (dev->pointer == 0xD0) { buffer[0] = 0x55; *out_len = 1; return; }
    if (dev->pointer >= 0xAA && dev->pointer < 0xC0) {
        uint8_t idx = dev->pointer - 0xAA;
        const int16_t* cals = &dev->ac1;
        int16_t val = cals[idx / 2];
        buffer[0] = (idx % 2 == 0) ? (val >> 8) & 0xFF : val & 0xFF;
        *out_len = 1; return;
    }
    if (dev->pointer >= 0xF6 && dev->pointer <= 0xF8) {
        if (dev->holding == 0) {
            if (dev->pointer == 0xF6) buffer[0] = (dev->raw_temperature >> 8) & 0xFF;
            else if (dev->pointer == 0xF7) buffer[0] = dev->raw_temperature & 0xFF;
            else buffer[0] = 0;
        } else {
            uint32_t raw = dev->raw_pressure << (8 - dev->oss);
            if (dev->pointer == 0xF6) buffer[0] = (raw >> 16) & 0xFF;
            else if (dev->pointer == 0xF7) buffer[0] = (raw >> 8) & 0xFF;
            else buffer[0] = raw & 0xFF;
        }
        *out_len = 1; return;
    }
    buffer[0] = 0; *out_len = 1;
}

// SHT31 - Temperature/humidity sensor I2C callbacks
static bool sht31_receive(void* ctx, uint8_t byte, bool is_control) {
    SHT31Context* dev = static_cast<SHT31Context*>(ctx);
    if (is_control || !dev->have_command_high) {
        dev->command_high = byte; dev->have_command_high = true; return true;
    }
    
    uint16_t cmd = (dev->command_high << 8) | byte;
    dev->have_command_high = false;
    
    if (cmd == 0x2400 || cmd == 0x240B || cmd == 0x2416 || cmd == 0x2C06 || cmd == 0x2C0D || cmd == 0x2C10) {
        int celsius = (dev->knob_temp_milli_c + 500) / 1000 + (dev->heater ? 1 : 0);  // milli-Celsius to Celsius, rounded
        dev->raw_temperature = static_cast<uint16_t>(((celsius + 45) * 65535 + 87) / 175);  // rounding to match TS Math.round
        int humidity = (dev->knob_humidity_milli_pct + 500) / 1000;  // milli-percent to percent, rounded
        dev->raw_humidity = static_cast<uint16_t>((humidity * 65535 + 50) / 100);  // rounding to match TS Math.round
    } else if (cmd == 0x2737) { dev->raw_temperature = 0; dev->raw_humidity = 0; dev->heater = false; dev->have_command_high = false; }
    else if (cmd == 0x30A2) { dev->heater = true; }
    else if (cmd == 0x306D) { dev->heater = false; }
    return true;
}

static void sht31_read(void* ctx, uint8_t* buffer, uint8_t count, uint8_t* out_len) {
    SHT31Context* dev = static_cast<SHT31Context*>(ctx);
    uint8_t len = std::min<uint8_t>(count, 6);
    
    if (dev->raw_temperature == 0 && dev->raw_humidity == 0) {
        for (int i = 0; i < 6; i++) buffer[i] = 0xFF;
        *out_len = 6; return;
    }
    
    auto crc8 = [](const uint8_t* data, int len) {
        uint8_t crc = 0xFF;
        for (int i = 0; i < len; i++) {
            crc ^= data[i];
            for (int bit = 0; bit < 8; bit++) {
                crc = (crc & 0x80) ? ((crc << 1) ^ 0x31) & 0xFF : (crc << 1) & 0xFF;
            }
        }
        return crc;
    };
    
    uint8_t t_bytes[2] = {static_cast<uint8_t>(dev->raw_temperature >> 8), static_cast<uint8_t>(dev->raw_temperature & 0xFF)};
    uint8_t h_bytes[2] = {static_cast<uint8_t>(dev->raw_humidity >> 8), static_cast<uint8_t>(dev->raw_humidity & 0xFF)};
    uint8_t t_crc = crc8(t_bytes, 2);
    uint8_t h_crc = crc8(h_bytes, 2);
    
    buffer[0] = t_bytes[0]; buffer[1] = t_bytes[1]; buffer[2] = t_crc;
    buffer[3] = h_bytes[0]; buffer[4] = h_bytes[1]; buffer[5] = h_crc;
    *out_len = 6;
}

// TMP102 - Temperature sensor I2C callbacks
static bool tmp102_receive(void* ctx, uint8_t byte, bool is_control) {
    TMP102Context* dev = static_cast<TMP102Context*>(ctx);
    if (is_control) { dev->pointer = byte & 0x03; dev->byte_index = 0; return true; }
    if (dev->pointer == 0x00) return true;
    
    uint16_t current = (dev->pointer == 0x01) ? dev->config : (dev->pointer == 0x02) ? dev->t_low : dev->t_high;
    uint16_t value = (dev->byte_index == 0) ? (static_cast<uint16_t>(byte) << 8) | (current & 0xFF) : (current & 0xFF00) | byte;
    
    if (dev->pointer == 0x01) dev->config = value & 0x7FFF;
    else if (dev->pointer == 0x02) dev->t_low = value;
    else if (dev->pointer == 0x03) dev->t_high = value;
    
    dev->byte_index = 1;
    return true;
}

static void tmp102_read(void* ctx, uint8_t* buffer, uint8_t count, uint8_t* out_len) {
    TMP102Context* dev = static_cast<TMP102Context*>(ctx);
    uint8_t len = std::min<uint8_t>(count, 2);
    
    int16_t temp_counts = 336;
    if (dev->pointer == 0x00) {
        int celsius = 21;
        temp_counts = static_cast<int16_t>(celsius / 0.0625);
    }
    
    uint16_t word;
    if (dev->pointer == 0x00) word = static_cast<uint16_t>((temp_counts & 0x0FFF) << 4);
    else if (dev->pointer == 0x01) word = dev->config;
    else if (dev->pointer == 0x02) word = dev->t_low;
    else word = dev->t_high;
    
    buffer[0] = (word >> 8) & 0xFF; buffer[1] = word & 0xFF;
    *out_len = len;
}

// Scripted I2C slave callbacks
static bool scripted_receive(void* ctx, uint8_t byte, bool is_control) {
    ScriptedContext* dev = static_cast<ScriptedContext*>(ctx);
    if (is_control) {
        dev->reg_ptr = byte;
        return true;
    }
    // Write data byte to current register
    dev->regs[dev->reg_ptr] = byte;
    return true;
}

static void scripted_read(void* ctx, uint8_t* buffer, uint8_t count, uint8_t* out_len) {
    ScriptedContext* dev = static_cast<ScriptedContext*>(ctx);
    uint8_t len = std::min<uint8_t>(count, 255);
    for (uint8_t i = 0; i < len; ++i) {
        buffer[i] = dev->regs[dev->reg_ptr];
    }
    *out_len = len;
}

// EEPROM 24LC256 I2C callbacks
static bool eeprom24lc256_receive(void* ctx, uint8_t byte, bool is_control) {
    EEPROM24LC256Context* dev = static_cast<EEPROM24LC256Context*>(ctx);
    if (is_control) { dev->high = byte; dev->address_bytes = 1; return true; }
    if (dev->address_bytes == 1) {
        dev->pointer = (static_cast<uint16_t>(dev->high) << 8) | byte;
        dev->address_bytes = 2; return true;
    }
    dev->bytes[dev->pointer % EEPROM24LC256Context::EEPROM_SIZE] = byte & 0xFF;
    uint32_t page = dev->pointer - (dev->pointer % EEPROM24LC256Context::EEPROM_PAGE_SIZE);
    dev->pointer = page + ((dev->pointer + 1) % EEPROM24LC256Context::EEPROM_PAGE_SIZE);
    return true;
}

static void eeprom24lc256_read(void* ctx, uint8_t* buffer, uint8_t count, uint8_t* out_len) {
    EEPROM24LC256Context* dev = static_cast<EEPROM24LC256Context*>(ctx);
    uint8_t len = std::min<uint8_t>(count, 255);  // Max readable in one go
    
    for (int i = 0; i < len; i++) {
        buffer[i] = dev->bytes[(dev->pointer + i) % EEPROM24LC256Context::EEPROM_SIZE];
    }
    *out_len = len;
}

// ============================================================================
// SPI Device Callback Implementations
// ============================================================================

// Shift595 (74HC595) SPI receive - shifts in a byte (8 bits at once, like 8 clock edges)
static void spi_shift_register_receive(void* ctx, uint8_t byte, bool data_select, bool chip_selected) {
    (void)data_select;
    if (!chip_selected) return;
    ShiftRegisterContext* dev = static_cast<ShiftRegisterContext*>(ctx);
    // Shift in 8 bits, MSB first (like the TS implementation)
    for (int edge = 0; edge < 8; edge++) {
        const bool arriving = (byte & 0x80) != 0;
        dev->shift_reg = static_cast<uint8_t>((dev->shift_reg << 1) | (arriving ? 1 : 0));
        byte = static_cast<uint8_t>(byte << 1);
    }
    dev->bit_count = 8;
}

static void spi_max6675_receive(void* ctx, uint8_t byte, bool data_select, bool chip_selected) {
    // MAX6675 is read-only over SPI; MOSI bytes are ignored.
    // CS deassertion is modelled by bus_reset (resets ctx via part_reset).
    (void)ctx; (void)byte; (void)data_select; (void)chip_selected;
}

static uint8_t spi_max6675_read(void* ctx, bool data_select, bool chip_selected) {
    (void)data_select; (void)chip_selected;
    MAX6675Context* dev = static_cast<MAX6675Context*>(ctx);
    // MAX6675 returns 16-bit value over two SPI transfers
    // First transfer: upper 8 bits of temperature (raw >> 5)
    // Second transfer: lower 5 bits of temp + 3 bits fault/status ((raw & 0x1F) << 3)
    uint8_t byte = (dev->sent == 0)
        ? static_cast<uint8_t>(dev->temp_quarter_deg >> 5)
        : static_cast<uint8_t>((dev->temp_quarter_deg & 0x1F) << 3);
    if (dev->sent > 0 && dev->fault) byte |= 0x01;
    dev->sent += 1;
    return byte;
}

static void spi_mfrc522_receive(void* ctx, uint8_t byte, bool data_select, bool chip_selected) {
    MFRC522Context* dev = static_cast<MFRC522Context*>(ctx);
    if (!chip_selected) return;
    
    if (data_select) {
        if (dev->reg_ptr == 0x09) {
            if (dev->fifo_level < 64) {
                dev->fifo[dev->fifo_level++] = byte;
            }
        } else {
            dev->reg_ptr = byte;
        }
    } else {
        dev->command = byte;
        switch (byte) {
            case 0x0F: dev->state = MFRC522Context::CALCULATING_CRC; break;
            case 0x0C: dev->state = MFRC522Context::TRANSCEIVING; break;
            case 0x0E: dev->state = MFRC522Context::AUTHENTICATING; break;
            case 0x00: dev->state = MFRC522Context::IDLE; break;
        }
    }
}

static uint8_t spi_mfrc522_read(void* ctx, bool data_select, bool chip_selected) {
    (void)data_select;
    if (!chip_selected) return 0;
    MFRC522Context* dev = static_cast<MFRC522Context*>(ctx);
    // Read from FIFO or register
    if (dev->reg_ptr == 0x09 && dev->fifo_level > 0) {  // FIFODataReg
        return dev->fifo[--dev->fifo_level];
    }
    // Register reads - simplified
    return 0;
}

static void spi_ili9341_receive(void* ctx, uint8_t byte, bool data_select, bool chip_selected) {
    ILI9341Context* dev = static_cast<ILI9341Context*>(ctx);
    if (!chip_selected) return;
    
    if (data_select) {
        if (dev->streaming) {
            // Streaming pixel data: write to framebuffer at cursor position
            if (dev->cursor_column < dev->width && dev->cursor_page < dev->height) {
                uint32_t idx = (dev->cursor_page * dev->width + dev->cursor_column) * 2;
                if (dev->expect_high_byte) {
                    if (idx < dev->framebuffer.size()) dev->framebuffer[idx] = byte;
                } else {
                    if (idx + 1 < dev->framebuffer.size()) dev->framebuffer[idx + 1] = byte;
                }
            }
            // Advance cursor per TS implementation
            if (dev->expect_high_byte) {
                dev->expect_high_byte = false;
            } else {
                dev->expect_high_byte = true;
                dev->cursor_column++;
                if (dev->cursor_column > dev->column_end) {
                    dev->cursor_column = dev->column_start;
                    dev->cursor_page++;
                    if (dev->cursor_page > dev->page_end) {
                        dev->cursor_page = dev->page_start;
                    }
                }
            }
        } else if (dev->expected_args > 0) {
            if (dev->cmd_arg_count < 16) {
                dev->cmd_args[dev->cmd_arg_count++] = byte;
                dev->expected_args--;
            }
        }
    } else {
        // Command byte
        dev->reg_ptr = byte;
        dev->cmd_arg_count = 0;
        // Process any pending command arguments before starting new command
        if (dev->expected_args == 0 && dev->cmd_arg_count > 0) {
            switch (dev->reg_ptr) {
                case 0x2A: if (dev->cmd_arg_count >= 4) { dev->column_start = dev->cmd_args[0]; dev->column_end = dev->cmd_args[1]; dev->cursor_column = dev->column_start; } break;
                case 0x2B: if (dev->cmd_arg_count >= 4) { dev->page_start = dev->cmd_args[0]; dev->page_end = dev->cmd_args[1]; dev->cursor_page = dev->page_start; } break;
                case 0x36: if (dev->cmd_arg_count >= 1) dev->madctl = dev->cmd_args[0]; break;
                case 0x3A: if (dev->cmd_arg_count >= 1) { /* pixel format - ignore */ } break;
            }
        }
        dev->reg_ptr = byte;
        dev->cmd_arg_count = 0;
        switch (byte) {
            case 0x2A: dev->expected_args = 4; break;
            case 0x2B: dev->expected_args = 4; break;
            case 0x2C: dev->expected_args = 0; break;
            case 0x36: dev->expected_args = 1; break;
            case 0x3A: dev->expected_args = 1; break;
            default: dev->expected_args = 0;
        }
        // Handle streaming commands
        if (byte == 0x2C || byte == 0x2D || byte == 0x3C || byte == 0x2E || byte == 0x3E) {
            dev->streaming = true;
            dev->cursor_column = dev->column_start;
            dev->cursor_page = dev->page_start;
            dev->expect_high_byte = true;
        } else {
            dev->streaming = false;
        }
    }
}

static void spi_max7219_receive(void* ctx, uint8_t byte, bool data_select, bool chip_selected) {
    MAX7219Context* dev = static_cast<MAX7219Context*>(ctx);
    if (!chip_selected) return;
    
    // Accumulate bits into shift register (like TS model)
    dev->shift = ((dev->shift << 8) | (byte & 0xff)) & 0xffff;
    dev->bits = std::min(dev->bits + 8, 16);
    // Do NOT apply frames here - wait for latch()
}

static void spi_max7219_latch(void* ctx) {
    MAX7219Context* dev = static_cast<MAX7219Context*>(ctx);
    if (dev->bits >= 16) {
        uint16_t frame = dev->shift;
        uint8_t address = (frame >> 8) & 0x0f;
        uint8_t data = frame & 0xff;
        if (address >= 1 && address <= 8) {
            dev->digit_data[address - 1] = data;
        }
        switch (address) {
            case 9: dev->decode_mode = data; break;
            case 10: dev->intensity = data & 0x0f; break;
            case 11: dev->scan_limit = data & 0x07; break;
            case 12: dev->shutdown = (data & 1) == 0; break;
            case 15: dev->display_test = data & 0x01; break;
        }
        dev->shift = 0;
        dev->bits = 0;
    }
}

// PCD8544 (Nokia 5110) SPI receive - handles commands and framebuffer data
extern "C" void spi_pcd8544_receive(void* ctx, uint8_t byte, bool data_select, bool chip_selected) {
    PCD8544Context* dev = static_cast<PCD8544Context*>(ctx);
    if (!chip_selected) return;
    
    if (data_select) {
        // Data byte - write to framebuffer at current (x, y) position
        size_t idx = dev->y * dev->width + dev->x;
        if (idx < dev->framebuffer.size()) {
            dev->framebuffer[idx] = byte;
        }
        
        // Advance position based on addressing mode
        if (dev->vertical) {
            dev->y += 1;
            if (dev->y >= PCD8544_BANKS) {
                dev->y = 0;
                dev->x += 1;
                if (dev->x >= dev->width) dev->x = 0;
            }
        } else {
            dev->x += 1;
            if (dev->x >= dev->width) {
                dev->x = 0;
                dev->y += 1;
                if (dev->y >= PCD8544_BANKS) dev->y = 0;
            }
        }
    } else {
        // Command byte - handle PCD8544 command set
        dev->reg_ptr = byte;
        
        // Handle commands that have immediate effect or set modes
        if ((byte & 0xF8) == 0x20) {  // FUNCTION_SET (0x20-0x27)
            // PD = bit 2, V = bit 1, H = bit 0
            bool pd = (byte & 0x04) != 0;
            bool v = (byte & 0x02) != 0;
            bool h = (byte & 0x01) != 0;
            dev->powerDown = pd;
            dev->vertical = v;
            dev->extended = h;
        } else if ((byte & 0xF8) == 0x08) {  // DISPLAY_CONTROL (0x08-0x0F)
            // D = bit 2, E = bit 0
            dev->blanked = (byte & 0x04) == 0;  // D=0 means display on
            dev->inverse = (byte & 0x01) != 0;  // E=1 means inverse
        } else if (dev->extended) {
            if (byte & 0x80) {  // SET_VOP (0x80-0xFF in extended mode)
                dev->vop = byte & 0x7F;
            }
            // Extended mode also has bias/temp coeff commands (0x10-0x1F) - ignore for now
        } else {
            // Basic instruction set
            if (byte & 0x80) {  // SET_X (0x80-0xFF)
                dev->x = byte & 0x7F;
                if (dev->x >= dev->width) dev->x = dev->width - 1;
            } else if ((byte & 0xF8) == 0x40) {  // SET_Y (0x40-0x47)
                dev->y = byte & 0x07;
                if (dev->y >= PCD8544_BANKS) dev->y = PCD8544_BANKS - 1;
            }
        }
    }
}

// ============================================================================
// Part Registration and Stamping
// ============================================================================

extern "C" void* part_register(uint32_t part_id, PartKind kind, const char* definition_json) {
    PartInstance inst;
    inst.kind = kind;
    inst.part_id = part_id;
    inst.impl = nullptr;
    g_parts[part_id] = inst;
    g_part_order.push_back(&g_parts[part_id]);
    return &g_parts[part_id];
}

// solution is the previous solve's result; parts that latch (relay, button)
// read it to decide their next state. Passing it in keeps the module free of
// process-wide state, so more than one engine can live in the same instance.
extern "C" void part_stamp(void* handle, const SolverSolution* solution, double time_ms) {
    // Update the global time for parts that need it in part_set_pin_level
    g_last_stamp_time_ms = static_cast<uint32_t>(time_ms);
    
    PartInstance* inst = static_cast<PartInstance*>(handle);
    if (!inst || !inst->impl) return;
    // solution may be nullptr (e.g., from harness time stimulus)
    const SolverSolution* sol = solution;
    
    switch (inst->kind) {
        case PART_KIND_POWER_SUPPLY: {
            PowerSupplyContext* ctx = static_cast<PowerSupplyContext*>(inst->impl);
            if (ctx->enabled && ctx->pos_net >= 0 && ctx->neg_net >= 0) {
                // Add voltage source between pos_net and neg_net
                // In MNA, a voltage source adds a row/column for current
                // and stamps +1/-1 in the conductance matrix
                // This is simplified - real implementation needs proper MNA stamping
            }
            break;
        }
        case PART_KIND_RELAY: {
            RelayContext* ctx = static_cast<RelayContext*>(inst->impl);
            if (ctx->coil_pos_net >= 0 && ctx->coil_neg_net >= 0 && sol) {
                double v_coil = voltageOfNet(sol, ctx->coil_pos_net)
                              - voltageOfNet(sol, ctx->coil_neg_net);
                bool should_pull_in = v_coil >= ctx->pull_in_voltage;
                bool should_drop_out = v_coil <= ctx->drop_out_voltage;
                
                if (!ctx->coil_energized && should_pull_in) {
                    ctx->coil_energized = true;
                    ctx->contacts_closed = true;
                } else if (ctx->coil_energized && should_drop_out) {
                    ctx->coil_energized = false;
                    ctx->contacts_closed = false;
                }
                
                // Stamp coil as resistor
                // Stamp contact as voltage-controlled switch (conductance)
            }
            break;
        }
        case PART_KIND_BUTTON: {
            ButtonContext* ctx = static_cast<ButtonContext*>(inst->impl);
            // Button state is set via part_set_pin_level
            // Stamp as switch between pin_net and gnd_net
            break;
        }
        case PART_KIND_POTENTIOMETER: {
            PotentiometerContext* ctx = static_cast<PotentiometerContext*>(inst->impl);
            // Stamp as two resistors: terminal_a to wiper, wiper to terminal_b
            break;
        }
        case PART_KIND_SHIFT_REGISTER: {
            ShiftRegisterContext* ctx = static_cast<ShiftRegisterContext*>(inst->impl);
            // Sample DS on SHCP rising edge, latch on STCP rising edge
            break;
        }
        case PART_KIND_RTC: {
            RTCContext* ctx = static_cast<RTCContext*>(inst->impl);
            // Update time based on elapsed ms
            break;
        }
        case PART_KIND_SERVO: {
            ServoContext* ctx = static_cast<ServoContext*>(inst->impl);
            // Pulse width measurement using g_last_stamp_time_ms
            // Track rising/falling edges of the PWM pin
            static bool last_pin_high = false;  // Actually need per-instance state
            // Use a flag in context instead
            // On rising edge: record start time
            // On falling edge: compute width from start time
            if (ctx->pin_high && !ctx->was_pin_high) {
                // Rising edge
                ctx->pulse_start_ms = g_last_stamp_time_ms;
            } else if (!ctx->pin_high && ctx->was_pin_high) {
                // Falling edge: compute pulse width
                uint32_t pulse_width_us = g_last_stamp_time_ms - ctx->pulse_start_ms;
                if (pulse_width_us > 0) {
                    // Map pulse width to angle: 1000us = 0°, 2000us = 180°
                    int wanted = static_cast<int>((pulse_width_us - 1000.0) / 1000.0 * 180.0 + 0.5);
                    if (wanted < 10) wanted = 10;
                    if (wanted > 170) wanted = 170;
                    ctx->current_angle = static_cast<uint8_t>(wanted);
                }
            }
            ctx->was_pin_high = ctx->pin_high;
            break;
        }
        case PART_KIND_BH1750: {
            // BH1750 conversion time: ~120ms for high-res, ~16ms for low-res
            BH1750Context* ctx = static_cast<BH1750Context*>(inst->impl);
            if (ctx->powered && ctx->mode != 0 && !ctx->conversion_ready) {
                // In continuous/one-shot mode, set conversion_ready after delay
                // Simplified: mark ready immediately for now
                ctx->conversion_ready = true;
            }
            break;
        }
        case PART_KIND_STEPPER: {
            // Stepper is driven entirely by part_set_pin_level (polarity edges)
            // No time-based advancement needed
            break;
        }
        case PART_KIND_STEPPER_DRIVER: {
            // A4988 is driven entirely by part_set_pin_level (STEP/DIR edges)
            // No time-based advancement needed
            break;
        }
        default:
            break;
    }
}

// Static buffer for part_get_state return value (single-threaded wasm use)
static PartStateSnapshot g_part_state_snapshot = {};

extern "C" PartStateSnapshot* part_get_state(void* handle) {
    PartStateSnapshot* snap = &g_part_state_snapshot;
    // Zero out the snapshot
    memset(snap, 0, sizeof(PartStateSnapshot));
    
    PartInstance* inst = static_cast<PartInstance*>(handle);
    if (!inst || !inst->impl) return snap;

    // Write partId (truncated to 63 chars + NUL) and kind string
    char buf[64];
    snprintf(buf, sizeof(buf), "%u", inst->part_id);
    memcpy(snap->partId, buf, 64);

    const char* kind_name = part_kind_name(inst->kind);
    size_t kl = strlen(kind_name);
    memcpy(snap->kind, kind_name, kl < 32 ? kl + 1 : 31);
    snap->kind[31] = '\0';
    
    switch (inst->kind) {
        case PART_KIND_POWER_SUPPLY: {
            PowerSupplyContext* ctx = static_cast<PowerSupplyContext*>(inst->impl);
            // Could add custom fields to PartStateSnapshot for power supply
            break;
        }
        case PART_KIND_RELAY: {
            RelayContext* ctx = static_cast<RelayContext*>(inst->impl);
            snap->relay_contacts_closed = ctx->contacts_closed;
            break;
        }
        case PART_KIND_BUTTON: {
            ButtonContext* ctx = static_cast<ButtonContext*>(inst->impl);
            snap->button_pressed = ctx->pressed;
            break;
        }
        case PART_KIND_POTENTIOMETER: {
            PotentiometerContext* ctx = static_cast<PotentiometerContext*>(inst->impl);
            snap->pot_wiper = ctx->wiper_position;
            break;
        }
        case PART_KIND_SHIFT_REGISTER: {
            ShiftRegisterContext* ctx = static_cast<ShiftRegisterContext*>(inst->impl);
            // Q pins are high-impedance when OE is deasserted, so report 0.
            if (ctx->outputs_enabled) {
                for (int i = 0; i < 8; i++) {
                    snap->shift_register_outputs[i] = (ctx->storage_reg >> i) & 1;
                }
            }
            // Also populate the dedicated shift595 fields for probe access
            snap->shift595_shift_reg = ctx->shift_reg;
            snap->shift595_storage_reg = ctx->storage_reg;
            snap->shift595_outputs_enabled = ctx->outputs_enabled;
            break;
        }
        case PART_KIND_RTC: {
            RTCContext* ctx = static_cast<RTCContext*>(inst->impl);
            snap->rtc_seconds = ctx->seconds;
            snap->rtc_minutes = ctx->minutes;
            snap->rtc_hours = ctx->hours;
            snap->rtc_day = ctx->day;
            snap->rtc_date = ctx->date;
            snap->rtc_month = ctx->month;
            snap->rtc_year = ctx->year;
            break;
        }
        case PART_KIND_DISPLAY_I2C: {
            // SSD1306Context
            SSD1306Context* ctx = static_cast<SSD1306Context*>(inst->impl);
            snap->framebuffer_offset = static_cast<uint32_t>(reinterpret_cast<uintptr_t>(ctx->framebuffer.data()));
            snap->framebuffer_size = static_cast<uint32_t>(ctx->framebuffer.size());
            snap->width = ctx->width;
            snap->height = ctx->height;
            break;
        }
        case PART_KIND_DISPLAY_SPI: {
            // ILI9341, PCD8544, MAX7219 — detect by context type
            // All have framebuffer + width/height
            PartContext* base = static_cast<PartContext*>(inst->impl);
            if (base->type() == PartContextType::ILI9341) {
                ILI9341Context* ctx = static_cast<ILI9341Context*>(base);
                snap->framebuffer_offset = static_cast<uint32_t>(reinterpret_cast<uintptr_t>(ctx->framebuffer.data()));
                snap->framebuffer_size = static_cast<uint32_t>(ctx->framebuffer.size());
                snap->width = ctx->width;
                snap->height = ctx->height;
            } else if (base->type() == PartContextType::PCD8544) {
                PCD8544Context* ctx = static_cast<PCD8544Context*>(base);
                snap->framebuffer_offset = static_cast<uint32_t>(reinterpret_cast<uintptr_t>(ctx->framebuffer.data()));
                snap->framebuffer_size = static_cast<uint32_t>(ctx->framebuffer.size());
                snap->width = ctx->width;
                snap->height = ctx->height;
                snap->pcd8544_x = ctx->x;
                snap->pcd8544_y = ctx->y;
                snap->pcd8544_vertical = ctx->vertical;
                snap->pcd8544_extended = ctx->extended;
                snap->pcd8544_powerDown = ctx->powerDown;
                snap->pcd8544_blanked = ctx->blanked;
                snap->pcd8544_inverse = ctx->inverse;
                snap->pcd8544_vop = ctx->vop;
            } else if (base->type() == PartContextType::MAX7219) {
                MAX7219Context* ctx = static_cast<MAX7219Context*>(base);
                for (int i = 0; i < 8; i++) snap->seven_seg_digits[i] = ctx->digit_data[i];
                // MAX7219 doesn't have a colon field, but we can use shutdown or display_test as placeholder
                snap->seven_seg_colon = 0;
                snap->max7219_decode_mode = ctx->decode_mode;
                snap->max7219_intensity = ctx->intensity;
                snap->max7219_scan_limit = ctx->scan_limit;
                snap->max7219_shutdown = ctx->shutdown != 0;
                snap->max7219_display_test = ctx->display_test != 0;
            }
            break;
        }
        case PART_KIND_DISPLAY_7SEG: {
            // MAX7219 (and TM1637)
            MAX7219Context* ctx = static_cast<MAX7219Context*>(inst->impl);
            for (int i = 0; i < 8; i++) snap->seven_seg_digits[i] = ctx->digit_data[i];
            snap->seven_seg_colon = 0;
            // Also populate MAX7219 config fields
            snap->max7219_decode_mode = ctx->decode_mode;
            snap->max7219_intensity = ctx->intensity;
            snap->max7219_scan_limit = ctx->scan_limit;
            snap->max7219_shutdown = ctx->shutdown != 0;
            snap->max7219_display_test = ctx->display_test != 0;
            break;
        }
        case PART_KIND_DISPLAY_LCD: {
            // HD44780
            HD44780Context* ctx = static_cast<HD44780Context*>(inst->impl);
            for (int i = 0; i < 80; i++) snap->lcd_chars[i] = ctx->chars[i];
            snap->lcd_rows = ctx->rows;
            snap->lcd_cols = ctx->cols;
            break;
        }
        case PART_KIND_SERVO: {
            ServoContext* ctx = static_cast<ServoContext*>(inst->impl);
            snap->servo_angle = ctx->current_angle;
            break;
        }
        case PART_KIND_STEPPER: {
            StepperContext* ctx = static_cast<StepperContext*>(inst->impl);
            snap->stepper_angle_deci_deg = ctx->current_angle_deci_deg;
            break;
        }
        case PART_KIND_STEPPER_DRIVER: {
            StepperDriverContext* ctx = static_cast<StepperDriverContext*>(inst->impl);
            for (int i = 0; i < 4; i++) snap->stepper_driver_outputs[i] = ctx->coil_outputs[i];
            break;
        }
        case PART_KIND_THERMOCOUPLE: {
            MAX6675Context* ctx = static_cast<MAX6675Context*>(inst->impl);
            snap->thermocouple_temp_quarter_deg = ctx->temp_quarter_deg;
            break;
        }
        case PART_KIND_RFID: {
            MFRC522Context* ctx = static_cast<MFRC522Context*>(inst->impl);
            snap->rfid_card_present = ctx->card_present;
            break;
        }
        case PART_KIND_I2C_EXPANDER: {
            PartContext* base = static_cast<PartContext*>(inst->impl);
            if (base->type() == PartContextType::PCF8574) {
                PCF8574Context* ctx = static_cast<PCF8574Context*>(base);
                snap->pcf8574_output_reg = ctx->output_reg;
                // In probe mode (no pin wiring), input_reg mirrors output_reg
                snap->pcf8574_input_reg = ctx->output_reg;
            } else if (base->type() == PartContextType::MCP23017) {
                MCP23017Context* ctx = static_cast<MCP23017Context*>(base);
                snap->mcp23017_iodira = ctx->iodira;
                snap->mcp23017_iodirb = ctx->iodirb;
                snap->mcp23017_gpioa = ctx->gpioa;
                snap->mcp23017_gpiob = ctx->gpiob;
                snap->mcp23017_olata = ctx->olata;
                snap->mcp23017_olatb = ctx->olatb;
            }
            break;
        }
        case PART_KIND_ADC: {
            PartContext* base = static_cast<PartContext*>(inst->impl);
            if (base->type() == PartContextType::ADS1115) {
                ADS1115Context* ctx = static_cast<ADS1115Context*>(base);
                snap->ads1115_config = ctx->config;
                snap->ads1115_conversion = ctx->conversion;
                snap->ads1115_conversion_ready = ctx->conversion_ready;
            }
            break;
        }
        case PART_KIND_DAC: {
            MCP4725Context* ctx = static_cast<MCP4725Context*>(inst->impl);
            snap->mcp4725_value = ctx->dac_value;
            break;
        }
        case PART_KIND_EEPROM: {
            // EEPROM has no snapshot fields
            break;
        }
        case PART_KIND_BH1750: {
            BH1750Context* ctx = static_cast<BH1750Context*>(inst->impl);
            // Compute counts from light level if not already computed
            if (ctx->conversion_ready) {
                snap->sensor_lux = static_cast<int32_t>(ctx->counts / 1.2);  // approximate
            }
            break;
        }
        case PART_KIND_BMP180: {
            BMP180Context* ctx = static_cast<BMP180Context*>(inst->impl);
            if (ctx->stale) {
                ctx->raw_temperature = 27898;  // ~25°C in tenths
                ctx->raw_pressure = 101325;
                ctx->stale = false;
            }
            // Temperature in milli-Celsius: convert from raw ADC counts
            // raw_temp = (celsius + 45) * 65535 / 175
            // celsius = raw_temp * 175 / 65535 - 45
            int32_t celsius_milli = static_cast<int32_t>((static_cast<int64_t>(ctx->raw_temperature) * 175000 + 32767) / 65535 - 45000);
            snap->sensor_temp_milli_c = celsius_milli;
            // Pressure in Pa
            snap->sensor_pressure_pa = static_cast<int32_t>(ctx->raw_pressure);
            break;
        }
        case PART_KIND_SHT31: {
            SHT31Context* ctx = static_cast<SHT31Context*>(inst->impl);
            if (ctx->raw_temperature == 0 && ctx->raw_humidity == 0) {
                int celsius = (ctx->knob_temp_milli_c + 500) / 1000 + (ctx->heater ? 1 : 0);
                ctx->raw_temperature = static_cast<uint16_t>(((celsius + 45) * 65535 + 87) / 175);
                int humidity = (ctx->knob_humidity_milli_pct + 500) / 1000;
                ctx->raw_humidity = static_cast<uint16_t>((humidity * 65535 + 50) / 100);
            }
            // Temperature in milli-Celsius
            int32_t celsius_milli = static_cast<int32_t>((static_cast<int64_t>(ctx->raw_temperature) * 175000 + 32767) / 65535 - 45000);
            snap->sensor_temp_milli_c = celsius_milli;
            // Humidity in milli-percent
            int32_t humidity_milli = static_cast<int32_t>((static_cast<int64_t>(ctx->raw_humidity) * 100000 + 32767) / 65535);
            snap->sensor_humidity_milli_pct = humidity_milli;
            break;
        }
        case PART_KIND_TMP102: {
            TMP102Context* ctx = static_cast<TMP102Context*>(inst->impl);
            int16_t temp_counts = 336;
            if (ctx->pointer == 0x00) {
                int celsius = 21;
                temp_counts = static_cast<int16_t>(celsius / 0.0625);
            }
            snap->sensor_temp_milli_c = static_cast<int32_t>(temp_counts * 625);  // 0.0625°C = 62.5 milli°C
            break;
        }
        case PART_KIND_PWM_DRIVER: {
            PCA9685Context* ctx = static_cast<PCA9685Context*>(inst->impl);
            snap->pca9685_prescale = ctx->prescale;
            for (int i = 0; i < 16; i++) {
                // duty counts mirror TS `duty()`: OFF wins, ON wins, else (end-start) mod 4096 counts
                if (ctx->mode1 & 0x10) { snap->pca9685_duty[i] = 0; continue; }  // oscillator sleep holds outputs low
                uint16_t on = (ctx->led_on_l[i] | (ctx->led_on_h[i] << 8));
                uint16_t off = (ctx->led_off_l[i] | (ctx->led_off_h[i] << 8));
                if ((off & 0x1000) != 0) { snap->pca9685_duty[i] = 0; }
                else if ((on & 0x1000) != 0) { snap->pca9685_duty[i] = 4096; }
                else {
                    uint16_t start = on & 0x0fff;
                    uint16_t end = off & 0x0fff;
                    snap->pca9685_duty[i] = (start == end) ? 0 : static_cast<uint16_t>((4096 + end - start) % 4096);
                }
            }
            break;
        }
        case PART_KIND_SONAR: {
            SonarContext* ctx = static_cast<SonarContext*>(inst->impl);
            snap->sonar_echo_us = ctx->echo_us;
            break;
        }
        case PART_KIND_DHT: {
            DHTContext* ctx = static_cast<DHTContext*>(inst->impl);
            snap->sensor_temp_milli_c = ctx->temp_milli_c;
            snap->sensor_humidity_milli_pct = ctx->humidity_milli_pct;
            break;
        }
        case PART_KIND_DS18B20: {
            DS18B20Context* ctx = static_cast<DS18B20Context*>(inst->impl);
            snap->sensor_temp_milli_c = ctx->temp_milli_c;
            break;
        }
        case PART_KIND_NEOPIXEL: {
            NeoPixelContext* ctx = static_cast<NeoPixelContext*>(inst->impl);
            snap->neopixel_count = ctx->pixel_count;
            if (ctx->pixel_count > 0) {
                snap->neopixel_pixel0_r = ctx->pixels[0];
                snap->neopixel_pixel0_g = ctx->pixels[1];
                snap->neopixel_pixel0_b = ctx->pixels[2];
            }
            if (ctx->pixel_count > 1) {
                snap->neopixel_pixel1_r = ctx->pixels[3];
                snap->neopixel_pixel1_g = ctx->pixels[4];
                snap->neopixel_pixel1_b = ctx->pixels[5];
            }
            if (ctx->pixel_count > 2) {
                snap->neopixel_pixel2_r = ctx->pixels[6];
                snap->neopixel_pixel2_g = ctx->pixels[7];
                snap->neopixel_pixel2_b = ctx->pixels[8];
            }
            if (ctx->pixel_count > 3) {
                snap->neopixel_pixel3_r = ctx->pixels[9];
                snap->neopixel_pixel3_g = ctx->pixels[10];
                snap->neopixel_pixel3_b = ctx->pixels[11];
            }
            break;
        }
        case PART_KIND_SCRIPTED: {
            ScriptedContext* ctx = static_cast<ScriptedContext*>(inst->impl);
            snap->scripted_reg_ptr = ctx->reg_ptr;
            snap->scripted_reg_0 = ctx->regs[0];
            snap->scripted_reg_1 = ctx->regs[1];
            snap->scripted_reg_2 = ctx->regs[2];
            snap->scripted_reg_3 = ctx->regs[3];
            snap->scripted_reg_4 = ctx->regs[4];
            snap->scripted_reg_5 = ctx->regs[5];
            snap->scripted_reg_6 = ctx->regs[6];
            snap->scripted_reg_7 = ctx->regs[7];
            break;
        }
        default:
            break;
    }
    return snap;
}

extern "C" void part_set_knob(void* handle, const char* knob_name, double value) {
    PartInstance* inst = static_cast<PartInstance*>(handle);
    if (!inst || !inst->impl) return;
    
    switch (inst->kind) {
        case PART_KIND_POWER_SUPPLY: {
            PowerSupplyContext* ctx = static_cast<PowerSupplyContext*>(inst->impl);
            if (strcmp(knob_name, "voltage") == 0) ctx->voltage = value;
            else if (strcmp(knob_name, "current_limit") == 0) ctx->current_limit = value;
            else if (strcmp(knob_name, "enabled") == 0) ctx->enabled = (value != 0.0);
            break;
        }
        case PART_KIND_RELAY: {
            RelayContext* ctx = static_cast<RelayContext*>(inst->impl);
            if (strcmp(knob_name, "coil_resistance") == 0) ctx->coil_resistance = value;
            else if (strcmp(knob_name, "contact_resistance") == 0) ctx->contact_resistance = value;
            else if (strcmp(knob_name, "pull_in_voltage") == 0) ctx->pull_in_voltage = value;
            else if (strcmp(knob_name, "drop_out_voltage") == 0) ctx->drop_out_voltage = value;
            break;
        }
        case PART_KIND_POTENTIOMETER: {
            PotentiometerContext* ctx = static_cast<PotentiometerContext*>(inst->impl);
            if (strcmp(knob_name, "position") == 0) ctx->wiper_position = std::clamp(value, 0.0, 1.0);
            else if (strcmp(knob_name, "max_resistance") == 0) ctx->max_resistance = value;
            break;
        }
        case PART_KIND_RTC: {
            RTCContext* ctx = static_cast<RTCContext*>(inst->impl);
            if (strcmp(knob_name, "hours") == 0) ctx->hours = static_cast<uint8_t>(value);
            else if (strcmp(knob_name, "minutes") == 0) ctx->minutes = static_cast<uint8_t>(value);
            else if (strcmp(knob_name, "seconds") == 0) ctx->seconds = static_cast<uint8_t>(value);
            break;
        }
        case PART_KIND_ADC: {
            ADS1115Context* ctx = static_cast<ADS1115Context*>(inst->impl);
            if (strcmp(knob_name, "ain0") == 0) ctx->input_voltage[0] = value;
            else if (strcmp(knob_name, "ain1") == 0) ctx->input_voltage[1] = value;
            else if (strcmp(knob_name, "ain2") == 0) ctx->input_voltage[2] = value;
            else if (strcmp(knob_name, "ain3") == 0) ctx->input_voltage[3] = value;
            break;
        }
        case PART_KIND_BH1750: {
            BH1750Context* ctx = static_cast<BH1750Context*>(inst->impl);
            if (knob_name && knob_name[0] == 'l' && knob_name[1] == 'i' && knob_name[2] == 'g' && knob_name[3] == 'h' && knob_name[4] == 't' && knob_name[5] == '\0') {
                // 1.2 counts per lux for high-res mode
                ctx->counts = static_cast<uint16_t>(value * 1.2);
                ctx->conversion_ready = true;
            }
            break;
        }
        case PART_KIND_BMP180: {
            BMP180Context* ctx = static_cast<BMP180Context*>(inst->impl);
            if (strcmp(knob_name, "temperature") == 0) {
                // Temperature in Celsius
                ctx->raw_temperature = static_cast<int32_t>((value + 45) * 65535 / 175);
            } else if (strcmp(knob_name, "pressure") == 0) {
                // Pressure in hPa -> Pa
                ctx->raw_pressure = static_cast<int32_t>(value * 100);
            }
            ctx->stale = false;
            break;
        }
        case PART_KIND_SHT31: {
            SHT31Context* ctx = static_cast<SHT31Context*>(inst->impl);
            if (strcmp(knob_name, "temperature") == 0) {
                ctx->knob_temp_milli_c = static_cast<int32_t>(value * 1000.0);
            } else if (strcmp(knob_name, "humidity") == 0) {
                ctx->knob_humidity_milli_pct = static_cast<int32_t>(value * 1000.0);
            }
            break;
        }
        case PART_KIND_DISPLAY_LCD: {
            HD44780Context* ctx = static_cast<HD44780Context*>(inst->impl);
            if (strcmp(knob_name, "clear") == 0) {
                ctx->cursor = 0;
                for (int i = 0; i < 80; i++) ctx->chars[i] = 0x20;  // space
            }
            break;
        }
        case PART_KIND_THERMOCOUPLE: {
            MAX6675Context* ctx = static_cast<MAX6675Context*>(inst->impl);
            if (strcmp(knob_name, "probe") == 0) {
                // Probe temperature in Celsius, 0.25 C steps, matching TS Max6675
                int steps = static_cast<int>(value / 0.25 + 0.5);
                if (steps < 0) steps = 0;
                if (steps > 0xFFF) steps = 0xFFF;
                ctx->temp_quarter_deg = static_cast<int16_t>(steps);
            }
            break;
        }
        case PART_KIND_SONAR: {
            SonarContext* ctx = static_cast<SonarContext*>(inst->impl);
            if (strcmp(knob_name, "distance") == 0) {
                ctx->distance_cm = std::clamp(value, 2.0, 400.0);
                ctx->echo_us = static_cast<uint16_t>(std::lround(ctx->distance_cm * 58.0));
            }
            break;
        }
        case PART_KIND_DHT: {
            DHTContext* ctx = static_cast<DHTContext*>(inst->impl);
            if (strcmp(knob_name, "temperature") == 0) ctx->temp_milli_c = static_cast<int32_t>(value * 1000.0);
            else if (strcmp(knob_name, "humidity") == 0) ctx->humidity_milli_pct = static_cast<int32_t>(value * 1000.0);
            break;
        }
        case PART_KIND_DS18B20: {
            DS18B20Context* ctx = static_cast<DS18B20Context*>(inst->impl);
            if (strcmp(knob_name, "temperature") == 0) ctx->temp_milli_c = static_cast<int32_t>(value * 1000.0);
            break;
        }
        case PART_KIND_NEOPIXEL: {
            NeoPixelContext* ctx = static_cast<NeoPixelContext*>(inst->impl);
            // Knob names: "pixel0_r", "pixel0_g", "pixel0_b", ..., "pixel3_b"
            if (knob_name && knob_name[0] == 'p' && knob_name[1] == 'i' &&
                knob_name[2] == 'x' && knob_name[3] == 'e' && knob_name[4] == 'l' &&
                knob_name[5] >= '0' && knob_name[5] <= '3' && knob_name[6] == '_' &&
                knob_name[7] != '\0' && knob_name[8] == '\0') {
                int pixel = knob_name[5] - '0';
                char channel = knob_name[7];
                int v = static_cast<int>(std::lround(std::clamp(value, 0.0, 255.0)));
                if (channel == 'r') ctx->set_pixel(pixel, v, -1, -1);
                else if (channel == 'g') ctx->set_pixel(pixel, -1, v, -1);
                else if (channel == 'b') ctx->set_pixel(pixel, -1, -1, v);
            }
            break;
        }
        case PART_KIND_SCRIPTED: {
            ScriptedContext* ctx = static_cast<ScriptedContext*>(inst->impl);
            if (strcmp(knob_name, "reg_ptr") == 0) {
                ctx->reg_ptr = static_cast<uint8_t>(std::clamp(static_cast<int>(value), 0, 255));
            } else if (knob_name && knob_name[0] == 'r' && knob_name[1] == 'e' &&
                       knob_name[2] == 'g' && knob_name[3] == '_' &&
                       knob_name[4] >= '0' && knob_name[4] <= '7' && knob_name[5] == '\0') {
                int reg = knob_name[4] - '0';
                ctx->regs[reg] = static_cast<uint8_t>(std::clamp(static_cast<int>(value), 0, 255));
            }
            break;
        }
        default:
            break;
    }
}

extern "C" void part_set_pin_level(void* handle, uint32_t pin_index, bool high) {
    PartInstance* inst = static_cast<PartInstance*>(handle);
    if (!inst || !inst->impl) return;
    
    switch (inst->kind) {
        case PART_KIND_POWER_SUPPLY: {
            PowerSupplyContext* ctx = static_cast<PowerSupplyContext*>(inst->impl);
            if (pin_index == 0) ctx->enabled = high;  // Enable pin
            break;
        }
        case PART_KIND_BUTTON: {
            ButtonContext* ctx = static_cast<ButtonContext*>(inst->impl);
            // Pin 0 is the button input (active low with pull-up)
            ctx->pressed = !high;  // Pressed = low (connected to ground)
            break;
        }
        case PART_KIND_SHIFT_REGISTER: {
            ShiftRegisterContext* ctx = static_cast<ShiftRegisterContext*>(inst->impl);
            // Pin order follows the 74HC595 wiring: DS=0, SHCP=1, STCP=2, OE=3.
            if (pin_index == 0) {  // DS (data)
                ctx->ds_level = high;
            } else if (pin_index == 1) {  // SHCP (shift clock)
                if (high && !ctx->last_shcp) {
                    // Rising edge: the bit present on DS enters the shift register.
                    ctx->shift_reg = static_cast<uint8_t>((ctx->shift_reg << 1) | (ctx->ds_level ? 1 : 0));
                    if (ctx->bit_count < 8) ctx->bit_count++;
                }
                ctx->last_shcp = high;
            } else if (pin_index == 2) {  // STCP (storage clock)
                if (high && !ctx->last_stcp) {
                    // Rising edge - latch shift reg to storage reg
                    ctx->storage_reg = ctx->shift_reg;
                }
                ctx->last_stcp = high;
            } else if (pin_index == 3) {  // OE (output enable, active low)
                ctx->outputs_enabled = !high;
            }
            break;
        }
        case PART_KIND_RTC: {
            // RTC pins handled via I2C
            break;
        }
        case PART_KIND_SERVO: {
            ServoContext* ctx = static_cast<ServoContext*>(inst->impl);
            if (pin_index == 0) {
                ctx->pin_high = high;
            }
            break;
        }
        case PART_KIND_STEPPER: {
            StepperContext* ctx = static_cast<StepperContext*>(inst->impl);
            if (pin_index >= 0 && pin_index <= 3) {
                ctx->pin_state[pin_index] = high;
                
                // Compute polarities: A+ vs A-, B+ vs B-
                // Pin mapping: 0=A+, 1=A-, 2=B+, 3=B-
                int aPlus = ctx->pin_state[0] ? 1 : 0;
                int aMinus = ctx->pin_state[1] ? 1 : 0;
                int bPlus = ctx->pin_state[2] ? 1 : 0;
                int bMinus = ctx->pin_state[3] ? 1 : 0;
                
                int8_t nextA = (aPlus && !aMinus) ? 1 : ((!aPlus && aMinus) ? -1 : 0);
                int8_t nextB = (bPlus && !bMinus) ? 1 : ((!bPlus && bMinus) ? -1 : 0);
                
                // First sighting arms the tracker
                if (ctx->prev_a == 0 && ctx->prev_b == 0 && nextA == 0 && nextB == 0) break;
                if (ctx->prev_a == 0 && ctx->prev_b == 0) {
                    ctx->prev_a = nextA;
                    ctx->prev_b = nextB;
                    break;
                }
                
                // Step transition logic (matches TS stepTransition)
                int8_t delta = 0;
                if (ctx->prev_a == 1 && ctx->prev_b == 1 && nextA == -1 && nextB == 1) delta = 1;
                else if (ctx->prev_a == -1 && ctx->prev_b == 1 && nextA == -1 && nextB == -1) delta = 1;
                else if (ctx->prev_a == -1 && ctx->prev_b == -1 && nextA == 1 && nextB == -1) delta = 1;
                else if (ctx->prev_a == 1 && ctx->prev_b == -1 && nextA == 1 && nextB == 1) delta = 1;
                else if (ctx->prev_a == -1 && ctx->prev_b == 1 && nextA == 1 && nextB == 1) delta = -1;
                else if (ctx->prev_a == -1 && ctx->prev_b == -1 && nextA == -1 && nextB == 1) delta = -1;
                else if (ctx->prev_a == 1 && ctx->prev_b == -1 && nextA == -1 && nextB == -1) delta = -1;
                else if (ctx->prev_a == 1 && ctx->prev_b == 1 && nextA == 1 && nextB == -1) delta = -1;
                
                if (delta != 0) {
                    // STEP_DEGREES = 7.5, so 75 deci-degrees per step
                    ctx->angle_accumulator += delta * 75;
                }
                
                ctx->prev_a = nextA;
                ctx->prev_b = nextB;
                
                // Update current angle for snapshot (mod 3600 deci-degrees)
                ctx->current_angle_deci_deg = static_cast<int16_t>((ctx->angle_accumulator % 3600 + 3600) % 3600);
            }
            break;
        }
        case PART_KIND_STEPPER_DRIVER: {
            StepperDriverContext* ctx = static_cast<StepperDriverContext*>(inst->impl);
            // Pin mapping: 0=STEP, 1=DIR, 2=ENABLE, 3=RESET, 4=SLEEP, 5=MS1, 6=MS2, 7=MS3
            if (pin_index == 0) {
                // STEP pin: rising edge triggers movement
                bool rising = high && !ctx->previous_step;
                ctx->previous_step = high;
                if (rising) {
                    ctx->active_microsteps = ctx->pending_microsteps;
                    if (!ctx->enabled || ctx->asleep || ctx->in_reset) break;
                    
                    int8_t stride = 16 / ctx->active_microsteps;
                    int8_t step = ctx->pin_state[1] ? stride : -stride;  // DIR is pin 1
                    ctx->fine_position = (ctx->fine_position + step + 64) % 64;
                }
            } else if (pin_index == 1) {
                // DIR pin
                ctx->pin_state[1] = high;
            } else if (pin_index == 2) {
                // ENABLE (active low)
                ctx->enabled = !high;
            } else if (pin_index == 3) {
                // RESET (active low)
                ctx->in_reset = !high;
                if (ctx->in_reset) {
                    ctx->fine_position = 0;
                    ctx->active_microsteps = ctx->pending_microsteps;
                }
            } else if (pin_index == 4) {
                // SLEEP (active low)
                ctx->asleep = !high;
                if (ctx->asleep) {
                    ctx->fine_position = 0;
                    ctx->active_microsteps = ctx->pending_microsteps;
                }
            } else if (pin_index >= 5 && pin_index <= 7) {
                // MS1, MS2, MS3 pins
                bool ms1 = ctx->pin_state[5];
                bool ms2 = ctx->pin_state[6];
                bool ms3 = ctx->pin_state[7];
                
                if (pin_index == 5) ctx->pin_state[5] = high;
                else if (pin_index == 6) ctx->pin_state[6] = high;
                else if (pin_index == 7) ctx->pin_state[7] = high;
                
                // microstepsFor: MS3 MS2 MS1 → 16/8/4/2/1
                if (ms3) ctx->pending_microsteps = (ms1 && ms2) ? 16 : 1;
                else if (ms2) ctx->pending_microsteps = ms1 ? 8 : 4;
                else ctx->pending_microsteps = ms1 ? 2 : 1;
            }
            
            // Update coil outputs based on current state
            if (!ctx->enabled || ctx->asleep || ctx->in_reset) {
                ctx->coil_outputs[0] = ctx->coil_outputs[1] = ctx->coil_outputs[2] = ctx->coil_outputs[3] = 0;
            } else if (ctx->active_microsteps == 1) {
                // Full step: use the FULL_STEP table from TS
                const bool full_step[4][4] = {
                    {1, 0, 0, 1},  // state 0
                    {1, 0, 1, 0},  // state 1
                    {0, 1, 1, 0},  // state 2
                    {0, 1, 0, 1},  // state 3
                };
                int pos = ctx->fine_position / 16;  // 0..3
                ctx->coil_outputs[0] = full_step[pos][0] ? 1 : 0;
                ctx->coil_outputs[1] = full_step[pos][1] ? 1 : 0;
                ctx->coil_outputs[2] = full_step[pos][2] ? 1 : 0;
                ctx->coil_outputs[3] = full_step[pos][3] ? 1 : 0;
            } else {
                // Microstepping: sine/cosine table
                // HOME_ANGLE_DEGREES = -45, ELECTRICAL_DEGREES_PER_STEP = 90
                double degrees = -45.0 + ctx->fine_position * (90.0 / 16.0);
                double radians = degrees * M_PI / 180.0;
                double a = cos(radians);
                double b = sin(radians);
                
                // duty: (1 + current) / 2 for positive end, (1 - current) / 2 for negative
                ctx->coil_outputs[0] = ((1.0 + a) / 2.0 > 0.5) ? 1 : 0;  // 1A
                ctx->coil_outputs[1] = ((1.0 - a) / 2.0 > 0.5) ? 1 : 0;  // 1B
                ctx->coil_outputs[2] = ((1.0 + b) / 2.0 > 0.5) ? 1 : 0;  // 2A
                ctx->coil_outputs[3] = ((1.0 - b) / 2.0 > 0.5) ? 1 : 0;  // 2B
            }
            break;
        }
        default:
            break;
    }
}

extern "C" void part_set_i2c_address(void* handle, uint8_t address) {
    // For I2C devices - already handled in factory
    (void)handle; (void)address;
}

// ============================================================================
// Part Factory Functions (implemented with correct signatures)
// ============================================================================

extern "C" void* part_create_relay(uint32_t part_id, double coil_ohms, double contact_ohms) {
    void* handle = part_register(part_id, PART_KIND_RELAY, "{}");
    PartInstance* inst = static_cast<PartInstance*>(handle);
    
    RelayContext* ctx = new RelayContext();
    ctx->coil_resistance = coil_ohms;
    ctx->contact_resistance = contact_ohms;
    inst->impl = ctx;
    g_part_impls.push_back(ctx);
    return handle;
}

extern "C" void* part_create_servo(uint32_t part_id) {
    void* handle = part_register(part_id, PART_KIND_SERVO, "{}");
    PartInstance* inst = static_cast<PartInstance*>(handle);
    ServoContext* ctx = new ServoContext();
    inst->impl = ctx;
    g_part_impls.push_back(ctx);
    return handle;
}

extern "C" void* part_create_stepper(uint32_t part_id, double step_angle_deg) {
    void* handle = part_register(part_id, PART_KIND_STEPPER, "{}");
    PartInstance* inst = static_cast<PartInstance*>(handle);
    StepperContext* ctx = new StepperContext();
    inst->impl = ctx;
    g_part_impls.push_back(ctx);
    return handle;
}

extern "C" void* part_create_stepper_driver(uint32_t part_id, double output_ohms) {
    void* handle = part_register(part_id, PART_KIND_STEPPER_DRIVER, "{}");
    PartInstance* inst = static_cast<PartInstance*>(handle);
    StepperDriverContext* ctx = new StepperDriverContext();
    inst->impl = ctx;
    g_part_impls.push_back(ctx);
    return handle;
}

extern "C" void* part_create_shift_register(uint32_t part_id) {
    void* handle = part_register(part_id, PART_KIND_SHIFT_REGISTER, "{}");
    PartInstance* inst = static_cast<PartInstance*>(handle);
    
    ShiftRegisterContext* ctx = new ShiftRegisterContext();
    inst->impl = ctx;
    g_part_impls.push_back(ctx);
    
    // Register as SPI device
    SPIPartImpl spi_part;
    spi_part.part_id = part_id;
    spi_part.cs_net = 0;  // Will be set when circuit is built
    spi_part.dc_net = 0;
    spi_part.ctx = ctx;
    spi_part.receive = spi_shift_register_receive;
    spi_part.read = nullptr;  // Shift595 is output-only, no MISO
    g_spi_parts.push_back(spi_part);
    
    return handle;
}

extern "C" void* part_create_lcd(uint32_t part_id, uint8_t cols, uint8_t rows) {
    void* handle = part_register(part_id, PART_KIND_DISPLAY_LCD, "{}");
    PartInstance* inst = static_cast<PartInstance*>(handle);
    HD44780Context* ctx = new HD44780Context();
    ctx->cols = cols;
    ctx->rows = rows;
    inst->impl = ctx;
    g_part_impls.push_back(ctx);
    return handle;
}

extern "C" void* part_create_i2c_expander(uint32_t part_id, uint8_t ports, uint8_t address) {
    void* handle = part_register(part_id, PART_KIND_I2C_EXPANDER, "{}");
    PartInstance* inst = static_cast<PartInstance*>(handle);
    
    if (ports == 8) {
        // PCF8574
        PCF8574Context* ctx = new PCF8574Context();
        inst->impl = ctx;
        g_part_impls.push_back(ctx);
        void* dev_handle = i2c_bus_register_device(address, part_id);
        I2CDeviceImpl* dev = static_cast<I2CDeviceImpl*>(dev_handle);
        dev->ctx = ctx;
        dev->receive = pcf8574_receive;
        dev->read = pcf8574_read;
    } else {
        // MCP23017 (16 ports)
        MCP23017Context* ctx = new MCP23017Context();
        inst->impl = ctx;
        g_part_impls.push_back(ctx);
        void* dev_handle = i2c_bus_register_device(address, part_id);
        I2CDeviceImpl* dev = static_cast<I2CDeviceImpl*>(dev_handle);
        dev->ctx = ctx;
        dev->receive = mcp23017_receive;
        dev->read = mcp23017_read;
    }
    return handle;
}

extern "C" void* part_create_pwm_driver(uint32_t part_id, uint8_t channels) {
    void* handle = part_register(part_id, PART_KIND_PWM_DRIVER, "{}");
    PartInstance* inst = static_cast<PartInstance*>(handle);
    
    PCA9685Context* ctx = new PCA9685Context();
    inst->impl = ctx;
    g_part_impls.push_back(ctx);
    void* dev_handle = i2c_bus_register_device(0x40, part_id);  // Default PCA9685 address
    I2CDeviceImpl* dev = static_cast<I2CDeviceImpl*>(dev_handle);
    dev->ctx = ctx;
    dev->receive = pca9685_receive;
    dev->read = pca9685_read;
    return handle;
}

extern "C" void* part_create_rtc(uint32_t part_id, bool is_ds3231) {
    void* handle = part_register(part_id, PART_KIND_RTC, "{}");
    PartInstance* inst = static_cast<PartInstance*>(handle);
    
    RTCContext* ctx = new RTCContext();
    ctx->is_ds3231 = is_ds3231;
    // Initialize with current time
    ctx->seconds = 0;
    ctx->minutes = 0;
    ctx->hours = 12;
    ctx->day = 1;
    ctx->date = 1;
    ctx->month = 1;
    ctx->year = 24;  // 2024
    ctx->control = is_ds3231 ? 0x00 : 0x00;
    if (is_ds3231) {
        ctx->control2 = 0x00;
        ctx->status = 0x00;
        ctx->aging = 0x00;
    }
    inst->impl = ctx;
    g_part_impls.push_back(ctx);
    return handle;
}

extern "C" void* part_create_sensor_i2c(uint32_t part_id, uint8_t type, uint8_t address) {
    void* handle = part_register(part_id, PART_KIND_SENSOR_I2C, "{}");
    PartInstance* inst = static_cast<PartInstance*>(handle);
    
    switch (type) {
        case 1: {  // BH1750
            BH1750Context* ctx = new BH1750Context();
            inst->impl = ctx;
            g_part_impls.push_back(ctx);
            void* dev_handle = i2c_bus_register_device(address, part_id);
            I2CDeviceImpl* dev = static_cast<I2CDeviceImpl*>(dev_handle);
            dev->ctx = ctx;
            dev->receive = bh1750_receive;
            dev->read = bh1750_read;
            inst->kind = PART_KIND_BH1750;
            break;
        }
        case 2: {  // BMP180
            BMP180Context* ctx = new BMP180Context();
            inst->impl = ctx;
            g_part_impls.push_back(ctx);
            void* dev_handle = i2c_bus_register_device(address, part_id);
            I2CDeviceImpl* dev = static_cast<I2CDeviceImpl*>(dev_handle);
            dev->ctx = ctx;
            dev->receive = bmp180_receive;
            dev->read = bmp180_read;
            inst->kind = PART_KIND_BMP180;
            break;
        }
        case 3: {  // SHT31
            SHT31Context* ctx = new SHT31Context();
            inst->impl = ctx;
            g_part_impls.push_back(ctx);
            void* dev_handle = i2c_bus_register_device(address, part_id);
            I2CDeviceImpl* dev = static_cast<I2CDeviceImpl*>(dev_handle);
            dev->ctx = ctx;
            dev->receive = sht31_receive;
            dev->read = sht31_read;
            inst->kind = PART_KIND_SHT31;
            break;
        }
        case 4: {  // TMP102
            TMP102Context* ctx = new TMP102Context();
            inst->impl = ctx;
            g_part_impls.push_back(ctx);
            void* dev_handle = i2c_bus_register_device(address, part_id);
            I2CDeviceImpl* dev = static_cast<I2CDeviceImpl*>(dev_handle);
            dev->ctx = ctx;
            dev->receive = tmp102_receive;
            dev->read = tmp102_read;
            inst->kind = PART_KIND_TMP102;
            break;
        }
        default:
            break;
    }
    return handle;
}

extern "C" void* part_create_eeprom(uint32_t part_id, uint8_t address) {
    void* handle = part_register(part_id, PART_KIND_EEPROM, "{}");
    PartInstance* inst = static_cast<PartInstance*>(handle);
    
    EEPROM24LC256Context* ctx = new EEPROM24LC256Context();
    inst->impl = ctx;
    g_part_impls.push_back(ctx);
    void* dev_handle = i2c_bus_register_device(address, part_id);
    I2CDeviceImpl* dev = static_cast<I2CDeviceImpl*>(dev_handle);
    dev->ctx = ctx;
    dev->receive = eeprom24lc256_receive;
    dev->read = eeprom24lc256_read;
    return handle;
}

extern "C" void* part_create_dac(uint32_t part_id, uint8_t address, uint8_t bits) {
    void* handle = part_register(part_id, PART_KIND_DAC, "{}");
    PartInstance* inst = static_cast<PartInstance*>(handle);
    
    MCP4725Context* ctx = new MCP4725Context();
    inst->impl = ctx;
    g_part_impls.push_back(ctx);
    void* dev_handle = i2c_bus_register_device(address, part_id);
    I2CDeviceImpl* dev = static_cast<I2CDeviceImpl*>(dev_handle);
    dev->ctx = ctx;
    dev->receive = mcp4725_receive;
    dev->read = mcp4725_read;
    return handle;
}

extern "C" void* part_create_adc(uint32_t part_id, uint8_t address, uint8_t channels) {
    void* handle = part_register(part_id, PART_KIND_ADC, "{}");
    PartInstance* inst = static_cast<PartInstance*>(handle);
    
    ADS1115Context* ctx = new ADS1115Context();
    inst->impl = ctx;
    g_part_impls.push_back(ctx);
    void* dev_handle = i2c_bus_register_device(address, part_id);
    I2CDeviceImpl* dev = static_cast<I2CDeviceImpl*>(dev_handle);
    dev->ctx = ctx;
    dev->receive = ads1115_receive;
    dev->read = ads1115_read;
    return handle;
}

extern "C" void* part_create_thermocouple(uint32_t part_id) {
    void* handle = part_register(part_id, PART_KIND_THERMOCOUPLE, "{}");
    PartInstance* inst = static_cast<PartInstance*>(handle);
    
    MAX6675Context* ctx = new MAX6675Context();
    inst->impl = ctx;
    g_part_impls.push_back(ctx);
    
    // Register as SPI device
    // The CS net would be determined by the circuit
    SPIPartImpl spi_part;
    spi_part.part_id = part_id;
    spi_part.cs_net = 0;  // Will be set when circuit is built
    spi_part.dc_net = 0;
    spi_part.ctx = ctx;
    spi_part.receive = spi_max6675_receive;
    spi_part.read = spi_max6675_read;
    g_spi_parts.push_back(spi_part);
    return handle;
}

extern "C" void* part_create_rfid(uint32_t part_id, uint8_t address) {
    void* handle = part_register(part_id, PART_KIND_RFID, "{}");
    PartInstance* inst = static_cast<PartInstance*>(handle);
    
    MFRC522Context* ctx = new MFRC522Context();
    inst->impl = ctx;
    g_part_impls.push_back(ctx);
    
    // Register as SPI device (MFRC522 can also be I2C but SPI is more common)
    SPIPartImpl spi_part;
    spi_part.part_id = part_id;
    spi_part.cs_net = 0;
    spi_part.dc_net = 0;
    spi_part.ctx = ctx;
    spi_part.receive = spi_mfrc522_receive;
    spi_part.read = spi_mfrc522_read;
    g_spi_parts.push_back(spi_part);
    return handle;
}

extern "C" void* part_create_neopixel(uint32_t part_id, uint16_t count) {
    void* handle = part_register(part_id, PART_KIND_NEOPIXEL, "{}");
    PartInstance* inst = static_cast<PartInstance*>(handle);
    NeoPixelContext* ctx = new NeoPixelContext();
    ctx->pixel_count = static_cast<int32_t>(count);
    if (ctx->pixel_count > 8) ctx->pixel_count = 8;
    inst->impl = ctx;
    g_part_impls.push_back(ctx);
    return handle;
}

extern "C" void* part_create_scripted(uint32_t part_id, uint8_t address) {
    void* handle = part_register(part_id, PART_KIND_SCRIPTED, "{}");
    PartInstance* inst = static_cast<PartInstance*>(handle);
    
    ScriptedContext* ctx = new ScriptedContext();
    inst->impl = ctx;
    g_part_impls.push_back(ctx);
    
    // Register as I2C device
    void* dev_handle = i2c_bus_register_device(address, part_id);
    I2CDeviceImpl* dev = static_cast<I2CDeviceImpl*>(dev_handle);
    dev->ctx = ctx;
    dev->receive = scripted_receive;
    dev->read = scripted_read;
    inst->kind = PART_KIND_SCRIPTED;
    return handle;
}

extern "C" void* part_create_dht(uint32_t part_id) {
    void* handle = part_register(part_id, PART_KIND_DHT, "{}");
    PartInstance* inst = static_cast<PartInstance*>(handle);
    DHTContext* ctx = new DHTContext();
    ctx->temp_milli_c = 25000;
    ctx->humidity_milli_pct = 50000;
    inst->impl = ctx;
    g_part_impls.push_back(ctx);
    return handle;
}

extern "C" void* part_create_ds18b20(uint32_t part_id) {
    void* handle = part_register(part_id, PART_KIND_DS18B20, "{}");
    PartInstance* inst = static_cast<PartInstance*>(handle);
    DS18B20Context* ctx = new DS18B20Context();
    ctx->temp_milli_c = 22000;
    inst->impl = ctx;
    g_part_impls.push_back(ctx);
    return handle;
}

extern "C" void* part_create_sonar(uint32_t part_id) {
    void* handle = part_register(part_id, PART_KIND_SONAR, "{}");
    PartInstance* inst = static_cast<PartInstance*>(handle);
    SonarContext* ctx = new SonarContext();
    ctx->distance_cm = 100.0;
    ctx->echo_us = static_cast<uint16_t>(std::lround(ctx->distance_cm * 58.0));
    inst->impl = ctx;
    g_part_impls.push_back(ctx);
    return handle;
}

extern "C" void* part_create_button(uint32_t part_id) {
    void* handle = part_register(part_id, PART_KIND_BUTTON, "{}");
    PartInstance* inst = static_cast<PartInstance*>(handle);
    
    ButtonContext* ctx = new ButtonContext();
    ctx->pressed = false;
    ctx->pull_up = true;
    ctx->debounce_ms = 10;
    inst->impl = ctx;
    g_part_impls.push_back(ctx);
    return handle;
}

extern "C" void* part_create_potentiometer(uint32_t part_id, double max_ohms) {
    void* handle = part_register(part_id, PART_KIND_POTENTIOMETER, "{}");
    PartInstance* inst = static_cast<PartInstance*>(handle);
    
    PotentiometerContext* ctx = new PotentiometerContext();
    ctx->max_resistance = max_ohms;
    ctx->wiper_position = 0.5;
    inst->impl = ctx;
    g_part_impls.push_back(ctx);
    return handle;
}

extern "C" void* part_create_power_supply(uint32_t part_id, double initial_volts) {
    void* handle = part_register(part_id, PART_KIND_POWER_SUPPLY, "{}");
    PartInstance* inst = static_cast<PartInstance*>(handle);
    
    PowerSupplyContext* ctx = new PowerSupplyContext();
    ctx->voltage = initial_volts;
    ctx->current_limit = 1.0;
    ctx->enabled = true;
    inst->impl = ctx;
    g_part_impls.push_back(ctx);
    return handle;
}

// I2C Display factory
extern "C" void* part_create_display_i2c(uint32_t part_id, uint8_t address, uint16_t width, uint16_t height) {
    void* handle = part_register(part_id, PART_KIND_DISPLAY_I2C, "{}");
    PartInstance* inst = static_cast<PartInstance*>(handle);
    
    SSD1306Context* ctx = new SSD1306Context();
    ctx->width = static_cast<uint8_t>(width);
    ctx->height = static_cast<uint8_t>(height);
    ctx->pages = static_cast<uint8_t>(height / 8);
    ctx->framebuffer.resize(width * height / 8, 0x00);
    ctx->column_end = static_cast<uint8_t>(width - 1);
    ctx->page_end = static_cast<uint8_t>(ctx->pages - 1);
    inst->impl = ctx;
    g_part_impls.push_back(ctx);
    
    void* dev_handle = i2c_bus_register_device(address, part_id);
    I2CDeviceImpl* dev = static_cast<I2CDeviceImpl*>(dev_handle);
    dev->ctx = ctx;
    dev->receive = ssd1306_receive;
    dev->read = ssd1306_read;
    return handle;
}

// SPI Display factory (ILI9341, etc.)
extern "C" void* part_create_display_spi(uint32_t part_id, uint16_t width, uint16_t height, bool has_dc) {
    void* handle = part_register(part_id, PART_KIND_DISPLAY_SPI, "{}");
    PartInstance* inst = static_cast<PartInstance*>(handle);
    
    ILI9341Context* ctx = new ILI9341Context();
    ctx->width = width;
    ctx->height = height;
    ctx->framebuffer.resize(width * height * 2, 0x00);
    ctx->column_start = 0;
    ctx->column_end = width - 1;
    ctx->page_start = 0;
    ctx->page_end = height - 1;
    ctx->cursor_column = 0;
    ctx->cursor_page = 0;
    ctx->expect_high_byte = true;
    ctx->streaming = false;
    inst->impl = ctx;
    g_part_impls.push_back(ctx);

    SPIPartImpl spi_part;
    spi_part.part_id = part_id;
    spi_part.cs_net = 0;
    spi_part.dc_net = has_dc ? 1 : 0;
    spi_part.ctx = ctx;
    spi_part.receive = spi_ili9341_receive;
    // ILI9341 is output-only, no MISO
    spi_part.read = nullptr;
    g_spi_parts.push_back(spi_part);
    return handle;
}

// PCD8544 (Nokia 5110) SPI Display factory
extern "C" void* part_create_display_pcd8544(uint32_t part_id) {
    void* handle = part_register(part_id, PART_KIND_DISPLAY_SPI, "{}");
    PartInstance* inst = static_cast<PartInstance*>(handle);
    
    PCD8544Context* ctx = new PCD8544Context();
    ctx->width = PCD8544_WIDTH;
    ctx->height = PCD8544_HEIGHT;
    ctx->framebuffer.resize(PCD8544_FRAME_BYTES, 0x00);
    ctx->x = 0;
    ctx->y = 0;
    ctx->powerDown = false;
    ctx->vertical = false;
    ctx->extended = false;
    ctx->blanked = true;
    ctx->inverse = false;
    ctx->vop = 0;
    inst->impl = ctx;
    g_part_impls.push_back(ctx);
    
    SPIPartImpl spi_part;
    spi_part.part_id = part_id;
    spi_part.cs_net = 0;
    spi_part.dc_net = 1;  // PCD8544 has D/C pin
    spi_part.ctx = ctx;
    spi_part.receive = spi_pcd8544_receive;
    // PCD8544 is output-only, no MISO
    spi_part.read = nullptr;
    g_spi_parts.push_back(spi_part);
    return handle;
}

// 7-segment display (I2C - TM1637/HT16K33 or SPI - MAX7219)
extern "C" void* part_create_7segment(uint32_t part_id, uint8_t digits) {
    void* handle = part_register(part_id, PART_KIND_DISPLAY_7SEG, "{}");
    PartInstance* inst = static_cast<PartInstance*>(handle);
    
    MAX7219Context* ctx = new MAX7219Context();
    inst->impl = ctx;
    g_part_impls.push_back(ctx);
    
    SPIPartImpl spi_part;
    spi_part.part_id = part_id;
    spi_part.cs_net = 0;
    spi_part.dc_net = 0;
    spi_part.ctx = ctx;
    spi_part.receive = spi_max7219_receive;
    spi_part.latch = spi_max7219_latch;
    // MAX7219 is output-only, no MISO
    spi_part.read = nullptr;
    g_spi_parts.push_back(spi_part);
    return handle;
}

// ============================================================================
// Bus State
// ============================================================================

extern "C" void bus_get_state(BusStateSnapshot* out) {
    if (!out) return;
    std::memset(out, 0, sizeof(BusStateSnapshot));
    
    out->i2c_address = g_i2c_address;
    out->i2c_payload_len = g_i2c_payload_len;
    std::memcpy(out->i2c_payload, g_i2c_payload, g_i2c_payload_len);
    out->i2c_transmitting = g_i2c_transmitting;
    out->i2c_read_len = g_i2c_read_len;
    std::memcpy(out->i2c_read_buffer, g_i2c_read_buffer, g_i2c_read_len);
    out->i2c_transactions_count = g_i2c_transaction_count;
    
    out->spi_selected = g_spi_selected;
    out->spi_saw_byte = g_spi_saw_byte;
    out->spi_payload_len = g_spi_payload_len;
    std::memcpy(out->spi_payload, g_spi_payload, g_spi_payload_len * sizeof(SpiByte));
    out->spi_transfers_count = g_spi_transfer_count;
}

extern "C" void bus_reset(void) {
    g_i2c_transmitting = false;
    g_i2c_payload_len = 0;
    g_i2c_read_len = 0;
    g_i2c_transaction_count = 0;
    g_spi_selected = false;
    g_spi_saw_byte = false;
    g_spi_payload_len = 0;
    g_spi_transfer_count = 0;
    g_i2c_devices.clear();
    g_spi_parts.clear();
    
    // Free part contexts. Handles stay alive in g_parts, so null their impl
    // pointer rather than leaving a dangling reference behind.
    for (PartContext* ctx : g_part_impls) {
        delete ctx;
    }
    g_part_impls.clear();
    // The order vector holds raw pointers into g_parts. g_parts outlives the
    // reset (handles stay valid), so the pointers are not dangling, but keeping
    // them would let one entry appear twice once the next cycle registers the
    // same part ids again. A reset means an empty bus, so empty this too.
    g_part_order.clear();
    for (auto& entry : g_parts) {
        entry.second.impl = nullptr;
    }
}

} // namespace engine