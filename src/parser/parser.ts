import { Token, TokenType } from "../lexer/token";
import { createRange, Range } from "../utils/position";
import * as AST from "./ast";

export interface ParseError {
    message: string;
    range: Range;
}

export class Parser {
    private tokens: Token[];
    private current = 0;
    private errors: ParseError[] = [];
    public comments: Token[] = [];

    constructor(tokens: Token[]) {
        
        this.comments = tokens.filter(t => t.type === TokenType.Comment);
        this.tokens = tokens.filter(t => t.type !== TokenType.Comment);
    }

    parse(): AST.Program {
        const startRange = this.tokens[0]?.range || createRange(0, 0, 0, 0);
        const statements: AST.Statement[] = [];

        while (!this.isAtEnd()) {
            
            if (
                this.check(TokenType.Newline) ||
                this.check(TokenType.Semicolon)
            ) {
                this.advance();
                continue;
            }

            try {
                const stmt = this.parseStatement();
                if (stmt) {
                    statements.push(stmt);
                }
            } catch (e) {
                
                this.synchronize();
            }
        }

        const endRange = this.previous().range;
        return {
            type: "Program",
            body: statements,
            range: createRange(
                startRange.start.line,
                startRange.start.character,
                endRange.end.line,
                endRange.end.character
            ),
        };
    }

    getErrors(): ParseError[] {
        return this.errors;
    }

    
    
    

    private parseStatement(): AST.Statement | null {
        
        if (this.match(TokenType.Var)) {
            return this.parseVarDeclaration();
        }

        
        if (this.match(TokenType.Def)) {
            return this.parseFuncDeclaration();
        }

        
        if (this.match(TokenType.If)) {
            return this.parseIfStatement();
        }

        
        if (this.match(TokenType.While)) {
            return this.parseWhileStatement();
        }

        
        if (this.match(TokenType.Return)) {
            return this.parseReturnStatement();
        }

        
        if (this.match(TokenType.Break)) {
            return this.parseBreakStatement();
        }

        
        if (this.match(TokenType.Import)) {
            return this.parseImportStatement();
        }

        
        if (this.match(TokenType.Execute)) {
            return this.parseExecuteStatement();
        }

        
        if (this.check(TokenType.CommandLine)) {
            return this.parseCommandStatement();
        }

        
        if (this.check(TokenType.MacroCommandLine)) {
            return this.parseMacroCommandStatement();
        }

        
        if (this.check(TokenType.LBrace)) {
            return this.parseBlockStatement();
        }

        
        return this.parseExpressionStatement();
    }

    private parseVarDeclaration(): AST.VarDeclaration {
        const start = this.previous();

        if (!this.check(TokenType.Identifier)) {
            this.error("Expected variable name");
            return {
                type: "VarDeclaration",
                name: {
                    type: "Identifier",
                    name: "",
                    range: this.peek().range,
                },
                init: null,
                range: start.range,
            };
        }

        const name = this.parseIdentifier();
        let init: AST.Expression | null = null;

        if (this.match(TokenType.Assign)) {
            init = this.parseExpression();
        }

        this.consumeStatementTerminator();

        return {
            type: "VarDeclaration",
            name,
            init,
            range: this.makeRange(start),
        };
    }

    private parseFuncDeclaration(): AST.FuncDeclaration {
        const start = this.previous();

        const name = this.parseIdentifier();

        this.consume(TokenType.LParen, 'Expected "(" after function name');

        const params: AST.VarDeclaration[] = [];
        if (!this.check(TokenType.RParen)) {
            do {
                if (!this.match(TokenType.Var)) {
                    this.error('Expected "var" before parameter name');
                }
                const paramName = this.parseIdentifier();
                params.push({
                    type: "VarDeclaration",
                    name: paramName,
                    init: null,
                    range: paramName.range,
                });
            } while (this.match(TokenType.Comma));
        }

        this.consume(TokenType.RParen, 'Expected ")" after parameters');

        const body = this.parseBlockStatement();

        return {
            type: "FuncDeclaration",
            name,
            params,
            body,
            range: this.makeRange(start),
        };
    }

    private parseIfStatement(): AST.IfStatement {
        const start = this.previous();

        this.consume(TokenType.LParen, 'Expected "(" after "if"');
        const condition = this.parseExpression();
        this.consume(TokenType.RParen, 'Expected ")" after condition');

        const consequent = this.parseStatement()!;
        const elseIfClauses: AST.ElseIfClause[] = [];
        let alternate: AST.Statement | null = null;

        
        while (this.check(TokenType.Else) && this.checkNext(TokenType.If)) {
            this.advance(); 
            this.advance(); 

            const elseIfStart = this.previous();
            this.consume(TokenType.LParen, 'Expected "(" after "else if"');
            const elseIfCondition = this.parseExpression();
            this.consume(
                TokenType.RParen,
                'Expected ")" after else if condition'
            );
            const elseIfConsequent = this.parseStatement()!;

            elseIfClauses.push({
                type: "ElseIfClause",
                condition: elseIfCondition,
                consequent: elseIfConsequent,
                range: this.makeRange(elseIfStart),
            });
        }

        
        if (this.match(TokenType.Else)) {
            alternate = this.parseStatement();
        }

        return {
            type: "IfStatement",
            condition,
            consequent,
            elseIfClauses,
            alternate,
            range: this.makeRange(start),
        };
    }

    private parseWhileStatement(): AST.WhileStatement {
        const start = this.previous();

        this.consume(TokenType.LParen, 'Expected "(" after "while"');
        const condition = this.parseExpression();
        this.consume(TokenType.RParen, 'Expected ")" after condition');

        const body = this.parseStatement()!;

        return {
            type: "WhileStatement",
            condition,
            body,
            range: this.makeRange(start),
        };
    }

    private parseReturnStatement(): AST.ReturnStatement {
        const start = this.previous();

        let argument: AST.Expression | null = null;

        
        if (
            !this.check(TokenType.Newline) &&
            !this.check(TokenType.Semicolon) &&
            !this.isAtEnd()
        ) {
            argument = this.parseExpression();
        }

        this.consumeStatementTerminator();

        return {
            type: "ReturnStatement",
            argument,
            range: this.makeRange(start),
        };
    }

    private parseBreakStatement(): AST.BreakStatement {
        const start = this.previous();
        this.consumeStatementTerminator();

        return {
            type: "BreakStatement",
            range: this.makeRange(start),
        };
    }

    private parseImportStatement(): AST.ImportStatement {
        const start = this.previous();

        const source = this.parseIdentifier();
        this.consumeStatementTerminator();

        return {
            type: "ImportStatement",
            source,
            range: this.makeRange(start),
        };
    }

    private parseExecuteStatement(): AST.ExecuteStatement {
        const start = this.previous();

        this.consume(TokenType.LParen, 'Expected "(" after "execute"');

        
        const subcommandStart = this.peek();
        let subcommandsText = "";
        let depth = 1;

        while (!this.isAtEnd() && depth > 0) {
            if (this.check(TokenType.LParen)) {
                depth++;
            } else if (this.check(TokenType.RParen)) {
                depth--;
                if (depth === 0) break;
            }
            subcommandsText += this.peek().value + " ";
            this.advance();
        }

        const subcommandEnd = this.previous();
        const subcommandRange = createRange(
            subcommandStart.range.start.line,
            subcommandStart.range.start.character,
            subcommandEnd.range.end.line,
            subcommandEnd.range.end.character
        );

        this.consume(
            TokenType.RParen,
            'Expected ")" after execute subcommands'
        );

        const body = this.parseBlockStatement();

        return {
            type: "ExecuteStatement",
            subcommands: subcommandsText.trim(),
            subcommandRange,
            body,
            range: this.makeRange(start),
        };
    }

    private parseCommandStatement(): AST.CommandStatement {
        const token = this.advance();

        return {
            type: "CommandStatement",
            command: token.value,
            commandRange: token.range,
            range: token.range,
        };
    }

    private parseMacroCommandStatement(): AST.MacroCommandStatement {
        const token = this.advance();

        
        const macroExpansions: AST.MacroExpansion[] = [];
        const regex = /\$\(([^)]+)\)/g;
        let match;

        while ((match = regex.exec(token.value)) !== null) {
            const varName = match[1];
            const offset = match.index;

            macroExpansions.push({
                type: "MacroExpansion",
                variable: varName,
                range: createRange(
                    token.range.start.line,
                    token.range.start.character + offset,
                    token.range.start.line,
                    token.range.start.character + offset + match[0].length
                ),
            });
        }

        return {
            type: "MacroCommandStatement",
            command: token.value,
            macroExpansions,
            commandRange: token.range,
            range: token.range,
        };
    }

    private parseExpressionStatement(): AST.ExpressionStatement {
        const expr = this.parseExpression();
        this.consumeStatementTerminator();

        return {
            type: "ExpressionStatement",
            expression: expr,
            range: expr.range,
        };
    }

    private parseBlockStatement(): AST.BlockStatement {
        const start = this.peek();

        this.consume(TokenType.LBrace, 'Expected "{"');

        const statements: AST.Statement[] = [];

        while (!this.check(TokenType.RBrace) && !this.isAtEnd()) {
            
            if (
                this.match(TokenType.Newline) ||
                this.match(TokenType.Semicolon)
            ) {
                continue;
            }

            const stmt = this.parseStatement();
            if (stmt) {
                statements.push(stmt);
            }
        }

        this.consume(TokenType.RBrace, 'Expected "}"');

        return {
            type: "BlockStatement",
            body: statements,
            range: this.makeRange(start),
        };
    }

    
    
    

    private parseExpression(): AST.Expression {
        return this.parseAssignment();
    }

    private parseAssignment(): AST.Expression {
        const expr = this.parseOr();

        if (this.match(TokenType.Assign)) {
            const value = this.parseAssignment();

            if (
                expr.type === "Identifier" ||
                expr.type === "MemberExpression"
            ) {
                return {
                    type: "AssignmentExpression",
                    target: expr,
                    value,
                    range: createRange(
                        expr.range.start.line,
                        expr.range.start.character,
                        value.range.end.line,
                        value.range.end.character
                    ),
                };
            }

            this.error("Invalid assignment target");
        }

        return expr;
    }

    private parseOr(): AST.Expression {
        let left = this.parseAnd();

        while (this.match(TokenType.Or)) {
            const operator = "or";
            const right = this.parseAnd();
            left = {
                type: "BinaryExpression",
                operator,
                left,
                right,
                range: this.combineRanges(left.range, right.range),
            };
        }

        return left;
    }

    private parseAnd(): AST.Expression {
        let left = this.parseEquality();

        while (this.match(TokenType.And)) {
            const operator = "and";
            const right = this.parseEquality();
            left = {
                type: "BinaryExpression",
                operator,
                left,
                right,
                range: this.combineRanges(left.range, right.range),
            };
        }

        return left;
    }

    private parseEquality(): AST.Expression {
        let left = this.parseComparison();

        while (this.match(TokenType.Eq, TokenType.NotEq)) {
            const op = this.previous().type;
            const operator = op === TokenType.Eq ? "==" : "!=";
            const right = this.parseComparison();
            left = {
                type: "BinaryExpression",
                operator,
                left,
                right,
                range: this.combineRanges(left.range, right.range),
            };
        }

        return left;
    }

    private parseComparison(): AST.Expression {
        let left = this.parseAdditive();

        while (
            this.match(
                TokenType.Lt,
                TokenType.Gt,
                TokenType.LtEq,
                TokenType.GtEq
            )
        ) {
            const op = this.previous().type;
            let operator: "<" | ">" | "<=" | ">=";
            switch (op) {
                case TokenType.Lt:
                    operator = "<";
                    break;
                case TokenType.Gt:
                    operator = ">";
                    break;
                case TokenType.LtEq:
                    operator = "<=";
                    break;
                case TokenType.GtEq:
                    operator = ">=";
                    break;
                default:
                    operator = "<";
            }
            const right = this.parseAdditive();
            left = {
                type: "BinaryExpression",
                operator,
                left,
                right,
                range: this.combineRanges(left.range, right.range),
            };
        }

        return left;
    }

    private parseAdditive(): AST.Expression {
        let left = this.parseMultiplicative();

        while (this.match(TokenType.Plus, TokenType.Minus)) {
            const op = this.previous().type;
            const operator = op === TokenType.Plus ? "+" : "-";
            const right = this.parseMultiplicative();
            left = {
                type: "BinaryExpression",
                operator,
                left,
                right,
                range: this.combineRanges(left.range, right.range),
            };
        }

        return left;
    }

    private parseMultiplicative(): AST.Expression {
        let left = this.parseUnary();

        while (this.match(TokenType.Star, TokenType.Slash, TokenType.Percent)) {
            const op = this.previous().type;
            let operator: "*" | "/" | "%";
            switch (op) {
                case TokenType.Star:
                    operator = "*";
                    break;
                case TokenType.Slash:
                    operator = "/";
                    break;
                case TokenType.Percent:
                    operator = "%";
                    break;
                default:
                    operator = "*";
            }
            const right = this.parseUnary();
            left = {
                type: "BinaryExpression",
                operator,
                left,
                right,
                range: this.combineRanges(left.range, right.range),
            };
        }

        return left;
    }

    private parseUnary(): AST.Expression {
        if (this.match(TokenType.Not, TokenType.Minus)) {
            const op = this.previous();
            const operator = op.type === TokenType.Not ? "!" : "-";
            const argument = this.parseUnary();
            return {
                type: "UnaryExpression",
                operator,
                argument,
                range: this.combineRanges(op.range, argument.range),
            };
        }

        return this.parsePostfix();
    }

    private parsePostfix(): AST.Expression {
        let expr = this.parsePrimary();

        while (true) {
            if (this.match(TokenType.LParen)) {
                
                const args: AST.Expression[] = [];

                if (!this.check(TokenType.RParen)) {
                    do {
                        args.push(this.parseExpression());
                    } while (this.match(TokenType.Comma));
                }

                const closeParen = this.consume(
                    TokenType.RParen,
                    'Expected ")" after arguments'
                );

                if (
                    expr.type !== "Identifier" &&
                    expr.type !== "MemberExpression"
                ) {
                    this.error("Invalid function call target");
                }

                expr = {
                    type: "CallExpression",
                    callee: expr as AST.Identifier | AST.MemberExpression,
                    arguments: args,
                    range: this.combineRanges(expr.range, closeParen.range),
                };
            } else if (this.match(TokenType.LBracket)) {
                
                const property = this.parseExpression();
                const closeBracket = this.consume(
                    TokenType.RBracket,
                    'Expected "]"'
                );

                expr = {
                    type: "MemberExpression",
                    object: expr,
                    property,
                    computed: true,
                    range: this.combineRanges(expr.range, closeBracket.range),
                };
            } else if (this.match(TokenType.Dot)) {
                
                const property = this.parseIdentifier();

                expr = {
                    type: "MemberExpression",
                    object: expr,
                    property,
                    computed: false,
                    range: this.combineRanges(expr.range, property.range),
                };
            } else {
                break;
            }
        }

        return expr;
    }

    private parsePrimary(): AST.Expression {
        
        if (this.match(TokenType.IntLiteral)) {
            const token = this.previous();
            return {
                type: "IntLiteral",
                value: parseInt(token.value, 10),
                raw: token.value,
                range: token.range,
            };
        }

        
        if (this.match(TokenType.FloatLiteral)) {
            const token = this.previous();
            return {
                type: "FloatLiteral",
                value: parseFloat(token.value),
                raw: token.value,
                range: token.range,
            };
        }

        
        if (this.match(TokenType.DoubleLiteral)) {
            const token = this.previous();
            return {
                type: "DoubleLiteral",
                value: parseFloat(token.value),
                raw: token.value,
                range: token.range,
            };
        }

        
        if (this.match(TokenType.StringLiteral)) {
            const token = this.previous();
            return {
                type: "StringLiteral",
                value: token.value,
                raw: `"${token.value}"`,
                range: token.range,
            };
        }

        
        if (this.match(TokenType.BoolLiteral)) {
            const token = this.previous();
            return {
                type: "BoolLiteral",
                value: token.value === "true",
                raw: token.value,
                range: token.range,
            };
        }

        
        if (this.match(TokenType.LBracket)) {
            const start = this.previous();
            const elements: AST.Expression[] = [];

            if (!this.check(TokenType.RBracket)) {
                do {
                    elements.push(this.parseExpression());
                } while (this.match(TokenType.Comma));
            }

            const end = this.consume(TokenType.RBracket, 'Expected "]"');

            return {
                type: "ArrayLiteral",
                elements,
                range: this.combineRanges(start.range, end.range),
            };
        }

        
        if (this.match(TokenType.LBrace)) {
            const start = this.previous();
            let depth = 1;
            const nbtTokens: Token[] = [start];

            while (!this.isAtEnd() && depth > 0) {
                const token = this.advance();
                nbtTokens.push(token);

                if (token.type === TokenType.LBrace) {
                    depth++;
                } else if (token.type === TokenType.RBrace) {
                    depth--;
                }
            }

            const raw = nbtTokens.map(t => t.value).join("");
            const end = this.previous();

            return {
                type: "NbtLiteral",
                raw,
                range: this.combineRanges(start.range, end.range),
            };
        }

        
        if (this.match(TokenType.LParen)) {
            const start = this.previous();
            const expr = this.parseExpression();
            const end = this.consume(TokenType.RParen, 'Expected ")"');

            return {
                type: "ParenExpression",
                expression: expr,
                range: this.combineRanges(start.range, end.range),
            };
        }

        
        if (
            this.match(
                TokenType.Identifier,
                TokenType.DunderNamespace,
                TokenType.DunderMain
            )
        ) {
            const token = this.previous();
            return {
                type: "Identifier",
                name: token.value,
                range: token.range,
            };
        }

        
        this.error(`Unexpected token: ${this.peek().value}`);
        const token = this.advance();
        return {
            type: "Identifier",
            name: "",
            range: token.range,
        };
    }

    private parseIdentifier(): AST.Identifier {
        if (
            this.check(TokenType.Identifier) ||
            this.check(TokenType.DunderNamespace) ||
            this.check(TokenType.DunderMain)
        ) {
            const token = this.advance();
            return {
                type: "Identifier",
                name: token.value,
                range: token.range,
            };
        }

        this.error("Expected identifier");
        return {
            type: "Identifier",
            name: "",
            range: this.peek().range,
        };
    }

    
    
    

    private match(...types: TokenType[]): boolean {
        for (const type of types) {
            if (this.check(type)) {
                this.advance();
                return true;
            }
        }
        return false;
    }

    private check(type: TokenType): boolean {
        if (this.isAtEnd()) return false;
        return this.peek().type === type;
    }

    private checkNext(type: TokenType): boolean {
        if (this.current + 1 >= this.tokens.length) return false;
        return this.tokens[this.current + 1].type === type;
    }

    private advance(): Token {
        if (!this.isAtEnd()) this.current++;
        return this.previous();
    }

    private isAtEnd(): boolean {
        return this.peek().type === TokenType.EOF;
    }

    private peek(): Token {
        return this.tokens[this.current];
    }

    private previous(): Token {
        return this.tokens[this.current - 1];
    }

    private consume(type: TokenType, message: string): Token {
        if (this.check(type)) return this.advance();

        this.error(message);
        return this.peek();
    }

    private consumeStatementTerminator(): void {
        
        this.match(TokenType.Newline, TokenType.Semicolon);
    }

    private error(message: string): void {
        const token = this.peek();
        this.errors.push({
            message,
            range: token.range,
        });
    }

    private synchronize(): void {
        this.advance();

        while (!this.isAtEnd()) {
            if (
                this.previous().type === TokenType.Newline ||
                this.previous().type === TokenType.Semicolon
            ) {
                return;
            }

            switch (this.peek().type) {
                case TokenType.Def:
                case TokenType.Var:
                case TokenType.If:
                case TokenType.While:
                case TokenType.Return:
                case TokenType.Import:
                case TokenType.Execute:
                case TokenType.CommandLine:
                case TokenType.MacroCommandLine:
                    return;
            }

            this.advance();
        }
    }

    private makeRange(start: Token): Range {
        const end = this.previous();
        return createRange(
            start.range.start.line,
            start.range.start.character,
            end.range.end.line,
            end.range.end.character
        );
    }

    private combineRanges(start: Range, end: Range): Range {
        return createRange(
            start.start.line,
            start.start.character,
            end.end.line,
            end.end.character
        );
    }
}
