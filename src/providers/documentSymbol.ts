import * as vscode from "vscode";
import { DocumentManager } from "../utils/document";
import { rangeToVscodeRange } from "../utils/position";
import * as AST from "../parser/ast";

export class DocumentSymbolProvider implements vscode.DocumentSymbolProvider {
    private documentManager: DocumentManager;

    constructor(documentManager: DocumentManager) {
        this.documentManager = documentManager;
    }

    provideDocumentSymbols(
        document: vscode.TextDocument,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<
        vscode.SymbolInformation[] | vscode.DocumentSymbol[]
    > {
        const parseResult = this.documentManager.parse(document);
        const symbols: vscode.DocumentSymbol[] = [];

        for (const stmt of parseResult.program.body) {
            const symbol = this.visitStatement(stmt);
            if (symbol) {
                symbols.push(symbol);
            }
        }

        return symbols;
    }

    private visitStatement(node: AST.Statement): vscode.DocumentSymbol | null {
        switch (node.type) {
            case "VarDeclaration":
                return this.createSymbol(
                    node.name.name,
                    vscode.SymbolKind.Variable,
                    node.range,
                    node.name.range
                );

            case "FuncDeclaration":
                const funcSymbol = this.createSymbol(
                    node.name.name,
                    vscode.SymbolKind.Function,
                    node.range,
                    node.name.range
                );

                
                for (const param of node.params) {
                    const paramSymbol = this.createSymbol(
                        param.name.name,
                        vscode.SymbolKind.Variable,
                        param.range,
                        param.name.range
                    );
                    funcSymbol.children.push(paramSymbol);
                }

                
                for (const stmt of node.body.body) {
                    const child = this.visitStatement(stmt);
                    if (child) {
                        funcSymbol.children.push(child);
                    }
                }

                return funcSymbol;

            case "ImportStatement":
                return this.createSymbol(
                    node.source.name,
                    vscode.SymbolKind.Module,
                    node.range,
                    node.source.range
                );

            case "IfStatement":
                
                const ifChildren: vscode.DocumentSymbol[] = [];

                if (node.consequent.type === "BlockStatement") {
                    for (const stmt of node.consequent.body) {
                        const child = this.visitStatement(stmt);
                        if (child) {
                            ifChildren.push(child);
                        }
                    }
                }

                for (const elseIf of node.elseIfClauses) {
                    if (elseIf.consequent.type === "BlockStatement") {
                        for (const stmt of elseIf.consequent.body) {
                            const child = this.visitStatement(stmt);
                            if (child) {
                                ifChildren.push(child);
                            }
                        }
                    }
                }

                if (
                    node.alternate &&
                    node.alternate.type === "BlockStatement"
                ) {
                    for (const stmt of node.alternate.body) {
                        const child = this.visitStatement(stmt);
                        if (child) {
                            ifChildren.push(child);
                        }
                    }
                }

                
                return ifChildren.length > 0 ? ifChildren[0] : null;

            case "WhileStatement":
                if (node.body.type === "BlockStatement") {
                    for (const stmt of node.body.body) {
                        const child = this.visitStatement(stmt);
                        if (child) {
                            return child;
                        }
                    }
                }
                return null;

            case "BlockStatement":
                for (const stmt of node.body) {
                    const child = this.visitStatement(stmt);
                    if (child) {
                        return child;
                    }
                }
                return null;

            default:
                return null;
        }
    }

    private createSymbol(
        name: string,
        kind: vscode.SymbolKind,
        range: AST.Range,
        selectionRange: AST.Range
    ): vscode.DocumentSymbol {
        return new vscode.DocumentSymbol(
            name,
            "",
            kind,
            rangeToVscodeRange(range),
            rangeToVscodeRange(selectionRange)
        );
    }
}
