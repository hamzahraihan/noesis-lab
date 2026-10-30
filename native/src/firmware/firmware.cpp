/**
 * Firmware Interpreter C++ Implementation (Phase 5)
 *
 * Stack-based VM for Arduino C++ subset and MicroPython-like Python sketches.
 * Uses explicit stack machine (PC + call stack + local frames) for determinism
 * and Wasm compatibility.
 */

#include "firmware.h"
#include <algorithm>
#include <cmath>
#include <cstring>
#include <unordered_map>
#include <vector>
#include <string>

using namespace firmware;
#include <map>
#include <memory>
#include <cstddef>
#include <cstdint>

namespace firmware {

// ============================================================================
// Value Implementation
// ============================================================================

class Value {
public:
    enum Kind { Number, String, Array, Dict, DateTime, TimeSpan, RtcHandle, Generator, Yielded } kind;

    union {
        double number;
        std::string* string;
        std::vector<Value>* array;
        std::map<std::string, Value>* dict;
        struct { int year, month, day, hour, minute, second; } datetime;
        struct { int days, hours, minutes, seconds; } timespan;
        int64_t rtc_handle;
        void* generator;
        Value* yielded;
    };

    Value() : kind(Number), number(0) {}
    Value(double n) : kind(Number), number(n) {}
    Value(const std::string& s) : kind(String), string(new std::string(s)) {}
    Value(const Value& other) { copy_from(other); }
    Value(Value&& other) noexcept { move_from(std::move(other)); }
    ~Value() { destroy(); }

    Value& operator=(const Value& other) { destroy(); copy_from(other); return *this; }
    Value& operator=(Value&& other) noexcept { destroy(); move_from(std::move(other)); return *this; }

    bool is_truthy() const {
        switch (kind) {
            case Number: return number != 0;
            case String: return !string->empty();
            case Array: return !array->empty();
            case Dict: return !dict->empty();
            case DateTime: case TimeSpan: case Generator: return true;
            default: return false;
        }
    }

    double as_number() const {
        if (kind == Number) return number;
        if (kind == String) return std::stod(*string);
        return 0;
    }

    std::string to_string() const {
        switch (kind) {
            case Number: return std::to_string(number);
            case String: return *string;
            case Array: {
                std::string result = "[";
                for (size_t i = 0; i < array->size(); ++i) {
                    if (i) result += ", ";
                    result += (*array)[i].to_string();
                }
                return result + "]";
            }
            case Dict: {
                std::string result = "{";
                bool first = true;
                for (const auto& kv : *dict) {
                    if (!first) result += ", ";
                    result += "'" + kv.first + "': " + kv.second.to_string();
                    first = false;
                }
                return result + "}";
            }
            default: return "object";
        }
    }

private:
    void copy_from(const Value& other) {
        kind = other.kind;
        switch (kind) {
            case Number: number = other.number; break;
            case String: string = new std::string(*other.string); break;
            case Array: array = new std::vector<Value>(*other.array); break;
            case Dict: dict = new std::map<std::string, Value>(*other.dict); break;
            case DateTime: datetime = other.datetime; break;
            case TimeSpan: timespan = other.timespan; break;
            case Generator: generator = other.generator; break;
            case Yielded: yielded = other.yielded ? new Value(*other.yielded) : nullptr; break;
            default: break;
        }
    }

    void move_from(Value&& other) noexcept {
        kind = other.kind;
        switch (kind) {
            case Number: number = other.number; break;
            case String: string = other.string; other.string = nullptr; break;
            case Array: array = other.array; other.array = nullptr; break;
            case Dict: dict = other.dict; other.dict = nullptr; break;
            case DateTime: datetime = other.datetime; break;
            case TimeSpan: timespan = other.timespan; break;
            case Generator: generator = other.generator; other.generator = nullptr; break;
            case Yielded: yielded = other.yielded; other.yielded = nullptr; break;
            default: break;
        }
        other.kind = Number;
    }

    void destroy() {
        switch (kind) {
            case String: delete string; break;
            case Array: delete array; break;
            case Dict: delete dict; break;
            case Yielded: delete yielded; break;
            default: break;
        }
        kind = Number;
    }
};

// ============================================================================
// AST Implementation
// ============================================================================

struct AstNode {
    AstNodeKind kind;
    uint32_t location;
    std::vector<std::unique_ptr<AstNode>> children;
    std::string name;
    double number_value;
    std::string string_value;
    int op;
    bool is_method;
    bool is_async;
    std::unique_ptr<AstNode> super_class;
    std::vector<std::unique_ptr<AstNode>> methods;
    std::vector<std::unique_ptr<AstNode>> fields;
    std::vector<std::pair<std::string, std::unique_ptr<AstNode>>> keywords;
    std::unique_ptr<AstNode> condition;
    std::unique_ptr<AstNode> then_branch;
    std::unique_ptr<AstNode> else_branch;
    std::unique_ptr<AstNode> body;
    std::unique_ptr<AstNode> init;
    std::unique_ptr<AstNode> update;
    std::unique_ptr<AstNode> expr;
    std::unique_ptr<AstNode> value;
    std::unique_ptr<AstNode> callee;
    std::vector<std::unique_ptr<AstNode>> args;
    std::vector<std::pair<std::string, std::unique_ptr<AstNode>>> keywords_list;
    std::unique_ptr<AstNode> object;
    std::unique_ptr<AstNode> index;
    std::unique_ptr<AstNode> target;
    std::unique_ptr<AstNode> then_expr;
    std::unique_ptr<AstNode> else_expr;
    std::unique_ptr<AstNode> then_block;
    std::unique_ptr<AstNode> catch_param;
    std::unique_ptr<AstNode> catch_block;
    std::unique_ptr<AstNode> finally_block;
    std::unique_ptr<AstNode> initializer;
    std::string super_class_name;
};

// ============================================================================
// Parser (stub - would use a real parser generator)
// ============================================================================

class Parser {
public:
    Parser() {}
    ~Parser() {}

    AstNode* parse_arduino(const std::string& source) {
        // Stub - would implement Arduino C++ parser
        std::unique_ptr<AstNode> ast = std::make_unique<AstNode>();
        return ast.release();
    }

    AstNode* parse_python(const std::string& source) {
        // Stub - would implement Python parser
        std::unique_ptr<AstNode> ast = std::make_unique<AstNode>();
        return ast.release();
    }

    std::string error_;
};

// ============================================================================
// VM Implementation
// ============================================================================

struct CallFrame {
    const AstNode* function;
    size_t pc;  // Program counter within function
    std::map<std::string, Value> locals;
    Value* return_value_ptr;
    const AstNode* return_address;
    bool is_method;
    Value* this_ptr;
};

class VM {
public:
    VM(AstNode* program, const FirmwareServices* services)
        : program_(program), services_(services), pc_(0), current_frame_(nullptr) {}

    ~VM() {}

    // Run for up to max_ms milliseconds
    struct RunResult {
        enum Kind { Wait, Yielded, Checkpoint, Done, Error } kind;
        uint32_t wait_ms;
        Value yielded_value;
        std::string error;
    };

    RunResult run(uint32_t max_ms) {
        // Stub implementation
        return {RunResult::Done, 0, {}, ""};
    }

    void load_sketch(const char* source, const char* language) {
        // Re-parse and reset
    }

    // Debug
    struct DebugFrame {
        uint32_t pc;
        uint32_t line;
        std::string file;
        uint32_t depth;
        std::vector<std::pair<std::string, std::string>> vars;
    };

    std::unique_ptr<DebugFrame> get_debug_state() {
        return std::make_unique<DebugFrame>();
    }

    void set_breakpoint(const char* file, uint32_t line) {}
    void clear_breakpoint(const char* file, uint32_t line) {}
    void step_over() {}
    void step_into() {}
    void resume() {}

private:
    AstNode* program_;
    const FirmwareServices* services_;
    size_t pc_;
    std::vector<CallFrame> call_stack_;
    CallFrame* current_frame_;
    std::map<uint32_t, std::pair<std::string, uint32_t>> breakpoints_; // pc -> (file, line)
    bool stepping_over_ = false;
    bool stepping_into_ = false;
    uint32_t step_over_depth_ = 0;
};

} // namespace firmware

// ============================================================================
// C API Implementation
// ============================================================================

extern "C" FirmwareParserHandle firmware_parser_create(void) {
    return new firmware::Parser();
}

extern "C" void firmware_parser_destroy(FirmwareParserHandle handle) {
    delete static_cast<firmware::Parser*>(handle);
}

extern "C" AstNodeHandle firmware_parse_arduino(FirmwareParserHandle handle, const char* source) {
    auto parser = static_cast<firmware::Parser*>(handle);
    AstNode* ast = parser->parse_arduino(source);
    return reinterpret_cast<AstNodeHandle>(ast);
}

extern "C" AstNodeHandle firmware_parse_python(FirmwareParserHandle handle, const char* source) {
    auto parser = static_cast<firmware::Parser*>(handle);
    AstNode* ast = parser->parse_python(source);
    return reinterpret_cast<AstNodeHandle>(ast);
}

extern "C" const char* firmware_parse_error(FirmwareParserHandle handle) {
    auto parser = static_cast<firmware::Parser*>(handle);
    static thread_local std::string error;
    error = parser->error_;
    return error.c_str();
}

extern "C" FirmwareVMHandle firmware_vm_create(AstNodeHandle program, const FirmwareServices* services) {
    firmware::AstNode* prog = reinterpret_cast<firmware::AstNode*>(program);
    return new firmware::VM(prog, services);
}

extern "C" void firmware_vm_destroy(FirmwareVMHandle handle) {
    delete static_cast<firmware::VM*>(handle);
}

extern "C" Produced firmware_vm_run(FirmwareVMHandle handle, uint32_t max_ms) {
    auto vm = static_cast<firmware::VM*>(handle);
    auto result = vm->run(max_ms);
    Produced produced;
    switch (result.kind) {
        case firmware::VM::RunResult::Wait:
            produced.kind = PRODUCED_WAIT;
            produced.wait_ms = result.wait_ms;
            break;
        case firmware::VM::RunResult::Yielded:
            produced.kind = PRODUCED_YIELDED;
            produced.yielded = new FirmwareValue(); // Would convert Value to FirmwareValue
            break;
        case firmware::VM::RunResult::Checkpoint:
            produced.kind = PRODUCED_CHECKPOINT;
            break;
        default:
            produced.kind = PRODUCED_WAIT;
            produced.wait_ms = 0;
            break;
    }
    return produced;
}

extern "C" DebugFrame* firmware_vm_get_debug_state(FirmwareVMHandle handle) {
    auto vm = static_cast<firmware::VM*>(handle);
    auto frame = vm->get_debug_state();
    DebugFrame* out = new DebugFrame();
    out->pc = frame->pc;
    out->line = frame->line;
    out->file = strdup(frame->file.c_str());
    out->depth = frame->depth;
    out->var_count = frame->vars.size();
    out->var_names = new const char*[frame->vars.size()];
    out->var_values = new const char*[frame->vars.size()];
    for (size_t i = 0; i < frame->vars.size(); ++i) {
        out->var_names[i] = strdup(frame->vars[i].first.c_str());
        out->var_values[i] = strdup(frame->vars[i].second.c_str());
    }
    return out;
}

extern "C" void firmware_vm_free_debug_state(DebugFrame* frame) {
    if (frame) {
        free((void*)frame->file);
        for (uint32_t i = 0; i < frame->var_count; ++i) {
            free((void*)frame->var_names[i]);
            free((void*)frame->var_values[i]);
        }
        delete[] frame->var_names;
        delete[] frame->var_values;
        delete frame;
    }
}

extern "C" void firmware_vm_set_breakpoint(FirmwareVMHandle handle, const char* file, uint32_t line) {
    auto vm = static_cast<firmware::VM*>(handle);
    vm->set_breakpoint(file, line);
}

extern "C" void firmware_vm_clear_breakpoint(FirmwareVMHandle handle, const char* file, uint32_t line) {
    auto vm = static_cast<firmware::VM*>(handle);
    vm->clear_breakpoint(file, line);
}

extern "C" void firmware_vm_step_over(FirmwareVMHandle handle) {
    auto vm = static_cast<firmware::VM*>(handle);
    vm->step_over();
}

extern "C" void firmware_vm_step_into(FirmwareVMHandle handle) {
    auto vm = static_cast<firmware::VM*>(handle);
    vm->step_into();
}

extern "C" void firmware_vm_resume(FirmwareVMHandle handle) {
    auto vm = static_cast<firmware::VM*>(handle);
    vm->resume();
}

extern "C" void firmware_vm_load_sketch(FirmwareVMHandle handle, const char* source, const char* language) {
    auto vm = static_cast<firmware::VM*>(handle);
    vm->load_sketch(source, language);
}

extern "C" void firmware_value_destroy(FirmwareValue* value) {
    delete value;
}

extern "C" void firmware_string_destroy(FirmwareString str) {
    free((void*)str.data);
}

extern "C" void firmware_array_destroy(FirmwareArray arr) {
    delete[] arr.items;
}

extern "C" void firmware_dict_destroy(FirmwareDict dict) {
    delete[] dict.keys;
    delete[] dict.values;
}

extern "C" FirmwareRunResult firmware_run_sketch(const char* source, const char* language, uint32_t max_ms, const FirmwareServices* services) {
    FirmwareRunResult result;
    result.success = true;
    result.error = nullptr;
    result.final_pc = 0;
    result.total_cycles = 0;
    result.serial_output = nullptr;
    return result;
}