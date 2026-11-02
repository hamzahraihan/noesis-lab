#ifndef FIRMWARE_H
#define FIRMWARE_H

#include <stdint.h>
#include <stddef.h>

struct SourceLocation {
    int32_t line;
    int32_t column;
    const char* file;  // pointer into wasm linear memory
};

enum TokenKind : uint8_t {
    TOKEN_NUMBER,
    TOKEN_STRING,
    TOKEN_CHAR,
    TOKEN_IDENTIFIER,
    TOKEN_PUNCTUATION,
    TOKEN_KEYWORD,
    TOKEN_DIRECTIVE,
    TOKEN_EOF,
};

struct Token {
    uint8_t kind;       // TokenKind
    const char* text;   // pointer into wasm linear memory
    double value;       // for NUMBER tokens
    int32_t line;
    int32_t column;
    const char* file;   // pointer into wasm linear memory
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

} // extern "C"
#endif