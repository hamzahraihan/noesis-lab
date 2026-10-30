/**
 * Firmware Interpreter C API (Phase 5)
 *
 * Stack-based VM for Arduino C++ subset and MicroPython-like Python sketches.
 * Replicates the TypeScript generator-based VM using an explicit stack machine
 * (program counter + call stack + local frames) for determinism and Wasm compatibility.
 */

#ifndef FIRMWARE_H
#define FIRMWARE_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

// ============================================================================
// Opaque Handle Types (C API)
// ============================================================================

typedef void* FirmwareVMHandle;
typedef void* FirmwareParserHandle;

// ============================================================================
// Value Types (matching TypeScript Value union)
// ============================================================================

typedef enum {
    FIRMWARE_VALUE_NUMBER = 0,
    FIRMWARE_VALUE_STRING = 1,
    FIRMWARE_VALUE_ARRAY = 2,
    FIRMWARE_VALUE_DICT = 3,
    FIRMWARE_VALUE_DATETIME = 4,
    FIRMWARE_VALUE_TIMESPAN = 5,
    FIRMWARE_VALUE_RTC_HANDLE = 6,
    FIRMWARE_VALUE_GENERATOR = 7,
    FIRMWARE_VALUE_YIELDED = 8,
} FirmwareValueKind;

typedef struct FirmwareValue FirmwareValue;

typedef struct {
    double value;
} FirmwareNumber;

typedef struct {
    const char* data;
    size_t length;
} FirmwareString;

typedef struct {
    FirmwareValue* items;
    size_t count;
    size_t capacity;
} FirmwareArray;

typedef struct {
    const char** keys;
    FirmwareValue* values;
    size_t count;
    size_t capacity;
} FirmwareDict;

typedef struct {
    int year;
    int month;
    int day;
    int hour;
    int minute;
    int second;
} FirmwareDateTime;

typedef struct {
    int days;
    int hours;
    int minutes;
    int seconds;
} FirmwareTimeSpan;

typedef struct {
    int64_t epoch;
} FirmwareRtcHandle;

typedef struct {
    void* handle;
} FirmwareGenerator;

typedef struct {
    FirmwareValue* value;
} FirmwareYielded;

struct FirmwareValue {
    FirmwareValueKind kind;
    union {
        FirmwareNumber number;
        FirmwareString string;
        FirmwareArray array;
        FirmwareDict dict;
        FirmwareDateTime datetime;
        FirmwareTimeSpan timespan;
        FirmwareRtcHandle rtc_handle;
        FirmwareGenerator generator;
        FirmwareYielded yielded;
    };
};

// ============================================================================
// AST Node Types (opaque in C API)
// ============================================================================

typedef enum {
    AST_PROGRAM = 0,
    AST_FUNCTION_DECL = 1,
    AST_CLASS_DECL = 2,
    AST_STMT_BLOCK = 3,
    AST_STMT_IF = 4,
    AST_STMT_WHILE = 5,
    AST_STMT_FOR = 6,
    AST_STMT_RETURN = 7,
    AST_STMT_BREAK = 8,
    AST_STMT_CONTINUE = 9,
    AST_STMT_EXPR = 10,
    AST_STMT_VAR_DECL = 11,
    AST_STMT_TRY = 12,
    AST_EXPR_NUMBER = 13,
    AST_EXPR_STRING = 14,
    AST_EXPR_IDENTIFIER = 15,
    AST_EXPR_BINARY = 16,
    AST_EXPR_UNARY = 17,
    AST_EXPR_CALL = 18,
    AST_EXPR_MEMBER = 19,
    AST_EXPR_INDEX = 20,
    AST_EXPR_ASSIGN = 21,
    AST_EXPR_TERNARY = 22,
    AST_EXPR_YIELD = 23,
    AST_EXPR_YIELD_FROM = 24,
} AstNodeKind;

// Opaque AST node handle for C API
typedef void* AstNodeHandle;

// ============================================================================
// VM State
// ============================================================================

typedef enum {
    FLOW_NORMAL = 0,
    FLOW_BREAK = 1,
    FLOW_CONTINUE = 2,
    FLOW_RETURN = 3,
} FlowKind;

typedef struct {
    FlowKind kind;
    FirmwareValue* value;  // For return
} Flow;

typedef enum {
    PRODUCED_WAIT = 0,      // DelayRequest (milliseconds)
    PRODUCED_YIELDED = 1,   // Yielded value
    PRODUCED_CHECKPOINT = 2, // Debugger checkpoint
} ProducedKind;

typedef struct {
    ProducedKind kind;
    union {
        uint32_t wait_ms;
        FirmwareValue* yielded;
    };
} Produced;

// ============================================================================
// Parser API
// ============================================================================

FirmwareParserHandle firmware_parser_create(void);
void firmware_parser_destroy(FirmwareParserHandle handle);

AstNodeHandle firmware_parse_arduino(FirmwareParserHandle handle, const char* source);
AstNodeHandle firmware_parse_python(FirmwareParserHandle handle, const char* source);
const char* firmware_parse_error(FirmwareParserHandle handle);

// ============================================================================
// VM API
// ============================================================================

typedef struct {
    // Host services (implemented by TypeScript, called from C++)
    uint32_t (*now_ms)(void);
    void (*pin_mode)(uint32_t pin, uint32_t mode);
    void (*digital_write)(uint32_t pin, uint32_t level);
    uint32_t (*digital_read)(uint32_t pin);
    void (*analog_write)(uint32_t pin, uint32_t value);
    uint32_t (*analog_read)(uint32_t pin);
    void (*serial_begin)(uint32_t baud);
    void (*serial_write)(const char* text);
    // I2C
    void (*wire_begin)(uint32_t sda, uint32_t scl);
    void (*wire_begin_transmission)(uint32_t address);
    void (*wire_write)(uint32_t value);
    uint32_t (*wire_end_transmission)(void);
    uint32_t (*wire_request_from)(uint32_t address, uint32_t count);
    uint32_t (*wire_read)(void);
    uint32_t (*wire_available)(void);
    // SPI
    void (*spi_begin)(void);
    uint32_t (*spi_transfer)(uint32_t value, uint32_t data_select);
    uint32_t (*spi_end)(void);
    // LCD
    uint32_t (*lcd_begin)(uint32_t columns, uint32_t rows);
    void (*lcd_clear)(void);
    void (*lcd_home)(void);
    void (*lcd_set_cursor)(uint32_t column, uint32_t row);
    void (*lcd_print)(const char* text);
    void (*lcd_write)(uint32_t value);
    void (*lcd_create_char)(uint32_t slot, const uint32_t* bitmap, uint32_t count);
    void (*lcd_backlight)(void);
    void (*lcd_no_backlight)(void);
    // Servo
    void (*servo_attach)(uint32_t pin);
    void (*servo_write)(uint32_t pin, uint32_t angle);
    uint32_t (*servo_read)(uint32_t pin);
    void (*servo_detach)(uint32_t pin);
    // TFT
    uint32_t (*tft_begin)(void);
    uint32_t (*tft_set_rotation)(uint32_t rotation);
    uint32_t (*tft_width)(void);
    uint32_t (*tft_height)(void);
    uint32_t (*tft_clear)(void);
    uint32_t (*tft_fill_rect)(uint32_t x, uint32_t y, uint32_t w, uint32_t h, uint32_t color);
    uint32_t (*tft_print)(const char* text, uint32_t x, uint32_t y, uint32_t color);
    uint32_t (*tft_text_width)(const char* text);
    uint32_t (*tft_text_height)(void);
    // DHT
    void (*dht_begin)(uint32_t pin);
    double (*dht_temperature)(uint32_t pin);
    double (*dht_humidity)(uint32_t pin);
    // OneWire
    double (*onewire_temperature)(uint32_t pin);
    // TM1637
    void (*tm1637_print)(uint32_t clk, uint32_t dio, const char* text);
    void (*tm1637_print_number)(uint32_t clk, uint32_t dio, int32_t value, uint32_t places);
    void (*tm1637_set_brightness)(uint32_t clk, uint32_t dio, uint32_t level);
    void (*tm1637_write)(uint32_t clk, uint32_t dio, uint32_t command, const uint32_t* data, uint32_t count);
    // IR
    uint32_t (*ir_read_code)(uint32_t pin);
    // Dialer
    int32_t (*dialer_read)(uint32_t pin);
    // SD
    uint32_t (*sd_begin)(uint32_t pin);
    uint32_t (*sd_write)(uint32_t pin, const char* name, const char* text);
    const char* (*sd_read)(uint32_t pin, const char* name);
    uint32_t (*sd_exists)(uint32_t pin, const char* name);
    uint32_t (*sd_remove)(uint32_t pin, const char* name);
    // Pixels
    uint32_t (*pixels_count)(uint32_t pin);
    void (*pixels_set_color)(uint32_t pin, uint32_t index, uint32_t r, uint32_t g, uint32_t b);
    // Net
    uint32_t (*net_join)(const char* ssid, const char* password);
    uint32_t (*net_status)(void);
    const char* (*net_local_ip)(void);
    uint32_t (*net_get)(const char* url);
    const char* (*net_read)(void);
    uint32_t (*net_failed)(void);
    uint32_t (*net_subscribe)(const char* topic);
    uint32_t (*net_available)(void);
    const char* (*net_message)(void);
    uint32_t (*net_publish)(const char* topic, const char* payload);
    void (*net_reset)(void);
    // Map
    uint32_t (*map_request)(uint32_t z, uint32_t x, uint32_t y);
    uint32_t (*map_blit)(uint32_t z, uint32_t x, uint32_t y, uint32_t dest_x, uint32_t dest_y);
    uint32_t (*map_ready)(void);
    void (*map_reset)(void);
    // PulseIn
    uint32_t (*pulse_in_begin)(uint32_t pin, uint32_t level, uint32_t timeout_us);
    void (*pulse_in_end)(void);
    // Debug
    void (*debug_print)(const char* msg);
} FirmwareServices;

FirmwareVMHandle firmware_vm_create(AstNodeHandle program, const FirmwareServices* services);
void firmware_vm_destroy(FirmwareVMHandle handle);

// Run the VM for up to max_ms milliseconds of simulated time.
// Returns a Produced indicating what happened.
Produced firmware_vm_run(FirmwareVMHandle handle, uint32_t max_ms);

// Debug API
typedef struct {
    uint32_t pc;
    uint32_t line;
    const char* file;
    uint32_t depth;
    // Variables
    const char** var_names;
    const char** var_values;
    uint32_t var_count;
} DebugFrame;

DebugFrame* firmware_vm_get_debug_state(FirmwareVMHandle handle);
void firmware_vm_free_debug_state(DebugFrame* frame);

void firmware_vm_set_breakpoint(FirmwareVMHandle handle, const char* file, uint32_t line);
void firmware_vm_clear_breakpoint(FirmwareVMHandle handle, const char* file, uint32_t line);
void firmware_vm_step_over(FirmwareVMHandle handle);
void firmware_vm_step_into(FirmwareVMHandle handle);
void firmware_vm_resume(FirmwareVMHandle handle);

// Load sketch
void firmware_vm_load_sketch(FirmwareVMHandle handle, const char* source, const char* language);

// Memory management for values returned to host
void firmware_value_destroy(FirmwareValue* value);
void firmware_string_destroy(FirmwareString str);
void firmware_array_destroy(FirmwareArray arr);
void firmware_dict_destroy(FirmwareDict dict);

// ============================================================================
// High-level API for TypeScript
// ============================================================================

// Load and run a sketch, returning final state
typedef struct {
    bool success;
    const char* error;
    uint32_t final_pc;
    uint32_t total_cycles;
    const char* serial_output;
} FirmwareRunResult;

FirmwareRunResult firmware_run_sketch(const char* source, const char* language, uint32_t max_ms, const FirmwareServices* services);

#ifdef __cplusplus
} // extern "C"

// C++ forward declarations for internal use
namespace firmware {
    struct AstNode;
    class Parser;
    class VM;
}
#endif

#endif // FIRMWARE_H