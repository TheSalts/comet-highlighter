import * as vscode from "vscode";
import * as AST from "../parser/ast";
import { Scope, ScopeAnalyzer } from "./scope";
import { rangeToVscodeRange, Range } from "../utils/position";

export interface Diagnostic {
    range: vscode.Range;
    message: string;
    severity: vscode.DiagnosticSeverity;
    source: string;
}

export class DiagnosticGenerator {
    private diagnostics: Diagnostic[] = [];
    private scopeAnalyzer: ScopeAnalyzer;
    private globalScope: Scope | null = null;
    private currentScope: Scope | null = null;
    private inLoop = 0;
    private inFunction = 0;

    constructor() {
        this.scopeAnalyzer = new ScopeAnalyzer();
    }

    generate(
        program: AST.Program,
        parserErrors: string[]
    ): vscode.Diagnostic[] {
        this.diagnostics = [];
        this.inLoop = 0;
        this.inFunction = 0;

        // Add parser errors
        for (const error of parserErrors) {
            this.diagnostics.push({
                range: new vscode.Range(0, 0, 0, 0),
                message: error,
                severity: vscode.DiagnosticSeverity.Error,
                source: "comet",
            });
        }

        // Perform scope analysis
        this.globalScope = this.scopeAnalyzer.analyze(program);
        this.currentScope = this.globalScope;

        // Visit AST to generate semantic diagnostics
        this.visitProgram(program);

        return this.diagnostics.map(d => {
            const diag = new vscode.Diagnostic(d.range, d.message, d.severity);
            diag.source = d.source;
            return diag;
        });
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
                this.visitReturnStatement(node);
                break;
            case "BreakStatement":
                this.visitBreakStatement(node);
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
        if (node.init) {
            this.visitExpression(node.init);
        }
    }

    private visitFuncDeclaration(node: AST.FuncDeclaration): void {
        // Check if function name starts with uppercase
        if (node.name.name.length > 0 && /^[A-Z]/.test(node.name.name)) {
            this.addDiagnostic(
                node.name.range,
                "Function names starting with uppercase letters may not be recognized by Minecraft",
                vscode.DiagnosticSeverity.Warning
            );
        }

        this.inFunction++;

        // Enter function scope
        const funcScope = this.findScopeForRange(node.body.range);
        if (funcScope) {
            const previousScope = this.currentScope;
            this.currentScope = funcScope;

            for (const stmt of node.body.body) {
                this.visitStatement(stmt);
            }

            this.currentScope = previousScope;
        }

        this.inFunction--;
    }

    private visitIfStatement(node: AST.IfStatement): void {
        this.visitExpression(node.condition);

        if (node.consequent.type !== "BlockStatement") {
            this.addDiagnostic(
                node.consequent.range,
                "If statement body should be enclosed in braces",
                vscode.DiagnosticSeverity.Warning
            );
        }
        this.visitStatement(node.consequent);

        // Check for else if usage and add information hint
        if (node.elseIfClauses.length > 0) {
            for (const elseIf of node.elseIfClauses) {
                this.addDiagnostic(
                    elseIf.range,
                    "else if may cause compiler bugs in some versions",
                    vscode.DiagnosticSeverity.Information
                );

                if (elseIf.consequent.type !== "BlockStatement") {
                    this.addDiagnostic(
                        elseIf.consequent.range,
                        "Else if statement body should be enclosed in braces",
                        vscode.DiagnosticSeverity.Warning
                    );
                }

                this.visitExpression(elseIf.condition);
                this.visitStatement(elseIf.consequent);
            }
        }

        if (node.alternate) {
            if (node.alternate.type !== "BlockStatement") {
                this.addDiagnostic(
                    node.alternate.range,
                    "Else statement body should be enclosed in braces",
                    vscode.DiagnosticSeverity.Warning
                );
            }
            this.visitStatement(node.alternate);
        }
    }

    private visitWhileStatement(node: AST.WhileStatement): void {
        this.visitExpression(node.condition);
        this.inLoop++;
        this.visitStatement(node.body);
        this.inLoop--;
    }

    private visitReturnStatement(node: AST.ReturnStatement): void {
        if (this.inFunction === 0) {
            this.addDiagnostic(
                node.range,
                "return statement outside of function",
                vscode.DiagnosticSeverity.Error
            );
        }

        if (node.argument) {
            this.visitExpression(node.argument);
        }
    }

    private visitBreakStatement(node: AST.BreakStatement): void {
        if (this.inLoop === 0) {
            this.addDiagnostic(
                node.range,
                "break statement outside of loop",
                vscode.DiagnosticSeverity.Error
            );
        }
    }

    private visitImportStatement(node: AST.ImportStatement): void {
        // Could add checks for file existence here
    }

    private visitExecuteStatement(node: AST.ExecuteStatement): void {
        // Enter execute scope
        const execScope = this.findScopeForRange(node.body.range);
        if (execScope) {
            const previousScope = this.currentScope;
            this.currentScope = execScope;

            for (const stmt of node.body.body) {
                this.visitStatement(stmt);
            }

            this.currentScope = previousScope;
        }
    }

    private visitBlockStatement(node: AST.BlockStatement): void {
        // Enter block scope
        const blockScope = this.findScopeForRange(node.range);
        if (blockScope) {
            const previousScope = this.currentScope;
            this.currentScope = blockScope;

            for (const stmt of node.body) {
                this.visitStatement(stmt);
            }

            this.currentScope = previousScope;
        }
    }

    private visitExpression(node: AST.Expression): void {
        switch (node.type) {
            case "Identifier":
                this.visitIdentifier(node);
                break;
            case "BinaryExpression":
                this.visitExpression(node.left);
                this.visitExpression(node.right);
                break;
            case "UnaryExpression":
                this.visitExpression(node.argument);
                break;
            case "AssignmentExpression":
                this.visitExpression(node.value);
                if (node.target.type === "Identifier") {
                    this.visitIdentifier(node.target);
                } else {
                    this.visitExpression(node.target);
                }
                break;
            case "CallExpression":
                this.visitCallExpression(node);
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
                // Literals don't need special handling
                break;
        }
    }

    private visitIdentifier(node: AST.Identifier): void {
        // Skip special identifiers
        if (node.name === "__namespace__" || node.name === "__main__") {
            return;
        }

        // Check if identifier is defined
        if (this.currentScope) {
            const symbol = this.currentScope.resolve(node.name);
            if (!symbol) {
                this.addDiagnostic(
                    node.range,
                    `Undefined identifier: ${node.name}`,
                    vscode.DiagnosticSeverity.Warning
                );
            }
        }
    }

    private visitCallExpression(node: AST.CallExpression): void {
        // Check function existence
        if (node.callee.type === "Identifier") {
            if (this.currentScope) {
                const symbol = this.currentScope.resolve(node.callee.name);
                if (!symbol) {
                    this.addDiagnostic(
                        node.callee.range,
                        `Undefined function: ${node.callee.name}`,
                        vscode.DiagnosticSeverity.Warning
                    );
                } else if (symbol.kind === "builtin" && symbol.params) {
                    // Check argument count for built-in functions
                    const minParams = symbol.params.filter(
                        p => !p.name.startsWith("...")
                    ).length;
                    const hasVariadic = symbol.params.some(p =>
                        p.name.startsWith("...")
                    );

                    if (!hasVariadic && node.arguments.length !== minParams) {
                        this.addDiagnostic(
                            node.range,
                            `Expected ${minParams} arguments, got ${node.arguments.length}`,
                            vscode.DiagnosticSeverity.Warning
                        );
                    } else if (node.arguments.length < minParams) {
                        this.addDiagnostic(
                            node.range,
                            `Expected at least ${minParams} arguments, got ${node.arguments.length}`,
                            vscode.DiagnosticSeverity.Warning
                        );
                    }
                }
            }
        }

        // Visit arguments
        for (const arg of node.arguments) {
            this.visitExpression(arg);
        }
    }

    private findScopeForRange(range: Range): Scope | null {
        if (!this.globalScope) return null;

        const findScope = (scope: Scope): Scope | null => {
            // Check if range is within this scope
            if (
                range.start.line >= scope.range.start.line &&
                range.end.line <= scope.range.end.line
            ) {
                // Check children first (more specific scopes)
                for (const child of scope.children) {
                    const found = findScope(child);
                    if (found) return found;
                }
                return scope;
            }
            return null;
        };

        return findScope(this.globalScope);
    }

    private addDiagnostic(
        range: Range,
        message: string,
        severity: vscode.DiagnosticSeverity
    ): void {
        this.diagnostics.push({
            range: rangeToVscodeRange(range),
            message,
            severity,
            source: "comet",
        });
    }
}
