import { Range } from "../utils/position";
export { Range };

// ============================================================================
// Program (Top-level)
// ============================================================================

export interface Program {
    type: "Program";
    body: Statement[];
    range: Range;
}

// ============================================================================
// Statements
// ============================================================================

export type Statement =
    | VarDeclaration
    | FuncDeclaration
    | IfStatement
    | WhileStatement
    | ReturnStatement
    | BreakStatement
    | ImportStatement
    | ExecuteStatement
    | CommandStatement
    | MacroCommandStatement
    | ExpressionStatement
    | BlockStatement
    | ErrorNode;

export interface VarDeclaration {
    type: "VarDeclaration";
    name: Identifier;
    init: Expression | null;
    range: Range;
}

export interface FuncDeclaration {
    type: "FuncDeclaration";
    name: Identifier;
    params: VarDeclaration[];
    body: BlockStatement;
    range: Range;
}

export interface IfStatement {
    type: "IfStatement";
    condition: Expression;
    consequent: Statement;
    elseIfClauses: ElseIfClause[];
    alternate: Statement | null;
    range: Range;
}

export interface ElseIfClause {
    type: "ElseIfClause";
    condition: Expression;
    consequent: Statement;
    range: Range;
}

export interface WhileStatement {
    type: "WhileStatement";
    condition: Expression;
    body: Statement;
    range: Range;
}

export interface ReturnStatement {
    type: "ReturnStatement";
    argument: Expression | null;
    range: Range;
}

export interface BreakStatement {
    type: "BreakStatement";
    range: Range;
}

export interface ImportStatement {
    type: "ImportStatement";
    source: Identifier;
    range: Range;
}

export interface ExecuteStatement {
    type: "ExecuteStatement";
    subcommands: string;
    subcommandRange: Range;
    body: BlockStatement;
    range: Range;
}

export interface CommandStatement {
    type: "CommandStatement";
    command: string;
    commandRange: Range;
    range: Range;
}

export interface MacroCommandStatement {
    type: "MacroCommandStatement";
    command: string;
    macroExpansions: MacroExpansion[];
    commandRange: Range;
    range: Range;
}

export interface MacroExpansion {
    type: "MacroExpansion";
    variable: string;
    range: Range;
}

export interface ExpressionStatement {
    type: "ExpressionStatement";
    expression: Expression;
    range: Range;
}

export interface BlockStatement {
    type: "BlockStatement";
    body: Statement[];
    range: Range;
}

export interface ErrorNode {
    type: "ErrorNode";
    message: string;
    range: Range;
}

// ============================================================================
// Expressions
// ============================================================================

export type Expression =
    | IntLiteral
    | FloatLiteral
    | DoubleLiteral
    | StringLiteral
    | BoolLiteral
    | ArrayLiteral
    | NbtLiteral
    | Identifier
    | BinaryExpression
    | UnaryExpression
    | AssignmentExpression
    | CallExpression
    | MemberExpression
    | ParenExpression;

export interface IntLiteral {
    type: "IntLiteral";
    value: number;
    raw: string;
    range: Range;
}

export interface FloatLiteral {
    type: "FloatLiteral";
    value: number;
    raw: string;
    range: Range;
}

export interface DoubleLiteral {
    type: "DoubleLiteral";
    value: number;
    raw: string;
    range: Range;
}

export interface StringLiteral {
    type: "StringLiteral";
    value: string;
    raw: string;
    range: Range;
}

export interface BoolLiteral {
    type: "BoolLiteral";
    value: boolean;
    raw: string;
    range: Range;
}

export interface ArrayLiteral {
    type: "ArrayLiteral";
    elements: Expression[];
    range: Range;
}

export interface NbtLiteral {
    type: "NbtLiteral";
    raw: string;
    range: Range;
}

export interface Identifier {
    type: "Identifier";
    name: string;
    range: Range;
}

export interface BinaryExpression {
    type: "BinaryExpression";
    operator:
        | "+"
        | "-"
        | "*"
        | "/"
        | "%"
        | "=="
        | "!="
        | "<"
        | ">"
        | "<="
        | ">="
        | "and"
        | "or";
    left: Expression;
    right: Expression;
    range: Range;
}

export interface UnaryExpression {
    type: "UnaryExpression";
    operator: "!" | "-";
    argument: Expression;
    range: Range;
}

export interface AssignmentExpression {
    type: "AssignmentExpression";
    target: Identifier | MemberExpression;
    value: Expression;
    range: Range;
}

export interface CallExpression {
    type: "CallExpression";
    callee: Identifier | MemberExpression;
    arguments: Expression[];
    range: Range;
}

export interface MemberExpression {
    type: "MemberExpression";
    object: Expression;
    property: Expression;
    computed: boolean; // true: a[0], false: a.b
    range: Range;
}

export interface ParenExpression {
    type: "ParenExpression";
    expression: Expression;
    range: Range;
}
