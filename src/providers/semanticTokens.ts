import * as vscode from "vscode";
import * as AST from "../parser/ast";
import { Scope } from "../analysis/scope";
import { DocumentManager } from "../utils/document";
import { Range } from "../utils/position";
import { getSpyglassManager } from "../minecraft/spyglass";

// Semantic token types (using VS Code built-in types)
export const TOKEN_TYPES = [
    "namespace", // __namespace__, __main__
    "type", // type conversion functions (int, float, double, string, bool)
    "function", // function definitions/calls
    "variable", // variables
    "parameter", // function parameters
    "property", // module.property access
    "number", // number literals
    "string", // string literals
    "keyword", // keywords
    "operator", // operators
    "comment", // comments
    "macro", // $(var) macro expansions
    "enumMember", // true, false
];

export const TOKEN_MODIFIERS = [
    "declaration", // definition location
    "definition", // function definition
    "readonly", // built-in functions
    "defaultLibrary", // built-in functions
    "modification", // assignment target
];

export const LEGEND = new vscode.SemanticTokensLegend(
    TOKEN_TYPES,
    TOKEN_MODIFIERS
);

export class SemanticTokensProvider
    implements vscode.DocumentSemanticTokensProvider
{
    private documentManager: DocumentManager;

    constructor(documentManager: DocumentManager) {
        this.documentManager = documentManager;
    }

    provideDocumentSemanticTokens(
        document: vscode.TextDocument,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.SemanticTokens> {
        const parseResult = this.documentManager.parse(document);
        const builder = new vscode.SemanticTokensBuilder(LEGEND);

        this.buildTokens(
            parseResult.program,
            parseResult.scope,
            builder,
            document
        );

        return builder.build();
    }

    private buildTokens(
        program: AST.Program,
        scope: Scope,
        builder: vscode.SemanticTokensBuilder,
        document: vscode.TextDocument
    ): void {
        for (const stmt of program.body) {
            this.visitStatement(stmt, scope, builder, document);
        }
    }

    private visitStatement(
        node: AST.Statement,
        scope: Scope,
        builder: vscode.SemanticTokensBuilder,
        document: vscode.TextDocument
    ): void {
        switch (node.type) {
            case "VarDeclaration":
                this.visitVarDeclaration(node, scope, builder);
                break;
            case "FuncDeclaration":
                this.visitFuncDeclaration(node, scope, builder, document);
                break;
            case "IfStatement":
                this.visitIfStatement(node, scope, builder, document);
                break;
            case "WhileStatement":
                this.visitWhileStatement(node, scope, builder, document);
                break;
            case "ReturnStatement":
                if (node.argument) {
                    this.visitExpression(node.argument, scope, builder);
                }
                break;
            case "ImportStatement":
                this.visitImportStatement(node, scope, builder);
                break;
            case "ExecuteStatement":
                this.visitExecuteStatement(node, scope, builder, document);
                break;
            case "CommandStatement":
                this.visitCommandStatement(node, scope, builder, document);
                break;
            case "MacroCommandStatement":
                this.visitMacroCommandStatement(node, scope, builder);
                break;
            case "ExpressionStatement":
                this.visitExpression(node.expression, scope, builder);
                break;
            case "BlockStatement":
                this.visitBlockStatement(node, scope, builder, document);
                break;
            default:
                break;
        }
    }

    private visitVarDeclaration(
        node: AST.VarDeclaration,
        scope: Scope,
        builder: vscode.SemanticTokensBuilder
    ): void {
        // Variable name (declaration)
        this.addToken(
            builder,
            node.name.range,
            TOKEN_TYPES.indexOf("variable"),
            [TOKEN_MODIFIERS.indexOf("declaration")]
        );

        if (node.init) {
            this.visitExpression(node.init, scope, builder);
        }
    }

    private visitFuncDeclaration(
        node: AST.FuncDeclaration,
        scope: Scope,
        builder: vscode.SemanticTokensBuilder,
        document: vscode.TextDocument
    ): void {
        // Function name (declaration + definition)
        this.addToken(
            builder,
            node.name.range,
            TOKEN_TYPES.indexOf("function"),
            [
                TOKEN_MODIFIERS.indexOf("declaration"),
                TOKEN_MODIFIERS.indexOf("definition"),
            ]
        );

        // Parameters
        for (const param of node.params) {
            this.addToken(
                builder,
                param.name.range,
                TOKEN_TYPES.indexOf("parameter"),
                [TOKEN_MODIFIERS.indexOf("declaration")]
            );
        }

        // Body
        this.visitBlockStatement(node.body, scope, builder, document);
    }

    private visitIfStatement(
        node: AST.IfStatement,
        scope: Scope,
        builder: vscode.SemanticTokensBuilder,
        document: vscode.TextDocument
    ): void {
        this.visitExpression(node.condition, scope, builder);
        this.visitStatement(node.consequent, scope, builder, document);

        for (const elseIf of node.elseIfClauses) {
            this.visitExpression(elseIf.condition, scope, builder);
            this.visitStatement(elseIf.consequent, scope, builder, document);
        }

        if (node.alternate) {
            this.visitStatement(node.alternate, scope, builder, document);
        }
    }

    private visitWhileStatement(
        node: AST.WhileStatement,
        scope: Scope,
        builder: vscode.SemanticTokensBuilder,
        document: vscode.TextDocument
    ): void {
        this.visitExpression(node.condition, scope, builder);
        this.visitStatement(node.body, scope, builder, document);
    }

    private visitImportStatement(
        node: AST.ImportStatement,
        scope: Scope,
        builder: vscode.SemanticTokensBuilder
    ): void {
        // Import source as namespace
        this.addToken(
            builder,
            node.source.range,
            TOKEN_TYPES.indexOf("namespace"),
            [TOKEN_MODIFIERS.indexOf("declaration")]
        );
    }

    private visitExecuteStatement(
        node: AST.ExecuteStatement,
        scope: Scope,
        builder: vscode.SemanticTokensBuilder,
        document: vscode.TextDocument
    ): void {
        // Highlight the subcommands string
        if (node.subcommands) {
            // Use actual text from document to ensure accurate offsets
            const range = new vscode.Range(
                node.subcommandRange.start.line,
                node.subcommandRange.start.character,
                node.subcommandRange.end.line,
                node.subcommandRange.end.character
            );
            const text = document.getText(range);

            // Prepend "execute " context for accurate tokenization
            const fullCommand = "execute " + text;
            // Adjust range start column when highlighting because we added "execute " prefix
            // But highlightMcCommand expects text to match range?
            // Actually highlightMcCommand re-tokenizes.
            // If we pass "execute run say hi", tokens will be at relative offsets 0..7 (execute), 8..11 (run), etc.
            // But our range starts at `run` in the document.
            // So we need to subtract "execute ".length + 1 (space) from the token start to map back to document range.

            this.highlightMcCommand(
                fullCommand,
                node.subcommandRange,
                builder,
                8
            );
        }
        this.visitBlockStatement(node.body, scope, builder, document);
    }

    private visitCommandStatement(
        node: AST.CommandStatement,
        scope: Scope,
        builder: vscode.SemanticTokensBuilder,
        document: vscode.TextDocument
    ): void {
        const range = new vscode.Range(
            node.commandRange.start.line,
            node.commandRange.start.character,
            node.commandRange.end.line,
            node.commandRange.end.character
        );
        const text = document.getText(range);
        this.highlightMcCommand(text, node.commandRange, builder, 0);
    }

    private highlightMcCommand(
        command: string,
        range: Range,
        builder: vscode.SemanticTokensBuilder,
        offsetAdjustment: number
    ): void {
        const spyglassManager = getSpyglassManager();
        const tokens = spyglassManager.getCommandSemanticTokens(command);

        for (const token of tokens) {
            // Assume single line commands for now
            const line = range.start.line;
            // Adjust for added context (e.g. "execute ")
            // token.start is relative to `command`.
            // We want relative to `range`.
            // If offsetAdjustment is 8 ("execute "), and token is "run" at 8,
            // relative start should be 8 - 8 = 0.

            const relativeTokenStart = token.start - offsetAdjustment;
            if (relativeTokenStart < 0) continue; // specific token is part of the prefix context

            const startChar = range.start.character + relativeTokenStart;

            const tokenTypeIndex = TOKEN_TYPES.indexOf(token.tokenType);
            if (tokenTypeIndex !== -1) {
                builder.push(
                    line,
                    startChar,
                    token.length,
                    tokenTypeIndex,
                    0 // No modifiers for now
                );
            }
        }
    }

    private visitMacroCommandStatement(
        node: AST.MacroCommandStatement,
        scope: Scope,
        builder: vscode.SemanticTokensBuilder
    ): void {
        // Highlight macro expansions
        for (const expansion of node.macroExpansions) {
            this.addToken(
                builder,
                expansion.range,
                TOKEN_TYPES.indexOf("macro"),
                []
            );
        }
    }

    private visitBlockStatement(
        node: AST.BlockStatement,
        scope: Scope,
        builder: vscode.SemanticTokensBuilder,
        document: vscode.TextDocument
    ): void {
        for (const stmt of node.body) {
            this.visitStatement(stmt, scope, builder, document);
        }
    }

    private visitExpression(
        node: AST.Expression,
        scope: Scope,
        builder: vscode.SemanticTokensBuilder
    ): void {
        switch (node.type) {
            case "Identifier":
                this.visitIdentifier(node, scope, builder);
                break;
            case "IntLiteral":
            case "FloatLiteral":
            case "DoubleLiteral":
                this.addToken(
                    builder,
                    node.range,
                    TOKEN_TYPES.indexOf("number"),
                    []
                );
                break;
            case "StringLiteral":
                this.addToken(
                    builder,
                    node.range,
                    TOKEN_TYPES.indexOf("string"),
                    []
                );
                break;
            case "BoolLiteral":
                this.addToken(
                    builder,
                    node.range,
                    TOKEN_TYPES.indexOf("enumMember"),
                    []
                );
                break;
            case "BinaryExpression":
                this.visitExpression(node.left, scope, builder);
                this.visitExpression(node.right, scope, builder);
                break;
            case "UnaryExpression":
                this.visitExpression(node.argument, scope, builder);
                break;
            case "AssignmentExpression":
                // Target gets modification modifier
                if (node.target.type === "Identifier") {
                    this.visitIdentifier(node.target, scope, builder, true);
                } else {
                    this.visitExpression(node.target, scope, builder);
                }
                this.visitExpression(node.value, scope, builder);
                break;
            case "CallExpression":
                this.visitCallExpression(node, scope, builder);
                break;
            case "MemberExpression":
                this.visitExpression(node.object, scope, builder);
                if (node.computed) {
                    this.visitExpression(node.property, scope, builder);
                } else if (node.property.type === "Identifier") {
                    // Non-computed property access
                    this.addToken(
                        builder,
                        node.property.range,
                        TOKEN_TYPES.indexOf("property"),
                        []
                    );
                }
                break;
            case "ArrayLiteral":
                for (const elem of node.elements) {
                    this.visitExpression(elem, scope, builder);
                }
                break;
            case "ParenExpression":
                this.visitExpression(node.expression, scope, builder);
                break;
            default:
                break;
        }
    }

    private visitIdentifier(
        node: AST.Identifier,
        scope: Scope,
        builder: vscode.SemanticTokensBuilder,
        isModification = false
    ): void {
        // Special identifiers
        if (node.name === "__namespace__" || node.name === "__main__") {
            this.addToken(
                builder,
                node.range,
                TOKEN_TYPES.indexOf("namespace"),
                []
            );
            return;
        }

        // Resolve symbol
        const symbol = scope.resolve(node.name);
        if (!symbol) {
            // Undefined - just mark as variable
            this.addToken(
                builder,
                node.range,
                TOKEN_TYPES.indexOf("variable"),
                isModification ? [TOKEN_MODIFIERS.indexOf("modification")] : []
            );
            return;
        }

        let tokenType: number;
        const modifiers: number[] = [];

        switch (symbol.kind) {
            case "function":
                tokenType = TOKEN_TYPES.indexOf("function");
                break;
            case "parameter":
                tokenType = TOKEN_TYPES.indexOf("parameter");
                break;
            case "import":
                tokenType = TOKEN_TYPES.indexOf("namespace");
                break;
            case "builtin":
                tokenType = TOKEN_TYPES.indexOf("function");
                modifiers.push(TOKEN_MODIFIERS.indexOf("readonly"));
                modifiers.push(TOKEN_MODIFIERS.indexOf("defaultLibrary"));
                break;
            case "variable":
            default:
                tokenType = TOKEN_TYPES.indexOf("variable");
                break;
        }

        if (isModification) {
            modifiers.push(TOKEN_MODIFIERS.indexOf("modification"));
        }

        this.addToken(builder, node.range, tokenType, modifiers);
    }

    private visitCallExpression(
        node: AST.CallExpression,
        scope: Scope,
        builder: vscode.SemanticTokensBuilder
    ): void {
        // Callee
        if (node.callee.type === "Identifier") {
            const symbol = scope.resolve(node.callee.name);

            // Check if it's a type conversion function
            const typeConversionFunctions = [
                "int",
                "float",
                "double",
                "string",
                "bool",
            ];
            if (typeConversionFunctions.includes(node.callee.name)) {
                this.addToken(
                    builder,
                    node.callee.range,
                    TOKEN_TYPES.indexOf("type"),
                    symbol?.kind === "builtin"
                        ? [TOKEN_MODIFIERS.indexOf("defaultLibrary")]
                        : []
                );
            } else {
                this.visitIdentifier(node.callee, scope, builder);
            }
        } else {
            this.visitExpression(node.callee, scope, builder);
        }

        // Arguments
        for (const arg of node.arguments) {
            this.visitExpression(arg, scope, builder);
        }
    }

    private addToken(
        builder: vscode.SemanticTokensBuilder,
        range: Range,
        tokenType: number,
        modifiers: number[]
    ): void {
        const line = range.start.line;
        const char = range.start.character;
        const length = range.end.character - range.start.character;

        if (length > 0) {
            const modifierBits = modifiers.reduce(
                (acc, mod) => acc | (1 << mod),
                0
            );
            builder.push(line, char, length, tokenType, modifierBits);
        }
    }
}
