import * as vscode from "vscode";
import { DocumentManager } from "../utils/document";
import { vscodePositionToPosition, Position, Range } from "../utils/position";
import * as AST from "../parser/ast";
import { TypeInference } from "../analysis/type_inference";

export class HoverProvider implements vscode.HoverProvider {
    private documentManager: DocumentManager;
    private typeInference: TypeInference;

    constructor(documentManager: DocumentManager) {
        this.documentManager = documentManager;
        this.typeInference = new TypeInference();
    }

    provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.Hover> {
        const parseResult = this.documentManager.parse(document);
        const pos = vscodePositionToPosition(position);

        // Find the identifier at the cursor position
        const identifier = this.findIdentifierAtPosition(
            parseResult.program,
            pos
        );
        if (!identifier) {
            return null;
        }

        // Resolve the symbol
        const symbol = parseResult.scope.resolve(identifier.name);
        if (!symbol) {
            return null;
        }

        // Create hover content based on symbol kind
        const markdown = new vscode.MarkdownString();
        markdown.isTrusted = true;

        switch (symbol.kind) {
            case "function":
                markdown.appendCodeblock(
                    `def ${symbol.name}(${this.formatParams(symbol.params || [])})`,
                    "comet"
                );
                if (symbol.documentation) {
                    markdown.appendMarkdown("\n\n" + symbol.documentation);
                }
                break;

            case "builtin":
                const signature = `${symbol.name}(${this.formatParams(symbol.params || [])})`;
                const returnType = symbol.returnType
                    ? ` → ${symbol.returnType}`
                    : "";
                markdown.appendCodeblock(signature + returnType, "comet");
                if (symbol.documentation) {
                    markdown.appendMarkdown("\n\n" + symbol.documentation);
                }
                break;

            case "variable":
                let typeStr = "any";
                // find definition node to infer type
                // symbol.declarationRange gives us the range of the identifier.
                // We need the parent VarDeclaration node.
                // This is hard without traversing up or having a map.
                // For now, let's try to infer from the symbol if we stored type.
                // Or we can assume the user wants type inference on hover of the variable Usage.

                // If we are hovering the definition, we can access the node via AST search?
                // `identifier` is independent of declaration.

                // Let's improve this: Symbol should store inferred type if possible.
                // OR we run inference on the init expression if we can find it.

                // Simplified approach: just show "variable name" for now + type if known
                // But we didn't store type in Symbol for variables yet.

                // Let's try to find the VarDeclaration node from the program.
                const declNode = this.findDeclarationNode(
                    parseResult.program,
                    symbol.declarationRange
                );
                if (declNode && declNode.init) {
                    typeStr = this.typeInference.infer(
                        declNode.init,
                        parseResult.scope
                    );
                }

                markdown.appendCodeblock(
                    `var ${symbol.name}: ${typeStr}`,
                    "comet"
                );
                const varLine = symbol.declarationRange.start.line + 1;
                markdown.appendMarkdown(`\n\nDeclared at line ${varLine}`);
                break;

            case "parameter":
                markdown.appendCodeblock(`parameter ${symbol.name}`, "comet");
                break;

            case "import":
                markdown.appendCodeblock(`import ${symbol.name}`, "comet");
                markdown.appendMarkdown(`\n\nImported module`);
                break;

            default:
                return null;
        }

        return new vscode.Hover(markdown);
    }

    private findIdentifierAtPosition(
        program: AST.Program,
        pos: Position
    ): AST.Identifier | null {
        let found: AST.Identifier | null = null;

        const visitNode = (node: any): void => {
            if (!node || typeof node !== "object") return;

            // Check if this is an Identifier and contains the position
            if (node.type === "Identifier" && node.range) {
                if (this.rangeContainsPosition(node.range, pos)) {
                    found = node;
                }
            }

            // Recursively visit all properties
            for (const key in node) {
                if (key === "range" || key === "type") continue;
                const value = node[key];

                if (Array.isArray(value)) {
                    for (const item of value) {
                        visitNode(item);
                    }
                } else if (typeof value === "object") {
                    visitNode(value);
                }
            }
        };

        visitNode(program);
        return found;
    }

    private rangeContainsPosition(range: Range, pos: Position): boolean {
        if (pos.line < range.start.line || pos.line > range.end.line) {
            return false;
        }
        if (
            pos.line === range.start.line &&
            pos.character < range.start.character
        ) {
            return false;
        }
        if (
            pos.line === range.end.line &&
            pos.character > range.end.character
        ) {
            return false;
        }
        return true;
    }

    private formatParams(params: any[]): string {
        return params
            .map(p => (p.type ? `${p.name}: ${p.type}` : p.name))
            .join(", ");
    }

    private findDeclarationNode(
        program: AST.Program,
        range: Range
    ): AST.VarDeclaration | null {
        let found: AST.VarDeclaration | null = null;

        const visit = (node: any) => {
            if (found) return;
            if (!node || typeof node !== "object") return;

            if (
                node.type === "VarDeclaration" &&
                node.name &&
                node.name.range
            ) {
                const r = node.name.range;
                if (
                    r.start.line === range.start.line &&
                    r.start.character === range.start.character
                ) {
                    found = node;
                    return;
                }
            }

            for (const key in node) {
                if (key === "range" || key === "type") continue;
                const val = node[key];
                if (Array.isArray(val)) val.forEach(visit);
                else if (typeof val === "object") visit(val);
            }
        };

        visit(program);
        return found;
    }
}
