/**
 * Firmware lexer (tokenizer) ported from TypeScript parser.ts tokenize().
 *
 * This is a freestanding C++20 implementation for wasm32. No libc, no exceptions,
 * no RTTI. Uses engine::alloc_bytes for heap allocations and engine::streq for
 * string comparison.
 */
#include "firmware.h"
#include "engine.h"

namespace firmware {

// Keyword set (matches TS parser.ts KEYWORDS exactly, lines 62-107)
static const char* KEYWORDS[] = {
    "void", "int", "float", "double", "bool", "char", "byte",
    "long", "short", "unsigned", "signed", "const", "static",
    "volatile", "true", "false", "if", "else", "while", "do",
    "for", "return", "break", "continue", "switch", "case",
    "default", "HIGH", "LOW", "INPUT", "OUTPUT", "INPUT_PULLUP",
    "class", "public", "private", "protected",
    "uint8_t", "int8_t", "uint16_t", "int16_t", "uint32_t", "int32_t",
    nullptr
};

static bool isKeyword(const char* text) {
    for (int i = 0; KEYWORDS[i] != nullptr; i++) {
        if (engine::streq(text, KEYWORDS[i])) return true;
    }
    return false;
}

// Punctuation list (longest-first, matches TS parser.ts lines 110-159)
static const char* PUNCTUATION[] = {
    "<<=", ">>=", "...", "==", "!=", "<=", ">=", "&&", "||",
    "++", "--", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=",
    "<<", ">>", "->", "::", "{", "}", "(", ")", "[", "]",
    ";", ",", ".", "+", "-", "*", "/", "%", "=",
    "<", ">", "!", "~", "&", "|", "^", "?", ":", "#",
    nullptr
};

// Helper to check if character is ASCII letter or underscore
static inline bool isAlphaUnderscore(char c) {
    return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c == '_';
}

// Helper to check if character is ASCII alphanumeric or underscore
static inline bool isAlnumUnderscore(char c) {
    return isAlphaUnderscore(c) || (c >= '0' && c <= '9');
}

// Helper to check if character is hex digit
static inline bool isHexDigit(char c) {
    return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
}

// Helper to check if character is digit
static inline bool isDigit(char c) {
    return c >= '0' && c <= '9';
}

// Helper to copy string to wasm heap and return pointer
static const char* copyToHeap(const char* src, int32_t len) {
    if (len <= 0) return "";
    uint32_t ptr = engine::alloc_bytes(static_cast<uint32_t>(len) + 1);
    if (ptr == 0) return "";
    char* dst = reinterpret_cast<char*>(ptr);
    for (int32_t i = 0; i < len; i++) {
        dst[i] = src[i];
    }
    dst[len] = '\0';
    return dst;
}



static int32_t tokenizeImpl(
    const char* source,
    int32_t source_len,
    Token* out,
    int32_t out_capacity,
    const char* file,
    int32_t file_len
) {
    // Debug: log input
    // engine::js_log1p(0); // placeholder for debug

    const char* file_ptr = copyToHeap(file, file_len);

    int32_t index = 0;
    int32_t line = 1;
    int32_t column = 1;
    int32_t token_count = 0;

    auto advance = [&](int32_t count) {
        for (int32_t i = 0; i < count; i++) {
            if (index >= source_len) break;
            if (source[index] == '\n') {
                line++;
                column = 1;
            } else {
                column++;
            }
            index++;
        }
    };

    auto readQuoted = [&](char quote) -> const char* {
        advance(1); // skip opening quote
        int32_t start = index;
        int32_t unescaped_len = 0;
        
        // First pass: calculate unescaped length
        int32_t scan_idx = start;
        while (scan_idx < source_len && source[scan_idx] != quote) {
            if (source[scan_idx] == '\\') {
                int32_t next_idx = scan_idx + 1;
                if (next_idx < source_len) {
                    unescaped_len++;
                    scan_idx += 2;
                    continue;
                }
            }
            unescaped_len++;
            scan_idx++;
        }
        // scan_idx is now at closing quote (or end)
        
        // Allocate
        uint32_t ptr = engine::alloc_bytes(static_cast<uint32_t>(unescaped_len) + 1);
        if (ptr == 0) return "";
        char* dst = reinterpret_cast<char*>(ptr);

        // Second pass: fill - use advance() to properly track line/column
        int32_t dst_idx = 0;
        index = start;
        while (index < source_len && source[index] != quote) {
            if (source[index] == '\\') {
                int32_t next_idx = index + 1;
                if (next_idx < source_len) {
                    char next = source[next_idx];
                    char unescaped = next;
                    if (next == 'n') unescaped = '\n';
                    else if (next == 't') unescaped = '\t';
                    else if (next == '\\') unescaped = '\\';
                    else unescaped = next;
                    dst[dst_idx++] = unescaped;
                    advance(2); // skip escape sequence
                    continue;
                }
            }
            dst[dst_idx++] = source[index];
            advance(1);
        }
        dst[dst_idx] = '\0';
        advance(1); // skip closing quote
        return dst;
    };

    while (index < source_len) {
        char ch = source[index];

        // Debug: log character
        // if (index < 20) engine::js_log1p(ch);

        // Whitespace
        if (ch == ' ' || ch == '\t' || ch == '\r' || ch == '\n') {
            advance(1);
            continue;
        }

        // Line comment
        if (ch == '/' && index + 1 < source_len && source[index + 1] == '/') {
            while (index < source_len && source[index] != '\n') advance(1);
            continue;
        }

        // Block comment
        if (ch == '/' && index + 1 < source_len && source[index + 1] == '*') {
            advance(2);
            while (index < source_len && !(source[index] == '*' && index + 1 < source_len && source[index + 1] == '/')) {
                advance(1);
            }
            advance(2);
            continue;
        }

        int32_t token_line = line;
        int32_t token_column = column;

        // Preprocessor directive
        if (ch == '#') {
            int32_t start = index;
            while (index < source_len && source[index] != '\n') advance(1);
            int32_t len = index - start;
            if (token_count >= out_capacity) return -1; // buffer full
            out[token_count].kind = static_cast<uint8_t>(TokenKind::TOKEN_DIRECTIVE);
            out[token_count].text = copyToHeap(source + start, len);
            out[token_count].value = 0;
            out[token_count].line = token_line;
            out[token_count].column = token_column;
            out[token_count].file = file_ptr;
            token_count++;
            continue;
        }

        // String or character literal
        if (ch == '"' || ch == '\'') {
            const char* text = readQuoted(ch);
            if (token_count >= out_capacity) return -1;
            out[token_count].kind = (ch == '"') ? static_cast<uint8_t>(TokenKind::TOKEN_STRING)
                                                  : static_cast<uint8_t>(TokenKind::TOKEN_CHAR);
            out[token_count].text = text;
            out[token_count].value = 0;
            out[token_count].line = token_line;
            out[token_count].column = token_column;
            out[token_count].file = file_ptr;
            token_count++;
            continue;
        }

        // Number literal
        if (isDigit(ch) || (ch == '.' && index + 1 < source_len && isDigit(source[index + 1]))) {
            int32_t start = index;
            // Read digits, hex prefix, decimal point
            while (index < source_len) {
                char c = source[index];
                if (isDigit(c) || isHexDigit(c) || c == 'x' || c == 'X' || c == '.') {
                    advance(1);
                } else {
                    break;
                }
            }
            // Exponent part
            if (index < source_len && (source[index] == 'e' || source[index] == 'E')) {
                advance(1);
                if (index < source_len && (source[index] == '+' || source[index] == '-')) {
                    advance(1);
                }
                while (index < source_len && isDigit(source[index])) {
                    advance(1);
                }
            }
            // Integer suffixes (u, U, l, L, f, F)
            while (index < source_len) {
                char c = source[index];
                if (c == 'u' || c == 'U' || c == 'l' || c == 'L' || c == 'f' || c == 'F') {
                    advance(1);
                } else {
                    break;
                }
            }

            int32_t len = index - start;
            const char* text = copyToHeap(source + start, len);

            // Parse value (matches TS logic)
            bool isHex = (len >= 2 && source[start] == '0' && (source[start + 1] == 'x' || source[start + 1] == 'X'));
            double value = 0;

            if (isHex) {
                int32_t hex_start = start + 2;
                int32_t hex_end = index;
                // Strip suffixes (only u, U, l, L for hex; f/F are hex digits)
                while (hex_end > hex_start) {
                    char c = source[hex_end - 1];
                    if (c == 'u' || c == 'U' || c == 'l' || c == 'L') hex_end--;
                    else break;
                }
                // Parse hex integer
                for (int32_t i = hex_start; i < hex_end; i++) {
                    char c = source[i];
                    int digit = 0;
                    if (c >= '0' && c <= '9') digit = c - '0';
                    else if (c >= 'a' && c <= 'f') digit = c - 'a' + 10;
                    else if (c >= 'A' && c <= 'F') digit = c - 'A' + 10;
                    else continue;
                    value = value * 16 + digit;
                }
            } else {
                // Decimal or float - parse manually
                int32_t num_end = index;
                while (num_end > start) {
                    char c = source[num_end - 1];
                    if (c == 'u' || c == 'U' || c == 'l' || c == 'L' || c == 'f' || c == 'F') {
                        num_end--;
                    } else {
                        break;
                    }
                }

                value = 0;
                double fraction = 0;
                double frac_div = 1;
                int32_t exp_sign = 1;
                int32_t exp_val = 0;
                bool in_fraction = false;
                bool in_exponent = false;
                bool has_exponent_digits = false;

                for (int32_t i = start; i < num_end; i++) {
                    char c = source[i];
                    if (c == '.') {
                        in_fraction = true;
                    } else if (c == 'e' || c == 'E') {
                        in_exponent = true;
                        in_fraction = false;
                    } else if (in_exponent) {
                        if (c == '+') {
                            exp_sign = 1;
                        } else if (c == '-') {
                            exp_sign = -1;
                        } else if (isDigit(c)) {
                            exp_val = exp_val * 10 + (c - '0');
                            has_exponent_digits = true;
                        }
                    } else if (in_fraction) {
                        if (isDigit(c)) {
                            frac_div *= 10;
                            fraction = fraction * 10 + (c - '0');
                        }
                    } else if (isDigit(c)) {
                        value = value * 10 + (c - '0');
                    }
                }

                value += fraction / frac_div;
                if (in_exponent) {
                    // If exponent started but no digits parsed, it's invalid (like "1.5e" or "1.5e-")
                    // Matches TS: Number("1.5e") = NaN -> 0
                    if (!has_exponent_digits) {
                        value = 0;
                    } else {
                        double exp_mult = 1;
                        for (int32_t i = 0; i < exp_val; i++) exp_mult *= 10;
                        if (exp_sign < 0) value /= exp_mult;
                        else value *= exp_mult;
                    }
                }
            }

            if (token_count >= out_capacity) return -1;
            out[token_count].kind = static_cast<uint8_t>(TokenKind::TOKEN_NUMBER);
            out[token_count].text = text;
            out[token_count].value = value;
            out[token_count].line = token_line;
            out[token_count].column = token_column;
            out[token_count].file = file_ptr;
            token_count++;
            continue;
        }

        // Identifier or keyword
        if (isAlphaUnderscore(ch)) {
            // Debug
            // engine::js_log1p(ch);
            int32_t start = index;
            while (index < source_len && isAlnumUnderscore(source[index])) {
                advance(1);
            }
            int32_t len = index - start;
            const char* text = copyToHeap(source + start, len);

            // Debug: check if it's a keyword
            // if (isKeyword(text)) engine::js_log1p(1); else engine::js_log1p(0);

            if (token_count >= out_capacity) return -1;
            out[token_count].kind = isKeyword(text)
                                        ? static_cast<uint8_t>(TokenKind::TOKEN_KEYWORD)
                                        : static_cast<uint8_t>(TokenKind::TOKEN_IDENTIFIER);
            out[token_count].text = text;
            out[token_count].value = 0;
            out[token_count].line = token_line;
            out[token_count].column = token_column;
            out[token_count].file = file_ptr;
            token_count++;
            continue;
        }

        // Punctuation (longest-first match)
        const char* matched_punct = nullptr;
        int32_t matched_len = 0;
        for (int i = 0; PUNCTUATION[i] != nullptr; i++) {
            const char* punct = PUNCTUATION[i];
            int32_t plen = 0;
            while (punct[plen] != '\0') plen++;
            if (index + plen <= source_len) {
                bool match = true;
                for (int32_t j = 0; j < plen; j++) {
                    if (source[index + j] != punct[j]) {
                        match = false;
                        break;
                    }
                }
                if (match) {
                    matched_punct = punct;
                    matched_len = plen;
                    break; // longest-first, so first match is the longest
                }
            }
        }

        if (matched_punct) {
            advance(matched_len);
            if (token_count >= out_capacity) return -1;
            out[token_count].kind = static_cast<uint8_t>(TokenKind::TOKEN_PUNCTUATION);
            out[token_count].text = copyToHeap(matched_punct, matched_len);
            out[token_count].value = 0;
            out[token_count].line = token_line;
            out[token_count].column = token_column;
            out[token_count].file = file_ptr;
            token_count++;
            continue;
        }

        // Unknown character - return error
        // Debug: log the unknown character
        // engine::js_log1p(ch);
        return -2;
    }

    // EOF token
    if (token_count >= out_capacity) return -1;
    out[token_count].kind = static_cast<uint8_t>(TokenKind::EOF_);
    out[token_count].text = copyToHeap("", 0);
    out[token_count].value = 0;
    out[token_count].line = line;
    out[token_count].column = column;
    out[token_count].file = file_ptr;
    token_count++;

    return token_count;
}

} // namespace firmware

extern "C" int32_t vm_tokenize(
    const char* source,
    int32_t source_len,
    Token* out,
    int32_t out_capacity,
    const char* file,
    int32_t file_len
) {
    return firmware::tokenizeImpl(source, source_len, out, out_capacity, file, file_len);
}