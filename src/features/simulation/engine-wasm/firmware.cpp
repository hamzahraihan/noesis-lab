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

namespace firmware {

// Parser state
struct Parser {
    const Token* tokens;
    int32_t token_count;
    int32_t position;
    const char* file;

    // Precedence table (matches TS BINARY_PRECEDENCE)
    static int getPrecedence(const char* op) {
        if (engine::streq(op, "||")) return 1;
        if (engine::streq(op, "&&")) return 2;
        if (engine::streq(op, "|")) return 3;
        if (engine::streq(op, "^")) return 4;
        if (engine::streq(op, "&")) return 5;
        if (engine::streq(op, "==") || engine::streq(op, "!=")) return 6;
        if (engine::streq(op, "<") || engine::streq(op, ">") ||
            engine::streq(op, "<=") || engine::streq(op, ">=")) return 7;
        if (engine::streq(op, "<<") || engine::streq(op, ">>")) return 8;
        if (engine::streq(op, "+") || engine::streq(op, "-")) return 9;
        if (engine::streq(op, "*") || engine::streq(op, "/") || engine::streq(op, "%")) return 10;
        return -1;
    }

    static bool isAssignOp(const char* op) {
        return engine::streq(op, "=") || engine::streq(op, "+=") || engine::streq(op, "-=") ||
               engine::streq(op, "*=") || engine::streq(op, "/=") || engine::streq(op, "%=") ||
               engine::streq(op, "&=") || engine::streq(op, "|=") || engine::streq(op, "^=") ||
               engine::streq(op, "<<=") || engine::streq(op, ">>=");
    }

    const Token& peek(int offset = 0) const {
        int idx = position + offset;
        if (idx >= token_count) idx = token_count - 1;
        return tokens[idx];
    }

    const Token& next() {
        const Token& t = tokens[position];
        if (position < token_count - 1) position++;
        return t;
    }

    bool at(TokenKind kind) const {
        return peek().kind == static_cast<uint8_t>(kind);
    }

    bool atPunct(const char* text) const {
        const Token& t = peek();
        return t.kind == static_cast<uint8_t>(TokenKind::TOKEN_PUNCTUATION) && engine::streq(t.text, text);
    }

    bool acceptPunct(const char* text) {
        if (atPunct(text)) {
            next();
            return true;
        }
        return false;
    }

    void expectPunct(const char* text) {
        if (!acceptPunct(text)) {
            // In a real parser we'd throw, but for now just continue
        }
    }

    bool isKeyword(const char* kw) const {
        const Token& t = peek();
        return t.kind == static_cast<uint8_t>(TokenKind::TOKEN_KEYWORD) && engine::streq(t.text, kw);
    }

    bool acceptKeyword(const char* kw) {
        if (isKeyword(kw)) {
            next();
            return true;
        }
        return false;
    }

    SourceLocation currentLoc() const {
        return { peek().line, peek().column, peek().file };
    }

    Expr* allocExpr(ExprKind kind, SourceLocation loc) {
        Expr* e = reinterpret_cast<Expr*>(engine::alloc_bytes(sizeof(Expr)));
        e->kind = kind;
        e->location = loc;
        return e;
    }

    Stmt* allocStmt(StmtKind kind, SourceLocation loc) {
        Stmt* s = reinterpret_cast<Stmt*>(engine::alloc_bytes(sizeof(Stmt)));
        s->kind = kind;
        s->location = loc;
        return s;
    }

    // Forward declarations
    Expr* readExpression();
    Expr* readAssignment();
    Expr* readTernary();
    Expr* readBinary(int minPrec);
    Expr* readUnary();
    Expr* readPostfix();
    Expr* readPrimary();
    Stmt* readStatement();
    Stmt* readBlock();
    Stmt* readIf();
    Stmt* readWhile();
    Stmt* readDoWhile();
    Stmt* readFor();
    Stmt* readReturn();
    Stmt* readBreak();
    Stmt* readContinue();
    Stmt* readDeclaration();
    Expr* readCall(Expr* callee, SourceLocation loc);
    Expr* readMember(Expr* target, SourceLocation loc);
    Expr* readIndex(Expr* target, SourceLocation loc);
};

// Expression parsing - precedence climbing (lowest binding first)

Expr* Parser::readExpression() {
    return readAssignment();
}

Expr* Parser::readAssignment() {
    Expr* target = readTernary();
    const Token& tok = peek();
    if (tok.kind == static_cast<uint8_t>(TokenKind::TOKEN_PUNCTUATION) && isAssignOp(tok.text)) {
        const char* op = tok.text;
        next();
        Expr* value = readAssignment();
        SourceLocation loc = target->location;
        Expr* e = allocExpr(ExprKind::ASSIGN, loc);
        e->assign.target = target;
        e->assign.op = op;
        e->assign.value = value;
        return e;
    }
    return target;
}

Expr* Parser::readTernary() {
    Expr* cond = readBinary(0);
    if (!atPunct("?")) return cond;
    next();
    Expr* then_ = readAssignment();
    expectPunct(":");
    Expr* else_ = readAssignment();
    SourceLocation loc = cond->location;
    Expr* e = allocExpr(ExprKind::TERNARY, loc);
    e->ternary.cond = cond;
    e->ternary.then_ = then_;
    e->ternary.else_ = else_;
    return e;
}

Expr* Parser::readBinary(int minPrec) {
    Expr* left = readUnary();
    for (;;) {
        const Token& tok = peek();
        if (tok.kind != static_cast<uint8_t>(TokenKind::TOKEN_PUNCTUATION)) break;
        int prec = getPrecedence(tok.text);
        if (prec < minPrec) break;
        if (prec < 0) break;

        const char* op = tok.text;
        next();
        Expr* right = readBinary(prec + 1);
        SourceLocation loc = tok.line > 0 ? SourceLocation{tok.line, tok.column, tok.file} : left->location;
        Expr* e = allocExpr(ExprKind::BINARY, loc);
        e->binary.left = left;
        e->binary.op = op;
        e->binary.right = right;
        left = e;
    }
    return left;
}

Expr* Parser::readUnary() {
    const Token& tok = peek();
    if (tok.kind == static_cast<uint8_t>(TokenKind::TOKEN_PUNCTUATION)) {
        const char* text = tok.text;
        if (engine::streq(text, "-") || engine::streq(text, "+") ||
            engine::streq(text, "!") || engine::streq(text, "~") ||
            engine::streq(text, "*") || engine::streq(text, "&")) {
            next();
            Expr* operand = readUnary();
            SourceLocation loc = {tok.line, tok.column, tok.file};
            Expr* e = allocExpr(ExprKind::UNARY, loc);
            e->unary.op = text;
            e->unary.operand = operand;
            return e;
        }
        if (engine::streq(text, "++") || engine::streq(text, "--")) {
            next();
            Expr* operand = readUnary();
            SourceLocation loc = {tok.line, tok.column, tok.file};
            // ++x becomes x += 1
            Expr* one = allocExpr(ExprKind::NUMBER, loc);
            one->number = 1.0;
            Expr* e = allocExpr(ExprKind::ASSIGN, loc);
            e->assign.target = operand;
            e->assign.op = text;
            e->assign.value = one;
            return e;
        }
    }
    return readPostfix();
}

Expr* Parser::readPostfix() {
    Expr* expr = readPrimary();
    for (;;) {
        if (atPunct("(")) {
            expr = readCall(expr, expr->location);
            continue;
        }
        if (atPunct("[")) {
            expr = readIndex(expr, expr->location);
            continue;
        }
        if (atPunct(".")) {
            next();
            const Token& member = peek();
            if (member.kind == static_cast<uint8_t>(TokenKind::TOKEN_IDENTIFIER)) {
                const char* name = member.text;
                next();
                SourceLocation loc = expr->location;
                Expr* e = allocExpr(ExprKind::MEMBER, loc);
                e->member.target = expr;
                e->member.member = name;
                expr = e;
                continue;
            }
        }
        if (atPunct("::")) {
            next();
            const Token& member = peek();
            if (member.kind == static_cast<uint8_t>(TokenKind::TOKEN_IDENTIFIER)) {
                const char* name = member.text;
                next();
                SourceLocation loc = expr->location;
                Expr* e = allocExpr(ExprKind::MEMBER, loc);
                e->member.target = expr;
                e->member.member = name;
                expr = e;
                continue;
            }
        }
        if (atPunct("++") || atPunct("--")) {
            const char* op = peek().text;
            next();
            SourceLocation loc = expr->location;
            Expr* one = allocExpr(ExprKind::NUMBER, loc);
            one->number = 1.0;
            Expr* e = allocExpr(ExprKind::ASSIGN, loc);
            e->assign.target = expr;
            e->assign.op = op;
            e->assign.value = one;
            expr = e;
            continue;
        }
        break;
    }
    return expr;
}

Expr* Parser::readPrimary() {
    const Token& tok = next();
    SourceLocation loc = {tok.line, tok.column, tok.file};

    if (tok.kind == static_cast<uint8_t>(TokenKind::TOKEN_NUMBER)) {
        Expr* e = allocExpr(ExprKind::NUMBER, loc);
        e->number = tok.value;
        return e;
    }
    if (tok.kind == static_cast<uint8_t>(TokenKind::TOKEN_STRING)) {
        Expr* e = allocExpr(ExprKind::STRING, loc);
        e->string_val = tok.text;
        return e;
    }
    if (tok.kind == static_cast<uint8_t>(TokenKind::TOKEN_CHAR)) {
        Expr* e = allocExpr(ExprKind::NUMBER, loc);
        e->number = tok.text[0] ? static_cast<double>(static_cast<unsigned char>(tok.text[0])) : 0.0;
        return e;
    }
    if (tok.kind == static_cast<uint8_t>(TokenKind::TOKEN_KEYWORD)) {
        if (engine::streq(tok.text, "true")) {
            Expr* e = allocExpr(ExprKind::BOOLEAN, loc);
            e->boolean_val = true;
            return e;
        }
        if (engine::streq(tok.text, "false")) {
            Expr* e = allocExpr(ExprKind::BOOLEAN, loc);
            e->boolean_val = false;
            return e;
        }
        // HIGH, LOW, INPUT, OUTPUT, INPUT_PULLUP are identifiers
        if (engine::streq(tok.text, "HIGH") || engine::streq(tok.text, "LOW") ||
            engine::streq(tok.text, "INPUT") || engine::streq(tok.text, "OUTPUT") ||
            engine::streq(tok.text, "INPUT_PULLUP")) {
            Expr* e = allocExpr(ExprKind::IDENTIFIER, loc);
            e->identifier = tok.text;
            return e;
        }
    }
    if (tok.kind == static_cast<uint8_t>(TokenKind::TOKEN_IDENTIFIER)) {
        Expr* e = allocExpr(ExprKind::IDENTIFIER, loc);
        e->identifier = tok.text;
        return e;
    }
    if (tok.kind == static_cast<uint8_t>(TokenKind::TOKEN_PUNCTUATION) && engine::streq(tok.text, "(")) {
        Expr* inner = readExpression();
        expectPunct(")");
        return inner;
    }
    // Error case - return 0
    Expr* e = allocExpr(ExprKind::NUMBER, loc);
    e->number = 0;
    return e;
}

Expr* Parser::readCall(Expr* callee, SourceLocation loc) {
    expectPunct("(");
    // Estimate max args
    Expr** args = reinterpret_cast<Expr**>(engine::alloc_bytes(32 * sizeof(Expr*)));
    int32_t arg_count = 0;
    if (!atPunct(")")) {
        do {
            if (arg_count >= 32) break;
            args[arg_count++] = readExpression();
        } while (acceptPunct(","));
    }
    expectPunct(")");
    Expr* e = allocExpr(ExprKind::CALL, loc);
    e->call.callee = callee;
    e->call.args = args;
    e->call.arg_count = arg_count;
    return e;
}

Expr* Parser::readIndex(Expr* target, SourceLocation loc) {
    expectPunct("[");
    Expr* index = readExpression();
    expectPunct("]");
    Expr* e = allocExpr(ExprKind::INDEX, loc);
    e->index.target = target;
    e->index.index = index;
    return e;
}

// Statement parsing

Stmt* Parser::readStatement() {
    const Token& tok = peek();
    SourceLocation loc = currentLoc();

    if (atPunct("{")) {
        next();
        return readBlock();
    }
    if (acceptPunct(";")) {
        Stmt* s = allocStmt(StmtKind::EMPTY, loc);
        return s;
    }
    if (tok.kind == static_cast<uint8_t>(TokenKind::TOKEN_DIRECTIVE)) {
        // Conditional directive - treat as empty
        next();
        Stmt* s = allocStmt(StmtKind::EMPTY, loc);
        return s;
    }

    if (tok.kind == static_cast<uint8_t>(TokenKind::TOKEN_KEYWORD)) {
        if (engine::streq(tok.text, "if")) return readIf();
        if (engine::streq(tok.text, "while")) return readWhile();
        if (engine::streq(tok.text, "do")) return readDoWhile();
        if (engine::streq(tok.text, "for")) return readFor();
        if (engine::streq(tok.text, "return")) return readReturn();
        if (engine::streq(tok.text, "break")) return readBreak();
        if (engine::streq(tok.text, "continue")) return readContinue();
    }

    // Check for declaration (type keyword)
    if (tok.kind == static_cast<uint8_t>(TokenKind::TOKEN_KEYWORD)) {
        const char* kw = tok.text;
        if (engine::streq(kw, "int") || engine::streq(kw, "float") || engine::streq(kw, "double") ||
            engine::streq(kw, "bool") || engine::streq(kw, "char") || engine::streq(kw, "byte") ||
            engine::streq(kw, "long") || engine::streq(kw, "short") || engine::streq(kw, "unsigned") ||
            engine::streq(kw, "signed") || engine::streq(kw, "const") || engine::streq(kw, "static") ||
            engine::streq(kw, "volatile") || engine::streq(kw, "void") ||
            engine::streq(kw, "uint8_t") || engine::streq(kw, "int8_t") ||
            engine::streq(kw, "uint16_t") || engine::streq(kw, "int16_t") ||
            engine::streq(kw, "uint32_t") || engine::streq(kw, "int32_t")) {
            return readDeclaration();
        }
    }

    // Expression statement
    Expr* expr = readExpression();
    expectPunct(";");
    Stmt* s = allocStmt(StmtKind::EXPRESSION, loc);
    s->expr = expr;
    return s;
}

Stmt* Parser::readBlock() {
    SourceLocation loc = currentLoc();
    Stmt** stmts = reinterpret_cast<Stmt**>(engine::alloc_bytes(64 * sizeof(Stmt*)));
    int32_t count = 0;
    while (!atPunct("}") && !at(TokenKind::EOF_)) {
        if (count >= 64) break;
        stmts[count++] = readStatement();
    }
    expectPunct("}");
    Stmt* s = allocStmt(StmtKind::BLOCK, loc);
    s->block.stmts = stmts;
    s->block.count = count;
    return s;
}

Stmt* Parser::readIf() {
    SourceLocation loc = currentLoc();
    next(); // consume 'if'
    expectPunct("(");
    Expr* cond = readExpression();
    expectPunct(")");
    Stmt* then_ = readStatement();
    Stmt* else_ = nullptr;
    if (isKeyword("else")) {
        next();
        else_ = readStatement();
    }
    Stmt* s = allocStmt(else_ ? StmtKind::IF_ELSE : StmtKind::IF, loc);
    s->ite.cond = cond;
    s->ite.then_ = then_;
    s->ite.else_ = else_;
    return s;
}

Stmt* Parser::readWhile() {
    SourceLocation loc = currentLoc();
    next(); // consume 'while'
    expectPunct("(");
    Expr* cond = readExpression();
    expectPunct(")");
    Stmt* body = readStatement();
    Stmt* s = allocStmt(StmtKind::WHILE, loc);
    s->loop.cond = cond;
    s->loop.body = body;
    return s;
}

Stmt* Parser::readDoWhile() {
    SourceLocation loc = currentLoc();
    next(); // consume 'do'
    Stmt* body = readStatement();
    if (!isKeyword("while")) {
        // error
    }
    next(); // consume 'while'
    expectPunct("(");
    Expr* cond = readExpression();
    expectPunct(")");
    expectPunct(";");
    Stmt* s = allocStmt(StmtKind::DO_WHILE, loc);
    s->loop.cond = cond;
    s->loop.body = body;
    return s;
}

Stmt* Parser::readFor() {
    SourceLocation loc = currentLoc();
    next(); // consume 'for'
    expectPunct("(");
    
    Stmt* init = nullptr;
    if (atPunct(";")) {
        next();
    } else if (peek().kind == static_cast<uint8_t>(TokenKind::TOKEN_KEYWORD) && 
               (engine::streq(peek().text, "int") || engine::streq(peek().text, "float") ||
                engine::streq(peek().text, "double") || engine::streq(peek().text, "bool") ||
                engine::streq(peek().text, "char") || engine::streq(peek().text, "byte") ||
                engine::streq(peek().text, "long") || engine::streq(peek().text, "short") ||
                engine::streq(peek().text, "unsigned") || engine::streq(peek().text, "signed") ||
                engine::streq(peek().text, "const") || engine::streq(peek().text, "static") ||
                engine::streq(peek().text, "volatile") || engine::streq(peek().text, "void"))) {
        init = readDeclaration();
    } else {
        Expr* expr = readExpression();
        expectPunct(";");
        Stmt* s = allocStmt(StmtKind::EXPRESSION, loc);
        s->expr = expr;
        init = s;
    }

    Expr* cond = nullptr;
    if (!atPunct(";")) {
        cond = readExpression();
    }
    expectPunct(";");

    Expr* update = nullptr;
    if (!atPunct(")")) {
        update = readExpression();
    }
    expectPunct(")");

    Stmt* body = readStatement();
    Stmt* s = allocStmt(StmtKind::FOR, loc);
    // For now, use loop struct - we'd need a more complete struct for for-loop
    s->loop.cond = cond;
    s->loop.body = body;
    return s;
}

Stmt* Parser::readReturn() {
    SourceLocation loc = currentLoc();
    next(); // consume 'return'
    Expr* value = nullptr;
    if (!atPunct(";")) {
        value = readExpression();
    }
    expectPunct(";");
    Stmt* s = allocStmt(StmtKind::RETURN, loc);
    s->ret.value = value;
    return s;
}

Stmt* Parser::readBreak() {
    SourceLocation loc = currentLoc();
    next(); // consume 'break'
    expectPunct(";");
    Stmt* s = allocStmt(StmtKind::BREAK, loc);
    return s;
}

Stmt* Parser::readContinue() {
    SourceLocation loc = currentLoc();
    next(); // consume 'continue'
    expectPunct(";");
    Stmt* s = allocStmt(StmtKind::CONTINUE, loc);
    return s;
}

Stmt* Parser::readDeclaration() {
    SourceLocation loc = currentLoc();
    // Consume type keywords
    while (peek().kind == static_cast<uint8_t>(TokenKind::TOKEN_KEYWORD)) {
        const char* kw = peek().text;
        if (engine::streq(kw, "int") || engine::streq(kw, "float") || engine::streq(kw, "double") ||
            engine::streq(kw, "bool") || engine::streq(kw, "char") || engine::streq(kw, "byte") ||
            engine::streq(kw, "long") || engine::streq(kw, "short") || engine::streq(kw, "unsigned") ||
            engine::streq(kw, "signed") || engine::streq(kw, "const") || engine::streq(kw, "static") ||
            engine::streq(kw, "volatile") || engine::streq(kw, "void") ||
            engine::streq(kw, "uint8_t") || engine::streq(kw, "int8_t") ||
            engine::streq(kw, "uint16_t") || engine::streq(kw, "int16_t") ||
            engine::streq(kw, "uint32_t") || engine::streq(kw, "int32_t")) {
            next();
        } else {
            break;
        }
    }
    
    const Token& nameTok = peek();
    if (nameTok.kind != static_cast<uint8_t>(TokenKind::TOKEN_IDENTIFIER)) {
        // error
        Stmt* s = allocStmt(StmtKind::EMPTY, loc);
        return s;
    }
    const char* name = nameTok.text;
    next();

    // Check for array declarator
    if (atPunct("[")) {
        next();
        int32_t size = 0;
        bool deduced = false;
        if (acceptPunct("]")) {
            deduced = true;
        } else {
            if (peek().kind == static_cast<uint8_t>(TokenKind::TOKEN_NUMBER)) {
                size = static_cast<int32_t>(peek().value);
                next();
            }
            expectPunct("]");
        }
        Expr** init = nullptr;
        int32_t init_count = 0;
        if (acceptPunct("=")) {
            expectPunct("{");
            init = reinterpret_cast<Expr**>(engine::alloc_bytes(32 * sizeof(Expr*)));
            if (!atPunct("}")) {
                do {
                    if (init_count >= 32) break;
                    init[init_count++] = readExpression();
                } while (acceptPunct(",") && !atPunct("}"));
            }
            expectPunct("}");
        }
        if (deduced) size = init_count;
        expectPunct(";");
        Stmt* s = allocStmt(StmtKind::ARRAY_DECL, loc);
        s->array_decl.name = name;
        s->array_decl.size = size;
        s->array_decl.init = init;
        s->array_decl.init_count = init_count;
        return s;
    }

    Expr* init = nullptr;
    if (acceptPunct("=")) {
        init = readExpression();
    }
    expectPunct(";");
    Stmt* s = allocStmt(StmtKind::VAR_DECL, loc);
    s->decl.name = name;
    s->decl.init = init;
    return s;
}

// Program parsing
Program* parseProgram(const Token* tokens, int32_t token_count, const char* file) {
    Parser parser;
    parser.tokens = tokens;
    parser.token_count = token_count;
    parser.position = 0;
    parser.file = file;

    Stmt** stmts = reinterpret_cast<Stmt**>(engine::alloc_bytes(128 * sizeof(Stmt*)));
    int32_t stmt_count = 0;

    while (!parser.at(TokenKind::EOF_) && stmt_count < 128) {
        if (parser.at(TokenKind::TOKEN_DIRECTIVE)) {
            parser.next();
            continue;
        }
        if (parser.acceptPunct(";")) continue;

        stmts[stmt_count++] = parser.readStatement();
    }

    Program* prog = reinterpret_cast<Program*>(engine::alloc_bytes(sizeof(Program)));
    prog->stmts = stmts;
    prog->stmt_count = stmt_count;
    return prog;
}

} // namespace firmware

// JSON serialization
namespace firmware {

// Simple integer to string (no libc)
static void writeIntToBuffer(char* buf, int32_t v, int& out_len) {
    if (v == 0) {
        buf[0] = '0';
        out_len = 1;
        return;
    }
    bool neg = v < 0;
    if (neg) v = -v;
    char tmp[32];
    int idx = 0;
    while (v > 0) {
        tmp[idx++] = '0' + (v % 10);
        v /= 10;
    }
    if (neg) buf[0] = '-';
    int start = neg ? 1 : 0;
    for (int i = 0; i < idx; i++) {
        buf[start + i] = tmp[idx - 1 - i];
    }
    out_len = start + idx;
}

static void writeDoubleToBuffer(char* buf, double v, int& out_len) {
    // Simple double to string - use fixed format for now
    // This is a minimal implementation
    if (v == 0.0) {
        buf[0] = '0'; buf[1] = '\0';
        out_len = 1;
        return;
    }
    // For simplicity, just handle integers
    int64_t iv = static_cast<int64_t>(v);
    if (static_cast<double>(iv) == v) {
        writeIntToBuffer(buf, static_cast<int32_t>(iv), out_len);
    } else {
        // Fallback - just write a placeholder
        const char* s = "0.0";
        int i = 0;
        while (s[i] && i < 63) {
            buf[i] = s[i];
            i++;
        }
        buf[i] = '\0';
        out_len = i;
    }
}

struct JsonWriter {
    char* buffer;
    int32_t capacity;
    int32_t pos;

    void write(const char* s) {
        while (*s && pos < capacity - 1) buffer[pos++] = *s++;
    }
    void writeChar(char c) {
        if (pos < capacity - 1) buffer[pos++] = c;
    }
    void writeInt(int32_t v) {
        char buf[32];
        int len;
        writeIntToBuffer(buf, v, len);
        for (int i = 0; i < len && pos < capacity - 1; i++) buffer[pos++] = buf[i];
    }
    void writeDouble(double v) {
        char buf[64];
        int len;
        writeDoubleToBuffer(buf, v, len);
        for (int i = 0; i < len && pos < capacity - 1; i++) buffer[pos++] = buf[i];
    }
    void writeString(const char* s) {
        writeChar('"');
        while (*s && pos < capacity - 1) {
            char c = *s++;
            if (c == '"' || c == '\\') {
                writeChar('\\');
                writeChar(c);
            } else if (c == '\n') {
                writeChar('\\'); writeChar('n');
            } else if (c == '\t') {
                writeChar('\\'); writeChar('t');
            } else if (c == '\r') {
                writeChar('\\'); writeChar('r');
            } else {
                writeChar(c);
            }
        }
        writeChar('"');
    }
};

void writeExpr(JsonWriter* w, const Expr* e);
void writeStmt(JsonWriter* w, const Stmt* s);

void writeExpr(JsonWriter* w, const Expr* e) {
    if (!e) { w->write("null"); return; }
    w->writeChar('{');
    w->write("\"kind\":\"");
    switch (e->kind) {
        case ExprKind::NUMBER: w->write("number"); break;
        case ExprKind::STRING: w->write("string"); break;
        case ExprKind::BOOLEAN: w->write("boolean"); break;
        case ExprKind::IDENTIFIER: w->write("identifier"); break;
        case ExprKind::CALL: w->write("call"); break;
        case ExprKind::MEMBER: w->write("member"); break;
        case ExprKind::ASSIGN: w->write("assign"); break;
        case ExprKind::BINARY: w->write("binary"); break;
        case ExprKind::UNARY: w->write("unary"); break;
        case ExprKind::TERNARY: w->write("ternary"); break;
        case ExprKind::ARRAY: w->write("list"); break;
        case ExprKind::INDEX: w->write("index"); break;
        default: w->write("unknown"); break;
    }
    w->write("\",");
    // Location
    w->write("\"location\":{\"line\":");
    w->writeInt(e->location.line);
    w->write(",\"column\":");
    w->writeInt(e->location.column);
    w->write(",\"file\":\"main.ino\"},");
    
    switch (e->kind) {
        case ExprKind::NUMBER:
            w->write("\"value\":");
            w->writeDouble(e->number);
            break;
        case ExprKind::STRING:
            w->write("\"value\":");
            w->writeString(e->string_val);
            break;
        case ExprKind::BOOLEAN:
            w->write("\"value\":");
            w->write(e->boolean_val ? "true" : "false");
            break;
        case ExprKind::IDENTIFIER:
            w->write("\"name\":");
            w->writeString(e->identifier);
            break;
        case ExprKind::CALL:
            w->write("\"callee\":");
            writeExpr(w, e->call.callee);
            w->write(",\"args\":[");
            for (int i = 0; i < e->call.arg_count; i++) {
                if (i > 0) w->writeChar(',');
                writeExpr(w, e->call.args[i]);
            }
            w->writeChar(']');
            break;
        case ExprKind::MEMBER:
            w->write("\"target\":");
            writeExpr(w, e->member.target);
            w->write(",\"member\":");
            w->writeString(e->member.member);
            break;
        case ExprKind::ASSIGN:
            w->write("\"target\":");
            writeExpr(w, e->assign.target);
            w->write(",\"operator\":");
            w->writeString(e->assign.op);
            w->write(",\"value\":");
            writeExpr(w, e->assign.value);
            break;
        case ExprKind::BINARY:
            w->write("\"operator\":");
            w->writeString(e->binary.op);
            w->write(",\"left\":");
            writeExpr(w, e->binary.left);
            w->write(",\"right\":");
            writeExpr(w, e->binary.right);
            break;
        case ExprKind::UNARY:
            w->write("\"operator\":");
            w->writeString(e->unary.op);
            w->write(",\"operand\":");
            writeExpr(w, e->unary.operand);
            break;
        case ExprKind::TERNARY:
            w->write("\"condition\":");
            writeExpr(w, e->ternary.cond);
            w->write(",\"whenTrue\":");
            writeExpr(w, e->ternary.then_);
            w->write(",\"whenFalse\":");
            writeExpr(w, e->ternary.else_);
            break;
        case ExprKind::ARRAY:
            w->write("\"items\":[");
            for (int i = 0; i < e->array.count; i++) {
                if (i > 0) w->writeChar(',');
                writeExpr(w, e->array.elements[i]);
            }
            w->writeChar(']');
            break;
        case ExprKind::INDEX:
            w->write("\"target\":");
            writeExpr(w, e->index.target);
            w->write(",\"index\":");
            writeExpr(w, e->index.index);
            break;
        default:
            break;
    }
    w->writeChar('}');
}

void writeStmt(JsonWriter* w, const Stmt* s) {
    if (!s) { w->write("null"); return; }
    w->writeChar('{');
    w->write("\"kind\":\"");
    switch (s->kind) {
        case StmtKind::EXPRESSION: w->write("expression"); break;
        case StmtKind::VAR_DECL: w->write("varDecl"); break;
        case StmtKind::ARRAY_DECL: w->write("arrayDecl"); break;
        case StmtKind::INSTANCE_DECL: w->write("instanceDecl"); break;
        case StmtKind::IF: w->write("if"); break;
        case StmtKind::IF_ELSE: w->write("if"); break;
        case StmtKind::WHILE: w->write("while"); break;
        case StmtKind::DO_WHILE: w->write("doWhile"); break;
        case StmtKind::FOR: w->write("for"); break;
        case StmtKind::BLOCK: w->write("block"); break;
        case StmtKind::RETURN: w->write("return"); break;
        case StmtKind::BREAK: w->write("break"); break;
        case StmtKind::CONTINUE: w->write("continue"); break;
        case StmtKind::EMPTY: w->write("empty"); break;
        default: w->write("unknown"); break;
    }
    w->write("\",");
    // Location
    w->write("\"location\":{\"line\":");
    w->writeInt(s->location.line);
    w->write(",\"column\":");
    w->writeInt(s->location.column);
    w->write(",\"file\":\"main.ino\"},");
    
    switch (s->kind) {
        case StmtKind::EXPRESSION:
            w->write("\"value\":");
            writeExpr(w, s->expr);
            break;
        case StmtKind::VAR_DECL:
            w->write("\"name\":");
            w->writeString(s->decl.name);
            w->write(",\"init\":");
            writeExpr(w, s->decl.init);
            break;
        case StmtKind::ARRAY_DECL:
            w->write("\"name\":");
            w->writeString(s->array_decl.name);
            w->write(",\"size\":");
            w->writeInt(s->array_decl.size);
            w->write(",\"init\":[");
            for (int i = 0; i < s->array_decl.init_count; i++) {
                if (i > 0) w->writeChar(',');
                writeExpr(w, s->array_decl.init[i]);
            }
            w->writeChar(']');
            break;
        case StmtKind::IF:
        case StmtKind::IF_ELSE:
            w->write("\"condition\":");
            writeExpr(w, s->ite.cond);
            w->write(",\"then\":");
            writeStmt(w, s->ite.then_);
            w->write(",\"otherwise\":");
            writeStmt(w, s->ite.else_);
            break;
        case StmtKind::WHILE:
        case StmtKind::DO_WHILE:
            w->write("\"condition\":");
            writeExpr(w, s->loop.cond);
            w->write(",\"body\":");
            writeStmt(w, s->loop.body);
            break;
        case StmtKind::FOR:
            w->write("\"init\":null,\"condition\":");
            writeExpr(w, s->loop.cond);
            w->write(",\"update\":null,\"body\":");
            writeStmt(w, s->loop.body);
            break;
        case StmtKind::BLOCK:
            w->write("\"statements\":[");
            for (int i = 0; i < s->block.count; i++) {
                if (i > 0) w->writeChar(',');
                writeStmt(w, s->block.stmts[i]);
            }
            w->writeChar(']');
            break;
        case StmtKind::RETURN:
            w->write("\"value\":");
            writeExpr(w, s->ret.value);
            break;
        case StmtKind::EMPTY:
            break;
        default:
            break;
    }
    w->writeChar('}');
}

int32_t serializeProgram(const Program* prog, char* out, int32_t out_capacity) {
    JsonWriter w{out, out_capacity, 0};
    w.write("{\"globals\":[");
    for (int i = 0; i < prog->stmt_count; i++) {
        if (i > 0) w.writeChar(',');
        writeStmt(&w, prog->stmts[i]);
    }
    w.write("],\"functions\":{},\"classes\":{},\"defines\":{},\"macros\":{}}");
    if (w.pos < out_capacity) out[w.pos] = '\0';
    return w.pos;
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

extern "C" Program* vm_parse(
    const char* source,
    int32_t source_len,
    const char* file,
    int32_t file_len
) {
    // Allocate token buffer
    const int32_t max_tokens = 512;
    Token* tokens = reinterpret_cast<Token*>(engine::alloc_bytes(max_tokens * sizeof(Token)));
    int32_t token_count = firmware::tokenizeImpl(source, source_len, tokens, max_tokens, file, file_len);
    if (token_count < 0) return nullptr;
    return firmware::parseProgram(tokens, token_count, file);
}

extern "C" void vm_free_program(Program* program) {
    // Arena-based: nothing to do, memory is reclaimed when wasm module resets
    (void)program;
}

extern "C" int32_t vm_ast_to_json(Program* program, char* out, int32_t out_capacity) {
    return firmware::serializeProgram(program, out, out_capacity);
}