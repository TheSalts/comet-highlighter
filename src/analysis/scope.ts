import { Range } from "../utils/position";
import * as AST from "../parser/ast";

export type SymbolKind =
    | "variable"
    | "function"
    | "parameter"
    | "import"
    | "builtin"
    | "score"
    | "tag"
    | "storage";

export interface Symbol {
    name: string;
    kind: SymbolKind;
    declarationRange: Range;
    params?: ParamInfo[];
    returnType?: string;
    documentation?: string;
    
    scope?: string; 
}

export interface ParamInfo {
    name: string;
    type?: string;
}

export class Scope {
    parent: Scope | null = null;
    children: Scope[] = [];
    symbols: Map<string, Symbol> = new Map();
    range: Range;

    constructor(range: Range, parent: Scope | null = null) {
        this.range = range;
        this.parent = parent;
        if (parent) {
            parent.children.push(this);
        }
    }

    define(symbol: Symbol): void {
        this.symbols.set(symbol.name, symbol);
    }

    resolve(name: string): Symbol | null {
        const symbol = this.symbols.get(name);
        if (symbol) {
            return symbol;
        }
        if (this.parent) {
            return this.parent.resolve(name);
        }
        return null;
    }

    resolveLocal(name: string): Symbol | null {
        return this.symbols.get(name) || null;
    }
}


export const BUILTIN_FUNCTIONS: Symbol[] = [
    {
        name: "print",
        kind: "builtin",
        declarationRange: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
        },
        params: [{ name: "value" }, { name: "...args" }],
        returnType: "void",
        documentation: "Print values to the console",
    },
    {
        name: "random",
        kind: "builtin",
        declarationRange: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
        },
        params: [],
        returnType: "double",
        documentation: "Generate a random double value",
    },
    {
        name: "type",
        kind: "builtin",
        declarationRange: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
        },
        params: [{ name: "value" }],
        returnType: "string",
        documentation: "Get the type of a value",
    },
    {
        name: "round",
        kind: "builtin",
        declarationRange: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
        },
        params: [{ name: "value", type: "float|double" }],
        returnType: "int",
        documentation: "Round a float or double to the nearest integer",
    },
    {
        name: "get_score",
        kind: "builtin",
        declarationRange: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
        },
        params: [
            { name: "target", type: "string" },
            { name: "objective", type: "string" },
        ],
        returnType: "int",
        documentation: "Get a scoreboard score",
    },
    {
        name: "set_score",
        kind: "builtin",
        declarationRange: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
        },
        params: [
            { name: "target", type: "string" },
            { name: "objective", type: "string" },
            { name: "value" },
        ],
        returnType: "any",
        documentation: "Set a scoreboard score",
    },
    {
        name: "get_data",
        kind: "builtin",
        declarationRange: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
        },
        params: [
            { name: "type", type: "string" },
            { name: "target", type: "string" },
            { name: "path", type: "string" },
        ],
        returnType: "any",
        documentation: "Get NBT data",
    },
    {
        name: "set_data",
        kind: "builtin",
        declarationRange: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
        },
        params: [
            { name: "type", type: "string" },
            { name: "target", type: "string" },
            { name: "path", type: "string" },
            { name: "value" },
        ],
        returnType: "void",
        documentation: "Set NBT data",
    },
    {
        name: "append",
        kind: "builtin",
        declarationRange: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
        },
        params: [{ name: "array", type: "array" }, { name: "value" }],
        returnType: "void",
        documentation: "Append a value to an array",
    },
    {
        name: "del",
        kind: "builtin",
        declarationRange: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
        },
        params: [{ name: "value" }],
        returnType: "void",
        documentation: "Delete a value",
    },
    {
        name: "len",
        kind: "builtin",
        declarationRange: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
        },
        params: [{ name: "value", type: "array|string" }],
        returnType: "int",
        documentation: "Get the length of an array or string",
    },
    {
        name: "is_module",
        kind: "builtin",
        declarationRange: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
        },
        params: [],
        returnType: "bool",
        documentation:
            "Check if the current file is being imported as a module",
    },
    {
        name: "divide",
        kind: "builtin",
        declarationRange: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
        },
        params: [
            { name: "a", type: "number" },
            { name: "b", type: "number" },
        ],
        returnType: "float",
        documentation: "Divide two numbers and return a float",
    },
    {
        name: "multiply",
        kind: "builtin",
        declarationRange: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
        },
        params: [
            { name: "a", type: "number" },
            { name: "b", type: "number" },
        ],
        returnType: "float",
        documentation: "Multiply two numbers and return a float",
    },
    {
        name: "int",
        kind: "builtin",
        declarationRange: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
        },
        params: [{ name: "value" }],
        returnType: "int",
        documentation: "Convert a value to an integer",
    },
    {
        name: "float",
        kind: "builtin",
        declarationRange: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
        },
        params: [{ name: "value" }],
        returnType: "float",
        documentation: "Convert a value to a float",
    },
    {
        name: "double",
        kind: "builtin",
        declarationRange: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
        },
        params: [{ name: "value" }],
        returnType: "double",
        documentation: "Convert a value to a double",
    },
    {
        name: "bool",
        kind: "builtin",
        declarationRange: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
        },
        params: [{ name: "value" }],
        returnType: "bool",
        documentation: "Convert a value to a boolean",
    },
    {
        name: "string",
        kind: "builtin",
        declarationRange: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
        },
        params: [{ name: "value" }],
        returnType: "string",
        documentation: "Convert a value to a string",
    },
];

export class ScopeAnalyzer {
    private globalScope: Scope;
    private currentScope: Scope;

    constructor() {
        this.globalScope = new Scope({
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
        });
        this.currentScope = this.globalScope;

        
        for (const builtin of BUILTIN_FUNCTIONS) {
            this.globalScope.define(builtin);
        }
    }

    analyze(program: AST.Program): Scope {
        this.visitProgram(program);
        return this.globalScope;
    }

    getGlobalScope(): Scope {
        return this.globalScope;
    }

    private visitProgram(node: AST.Program): void {
        for (const stmt of node.body) {
            this.visitStatement(stmt);
        }
    }

    private visitStatement(node: AST.Statement): void {
        switch (node.type) {
            case "VarDeclaration":
                this.visitVarDeclaration(node);
                break;
            case "FuncDeclaration":
                this.visitFuncDeclaration(node);
                break;
            case "IfStatement":
                this.visitIfStatement(node);
                break;
            case "WhileStatement":
                this.visitWhileStatement(node);
                break;
            case "ReturnStatement":
                if (node.argument) {
                    this.visitExpression(node.argument);
                }
                break;
            case "ImportStatement":
                this.visitImportStatement(node);
                break;
            case "ExecuteStatement":
                this.visitExecuteStatement(node);
                break;
            case "ExpressionStatement":
                this.visitExpression(node.expression);
                break;
            case "BlockStatement":
                this.visitBlockStatement(node);
                break;
            default:
                
                break;
        }
    }

    private visitVarDeclaration(node: AST.VarDeclaration): void {
        this.currentScope.define({
            name: node.name.name,
            kind: "variable",
            declarationRange: node.name.range,
        });

        if (node.init) {
            this.visitExpression(node.init);
        }
    }

    private visitFuncDeclaration(node: AST.FuncDeclaration): void {
        
        const params: ParamInfo[] = node.params.map(p => ({
            name: p.name.name,
        }));

        this.currentScope.define({
            name: node.name.name,
            kind: "function",
            declarationRange: node.name.range,
            params,
        });

        
        const funcScope = new Scope(node.body.range, this.currentScope);
        const previousScope = this.currentScope;
        this.currentScope = funcScope;

        
        for (const param of node.params) {
            funcScope.define({
                name: param.name.name,
                kind: "parameter",
                declarationRange: param.name.range,
            });
        }

        
        for (const stmt of node.body.body) {
            this.visitStatement(stmt);
        }

        this.currentScope = previousScope;
    }

    private visitIfStatement(node: AST.IfStatement): void {
        this.visitExpression(node.condition);
        this.visitStatement(node.consequent);

        for (const elseIf of node.elseIfClauses) {
            this.visitExpression(elseIf.condition);
            this.visitStatement(elseIf.consequent);
        }

        if (node.alternate) {
            this.visitStatement(node.alternate);
        }
    }

    private visitWhileStatement(node: AST.WhileStatement): void {
        this.visitExpression(node.condition);
        this.visitStatement(node.body);
    }

    private visitImportStatement(node: AST.ImportStatement): void {
        this.currentScope.define({
            name: node.source.name,
            kind: "import",
            declarationRange: node.source.range,
        });
    }

    private visitExecuteStatement(node: AST.ExecuteStatement): void {
        
        const execScope = new Scope(node.body.range, this.currentScope);
        const previousScope = this.currentScope;
        this.currentScope = execScope;

        for (const stmt of node.body.body) {
            this.visitStatement(stmt);
        }

        this.currentScope = previousScope;
    }

    private visitBlockStatement(node: AST.BlockStatement): void {
        
        const blockScope = new Scope(node.range, this.currentScope);
        const previousScope = this.currentScope;
        this.currentScope = blockScope;

        for (const stmt of node.body) {
            this.visitStatement(stmt);
        }

        this.currentScope = previousScope;
    }

    private visitExpression(node: AST.Expression): void {
        switch (node.type) {
            case "BinaryExpression":
                this.visitExpression(node.left);
                this.visitExpression(node.right);
                break;
            case "UnaryExpression":
                this.visitExpression(node.argument);
                break;
            case "AssignmentExpression":
                this.visitExpression(node.value);
                break;
            case "CallExpression":
                
                if (node.callee.type === "Identifier") {
                    this.handleTrackingFunction(
                        node.callee.name,
                        node.arguments
                    );
                }

                for (const arg of node.arguments) {
                    this.visitExpression(arg);
                }
                break;
            case "MemberExpression":
                this.visitExpression(node.object);
                if (node.computed) {
                    this.visitExpression(node.property);
                }
                break;
            case "ArrayLiteral":
                for (const elem of node.elements) {
                    this.visitExpression(elem);
                }
                break;
            case "ParenExpression":
                this.visitExpression(node.expression);
                break;
            default:
                
                break;
        }
    }

    private handleTrackingFunction(
        funcName: string,
        args: AST.Expression[]
    ): void {
        const getArgValue = (arg: AST.Expression): string | null => {
            if (arg.type === "StringLiteral") return arg.value;
            return null;
        };

        if (funcName === "set_score" || funcName === "get_score") {
            const target = getArgValue(args[0]);
            const objective = getArgValue(args[1]);
            if (target && objective) {
                
                this.globalScope.define({
                    name: target,
                    kind: "score",
                    scope: objective,
                    declarationRange: args[0].range,
                });
            }
        } else if (funcName === "set_data" || funcName === "get_data") {
            const type = getArgValue(args[0]);
            const target = getArgValue(args[1]);
            if (type && target) {
                if (type === "storage") {
                    this.globalScope.define({
                        name: target,
                        kind: "storage",
                        declarationRange: args[1].range,
                    });
                }
            }
        }
        
        
    }
}
