import * as vscode from "vscode";
import { DocumentManager } from "./utils/document";
import { SemanticTokensProvider, LEGEND } from "./providers/semanticTokens";
import { DiagnosticGenerator } from "./analysis/diagnostics";
import { CompletionProvider } from "./providers/completion";
import { HoverProvider } from "./providers/hover";
import { DefinitionProvider } from "./providers/definition";
import { DocumentSymbolProvider } from "./providers/documentSymbol";
import { getSpyglassManager } from "./minecraft/spyglass";
import { getMcdocManager } from "./minecraft/mcdoc";

let documentManager: DocumentManager;
let diagnosticCollection: vscode.DiagnosticCollection;

export function activate(context: vscode.ExtensionContext) {
    console.log("[COMET] Comet Highlighter v3 activated");

    documentManager = new DocumentManager();

    diagnosticCollection = vscode.languages.createDiagnosticCollection("comet");
    context.subscriptions.push(diagnosticCollection);

    const semanticTokensProvider = new SemanticTokensProvider(documentManager);
    context.subscriptions.push(
        vscode.languages.registerDocumentSemanticTokensProvider(
            { language: "comet" },
            semanticTokensProvider,
            LEGEND
        )
    );

    const completionProvider = new CompletionProvider(documentManager);
    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            { language: "comet" },
            completionProvider,
            ".",
            "(",
            ",",
            " ",
            "/"
        )
    );

    const hoverProvider = new HoverProvider(documentManager);
    context.subscriptions.push(
        vscode.languages.registerHoverProvider(
            { language: "comet" },
            hoverProvider
        )
    );

    const definitionProvider = new DefinitionProvider(documentManager);
    context.subscriptions.push(
        vscode.languages.registerDefinitionProvider(
            { language: "comet" },
            definitionProvider
        )
    );

    const documentSymbolProvider = new DocumentSymbolProvider(documentManager);
    context.subscriptions.push(
        vscode.languages.registerDocumentSymbolProvider(
            { language: "comet" },
            documentSymbolProvider
        )
    );

    let timeout: ReturnType<typeof setTimeout> | undefined;
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(event => {
            if (event.document.languageId === "comet") {
                if (timeout) {
                    clearTimeout(timeout);
                }
                timeout = setTimeout(() => {
                    updateDiagnostics(event.document);
                }, 300);
            }
        })
    );

    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(document => {
            if (document.languageId === "comet") {
                updateDiagnostics(document);
            }
        })
    );

    context.subscriptions.push(
        vscode.workspace.onDidCloseTextDocument(document => {
            if (document.languageId === "comet") {
                diagnosticCollection.delete(document.uri);
                documentManager.clear(document);
            }
        })
    );

    vscode.workspace.textDocuments.forEach(document => {
        if (document.languageId === "comet") {
            updateDiagnostics(document);
        }
    });

    const config = vscode.workspace.getConfiguration("comet");
    const fallbackVersion = config.get<string>("minecraftVersion", "1.21");

    resolveTvVersion(fallbackVersion).then(async version => {
        console.log(
            `[COMET] Initializing Spyglass with MC version: ${version}`
        );

        try {
            await vscode.workspace.fs.createDirectory(context.globalStorageUri);
        } catch (error) {
            console.warn(
                "[COMET] Failed to create global storage directory:",
                error
            );
        }

        const spyglassManager = getSpyglassManager();
        spyglassManager.setCacheDir(context.globalStorageUri.fsPath);

        const mcdocManager = getMcdocManager();
        mcdocManager.setCacheDir(context.globalStorageUri.fsPath);
        mcdocManager.initialize();

        spyglassManager
            .initialize(version)
            .then(() => {
                semanticTokensProvider.refresh();
                vscode.workspace.textDocuments.forEach(document => {
                    if (document.languageId === "comet") {
                        updateDiagnostics(document);
                    }
                });
            })
            .catch(err => {
                console.warn("[COMET] Failed to initialize Spyglass:", err);
            });
    });

    checkConfigInitialization(context);
}

async function checkConfigInitialization(context: vscode.ExtensionContext) {
    if (context.globalState.get<boolean>("comet.dontAskConfig", false)) {
        return;
    }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return;

    const configFiles = await vscode.workspace.findFiles("comet.config.json");
    if (configFiles.length > 0) return;

    const selection = await vscode.window.showInformationMessage(
        "comet.config.json not found. Create one?",
        "Create",
        "Don't ask again"
    );

    if (selection === "Create") {
        const rootPath = workspaceFolders[0].uri;
        const configUri = vscode.Uri.joinPath(rootPath, "comet.config.json");

        const config = vscode.workspace.getConfiguration("comet");
        const defaultVersion = config.get<string>(
            "defaultMcVersion",
            "1.21.11"
        );

        const content = {
            mcversion: defaultVersion,
        };

        await vscode.workspace.fs.writeFile(
            configUri,
            new TextEncoder().encode(JSON.stringify(content, null, 2))
        );

        vscode.window.showInformationMessage(
            `Created comet.config.json with version ${defaultVersion}`
        );
    } else if (selection === "Don't ask again") {
        await context.globalState.update("comet.dontAskConfig", true);
    }
}

async function resolveTvVersion(fallback: string): Promise<string> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return fallback;

    const rootPath = workspaceFolders[0].uri;
    const configUri = vscode.Uri.joinPath(rootPath, "comet.config.json");

    try {
        const fileData = await vscode.workspace.fs.readFile(configUri);
        const jsonContent = JSON.parse(new TextDecoder().decode(fileData));
        if (jsonContent.mcversion) {
            return jsonContent.mcversion;
        }
    } catch (e) {}
    return fallback;
}

function updateDiagnostics(document: vscode.TextDocument): void {
    const parseResult = documentManager.parse(document);
    const diagnosticGenerator = new DiagnosticGenerator();
    const diagnostics = diagnosticGenerator.generate(
        parseResult.program,
        parseResult.errors
    );

    diagnosticCollection.set(document.uri, diagnostics);
}

export function deactivate() {
    if (documentManager) {
        documentManager.clearAll();
    }
    if (diagnosticCollection) {
        diagnosticCollection.dispose();
    }
}
