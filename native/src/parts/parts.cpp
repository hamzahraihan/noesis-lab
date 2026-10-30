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
#include <cstring>
#include <unordered_map>
#include <vector>

namespace engine {

// ============================================================================
// Device-Specific Context Structures
// ============================================================================

// PCF8574 - 8-bit I/O expander with quasi-bidirectional pins
struct PCF8574Context {
    uint8_t output_reg = 0xFF;  // All pins high (weak pull-up) at reset
    uint8_t input_reg = 0xFF;   // Input latch
};

// MCP23017 - 16-bit I/O expander with full bidirectional ports
struct MCP23017Context {
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
};

// PCA9685 - 16-channel 12-bit PWM driver
struct PCA9685Context {
    uint8_t mode1 = 0x00;
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
    bool auto_increment = true;
};

// SSD1306 - OLED display controller
struct SSD1306Context {
    uint8_t width;
    uint8_t height;
    uint8_t pages;
    std::vector<uint8_t> framebuffer;
    uint8_t column_start = 0;
    uint8_t column_end = 127;
    uint8_t page_start = 0;
    uint8_t page_end = 7;
    uint8_t display_on = 0;
    uint8_t contrast = 0x7F;
    uint8_t charge_pump = 0x10;
    uint8_t memory_mode = 0x00;  // Horizontal addressing
    uint8_t com_pins = 0x02;
    uint8_t com_scan_dir = 0xC0;
    uint8_t display_offset = 0x00;
    uint8_t display_clock_div = 0x80;
    uint8_t precharge = 0xF1;
    uint8_t vcom_detect = 0x40;
    uint8_t reg_ptr = 0x00;
    bool expecting_data = false;  // After 0x40 (data) vs 0x00 (command)
};

// ADS1115 - 16-bit ADC
struct ADS1115Context {
    uint16_t config = 0x8583;  // Default: AIN0, +/-6.144V, single-shot, 128SPS
    uint16_t lo_thresh = 0x8000;
    uint16_t hi_thresh = 0x7FFF;
    uint16_t conversion = 0x0000;
    uint8_t reg_ptr = 0x00;
    uint32_t conversion_start = 0;
    bool conversion_ready = true;
    // Simulated input voltages (from knobs)
    double input_voltage[4] = {0.0, 0.0, 0.0, 0.0};
};

// MCP4725 - 12-bit DAC
struct MCP4725Context {
    uint16_t dac_value = 0x0000;  // 12-bit value
    uint8_t power_down = 0x00;
    bool eeprom_write = false;
    uint8_t reg_ptr = 0x00;
    bool multi_byte = false;
    uint8_t write_buffer[3];
    uint8_t write_count = 0;
};

// MAX6675 - Thermocouple (SPI)
struct MAX6675Context {
    int16_t temp_quarter_deg = 0;  // Temperature in 0.25°C steps
    bool fault = false;  // Open thermocouple detection
};

// MFRC522 - RFID reader (SPI)
struct MFRC522Context {
    enum State { IDLE, AUTHENTICATING, TRANSCEIVING, CALCULATING_CRC } state = IDLE;
    uint8_t fifo[64];
    uint8_t fifo_level = 0;
    uint8_t command = 0x00;
    uint8_t reg_ptr = 0x00;
    uint8_t uid[4] = {0x12, 0x34, 0x56, 0x78};  // Default card UID
    bool card_present = true;
    uint8_t key_a[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};
    uint8_t key_b[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};
};

// ILI9341 - TFT display (SPI)
struct ILI9341Context {
    uint16_t width;
    uint16_t height;
    std::vector<uint16_t> framebuffer;  // RGB565
    uint8_t reg_ptr = 0x00;
    bool data_mode = false;  // DC pin state
    // Command state machine
    uint8_t cmd_args[16];
    uint8_t cmd_arg_count = 0;
    uint8_t expected_args = 0;
};

// MAX7219 - 8x8 LED matrix (SPI)
struct MAX7219Context {
    uint8_t decode_mode = 0x00;
    uint8_t intensity = 0x00;
    uint8_t scan_limit = 0x07;
    uint8_t shutdown = 0x00;
    uint8_t display_test = 0x00;
    uint8_t digit_data[8] = {0};
    uint8_t reg_ptr = 0x00;
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

struct SPIPartImpl {
    uint32_t part_id;
    uint32_t cs_net;
    uint32_t dc_net;  // For displays
    // Function pointers
    void (*receive)(void* ctx, uint8_t byte, bool data_select, bool chip_selected);
    void* ctx;
};

static std::vector<SPIPartImpl> g_spi_parts;

// Part implementations
static std::vector<void*> g_part_impls;  // Owned pointers

// ============================================================================
// Utility Functions
// ============================================================================

inline double voltageOfNet(SolverSolution* sol, int32_t net) {
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
    g_spi_selected = false;
    g_spi_saw_byte = false;
    g_spi_payload_len = 0;
}

extern "C" uint8_t spi_bus_transfer(uint8_t byte, bool data_select, bool chip_selected) {
    if (!g_spi_selected) return 0;
    
    if (g_spi_payload_len < 256) {
        g_spi_payload[g_spi_payload_len++] = {byte, data_select};
    }
    
    // Deliver to registered SPI parts
    for (auto& part : g_spi_parts) {
        if (part.receive) {
            part.receive(part.ctx, byte, data_select, chip_selected);
        }
    }
    
    // Return MISO data (simplified - returns 0 for now)
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
    
    if (dev->seqop) {
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
        dev->auto_increment = (dev->mode1 & 0x20) != 0;
        return true;
    }
    
    uint8_t reg = dev->reg_ptr;
    switch (reg) {
        case 0x00: dev->mode1 = byte; dev->auto_increment = (byte & 0x20) != 0; break;
        case 0x01: dev->mode2 = byte; break;
        case 0xFE: dev->prescale = byte; break;
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
        dev->reg_ptr = byte;
        dev->expecting_data = (byte == 0x40);
        return true;
    }
    
    if (dev->expecting_data) {
        uint16_t page = dev->page_start;
        uint16_t col = dev->column_start;
        size_t idx = page * dev->width + col;
        if (idx < dev->framebuffer.size()) {
            dev->framebuffer[idx] = byte;
        }
        dev->column_start++;
        if (dev->column_start > dev->column_end) {
            dev->column_start = 0;
            dev->page_start = (dev->page_start + 1) % dev->pages;
        }
        return true;
    }
    
    switch (dev->reg_ptr) {
        case 0x00: dev->column_start = (dev->column_start & 0xF0) | (byte & 0x0F); break;
        case 0x10: dev->column_start = (dev->column_start & 0x0F) | ((byte & 0x0F) << 4); break;
        case 0xB0: case 0xB1: case 0xB2: case 0xB3:
        case 0xB4: case 0xB5: case 0xB6: case 0xB7:
            dev->page_start = dev->reg_ptr & 0x07; break;
        case 0x81: dev->contrast = byte; break;
        case 0x8D: dev->charge_pump = byte; break;
        case 0xAE: case 0xAF:
            dev->display_on = (dev->reg_ptr == 0xAF) ? 1 : 0; break;
        case 0xC0: case 0xC8: dev->com_scan_dir = dev->reg_ptr; break;
        case 0xD3: dev->display_offset = byte; break;
        case 0xD5: dev->display_clock_div = byte; break;
        case 0xD9: dev->precharge = byte; break;
        case 0xDA: dev->com_pins = byte; break;
        case 0xDB: dev->vcom_detect = byte; break;
        case 0x20: dev->memory_mode = byte; break;
        case 0x21: dev->column_start = byte; break;
        case 0x22: dev->page_start = byte; break;
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
        return true;
    }
    
    static uint8_t first_byte = 0;
    static bool have_first = false;
    
    if (!have_first) {
        first_byte = byte;
        have_first = true;
        return true;
    }
    
    uint16_t value = (static_cast<uint16_t>(first_byte) << 8) | byte;
    have_first = false;
    
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

// ============================================================================
// SPI Device Callback Implementations
// ============================================================================

static void spi_max6675_receive(void* ctx, uint8_t byte, bool data_select, bool chip_selected) {
    (void)ctx; (void)byte; (void)data_select; (void)chip_selected;
}

static int16_t spi_max6675_receive_read(void* ctx) {
    MAX6675Context* dev = static_cast<MAX6675Context*>(ctx);
    uint16_t value = static_cast<uint16_t>(dev->temp_quarter_deg) << 3;
    if (dev->fault) value |= 0x0001;
    return static_cast<int16_t>(value);
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

static void spi_ili9341_receive(void* ctx, uint8_t byte, bool data_select, bool chip_selected) {
    ILI9341Context* dev = static_cast<ILI9341Context*>(ctx);
    if (!chip_selected) return;
    
    if (data_select) {
        if (dev->expected_args > 0) {
            if (dev->cmd_arg_count < 16) {
                dev->cmd_args[dev->cmd_arg_count++] = byte;
                dev->expected_args--;
            }
        }
    } else {
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
    }
}

static void spi_max7219_receive(void* ctx, uint8_t byte, bool data_select, bool chip_selected) {
    MAX7219Context* dev = static_cast<MAX7219Context*>(ctx);
    if (!chip_selected) return;
    
    if (data_select) {
        switch (dev->reg_ptr) {
            case 0x01: case 0x02: case 0x03: case 0x04:
            case 0x05: case 0x06: case 0x07: case 0x08:
                dev->digit_data[dev->reg_ptr - 1] = byte; break;
            case 0x09: dev->decode_mode = byte; break;
            case 0x0A: dev->intensity = byte & 0x0F; break;
            case 0x0B: dev->scan_limit = byte & 0x07; break;
            case 0x0C: dev->shutdown = byte & 0x01; break;
            case 0x0F: dev->display_test = byte & 0x01; break;
        }
    } else {
        dev->reg_ptr = byte;
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

extern "C" void part_stamp(void* handle, double time_ms) {
    PartInstance* inst = static_cast<PartInstance*>(handle);
    // Kind-specific stamping would go here
    // This is where each part adds its elements to the solver
}

extern "C" PartStateSnapshot part_get_state(void* handle) {
    PartStateSnapshot snap = {};
    PartInstance* inst = static_cast<PartInstance*>(handle);
    // Fill in kind-specific state
    return snap;
}

extern "C" void part_set_knob(void* handle, const char* knob_name, double value) {
    // Kind-specific knob handling
}

extern "C" void part_set_pin_level(void* handle, uint32_t pin_index, bool high) {
    // Kind-specific pin handling
}

extern "C" void part_set_i2c_address(void* handle, uint8_t address) {
    // For I2C devices
}

// ============================================================================
// Part Factory Functions (implemented with correct signatures)
// ============================================================================

extern "C" void* part_create_relay(uint32_t part_id, double coil_ohms, double contact_ohms) {
    part_register(part_id, PART_KIND_RELAY, "{}");
    return &g_parts[part_id];
}

extern "C" void* part_create_servo(uint32_t part_id) {
    part_register(part_id, PART_KIND_SERVO, "{}");
    return &g_parts[part_id];
}

extern "C" void* part_create_stepper(uint32_t part_id, double step_angle_deg) {
    part_register(part_id, PART_KIND_STEPPER, "{}");
    return &g_parts[part_id];
}

extern "C" void* part_create_stepper_driver(uint32_t part_id, double output_ohms) {
    part_register(part_id, PART_KIND_STEPPER_DRIVER, "{}");
    return &g_parts[part_id];
}

extern "C" void* part_create_shift_register(uint32_t part_id) {
    part_register(part_id, PART_KIND_SHIFT_REGISTER, "{}");
    return &g_parts[part_id];
}

extern "C" void* part_create_display_i2c(uint32_t part_id, uint8_t address, uint16_t width, uint16_t height) {
    part_register(part_id, PART_KIND_DISPLAY_I2C, "{}");
    return &g_parts[part_id];
}

extern "C" void* part_create_display_spi(uint32_t part_id, uint16_t width, uint16_t height, bool has_dc) {
    part_register(part_id, PART_KIND_DISPLAY_SPI, "{}");
    return &g_parts[part_id];
}

extern "C" void* part_create_7segment(uint32_t part_id, uint8_t digits) {
    part_register(part_id, PART_KIND_DISPLAY_7SEG, "{}");
    return &g_parts[part_id];
}

extern "C" void* part_create_lcd(uint32_t part_id, uint8_t cols, uint8_t rows) {
    part_register(part_id, PART_KIND_DISPLAY_LCD, "{}");
    return &g_parts[part_id];
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
    // RTC uses I2C but we'll implement a simple stub for now
    void* handle = part_register(part_id, PART_KIND_RTC, "{}");
    PartInstance* inst = static_cast<PartInstance*>(handle);
    // TODO: Implement DS1307/DS3231 register map
    return handle;
}

extern "C" void* part_create_sensor_i2c(uint32_t part_id, uint8_t type, uint8_t address) {
    // Generic I2C sensor - could be BH1750, BMP180, SHT31, etc.
    void* handle = part_register(part_id, PART_KIND_SENSOR_I2C, "{}");
    PartInstance* inst = static_cast<PartInstance*>(handle);
    // TODO: Implement specific sensor types based on 'type' parameter
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
    g_spi_parts.push_back(spi_part);
    return handle;
}

extern "C" void* part_create_neopixel(uint32_t part_id, uint16_t count) {
    void* handle = part_register(part_id, PART_KIND_NEOPIXEL, "{}");
    PartInstance* inst = static_cast<PartInstance*>(handle);
    // NeoPixel uses 1-wire protocol on a GPIO pin, not SPI/I2C
    // Implementation would be in part_stamp
    return handle;
}

extern "C" void* part_create_sonar(uint32_t part_id) {
    void* handle = part_register(part_id, PART_KIND_SONAR, "{}");
    PartInstance* inst = static_cast<PartInstance*>(handle);
    // HC-SR04 uses trigger/echo GPIO pins
    return handle;
}

extern "C" void* part_create_button(uint32_t part_id) {
    void* handle = part_register(part_id, PART_KIND_BUTTON, "{}");
    PartInstance* inst = static_cast<PartInstance*>(handle);
    // Simple GPIO button
    return handle;
}

extern "C" void* part_create_potentiometer(uint32_t part_id, double max_ohms) {
    void* handle = part_register(part_id, PART_KIND_POTENTIOMETER, "{}");
    PartInstance* inst = static_cast<PartInstance*>(handle);
    // 3-terminal analog device
    return handle;
}

extern "C" void* part_create_power_supply(uint32_t part_id, double initial_volts) {
    void* handle = part_register(part_id, PART_KIND_POWER_SUPPLY, "{}");
    PartInstance* inst = static_cast<PartInstance*>(handle);
    // Voltage source with current limit
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

// SPI Display factory
extern "C" void* part_create_display_spi(uint32_t part_id, uint16_t width, uint16_t height, bool has_dc) {
    void* handle = part_register(part_id, PART_KIND_DISPLAY_SPI, "{}");
    PartInstance* inst = static_cast<PartInstance*>(handle);
    
    ILI9341Context* ctx = new ILI9341Context();
    ctx->width = width;
    ctx->height = height;
    ctx->framebuffer.resize(width * height, 0x0000);
    inst->impl = ctx;
    g_part_impls.push_back(ctx);
    
    SPIPartImpl spi_part;
    spi_part.part_id = part_id;
    spi_part.cs_net = 0;
    spi_part.dc_net = has_dc ? 1 : 0;
    spi_part.ctx = ctx;
    spi_part.receive = spi_ili9341_receive;
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
}

} // namespace engine