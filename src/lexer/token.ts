import { Range } from "../utils/position";

export enum TokenType {
    
    IntLiteral, 
    FloatLiteral, 
    DoubleLiteral, 
    StringLiteral, 
    BoolLiteral, 

    
    Var, 
    Def, 
    If, 
    Else, 
    While, 
    Break, 
    Return, 
    Import, 
    Execute, 
    And, 
    Or, 

    
    DunderNamespace, 
    DunderMain, 

    
    Identifier, 
    Plus, 
    Minus, 
    Star, 
    Slash, 
    Percent, 
    Eq, 
    NotEq, 
    Lt, 
    Gt, 
    LtEq, 
    GtEq, 
    Assign, 
    Not, 

    
    LParen, 
    RParen, 
    LBrace, 
    RBrace, 
    LBracket, 
    RBracket, 
    Comma, 
    Dot, 
    Semicolon, 
    Colon, 

    
    CommandLine, 
    MacroCommandLine, 
    Comment, 
    Newline, 
    EOF, 
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
