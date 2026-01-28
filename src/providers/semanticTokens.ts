import * as vscode from "vscode";
import * as AST from "../parser/ast";
import { Scope } from "../analysis/scope";
import { DocumentManager } from "../utils/document";
import { Range } from "../utils/position";
import { getSpyglassManager } from "../minecraft/spyglass";


export const TOKEN_TYPES = [
    "namespace", 
    "type", 
    "class", 
    "enum", 
    "interface", 
    "struct", 
    "function", 
    "method", 
    "variable", 
    "parameter", 
    "property", 
    "decorator", 
    "number", 
    "string", 
    "keyword", 
    "operator", 
    "comment", 
    "macro", 
    "enumMember", 
];

export const TOKEN_MODIFIERS = [
    "declaration", 
    "definition", 
    "readonly", 
    "defaultLibrary", 
    "modification", 
];

export const LEGEND = new vscode.SemanticTokensLegend(
    TOKEN_TYPES,
    TOKEN_MODIFIERS
);

export class SemanticTokensProvider
    implements vscode.DocumentSemanticTokensProvider
{
    private documentManager: DocumentManager;
    private activeDocument?: vscode.TextDocument;
    private _onDidChangeSemanticTokens = new vscode.EventEmitter<void>();
    readonly onDidChangeSemanticTokens: vscode.Event<void> =
        this._onDidChangeSemanticTokens.event;

    constructor(documentManager: DocumentManager) {
        this.documentManager = documentManager;
    }

    refresh(): void {
        this._onDidChangeSemanticTokens.fire();
    }

    provideDocumentSemanticTokens(
        document: vscode.TextDocument,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.SemanticTokens> {
        const parseResult = this.documentManager.parse(document);
        const builder = new vscode.SemanticTokensBuilder(LEGEND);
        this.activeDocument = document;

        this.buildTokens(
            parseResult.program,
            parseResult.scope,
            builder,
            document
        );

        
        if (parseResult.comments) {
            for (const comment of parseResult.comments) {
                this.addToken(
                    builder,
                    comment.range,
                    TOKEN_TYPES.indexOf("comment"),
                    []
                );
            }
        }

        const tokens = builder.build();
        this.activeDocument = undefined;
        return tokens;
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
        
        this.addToken(
            builder,
            node.name.range,
            TOKEN_TYPES.indexOf("function"),
            [
                TOKEN_MODIFIERS.indexOf("declaration"),
                TOKEN_MODIFIERS.indexOf("definition"),
            ]
        );

        
        for (const param of node.params) {
            this.addToken(
                builder,
                param.name.range,
                TOKEN_TYPES.indexOf("parameter"),
                [TOKEN_MODIFIERS.indexOf("declaration")]
            );
        }

        
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
        
        if (node.subcommands) {
            
            const range = new vscode.Range(
                node.subcommandRange.start.line,
                node.subcommandRange.start.character,
                node.subcommandRange.end.line,
                node.subcommandRange.end.character
            );
            const text = document.getText(range);

            
            const fullCommand = "execute " + text;
            
            
            
            
            
            

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
            
            const line = range.start.line;
            
            
            
            
            

            const relativeTokenStart = token.start - offsetAdjustment;
            if (relativeTokenStart < 0) continue; 

            const startChar = range.start.character + relativeTokenStart;

            const tokenTypeIndex = TOKEN_TYPES.indexOf(token.tokenType);
            if (tokenTypeIndex !== -1) {
                builder.push(line, startChar, token.length, tokenTypeIndex, 0);
            }
        }
    }

    private visitMacroCommandStatement(
        node: AST.MacroCommandStatement,
        scope: Scope,
        builder: vscode.SemanticTokensBuilder
    ): void {
        
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
            case "NbtLiteral":
                
                const range = new vscode.Range(
                    node.range.start.line,
                    node.range.start.character,
                    node.range.end.line,
                    node.range.end.character
                );
                
                
                if (!this.activeDocument) break;
                const text = this.activeDocument.getText(range);

                
                const spyglass = getSpyglassManager();
                const nbtTokens = spyglass.getNbtTokens(text);

                for (const token of nbtTokens) {
                    const line = node.range.start.line; 

                    const startOffset = this.activeDocument.offsetAt(
                        new vscode.Position(
                            node.range.start.line,
                            node.range.start.character
                        )
                    );
                    const tokenStartAbs = startOffset + token.start;
                    const tokenStartPos =
                        this.activeDocument.positionAt(tokenStartAbs);

                    const tokenEndPos = this.activeDocument.positionAt(
                        tokenStartAbs + token.length
                    );
                    const tokenRange = new vscode.Range(
                        tokenStartPos,
                        tokenEndPos
                    );

                    const typeIdx = TOKEN_TYPES.indexOf(token.tokenType);
                    if (typeIdx !== -1) {
                        this.addToken(
                            builder,
                            {
                                start: {
                                    line: tokenRange.start.line,
                                    character: tokenRange.start.character,
                                },
                                end: {
                                    line: tokenRange.end.line,
                                    character: tokenRange.end.character,
                                },
                            },
                            typeIdx,
                            []
                        );
                    }
                }
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
        
        if (node.name === "__namespace__" || node.name === "__main__") {
            this.addToken(
                builder,
                node.range,
                TOKEN_TYPES.indexOf("namespace"),
                []
            );
            return;
        }

        
        const symbol = scope.resolve(node.name);
        if (!symbol) {
            
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
        
        if (node.callee.type === "Identifier") {
            const symbol = scope.resolve(node.callee.name);

            
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
