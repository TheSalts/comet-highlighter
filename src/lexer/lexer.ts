import { Token, TokenType, KEYWORDS, createToken } from "./token";
import { Range, createRange, createPosition } from "../utils/position";

export class Lexer {
    private source: string;
    private tokens: Token[] = [];
    private current = 0;
    private line = 0;
    private column = 0;
    private lineStart = 0;

    constructor(source: string) {
        this.source = source;
    }

    tokenize(): Token[] {
        this.tokens = [];
        this.current = 0;
        this.line = 0;
        this.column = 0;
        this.lineStart = 0;

        while (!this.isAtEnd()) {
            this.scanToken();
        }

        this.addToken(TokenType.EOF, "", this.getCurrentRange());
        return this.tokens;
    }

    private scanToken(): void {
        const startLine = this.line;
        const startColumn = this.column;

        
        if (this.isWhitespace(this.peek()) && this.peek() !== "\n") {
            this.advance();
            return;
        }

        
        if (this.peek() === "\n") {
            this.addToken(
                TokenType.Newline,
                "\n",
                this.makeRange(startLine, startColumn)
            );
            this.advance();
            this.line++;
            this.column = 0;
            this.lineStart = this.current;
            return;
        }

        
        const isLineStart = this.column === 0 || this.isLineStart();

        
        if (isLineStart && this.peek() === "/") {
            
            if (this.peekNext() === "#") {
                this.scanComment(); 
                return;
            }
            this.scanCommandLine();
            return;
        }

        
        if (this.peek() === "#") {
            this.scanComment();
            return;
        }

        
        if (this.peek() === '"') {
            this.scanString();
            return;
        }

        
        if (this.isDigit(this.peek())) {
            this.scanNumber();
            return;
        }

        
        if (this.isAlpha(this.peek())) {
            this.scanIdentifier();
            return;
        }

        
        const ch = this.peek();
        const next = this.peekNext();

        if (ch === "=" && next === "=") {
            this.advance();
            this.advance();
            this.addToken(
                TokenType.Eq,
                "==",
                this.makeRange(startLine, startColumn)
            );
            return;
        }

        if (ch === "!" && next === "=") {
            this.advance();
            this.advance();
            this.addToken(
                TokenType.NotEq,
                "!=",
                this.makeRange(startLine, startColumn)
            );
            return;
        }

        if (ch === "<" && next === "=") {
            this.advance();
            this.advance();
            this.addToken(
                TokenType.LtEq,
                "<=",
                this.makeRange(startLine, startColumn)
            );
            return;
        }

        if (ch === ">" && next === "=") {
            this.advance();
            this.advance();
            this.addToken(
                TokenType.GtEq,
                ">=",
                this.makeRange(startLine, startColumn)
            );
            return;
        }

        
        const char = this.advance();
        switch (char) {
            case "+":
                this.addToken(
                    TokenType.Plus,
                    char,
                    this.makeRange(startLine, startColumn)
                );
                break;
            case "-":
                this.addToken(
                    TokenType.Minus,
                    char,
                    this.makeRange(startLine, startColumn)
                );
                break;
            case "*":
                this.addToken(
                    TokenType.Star,
                    char,
                    this.makeRange(startLine, startColumn)
                );
                break;
            case "/":
                this.addToken(
                    TokenType.Slash,
                    char,
                    this.makeRange(startLine, startColumn)
                );
                break;
            case "%":
                this.addToken(
                    TokenType.Percent,
                    char,
                    this.makeRange(startLine, startColumn)
                );
                break;
            case "=":
                this.addToken(
                    TokenType.Assign,
                    char,
                    this.makeRange(startLine, startColumn)
                );
                break;
            case "!":
                this.addToken(
                    TokenType.Not,
                    char,
                    this.makeRange(startLine, startColumn)
                );
                break;
            case "<":
                this.addToken(
                    TokenType.Lt,
                    char,
                    this.makeRange(startLine, startColumn)
                );
                break;
            case ">":
                this.addToken(
                    TokenType.Gt,
                    char,
                    this.makeRange(startLine, startColumn)
                );
                break;
            case "(":
                this.addToken(
                    TokenType.LParen,
                    char,
                    this.makeRange(startLine, startColumn)
                );
                break;
            case ")":
                this.addToken(
                    TokenType.RParen,
                    char,
                    this.makeRange(startLine, startColumn)
                );
                break;
            case "{":
                this.addToken(
                    TokenType.LBrace,
                    char,
                    this.makeRange(startLine, startColumn)
                );
                break;
            case "}":
                this.addToken(
                    TokenType.RBrace,
                    char,
                    this.makeRange(startLine, startColumn)
                );
                break;
            case "[":
                this.addToken(
                    TokenType.LBracket,
                    char,
                    this.makeRange(startLine, startColumn)
                );
                break;
            case "]":
                this.addToken(
                    TokenType.RBracket,
                    char,
                    this.makeRange(startLine, startColumn)
                );
                break;
            case ",":
                this.addToken(
                    TokenType.Comma,
                    char,
                    this.makeRange(startLine, startColumn)
                );
                break;
            case ".":
                this.addToken(
                    TokenType.Dot,
                    char,
                    this.makeRange(startLine, startColumn)
                );
                break;
            case ";":
                this.addToken(
                    TokenType.Semicolon,
                    char,
                    this.makeRange(startLine, startColumn)
                );
                break;
            case ":":
                this.addToken(
                    TokenType.Colon,
                    char,
                    this.makeRange(startLine, startColumn)
                );
                break;
            default:
                
                break;
        }
    }

    private scanCommandLine(): void {
        const startLine = this.line;
        const startColumn = this.column;

        this.advance(); 

        
        const isMacro = this.peek() === "$";
        if (isMacro) {
            this.advance(); 
        }

        
        const start = this.current;
        while (!this.isAtEnd() && this.peek() !== "\n") {
            this.advance();
        }

        const commandText = this.source.substring(start, this.current);
        const tokenType = isMacro
            ? TokenType.MacroCommandLine
            : TokenType.CommandLine;

        this.addToken(
            tokenType,
            commandText,
            this.makeRange(startLine, startColumn)
        );
    }

    private scanComment(): void {
        const startLine = this.line;
        const startColumn = this.column;

        this.advance(); 

        
        const start = this.current;
        while (!this.isAtEnd() && this.peek() !== "\n") {
            this.advance();
        }

        const commentText = this.source.substring(start, this.current);
        this.addToken(
            TokenType.Comment,
            commentText,
            this.makeRange(startLine, startColumn)
        );
    }

    private scanString(): void {
        const startLine = this.line;
        const startColumn = this.column;

        this.advance(); 

        let value = "";
        while (!this.isAtEnd() && this.peek() !== '"') {
            if (this.peek() === "\\") {
                this.advance(); 
                if (!this.isAtEnd()) {
                    const escaped = this.advance();
                    
                    switch (escaped) {
                        case "n":
                            value += "\n";
                            break;
                        case "t":
                            value += "\t";
                            break;
                        case "r":
                            value += "\r";
                            break;
                        case "\\":
                            value += "\\";
                            break;
                        case '"':
                            value += '"';
                            break;
                        default:
                            value += escaped;
                            break;
                    }
                }
            } else {
                if (this.peek() === "\n") {
                    this.line++;
                    this.column = 0;
                    this.lineStart = this.current + 1;
                }
                value += this.advance();
            }
        }

        if (!this.isAtEnd() && this.peek() === '"') {
            this.advance(); 
        }

        this.addToken(
            TokenType.StringLiteral,
            value,
            this.makeRange(startLine, startColumn)
        );
    }

    private scanNumber(): void {
        const startLine = this.line;
        const startColumn = this.column;
        const start = this.current;

        
        while (this.isDigit(this.peek())) {
            this.advance();
        }

        
        if (this.peek() === "f") {
            this.advance();
            const value = this.source.substring(start, this.current);
            this.addToken(
                TokenType.FloatLiteral,
                value,
                this.makeRange(startLine, startColumn)
            );
            return;
        }

        
        if (this.peek() === "." && this.isDigit(this.peekNext())) {
            this.advance(); 
            while (this.isDigit(this.peek())) {
                this.advance();
            }

            
            if (this.peek() === "f") {
                this.advance();
                const value = this.source.substring(start, this.current);
                this.addToken(
                    TokenType.FloatLiteral,
                    value,
                    this.makeRange(startLine, startColumn)
                );
                return;
            }

            const value = this.source.substring(start, this.current);
            this.addToken(
                TokenType.DoubleLiteral,
                value,
                this.makeRange(startLine, startColumn)
            );
            return;
        }

        
        const value = this.source.substring(start, this.current);
        this.addToken(
            TokenType.IntLiteral,
            value,
            this.makeRange(startLine, startColumn)
        );
    }

    private scanIdentifier(): void {
        const startLine = this.line;
        const startColumn = this.column;
        const start = this.current;

        while (this.isAlphaNumeric(this.peek())) {
            this.advance();
        }

        const value = this.source.substring(start, this.current);

        
        const keywordType = KEYWORDS.get(value);
        if (keywordType !== undefined) {
            this.addToken(
                keywordType,
                value,
                this.makeRange(startLine, startColumn)
            );
        } else {
            this.addToken(
                TokenType.Identifier,
                value,
                this.makeRange(startLine, startColumn)
            );
        }
    }

    private isLineStart(): boolean {
        
        for (let i = this.lineStart; i < this.current; i++) {
            const ch = this.source[i];
            if (ch !== " " && ch !== "\t") {
                return false;
            }
        }
        return true;
    }

    private isWhitespace(ch: string): boolean {
        return ch === " " || ch === "\t" || ch === "\r" || ch === "\n";
    }

    private isDigit(ch: string): boolean {
        return ch >= "0" && ch <= "9";
    }

    private isAlpha(ch: string): boolean {
        return (
            (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_"
        );
    }

    private isAlphaNumeric(ch: string): boolean {
        return this.isAlpha(ch) || this.isDigit(ch);
    }

    private peek(): string {
        if (this.isAtEnd()) return "\0";
        return this.source[this.current];
    }

    private peekNext(): string {
        if (this.current + 1 >= this.source.length) return "\0";
        return this.source[this.current + 1];
    }

    private advance(): string {
        const ch = this.source[this.current];
        this.current++;
        this.column++;
        return ch;
    }

    private isAtEnd(): boolean {
        return this.current >= this.source.length;
    }

    private getCurrentRange(): Range {
        return createRange(this.line, this.column, this.line, this.column);
    }

    private makeRange(startLine: number, startColumn: number): Range {
        return createRange(startLine, startColumn, this.line, this.column);
    }

    private addToken(type: TokenType, value: string, range: Range): void {
        this.tokens.push(createToken(type, value, range));
    }
}
