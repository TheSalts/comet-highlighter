import { Range } from "../utils/position";

export enum TokenType {
    // Literals
    IntLiteral, // 1, -2, 100
    FloatLiteral, // 1f, 2.7f
    DoubleLiteral, // 1.0, 3.14
    StringLiteral, // "..."
    BoolLiteral, // true, false

    // Keywords
    Var, // var
    Def, // def
    If, // if
    Else, // else
    While, // while
    Break, // break
    Return, // return
    Import, // import
    Execute, // execute
    And, // and
    Or, // or

    // Special identifiers
    DunderNamespace, // __namespace__
    DunderMain, // __main__

    // Identifier & Operators
    Identifier, // [a-zA-Z_][a-zA-Z0-9_]*
    Plus, // +
    Minus, // -
    Star, // *
    Slash, // /
    Percent, // %
    Eq, // ==
    NotEq, // !=
    Lt, // <
    Gt, // >
    LtEq, // <=
    GtEq, // >=
    Assign, // =
    Not, // !

    // Punctuation
    LParen, // (
    RParen, // )
    LBrace, // {
    RBrace, // }
    LBracket, // [
    RBracket, // ]
    Comma, // ,
    Dot, // .
    Semicolon, // ;
    Colon, // :

    // Special
    CommandLine, // /...  (entire line)
    MacroCommandLine, // /$... (entire line)
    Comment, // # ...
    Newline, // \n (significant for statement separation)
    EOF, // End of file
}

export interface Token {
    type: TokenType;
    value: string;
    range: Range;
}

export function createToken(
    type: TokenType,
    value: string,
    range: Range
): Token {
    return { type, value, range };
}

// Keyword mapping
export const KEYWORDS: Map<string, TokenType> = new Map([
    ["var", TokenType.Var],
    ["def", TokenType.Def],
    ["if", TokenType.If],
    ["else", TokenType.Else],
    ["while", TokenType.While],
    ["break", TokenType.Break],
    ["return", TokenType.Return],
    ["import", TokenType.Import],
    ["execute", TokenType.Execute],
    ["and", TokenType.And],
    ["or", TokenType.Or],
    ["true", TokenType.BoolLiteral],
    ["false", TokenType.BoolLiteral],
    ["__namespace__", TokenType.DunderNamespace],
    ["__main__", TokenType.DunderMain],
]);
