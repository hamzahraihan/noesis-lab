#ifndef FIRMWARE_H
#define FIRMWARE_H

#include <stdint.h>
#include <stddef.h>

struct SourceLocation {
    int32_t line;
    int32_t column;
    const char* file;  // pointer into wasm linear memory
};

enum class TokenKind : uint8_t {
    TOKEN_NUMBER,
    TOKEN_STRING,
    TOKEN_CHAR,
    TOKEN_IDENTIFIER,
    TOKEN_PUNCTUATION,
    TOKEN_KEYWORD,
    TOKEN_DIRECTIVE,
    EOF_,
};

struct Token {
    uint8_t kind;       // TokenKind
    const char* text;   // pointer into wasm linear memory
    double value;       // for NUMBER tokens
    int32_t line;
    int32_t column;
    const char* file;   // pointer into wasm linear memory
};

// AST node kinds - matches TypeScript parser.ts
enum class StmtKind : uint8_t {
    EXPRESSION,
    DECLARATION,
    IF,
    IF_ELSE,
    WHILE,
    DO_WHILE,
    FOR,
    BLOCK,
    RETURN,
    BREAK,
    CONTINUE,
    SWITCH,
    CLASS_DECL,
    VAR_DECL,
    ARRAY_DECL,
    INSTANCE_DECL,
    EMPTY,
    TRY,
    RAISE,
    FOR_EACH,
    FUNCTION_DECL,
};

enum class ExprKind : uint8_t {
    NUMBER,
    STRING,
    BOOLEAN,
    IDENTIFIER,
    CALL,
    MEMBER,
    ASSIGN,
    BINARY,
    UNARY,
    TERNARY,
    ARRAY,        // list in TS
    INDEX,
    NEW,
    DICT,
    COMPREHENSION,
    YIELD,
    YIELD_FROM,
};

struct Expr;
struct Stmt;

struct Expr {
    ExprKind kind;
    SourceLocation location;
    union {
        double number;
        const char* string_val;
        bool boolean_val;
        const char* identifier;
        struct {
            Expr* callee;
            Expr** args;
            int32_t arg_count;
        } call;
        struct {
            Expr* target;
            const char* member;
        } member;
        struct {
            Expr* target;
            const char* op;  // operator string
            Expr* value;
        } assign;
        struct {
            Expr* left;
            const char* op;
            Expr* right;
        } binary;
        struct {
            const char* op;
            Expr* operand;
        } unary;
        struct {
            Expr* cond;
            Expr* then_;
            Expr* else_;
        } ternary;
        struct {
            Expr** elements;
            int32_t count;
        } array;
        struct {
            Expr* target;
            Expr* index;
        } index;
        struct {
            Expr** entries_keys;
            Expr** entries_values;
            int32_t count;
        } dict;
    };
};

struct Stmt {
    StmtKind kind;
    SourceLocation location;
    union {
        Expr* expr;
        struct { const char* name; Expr* init; } decl;
        struct { const char* name; int32_t size; Expr** init; int32_t init_count; } array_decl;
        struct { const char* class_name; const char* name; Expr** args; int32_t arg_count; } instance_decl;
        struct { Expr* cond; Stmt* then_; Stmt* else_; } ite;
        struct { Expr* cond; Stmt* body; } loop;
        struct { Stmt* init; Expr* cond; Expr* update; Stmt* body; } for_loop;
        struct { Stmt** stmts; int32_t count; } block;
        struct { Expr* value; } ret;
        struct { const char* name; Expr* value; } raise;
        // Function declaration
        struct { const char* name; const char** params; int32_t param_count; Stmt* body; } func_decl;
        // switch, try, for_each can be added later
    };
};

struct Program {
    Stmt** stmts;
    int32_t stmt_count;
};

/**
 * A runtime value matching the TypeScript Value type from interpreter.ts:
 *   number | string | number[] | Value[] | DictValue | DateTimeValue | TimeSpanValue | RtcHandle | null
 * 
 * Uses a tagged union with a type discriminator and a payload union.
 * For complex types (STRING, ARRAY, DATETIME, TIMESPAN, RTC), the payload
 * holds an opaque handle (offset into VM heap for strings/arrays, or
 * special encoding for datetime/timespan/rtc).
 */
enum class ValueType : uint8_t {
    NUMBER,
    STRING,
    ARRAY,
    DATETIME,
    TIMESPAN,
    RTC,
    NULL_,
};

struct Value {
    ValueType type;
    union {
        double number;
        const char* string;  // pointer into VM heap
        struct { Value* elements; int32_t count; } array;
        // datetime/timespan/rtc as opaque handles
        int64_t opaque;
    };
};

// Execution result for statement control flow
enum class ExecResult : uint8_t {
    OK,
    RETURN_VALUE,
    BREAK,
    CONTINUE,
    YIELD_MS,
};

// Debug state for VM inspection
struct VMDebugState {
    int32_t pc;                // Current statement index in current frame
    int32_t frame_count;       // Number of active frames
    int32_t simulated_ms;      // Simulated time
    int32_t yield_until_ms;    // When yield will complete (-1 = not yielding)
    bool halted;               // Whether VM is halted
    bool hit_breakpoint;       // Whether a breakpoint was hit
    int32_t current_line;      // Current source line (if available)
    const char* current_file;  // Current source file (if available)
};

// Breakpoint identifier
typedef int32_t BreakpointId;

// Forward declaration
struct Scope;

// VM call frame
struct Frame {
    const Stmt** stmts;
    int32_t stmt_count;
    int32_t pc;  // current statement index
    Scope* locals;
    Value return_value;
};

// Variable scope for variable lookup
struct Scope {
    // Variable bindings: name -> Value
    struct Binding {
        const char* name;
        Value value;
        Binding* next;
    };
    Binding* bindings = nullptr;
    Scope* parent = nullptr;
    
    // Array bindings: name -> {elements, count}
    struct ArrayBinding {
        const char* name;
        Value* elements;
        int32_t count;
        ArrayBinding* next;
    };
    ArrayBinding* arrays = nullptr;
};

// Loop frame for BREAK/CONTINUE unwinding
struct LoopFrame {
    Frame* frame;         // The frame containing the loop
    int32_t stmt_index;   // Statement index of the loop in the frame
    LoopFrame* next;      // Previous loop frame
};

// Virtual Machine
struct VM {
    // Bump-allocator arena for this VM's heap
    uintptr_t heap_top = 0;
    Frame* frames = nullptr;
    int32_t frame_count = 0;
    int32_t frame_capacity = 0;
    Scope* global_scope = nullptr;
    int32_t yield_until_ms = -1;  // -1 = not yielding
    int32_t simulated_ms = 0;
    bool halted = false;
    bool hit_breakpoint = false;
    // Serial output buffer
    char* serial_buf = nullptr;
    int32_t serial_buf_len = 0;
    int32_t serial_buf_cap = 0;
    // Pin levels (mirrors parts.wasm GPIO)
    bool pin_levels[64];
    // Breakpoint support
    struct Breakpoint {
        const char* file;
        int32_t line;
        BreakpointId id;
        Breakpoint* next;
    };
    Breakpoint* breakpoints = nullptr;
    BreakpointId next_breakpoint_id = 1;
    // Loop frame stack for BREAK/CONTINUE
    LoopFrame* loop_frames = nullptr;
};

extern "C" {

// Tokenize a sketch source. Returns count; writes tokens into `out` (caller-allocated).
// `out_capacity` is the size of the out array. Returns number of tokens written,
// or negative on error.
int32_t vm_tokenize(
    const char* source,
    int32_t source_len,
    Token* out,
    int32_t out_capacity,
    const char* file,
    int32_t file_len
);

// Parse a sketch source. Returns Program* or nullptr on error.
Program* vm_parse(
    const char* source,
    int32_t source_len,
    const char* file,
    int32_t file_len
);

// Free the entire AST arena.
void vm_free_program(Program* program);

// Serialize AST to JSON string in wasm memory. Returns length written, or negative on error.
// `out` must have capacity `out_capacity`. The JSON is null-terminated.
int32_t vm_ast_to_json(Program* program, char* out, int32_t out_capacity);

// VM API
VM* vm_create(void);
void vm_destroy(VM* vm);
int32_t vm_load_sketch(VM* vm, Program* program);
// Run for up to `milliseconds`. Returns milliseconds actually consumed,
// or negative if a yield (delay) is pending (return value = -ms_until_ready).
int32_t vm_run(VM* vm, int32_t milliseconds);
// Single-step: execute exactly one statement. Returns milliseconds consumed,
// or negative if a yield is pending, or 0 if halted.
int32_t vm_step(VM* vm);
// Get debug state for inspection
VMDebugState vm_get_debug_state(VM* vm);
// Breakpoint management
BreakpointId vm_set_breakpoint(VM* vm, const char* file, int32_t line);
void vm_clear_breakpoint(VM* vm, BreakpointId id);
int32_t vm_pin_level(VM* vm, uint8_t pin);
void vm_set_pin_level(VM* vm, uint8_t pin, bool high);
const char* vm_serial_output(VM* vm);  // pointer into wasm memory, valid until next vm_run

} // extern "C"
#endif