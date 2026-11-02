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
        // switch, try, for_each can be added later
    };
};

struct Program {
    Stmt** stmts;
    int32_t stmt_count;
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

} // extern "C"
#endif