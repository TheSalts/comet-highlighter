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
            
            const toUri = (p: string) =>
                `file://${p.replace(/\\/g, "/")}${p.endsWith("/") ? "" : "/"}` as `${string}/`;

            const mainRootUri = toUri(mcdocRoot);
            const cacheRootUri = toUri(
                path.join(this.cachePath, "spyglass_cache")
            );

            console.log("[COMET] Initializing Spyglass Service for MCDoc...");
            console.log("[COMET] Root:", mainRootUri);

            const { Service, FileService } = await import("@spyglassmc/core");
            
            const { NodeJsExternals } =
                require("@spyglassmc/core/lib/nodejs") as any;

            const externals = NodeJsExternals;
            const fileService = FileService.create(externals, cacheRootUri);

            this.service = new Service({
                logger: console, 
                project: {
                    cacheRoot: cacheRootUri,
                    projectRoots: [mainRootUri],
                    externals,
                    fs: fileService,
                },
            });

            
            const mcdoc = await import("@spyglassmc/mcdoc");
            mcdoc.initialize({ meta: this.service.project.meta });

            await this.service.project.ready();

            this.initialized = true;
            console.log("[COMET] MCDoc Service fully initialized.");

            
            
            
        } catch (e) {
            console.warn("[COMET] Failed to initialize MCDoc Service:", e);
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

        console.log("[COMET] Downloading MCDoc tarball...");

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

        console.log("[COMET] Extracting MCDoc tarball...");
        const child_process = require("child_process");
        if (!fs.existsSync(mcdocDir))
            fs.mkdirSync(mcdocDir, { recursive: true });

        await new Promise<void>((resolve, reject) => {
            child_process.exec(
                `tar -xf "${tarballPath}" -C "${mcdocDir}"`,
                (error: any, stdout: any, stderr: any) => {
                    if (error) {
                        console.warn("[COMET] Tar extraction failed:", stderr);
                        reject(error);
                    } else {
                        console.log("[COMET] MCDoc extracted successfully.");
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

        
        
        
        

        
        
        

        
        
        
        
        

        

        const cleanId = id.replace("minecraft:", "");
        const pascalName = cleanId
            .split("_")
            .map(p => p.charAt(0).toUpperCase() + p.slice(1))
            .join("");
        const searchSuffix = `::${pascalName}`;

        
        
        

        
        

        
        
        

        
        

        
        

        const globalSymbols = this.service.project.symbols.global;
        
        
        
        
        
        const structs = globalSymbols?.get("mcdoc/struct") || {};

        for (const key of Object.keys(structs)) {
            if (key.includes(`::${category}::`) && key.endsWith(searchSuffix)) {
                return key;
            }
        }

        
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

        
        

        const globalSymbols = this.service.project.symbols.global;
        
        const structMap = globalSymbols?.get("mcdoc/struct");
        const symbol = structMap?.[symbolPath];

        if (!symbol) return [];

        
        
        

        

        
        

        
        
        

        const items: vscode.CompletionItem[] = [];

        
        if (symbol.declaration?.node) {
            
            
            
            
            

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
