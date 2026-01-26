import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import * as https from "https";

export class McdocManager {
    public service: any | null = null;
    private initialized = false;
    private cachePath: string | null = null;

    setCacheDir(path: string) {
        this.cachePath = path;
    }

    async initialize(): Promise<void> {
        if (this.initialized || !this.cachePath) return;

        try {
            await this.downloadSourceFiles();

            const mcdocRoot = path.join(this.cachePath, "mcdoc");
            // Normalize path to URI format for Spyglass
            const toUri = (p: string) =>
                `file://${p.replace(/\\/g, "/")}${p.endsWith("/") ? "" : "/"}` as `${string}/`;

            const mainRootUri = toUri(mcdocRoot);
            const cacheRootUri = toUri(
                path.join(this.cachePath, "spyglass_cache")
            );

            console.log("Initializing Spyglass Service for MCDoc...");
            console.log("Root:", mainRootUri);

            const { Service, FileService } = await import("@spyglassmc/core");
            // @ts-ignore
            const { NodeJsExternals } =
                require("@spyglassmc/core/lib/nodejs") as any;

            const externals = NodeJsExternals;
            const fileService = FileService.create(externals, cacheRootUri);

            this.service = new Service({
                logger: console, // Simple logger
                project: {
                    cacheRoot: cacheRootUri,
                    projectRoots: [mainRootUri],
                    externals,
                    fs: fileService,
                },
            });

            // Register MCDoc
            const mcdoc = await import("@spyglassmc/mcdoc");
            mcdoc.initialize({ meta: this.service.project.meta });

            await this.service.project.ready();

            this.initialized = true;
            console.log("MCDoc Service fully initialized.");

            // Debug: print some symbols
            // const symbols = this.service.project.symbols.global.get("mcdoc/struct");
            // console.log("Loaded structs:", Object.keys(symbols || {}).length);
        } catch (e) {
            console.warn("Failed to initialize MCDoc Service:", e);
        }
    }

    private async downloadSourceFiles(): Promise<void> {
        if (!this.cachePath) return;

        const mcdocDir = path.join(this.cachePath, "mcdoc");
        const tarballPath = path.join(this.cachePath, "mcdoc.tar.gz");

        if (fs.existsSync(mcdocDir)) {
            const stats = fs.statSync(mcdocDir);
            if (Date.now() - stats.mtimeMs < 24 * 60 * 60 * 1000) {
                return;
            }
        }

        console.log("Downloading MCDoc tarball...");

        await new Promise<void>((resolve, reject) => {
            const file = fs.createWriteStream(tarballPath);
            https
                .get(
                    "https://api.spyglassmc.com/vanilla-mcdoc/tarball",
                    res => {
                        if (res.statusCode !== 200) {
                            reject(
                                new Error(
                                    `Failed to download tarball: ${res.statusCode}`
                                )
                            );
                            return;
                        }
                        res.pipe(file);
                        file.on("finish", () => {
                            file.close();
                            resolve();
                        });
                    }
                )
                .on("error", err => {
                    fs.unlink(tarballPath, () => {});
                    reject(err);
                });
        });

        console.log("Extracting MCDoc tarball...");
        const child_process = require("child_process");
        if (!fs.existsSync(mcdocDir))
            fs.mkdirSync(mcdocDir, { recursive: true });

        await new Promise<void>((resolve, reject) => {
            child_process.exec(
                `tar -xf "${tarballPath}" -C "${mcdocDir}"`,
                (error: any, stdout: any, stderr: any) => {
                    if (error) {
                        console.warn("Tar extraction failed:", stderr);
                        reject(error);
                    } else {
                        console.log("MCDoc extracted successfully.");
                        resolve();
                    }
                }
            );
        });
    }

    findSymbol(
        category: "block" | "item" | "entity",
        id: string
    ): string | undefined {
        if (!this.service) return undefined;

        // MCDoc symbols are stored in queryable tables.
        // We need to map minecraft ID to MCDoc symbol path.
        // The library relies on "dispatch" usually, assuming we are parsing a file.
        // But here we want to look up a definition.

        // With the full library, the "symbols.json" logic from before (path guessing) is still relevant
        // because the parsed symbols follow the same path structure.
        // But we must query the symbol table of the service.

        // Category mapping:
        // Structs are usually in 'mcdoc/struct' category in global table?
        // Let's inspect the categories used by MCDoc.
        // Based on symbols.json, the keys were like "::java::...".
        // The library puts these in the global symbol table.

        // Attempt to search in 'mcdoc/struct' or generic definitions.

        const cleanId = id.replace("minecraft:", "");
        const pascalName = cleanId
            .split("_")
            .map(p => p.charAt(0).toUpperCase() + p.slice(1))
            .join("");
        const searchSuffix = `::${pascalName}`;

        // Access global symbol table
        // The type for symbols is TwowayMap or similar.
        // Service.project.symbols.global.get(category) returns resolved map?

        // Warning: Internal API might be complex.
        // Let's try to iterate 'mcdoc' category if it exists.

        // As a fallback/proxy to previous logic, we can try to iterate known symbols if exposed.
        // But we don't have the simple JSON map anymore.
        // We have to rely on the service.

        // Actually, for autocompletion, if we can match the ID to a "definition", we can ask the service specifically.
        // But we need the symbol path.

        // Let's create a temporary heuristic using the cached files if needed, or iterate valid symbols.
        // Iterating ALL global symbols might be slow but let's try.

        const globalSymbols = this.service.project.symbols.global;
        // globalSymbols is a SymbolTable.
        // We can't iterate easily?
        // It has `get(category)`?
        // Let's try 'mcdoc/struct'
        // @ts-ignore
        const structs = globalSymbols?.get("mcdoc/struct") || {};

        for (const key of Object.keys(structs)) {
            if (key.includes(`::${category}::`) && key.endsWith(searchSuffix)) {
                return key;
            }
        }

        // Partial search
        for (const key of Object.keys(structs)) {
            if (key.includes(`::${category}::`)) {
                const lastPart = key.split("::").pop();
                if (
                    lastPart?.toLowerCase() ===
                    cleanId.replace(/_/g, "").toLowerCase()
                ) {
                    return key;
                }
            }
        }

        return undefined;
    }

    getCompletions(symbolPath: string): vscode.CompletionItem[] {
        if (!this.service) return [];

        // We have a symbol path. We need to find its definition in the service.
        // 'mcdoc/struct' category.

        const globalSymbols = this.service.project.symbols.global;
        // @ts-ignore
        const structMap = globalSymbols?.get("mcdoc/struct");
        const symbol = structMap?.[symbolPath];

        if (!symbol) return [];

        // Symbol is a `Symbol` object from @spyglassmc/core.
        // It might reference the definition node.
        // But we might need the "bound" validation type.

        // If we have the AST Node of the struct definition, we can walk fields.

        // This part is much harder with the library than with JSON because we deal with AST nodes.
        // However, the library *should* provide helpers.

        // For now, let's just return a placeholder or try to inspect `symbol.members`?
        // Struct symbols usually have `members` or similar.
        // Or we need to resolve it.

        const items: vscode.CompletionItem[] = [];

        // If we can get the node.
        if (symbol.declaration?.node) {
            // We need to cast this node to StructDefinitionNode
            // And iterate fields.
            // Logic is similar to traverse.
            // But we lack the specific types imported here.
            // We can do best-effort loose typing.

            const node = symbol.declaration.node as any;
            if (node.fields) {
                for (const field of node.fields) {
                    if (field.key && field.key.value) {
                        items.push(
                            new vscode.CompletionItem(
                                field.key.value,
                                vscode.CompletionItemKind.Field
                            )
                        );
                    }
                }
            }
        }

        return items;
    }
}

let instance: McdocManager | null = null;
export function getMcdocManager(): McdocManager {
    if (!instance) instance = new McdocManager();
    return instance;
}
