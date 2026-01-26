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
    console.log("Comet Highlighter v2 activated");

    // Initialize document manager
    documentManager = new DocumentManager();

    // Initialize Spyglass for Minecraft command support
    const config = vscode.workspace.getConfiguration("comet");
    const fallbackVersion = config.get<string>("minecraftVersion", "1.21");

    // Resolve version from comet.config.json if available
    resolveTvVersion(fallbackVersion).then(async version => {
        console.log(`Initializing Spyglass with MC version: ${version}`);

        // Ensure global storage exists
        try {
            await vscode.workspace.fs.createDirectory(context.globalStorageUri);
        } catch (error) {
            console.warn("Failed to create global storage directory:", error);
        }

        const spyglassManager = getSpyglassManager();
        spyglassManager.setCacheDir(context.globalStorageUri.fsPath);

        const mcdocManager = getMcdocManager(); // Import this!
        mcdocManager.setCacheDir(context.globalStorageUri.fsPath);
        mcdocManager.initialize();

        spyglassManager.initialize(version).catch(err => {
            console.warn("Failed to initialize Spyglass:", err);
        });
    });

    // Create diagnostic collection
    diagnosticCollection = vscode.languages.createDiagnosticCollection("comet");
    context.subscriptions.push(diagnosticCollection);

    // Register semantic tokens provider
    const semanticTokensProvider = new SemanticTokensProvider(documentManager);
    context.subscriptions.push(
        vscode.languages.registerDocumentSemanticTokensProvider(
            { language: "comet" },
            semanticTokensProvider,
            LEGEND
        )
    );

    // Register completion provider
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

    // Register hover provider
    const hoverProvider = new HoverProvider(documentManager);
    context.subscriptions.push(
        vscode.languages.registerHoverProvider(
            { language: "comet" },
            hoverProvider
        )
    );

    // Register definition provider
    const definitionProvider = new DefinitionProvider(documentManager);
    context.subscriptions.push(
        vscode.languages.registerDefinitionProvider(
            { language: "comet" },
            definitionProvider
        )
    );

    // Register document symbol provider
    const documentSymbolProvider = new DocumentSymbolProvider(documentManager);
    context.subscriptions.push(
        vscode.languages.registerDocumentSymbolProvider(
            { language: "comet" },
            documentSymbolProvider
        )
    );

    // Update diagnostics on document change
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(event => {
            if (event.document.languageId === "comet") {
                updateDiagnostics(event.document);
            }
        })
    );

    // Update diagnostics on document open
    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(document => {
            if (document.languageId === "comet") {
                updateDiagnostics(document);
            }
        })
    );

    // Clear diagnostics on document close
    context.subscriptions.push(
        vscode.workspace.onDidCloseTextDocument(document => {
            if (document.languageId === "comet") {
                diagnosticCollection.delete(document.uri);
                documentManager.clear(document);
            }
        })
    );

    // Update diagnostics for all open Comet documents
    vscode.workspace.textDocuments.forEach(document => {
        if (document.languageId === "comet") {
            updateDiagnostics(document);
        }
    });

    checkConfigInitialization(context);
}

async function checkConfigInitialization(context: vscode.ExtensionContext) {
    if (context.globalState.get<boolean>("comet.dontAskConfig", false)) {
        return;
    }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return;

    // Check if comet.config.json exists in the first workspace folder
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
    } catch (e) {
        // File not found or invalid JSON, use fallback
    }
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
