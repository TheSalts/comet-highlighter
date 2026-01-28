import * as https from "https";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { getMcdocManager } from "./mcdoc";

interface CommandNode {
    type: "root" | "literal" | "argument";
    children?: Record<string, CommandNode>;
    executable?: boolean;
    parser?: string;
    properties?: any;
    redirect?: string[];
}

interface CommandTree {
    type: "root";
    children: Record<string, CommandNode>;
}

interface RegistryData {
    [key: string]: string[];
}

export interface CommandValidationError {
    start: number;
    length: number;
    message: string;
    severity: "error" | "warning" | "info";
}

export class SpyglassManager {
    private initialized = false;
    private commandTree: CommandTree | null = null;
    private registries: RegistryData = {};
    private commandTokensCache = new Map<string, any[]>();
    private readonly MAX_CACHE_SIZE = 100;
    private version: string = "1.21.11";
    private cachePath: string | null = null;
    private registryMap: Record<string, string> = {
        "minecraft:item_stack": "item",
        "minecraft:item_predicate": "item",
        "minecraft:block_state": "block",
        "minecraft:block_predicate": "block",
        "minecraft:entity_summon": "entity_type",
        "minecraft:mob_effect": "mob_effect",
        "minecraft:enchantment": "enchantment",
        "minecraft:particle": "particle_type",
        "minecraft:attribute": "attribute",
        "minecraft:dimension": "dimension",
        "minecraft:game_profile": "", 
        "minecraft:score_holder": "", 
        "minecraft:resource_location": "", 
        "minecraft:function": "function", 
        "minecraft:time": "",
        "minecraft:uuid": "",
        "minecraft:color": "",
        "minecraft:swizzle": "",
        "minecraft:team": "", 
        "minecraft:objective": "", 
        "minecraft:loot_table": "loot_table",
        "minecraft:recipe": "recipe",
        "minecraft:advancement": "advancement",
        "minecraft:sound": "sound_event",
        "minecraft:fluid": "fluid",
        "minecraft:potion": "potion",
        "minecraft:sound_event": "sound_event",
    };

    
    private static readonly REGISTRY_PROPERTY_PARSERS = new Set([
        "minecraft:resource_key",
        "minecraft:resource",
        "minecraft:resource_or_tag",
        "minecraft:resource_or_tag_key",
        "minecraft:resource_selector",
    ]);

    
    private static getParserTokenCount(parser: string): number {
        switch (parser) {
            case "minecraft:block_pos":
            case "minecraft:vec3":
                return 3;
            case "minecraft:column_pos":
            case "minecraft:vec2":
            case "minecraft:rotation":
                return 2;
            default:
                return 1;
        }
    }

    private static isCoordinateParser(parser: string): boolean {
        return SpyglassManager.getParserTokenCount(parser) > 1;
    }

    private resourceLocationRegistryMap: Record<string, string> = {
        advancement: "advancement",
        loot_table: "loot_table",
        predicate: "predicate",
        recipe: "recipe",
        structure: "structure",
    };

    setCacheDir(path: string) {
        this.cachePath = path;
    }

    async initialize(mcVersion: string = "1.21.11"): Promise<void> {
        let apiVersion = mcVersion;
        this.version = apiVersion;

        const fetchData = async (ver: string) => {
            console.log(`[COMET] Fetching Spyglass data for MC ${ver}...`);
            return Promise.all([
                this.fetchJson<CommandTree>(
                    `https://api.spyglassmc.com/mcje/versions/${ver}/commands`,
                    `spyglass-commands-${ver}.json`
                ),
                this.fetchJson<RegistryData>(
                    `https://api.spyglassmc.com/mcje/versions/${ver}/registries`,
                    `spyglass-registries-${ver}.json`
                ),
            ]);
        };

        try {
            const [commands, registries] = await fetchData(apiVersion);

            this.commandTree = commands;
            this.registries = registries;
            this.initialized = true;
            console.log(
                `[COMET] Spyglass data for ${apiVersion} loaded successfully`
            );
        } catch (error) {
            console.warn(
                `[COMET] Failed to fetch Spyglass data for ${apiVersion}, trying fallback to 1.21.1:`,
                error
            );
            try {
                
                const fallbackVersion = "1.21.1";
                const [commands, registries] = await fetchData(fallbackVersion);
                this.commandTree = commands;
                this.registries = registries;
                this.initialized = true;
                console.log(
                    `[COMET] Spyglass fallback data (${fallbackVersion}) loaded successfully`
                );
            } catch (fallbackError) {
                console.warn(
                    "[COMET] Failed to fetch fallback Spyglass data:",
                    fallbackError
                );
                this.initialized = false;
            }
        }
    }

    isInitialized(): boolean {
        return this.initialized;
    }

    validateCommand(
        command: string,
        options: { ignoreIncomplete?: boolean } = {}
    ): CommandValidationError[] {
        const errors: CommandValidationError[] = [];

        if (!this.initialized || !this.commandTree) {
            return errors;
        }

        const cleanCommand = command.startsWith("/")
            ? command.substring(1)
            : command;

        if (cleanCommand.trim() === "") {
            return errors;
        }

        const tokens = this.tokenize(cleanCommand.trim());
        if (tokens.length === 0) {
            return errors;
        }

        const firstToken = tokens[0];
        if (!this.commandTree.children[firstToken]) {
            errors.push({
                start: command.startsWith("/") ? 1 : 0,
                length: firstToken.length,
                message: `Unknown command: ${firstToken}`,
                severity: "error",
            });
            return errors;
        }

        let currentNodes: CommandNode[] = [this.commandTree];
        let tokenIndex = 0;
        let currentOffset = command.startsWith("/") ? 1 : 0;
        let hasExecutable = false; 

        while (tokenIndex < tokens.length) {
            const token = tokens[tokenIndex];
            const nextNodes: CommandNode[] = [];
            let foundMatch = false;
            let foundLiteral = false;
            let argSkip = 0;

            let hasRedirect = false; 

            for (const node of currentNodes) {
                if (!node.children) continue;

                if (node.children[token]?.type === "literal") {
                    const originalNode = node.children[token];
                    
                    if (originalNode.executable) {
                        hasExecutable = true;
                    }

                    let targetNode = originalNode;
                    if (targetNode.redirect) {
                        hasRedirect = true;
                        const redirected = this.resolveRedirect(
                            targetNode.redirect
                        );
                        if (redirected) targetNode = redirected;
                    }
                    nextNodes.push(targetNode);
                    foundLiteral = true;
                    foundMatch = true;
                    break;
                }
            }

            if (!foundLiteral) {
                for (const node of currentNodes) {
                    if (!node.children) continue;
                    for (const [key, child] of Object.entries(node.children)) {
                        if (child.type === "argument") {
                            
                            if (child.executable) {
                                hasExecutable = true;
                            }

                            let targetNode = child;
                            if (targetNode.redirect) {
                                hasRedirect = true;
                                const redirected = this.resolveRedirect(
                                    targetNode.redirect
                                );
                                if (redirected) targetNode = redirected;
                            }
                            nextNodes.push(targetNode);
                            foundMatch = true;

                            const count = SpyglassManager.getParserTokenCount(
                                child.parser || ""
                            );
                            argSkip = Math.max(argSkip, count - 1);

                            const validationError = this.validateArgument(
                                token,
                                child,
                                currentOffset
                            );
                            if (validationError) {
                                errors.push(validationError);
                            }
                            break;
                        }
                    }
                    if (nextNodes.length > 0) break;
                }
            }

            if (!foundMatch && tokenIndex > 0) {
                const expectedTokens = this.getExpectedTokens(currentNodes);
                if (expectedTokens.length > 0) {
                    const expected = expectedTokens.slice(0, 5).join(", ");
                    errors.push({
                        start: currentOffset,
                        length: token.length,
                        message: `Unexpected argument: ${token}. Expected: ${expected}${expectedTokens.length > 5 ? "..." : ""}`,
                        severity: "error",
                    });
                }
            }

            if (token === "run") {
                currentNodes = [this.commandTree];
                hasExecutable = false; 
            } else if (nextNodes.length > 0) {
                currentNodes = nextNodes;
            }

            
            
            
            if (hasRedirect && tokenIndex + 1 + (foundLiteral ? 0 : argSkip) < tokens.length) {
                hasExecutable = false;
            }

            currentOffset += token.length + 1;
            tokenIndex += 1 + (foundLiteral ? 0 : argSkip);
        }

        
        const hasExecutableNode = hasExecutable || currentNodes.some(node => node && node.executable);

        if (
            !options.ignoreIncomplete &&
            !hasExecutableNode &&
            currentNodes[0] !== this.commandTree
        ) {
            const expectedTokens = this.getExpectedTokens(currentNodes);
            if (expectedTokens.length > 0) {
                const expected = expectedTokens.slice(0, 5).join(", ");
                errors.push({
                    start: 0,
                    length: command.length,
                    message: `Incomplete command. Expected: ${expected}${expectedTokens.length > 5 ? "..." : ""}`,
                    severity: "error",
                });
            }
        }

        return errors;
    }

    private validateArgument(
        token: string,
        node: CommandNode,
        offset: number
    ): CommandValidationError | null {
        const parser = node.parser;
        if (!parser) return null;

        if (parser === "brigadier:integer") {
            if (!/^-?\d+$/.test(token)) {
                return {
                    start: offset,
                    length: token.length,
                    message: `Expected integer, got: ${token}`,
                    severity: "error",
                };
            }
        } else if (
            parser === "brigadier:float" ||
            parser === "brigadier:double"
        ) {
            if (!/^-?\d+(\.\d+)?$/.test(token)) {
                return {
                    start: offset,
                    length: token.length,
                    message: `Expected number, got: ${token}`,
                    severity: "error",
                };
            }
        } else if (parser === "brigadier:bool") {
            if (token !== "true" && token !== "false") {
                return {
                    start: offset,
                    length: token.length,
                    message: `Expected boolean (true/false), got: ${token}`,
                    severity: "error",
                };
            }
        } else if (parser === "minecraft:gamemode") {
            const modes = ["survival", "creative", "adventure", "spectator"];
            if (!modes.includes(token)) {
                return {
                    start: offset,
                    length: token.length,
                    message: `Invalid gamemode: ${token}. Expected: ${modes.join(", ")}`,
                    severity: "error",
                };
            }
        } else if (
            parser.includes("entity") ||
            parser === "minecraft:score_holder" ||
            parser === "minecraft:game_profile"
        ) {
            if (!token.startsWith("@") && !/^[a-zA-Z0-9_]+$/.test(token)) {
                return {
                    start: offset,
                    length: token.length,
                    message: `Invalid entity selector or player name: ${token}`,
                    severity: "warning",
                };
            }
        }

        const registryKey = this.resolveRegistryKey(node, "");
        if (registryKey && this.registries[registryKey]) {
            const entries = this.registries[registryKey];
            const normalizedToken = token.replace(/^#/, "");
            const fullId = normalizedToken.includes(":")
                ? normalizedToken
                : `minecraft:${normalizedToken}`;

            const baseId = fullId.replace(/\[.*$/, "").replace(/\{.*$/, "");

            if (
                !entries.includes(baseId) &&
                !entries.includes(baseId.replace("minecraft:", ""))
            ) {
                return {
                    start: offset,
                    length: token.length,
                    message: `Unknown ${registryKey}: ${baseId}`,
                    severity: "warning",
                };
            }
        }

        return null;
    }

    private getExpectedTokens(nodes: CommandNode[]): string[] {
        const expected: string[] = [];
        for (const node of nodes) {
            if (!node.children) continue;
            for (const [key, child] of Object.entries(node.children)) {
                if (child.type === "literal") {
                    expected.push(key);
                } else if (child.type === "argument") {
                    expected.push(`<${key}>`);
                }
            }
        }
        return expected;
    }

    getCommandCompletions(
        command: string,
        cursorOffset: number,
        availableTags: string[] = []
    ): vscode.CompletionItem[] {
        if (!this.initialized || !this.commandTree) {
            return this.getFallbackCompletions(command);
        }

        const items: any[] = [];
        const seenLabels = new Set<string>();

        
        const cleanCommand = command.startsWith("/")
            ? command.substring(1)
            : command;
        const offsetAdjustment = command.startsWith("/") ? 1 : 0;
        const effectiveOffset = cursorOffset - offsetAdjustment;

        if (effectiveOffset < 0) return [];

        
        const selectorMatch = cleanCommand
            .substring(0, effectiveOffset)
            .match(/(@[a-z])\[([^\]]*)$/);
        if (selectorMatch) {
            const selectorContent = selectorMatch[2];
            const parts = selectorContent.split(",");
            const lastPart = parts[parts.length - 1].trim();

            if (lastPart.includes("=")) {
                const [key, val] = lastPart.split("=").map(s => s.trim());
                if (key === "type") {
                    this.addRegistryCompletions(
                        items,
                        "entity_type",
                        val,
                        seenLabels
                    );
                    this.addRegistryCompletions(
                        items,
                        "entity_type",
                        val.replace("!", ""),
                        seenLabels,
                        false,
                        true
                    );
                    return items;
                } else if (key === "gamemode") {
                    ["survival", "creative", "adventure", "spectator"].forEach(
                        m => {
                            if (m.startsWith(val))
                                items.push({
                                    label: m,
                                    kind: vscode.CompletionItemKind.EnumMember,
                                });
                        }
                    );
                    return items;
                } else if (key === "tag") {
                    availableTags.forEach(t => {
                        if (
                            t.startsWith(val) ||
                            t.startsWith(val.replace("!", ""))
                        ) {
                            items.push({
                                label: t,
                                kind: vscode.CompletionItemKind.Value,
                                detail: "Tag",
                            });
                        }
                    });
                    return items;
                }
            } else {
                const keys = [
                    "type",
                    "tag",
                    "name",
                    "distance",
                    "level",
                    "x",
                    "y",
                    "z",
                    "dx",
                    "dy",
                    "dz",
                    "gamemode",
                    "scores",
                    "advancements",
                    "nbt",
                    "limit",
                    "sort",
                    "x_rotation",
                    "y_rotation",
                    "team",
                ];
                keys.forEach(k => {
                    if (k.startsWith(lastPart)) {
                        items.push({
                            label: k,
                            kind: vscode.CompletionItemKind.Property,
                            insertText: k + "=",
                        });
                    }
                });
                return items;
            }
        }

        const textBeforeCursor = cleanCommand.substring(0, effectiveOffset);

        
        const tokens = this.tokenize(textBeforeCursor.trim());
        const isNewToken = textBeforeCursor.endsWith(" ");

        const completedArgs = isNewToken ? tokens : tokens.slice(0, -1);
        const currentInput = isNewToken ? "" : tokens[tokens.length - 1] || "";

        
        if (completedArgs.length >= 2 && completedArgs[0] === "tag") {
            const action = completedArgs[2]; 
            if (
                (action === "add" || action === "remove") &&
                completedArgs.length === 3
            ) {
                availableTags.forEach(tag => {
                    if (tag.startsWith(currentInput) && !seenLabels.has(tag)) {
                        items.push({
                            label: tag,
                            kind: vscode.CompletionItemKind.Value,
                            detail: "Tag",
                        });
                        seenLabels.add(tag);
                    }
                });
            }
        }

        
        const { nodes: contextNodes, midCoord } = this.traverse(
            this.commandTree,
            completedArgs
        );

        if (midCoord > 0) {
            this.addSingleCoordinateCompletions(
                items,
                currentInput,
                seenLabels
            );
            return items;
        }

        
        if (currentInput.includes("{")) {
            const nbtPart = currentInput.substring(
                currentInput.lastIndexOf("{")
            );
            
            if (/Tags\s*:\s*\[[^\]]*$/.test(nbtPart)) {
                const match = /Tags\s*:\s*\[(.*)$/.exec(nbtPart);
                if (match) {
                    const content = match[1];
                    const currentTag =
                        content
                            .split(",")
                            .pop()
                            ?.trim()
                            .replace(/^"|"$/g, "") || "";

                    availableTags.forEach(tag => {
                        if (
                            tag.startsWith(currentTag) &&
                            !seenLabels.has(tag)
                        ) {
                            items.push({
                                label: tag,
                                kind: vscode.CompletionItemKind.Value,
                                detail: "Tag",
                                insertText: `"${tag}"`,
                            });
                            seenLabels.add(tag);
                        }
                    });
                    return items;
                }
            }
        }

        for (const node of contextNodes) {
            if (!node.children) continue;

            for (const [key, child] of Object.entries(node.children)) {
                if (child.type === "literal") {
                    if (key.startsWith(currentInput) && !seenLabels.has(key)) {
                        items.push({
                            label: key,
                            kind: vscode.CompletionItemKind.Keyword,
                            detail: "Literal",
                            sortText: "0_" + key,
                        });
                        seenLabels.add(key);
                    }
                } else if (child.type === "argument") {
                    this.addArgumentCompletions(
                        items,
                        child,
                        currentInput,
                        seenLabels,
                        key
                    );
                }
            }
        }

        return items;
    }

    private resolveRegistryKey(
        node: CommandNode,
        nodeName: string
    ): string | undefined {
        const parser = node.parser;
        if (!parser) return undefined;

        
        if (SpyglassManager.REGISTRY_PROPERTY_PARSERS.has(parser)) {
            const reg: string | undefined = node.properties?.registry;
            if (reg) {
                
                const key = reg.replace(/^minecraft:/, "");
                if (this.registries[key]) return key;
            }
            return undefined;
        }

        
        const mapped = this.registryMap[parser];
        if (mapped && this.registries[mapped]) return mapped;

        
        if (mapped === undefined && parser.includes(":")) {
            const bareKey = parser.split(":")[1];
            if (this.registries[bareKey]) return bareKey;
        }

        
        if (parser === "minecraft:resource_location") {
            const heuristic = this.resourceLocationRegistryMap[nodeName];
            if (heuristic && this.registries[heuristic]) return heuristic;
        }

        
        if (parser === "minecraft:loot_table" && this.registries["loot_table"])
            return "loot_table";

        return undefined;
    }

    private addRegistryCompletions(
        items: any[],
        registryKey: string,
        currentInput: string,
        seenLabels: Set<string>,
        isTag: boolean = false,
        isNegated: boolean = false
    ) {
        const entries = this.registries[registryKey];
        if (!entries) return;

        for (const id of entries) {
            const fullId = id.includes(":") ? id : `minecraft:${id}`;

            if (
                currentInput === "" ||
                id.includes(currentInput) ||
                fullId.includes(currentInput) ||
                id.split(":")[1]?.startsWith(currentInput) ||
                fullId.split(":")[1]?.startsWith(currentInput)
            ) {
                let label = isTag ? `#${fullId}` : fullId;
                if (isNegated) label = "!" + label;

                if (!seenLabels.has(label)) {
                    items.push({
                        label,
                        kind: vscode.CompletionItemKind.Value,
                        detail: registryKey,
                        sortText: "1_" + label,
                    });
                    seenLabels.add(label);
                }
            }
        }
    }

    private addSingleCoordinateCompletions(
        items: any[],
        currentInput: string,
        seenLabels: Set<string>
    ) {
        const values = ["~", "^", "0"];
        for (const val of values) {
            if (val.startsWith(currentInput) && !seenLabels.has(val)) {
                items.push({
                    label: val,
                    kind: vscode.CompletionItemKind.Value,
                    detail: "Coordinate",
                    sortText: "0_" + val,
                });
                seenLabels.add(val);
            }
        }
    }

    private addCoordinateCompletions(
        items: any[],
        parser: string,
        currentInput: string,
        seenLabels: Set<string>
    ) {
        const count = SpyglassManager.getParserTokenCount(parser);
        const axes3 = count === 3;

        
        const snippets: { label: string; insert: string; detail: string }[] =
            [];

        if (axes3) {
            snippets.push(
                {
                    label: "~ ~ ~",
                    insert: "~ ~ ~",
                    detail: "Relative coordinates",
                },
                {
                    label: "^ ^ ^",
                    insert: "^ ^ ^",
                    detail: "Local coordinates",
                },
                {
                    label: "0 0 0",
                    insert: "0 0 0",
                    detail: "Absolute coordinates",
                }
            );
        } else {
            snippets.push(
                { label: "~ ~", insert: "~ ~", detail: "Relative" },
                { label: "^ ^", insert: "^ ^", detail: "Local" },
                { label: "0 0", insert: "0 0", detail: "Absolute" }
            );
        }

        for (const s of snippets) {
            if (
                (currentInput === "" || s.label.startsWith(currentInput)) &&
                !seenLabels.has(s.label)
            ) {
                items.push({
                    label: s.label,
                    kind: vscode.CompletionItemKind.Snippet,
                    detail: s.detail,
                    insertText: s.insert,
                    sortText: "0_" + s.label,
                });
                seenLabels.add(s.label);
            }
        }

        
        this.addSingleCoordinateCompletions(items, currentInput, seenLabels);
    }

    private addArgumentCompletions(
        items: any[],
        node: CommandNode,
        currentInput: string,
        seenLabels: Set<string>,
        nodeName: string = ""
    ) {
        const parser = node.parser;
        if (!parser) return;

        
        if (SpyglassManager.isCoordinateParser(parser)) {
            this.addCoordinateCompletions(
                items,
                parser,
                currentInput,
                seenLabels
            );
            return;
        }

        
        const registryKey = this.resolveRegistryKey(node, nodeName);

        if (registryKey) {
            const isTag =
                parser === "minecraft:resource_or_tag" ||
                parser === "minecraft:resource_or_tag_key";

            this.addRegistryCompletions(
                items,
                registryKey,
                currentInput,
                seenLabels
            );

            
            if (isTag) {
                const tagKey = `tag/${registryKey}`;
                if (this.registries[tagKey]) {
                    this.addRegistryCompletions(
                        items,
                        tagKey,
                        currentInput.replace(/^#/, ""),
                        seenLabels,
                        true
                    );
                }
            }
            return;
        }

        
        if (parser === "brigadier:bool") {
            ["true", "false"].forEach(val => {
                if (val.startsWith(currentInput) && !seenLabels.has(val)) {
                    items.push({
                        label: val,
                        kind: vscode.CompletionItemKind.Keyword,
                        detail: "Boolean",
                    });
                    seenLabels.add(val);
                }
            });
        } else if (
            parser.includes("entity") ||
            parser === "minecraft:score_holder" ||
            parser === "minecraft:game_profile"
        ) {
            const selectors = ["@p", "@a", "@r", "@s", "@e"];
            for (const sel of selectors) {
                if (sel.startsWith(currentInput) && !seenLabels.has(sel)) {
                    items.push({
                        label: sel,
                        kind: vscode.CompletionItemKind.Value,
                        detail: "Selector",
                    });
                    seenLabels.add(sel);
                }
            }
        } else if (parser === "minecraft:gamemode") {
            const modes = ["survival", "creative", "adventure", "spectator"];
            for (const mode of modes) {
                if (mode.startsWith(currentInput) && !seenLabels.has(mode)) {
                    items.push({
                        label: mode,
                        kind: vscode.CompletionItemKind.EnumMember,
                        detail: "Game mode",
                    });
                    seenLabels.add(mode);
                }
            }
        } else if (
            parser === "minecraft:color" ||
            parser === "minecraft:hex_color"
        ) {
            if (parser === "minecraft:color") {
                const colors = [
                    "black",
                    "dark_blue",
                    "dark_green",
                    "dark_aqua",
                    "dark_red",
                    "dark_purple",
                    "gold",
                    "gray",
                    "dark_gray",
                    "blue",
                    "green",
                    "aqua",
                    "red",
                    "light_purple",
                    "yellow",
                    "white",
                    "reset",
                ];
                for (const color of colors) {
                    if (
                        color.startsWith(currentInput) &&
                        !seenLabels.has(color)
                    ) {
                        items.push({
                            label: color,
                            kind: vscode.CompletionItemKind.Color,
                            detail: "Color",
                        });
                        seenLabels.add(color);
                    }
                }
            }
        } else if (parser === "minecraft:resource_location" && !registryKey) {
            
            if (
                "minecraft:".startsWith(currentInput) &&
                !seenLabels.has("minecraft:")
            ) {
                items.push({
                    label: "minecraft:",
                    kind: vscode.CompletionItemKind.Value,
                    detail: "Namespace",
                });
                seenLabels.add("minecraft:");
            }
        }
    }

     
    private traverse(
        root: CommandNode,
        args: string[]
    ): { nodes: CommandNode[]; midCoord: number } {
        let currentNodes: CommandNode[] = [root];
        let i = 0;

        while (i < args.length) {
            const arg = args[i];
            const nextNodes: CommandNode[] = [];
            let foundLiteral = false;
            let argSkip = 0;

            for (const node of currentNodes) {
                if (!node.children) continue;

                for (const [key, child] of Object.entries(node.children)) {
                    let targetNode = child;
                    if (child.redirect) {
                        const redirected = this.resolveRedirect(child.redirect);
                        if (redirected) targetNode = redirected;
                    }

                    if (child.type === "literal") {
                        if (key === arg) {
                            nextNodes.push(targetNode);
                            foundLiteral = true;
                        }
                    } else if (child.type === "argument") {
                        nextNodes.push(targetNode);
                        const count = SpyglassManager.getParserTokenCount(
                            child.parser || ""
                        );
                        argSkip = Math.max(argSkip, count - 1);
                    }
                }
            }

            if (nextNodes.length === 0) return { nodes: [], midCoord: 0 };

            currentNodes = nextNodes;
            const skip = foundLiteral ? 0 : argSkip;
            const remaining = args.length - (i + 1);

            if (!foundLiteral && skip > 0 && remaining < skip) {
                
                return { nodes: currentNodes, midCoord: skip - remaining };
            }

            i += 1 + skip;
        }
        return { nodes: currentNodes, midCoord: 0 };
    }

    private resolveRedirect(path: string[]): CommandNode | null {
        if (!this.commandTree) return null;
        let nodes = this.commandTree.children;
        let foundNode: CommandNode | null = null;
        for (const key of path) {
            if (nodes && nodes[key]) {
                foundNode = nodes[key];
                nodes = foundNode.children || {};
            } else {
                return null;
            }
        }
        return foundNode;
    }

    private tokenize(text: string): string[] {
        const tokens: string[] = [];
        let current = "";
        let inString = false;
        let braceDepth = 0; 

        for (let i = 0; i < text.length; i++) {
            const c = text[i];

            if (c === '"' && text[i - 1] !== "\\\\") {
                inString = !inString;
                current += c;
            } else if (inString) {
                current += c;
            } else if (c === "{" || c === "[") {
                if (
                    braceDepth === 0 &&
                    current.length > 0 &&
                    current.trim() === ""
                ) {
                    
                }
                braceDepth++;
                current += c;
            } else if (c === "}" || c === "]") {
                braceDepth--;
                current += c;
            } else if (c === " " && braceDepth === 0) {
                if (current.length > 0) {
                    tokens.push(current);
                    current = "";
                }
            } else {
                current += c;
            }
        }
        if (current.length > 0) tokens.push(current);
        return tokens;
    }

    getCommandSemanticTokens(command: string): {
        start: number;
        length: number;
        tokenType: string;
        tokenModifiers: string[];
    }[] {
        if (this.commandTokensCache.has(command)) {
            return this.commandTokensCache.get(command)!;
        }

        if (!this.initialized || !this.commandTree) {
            return this.getFallbackSemanticTokens(command);
        }

        
        const ranges = this.tokenizeWithRanges(command);
        const semanticTokens: any[] = [];

        
        let currentNodes: CommandNode[] = [this.commandTree];
        let tokenIndex = 0;
        let isFirstLiteral = true; 
        let afterRun = false; 

        while (tokenIndex < ranges.length) {
            const token = ranges[tokenIndex];
            const nextNodes: CommandNode[] = [];
            let matchedNode: CommandNode | null = null;
            let matchType = "variable";

            let tokenValue = token.value;
            if (tokenValue.startsWith("/"))
                tokenValue = tokenValue.substring(1);

            let foundLiteral = false;

            
            for (const node of currentNodes) {
                if (!node.children) continue;
                if (
                    node.children[tokenValue] &&
                    node.children[tokenValue].type === "literal"
                ) {
                    matchedNode = node.children[tokenValue];
                    if (matchedNode.redirect) {
                        const r = this.resolveRedirect(matchedNode.redirect);
                        if (r) matchedNode = r;
                    }
                    nextNodes.push(matchedNode);

                    
                    if (isFirstLiteral || afterRun) {
                        matchType = "keyword"; 
                        isFirstLiteral = false;
                        afterRun = false;
                    } else {
                        matchType = "function"; 
                    }

                    
                    
                    if (tokenValue === "run") {
                        afterRun = true;
                    }

                    foundLiteral = true;
                    break;
                }
            }

            if (!foundLiteral) {
                
                for (const node of currentNodes) {
                    if (!node.children) continue;
                    for (const [key, child] of Object.entries(node.children)) {
                        if (child.type === "argument") {
                            matchedNode = child;
                            if (matchedNode.redirect) {
                                const r = this.resolveRedirect(
                                    matchedNode.redirect
                                );
                                if (r) matchedNode = r;
                            }
                            nextNodes.push(matchedNode);
                            matchType = this.mapParserToTokenType(child.parser);
                            break;
                        }
                    }
                    if (nextNodes.length > 0) break;
                }
            }

            if (matchedNode) {
                if (tokenValue === "run") {
                    currentNodes = [this.commandTree];
                } else {
                    currentNodes = nextNodes;
                }
                const parser = matchedNode.parser;

                
                if (parser && SpyglassManager.isCoordinateParser(parser)) {
                    const count = SpyglassManager.getParserTokenCount(parser);
                    
                    for (
                        let j = 0;
                        j < count && tokenIndex < ranges.length;
                        j++
                    ) {
                        const coordToken = ranges[tokenIndex];
                        semanticTokens.push({
                            start: coordToken.start,
                            length: coordToken.length,
                            tokenType: "number",
                            tokenModifiers: [],
                        });
                        tokenIndex++;
                    }
                    continue; 
                }

                

                
                const isComplexByParser =
                    parser &&
                    (parser.includes("entity") ||
                        parser === "minecraft:score_holder" ||
                        parser === "minecraft:game_profile" ||
                        parser === "minecraft:resource_location" ||
                        parser === "minecraft:block_state" ||
                        parser === "minecraft:block_predicate" ||
                        parser === "minecraft:item_stack" ||
                        parser === "minecraft:item_predicate" ||
                        parser === "minecraft:nbt_compound_tag" ||
                        parser === "minecraft:nbt_tag" ||
                        parser === "minecraft:nbt_path" ||
                        SpyglassManager.REGISTRY_PROPERTY_PARSERS.has(parser));

                
                const isSelector = /^@[aeprs](\[.*\])?$/.test(token.value);
                const isResourceLocation =
                    /^#?[a-z0-9_.-]+:[a-z0-9_/.:-]+(\{.*\})?(\[.*\])?$/.test(
                        token.value
                    );
                const isNbt = /^\{.*\}$/.test(token.value);
                const isNumber = /^-?\d+(\.\d+)?[bslfd]?$/i.test(token.value);
                const isComplexByPattern =
                    isSelector || isResourceLocation || isNbt;

                if (isComplexByParser || isComplexByPattern) {
                    
                    const effectiveParser =
                        parser ||
                        (isSelector
                            ? "minecraft:entity"
                            : isResourceLocation
                              ? "minecraft:resource_location"
                              : isNbt
                                ? "minecraft:nbt_compound_tag"
                                : undefined);

                    const subTokens = this.parseComplexArgument(
                        token.value,
                        token.start,
                        effectiveParser || ""
                    );

                    semanticTokens.push(...subTokens);
                } else if (isNumber) {
                    semanticTokens.push({
                        start: token.start,
                        length: token.length,
                        tokenType: "number",
                        tokenModifiers: [],
                    });
                } else {
                    
                    const finalType = parser
                        ? this.mapParserToTokenType(parser)
                        : matchType;

                    semanticTokens.push({
                        start: token.start,
                        length: token.length,
                        tokenType: finalType,
                        tokenModifiers: [],
                    });
                }
            } else {
                
                break;
            }

            tokenIndex++;
        }

        if (this.commandTokensCache.size >= this.MAX_CACHE_SIZE) {
            const firstKey = this.commandTokensCache.keys().next().value;
            if (firstKey !== undefined) {
                this.commandTokensCache.delete(firstKey);
            }
        }
        this.commandTokensCache.set(command, semanticTokens);

        return semanticTokens;
    }

    

    public getNbtTokens(text: string): any[] {
        return this.tokenizeNbt(text, 0);
    }

    private tokenizeNbt(text: string, baseOffset: number): any[] {
        const tokens: any[] = [];
        let pos = 0;

        const peek = () => (pos < text.length ? text[pos] : "");
        const at = (ch: string) => pos < text.length && text[pos] === ch;
        const emit = (start: number, len: number, type: string) => {
            if (len > 0) {
                tokens.push({
                    start: baseOffset + start,
                    length: len,
                    tokenType: type,
                    tokenModifiers: [],
                });
            }
        };

        function skipWs() {
            while (pos < text.length && text[pos] === " ") pos++;
        }

        const readQuotedString = () => {
            const s = pos;
            const q = text[pos++]; 
            while (pos < text.length && text[pos] !== q) {
                if (text[pos] === "\\") pos++;
                pos++;
            }
            if (pos < text.length) pos++; 
            emit(s, pos - s, "string");
        };

        const readUnquoted = (): string => {
            const s = pos;
            while (pos < text.length && /[a-zA-Z0-9._+\-:/]/.test(text[pos]))
                pos++;
            return text.substring(s, pos);
        };

        const classifyWord = (word: string, start: number) => {
            if (word.length === 0) return;
            if (word === "true" || word === "false") {
                emit(start, word.length, "enumMember");
            } else if (/^[-+]?[0-9]+(\.[0-9]+)?[bBsSlLfFdD]?$/.test(word)) {
                emit(start, word.length, "number");
            } else if (word.includes(":")) {
                const ci = word.indexOf(":");
                emit(start, ci, "type");
                emit(start + ci, 1, "operator");
                emit(start + ci + 1, word.length - ci - 1, "type");
            } else {
                emit(start, word.length, "string");
            }
        };

        const readValue = () => {
            skipWs();
            if (pos >= text.length) return;
            const ch = peek();
            if (ch === "{") {
                readCompound();
            } else if (ch === "[") {
                readList();
            } else if (ch === '"' || ch === "'") {
                readQuotedString();
            } else {
                const s = pos;
                const w = readUnquoted();
                classifyWord(w, s);
            }
        };

        const readCompound = () => {
            emit(pos, 1, "operator"); 
            pos++;
            skipWs();

            while (pos < text.length && text[pos] !== "}") {
                const startPos = pos;
                skipWs();
                if (pos >= text.length || text[pos] === "}") break;

                
                const ks = pos;
                if (text[pos] === '"' || text[pos] === "'") {
                    const q = text[pos++];
                    while (pos < text.length && text[pos] !== q) {
                        if (text[pos] === "\\") pos++;
                        pos++;
                    }
                    if (pos < text.length) pos++;
                    emit(ks, pos - ks, "property");
                } else {
                    const key = readUnquoted();
                    if (key.length > 0) emit(ks, key.length, "property");
                }

                skipWs();

                
                if (at(":")) {
                    emit(pos, 1, "operator");
                    pos++;
                }

                
                readValue();

                skipWs();
                if (at(",")) {
                    emit(pos, 1, "operator");
                    pos++;
                }

                
                if (pos === startPos) {
                    pos++;
                }
            }

            if (at("}")) {
                emit(pos, 1, "operator");
                pos++;
            }
        };

        const readList = () => {
            emit(pos, 1, "operator"); 
            pos++;
            skipWs();

            
            if (
                pos + 1 < text.length &&
                "BIL".includes(text[pos]) &&
                text[pos + 1] === ";"
            ) {
                emit(pos, 1, "keyword");
                pos++;
                emit(pos, 1, "operator");
                pos++;
            }

            while (pos < text.length && text[pos] !== "]") {
                const startPos = pos;
                skipWs();
                if (pos >= text.length || text[pos] === "]") break;

                readValue();

                skipWs();
                if (at(",")) {
                    emit(pos, 1, "operator");
                    pos++;
                }

                
                if (pos === startPos) {
                    pos++;
                }
            }

            if (at("]")) {
                emit(pos, 1, "operator");
                pos++;
            }
        };

        
        skipWs();
        if (pos < text.length) readValue();

        return tokens;
    }

    

    private tokenizeBlockState(text: string, baseOffset: number): any[] {
        const tokens: any[] = [];
        let pos = 0;
        const emit = (start: number, len: number, type: string) => {
            if (len > 0) {
                tokens.push({
                    start: baseOffset + start,
                    length: len,
                    tokenType: type,
                    tokenModifiers: [],
                });
            }
        };

        if (pos < text.length && text[pos] === "[") {
            emit(pos, 1, "operator");
            pos++;

            while (pos < text.length && text[pos] !== "]") {
                
                const ks = pos;
                while (pos < text.length && /[a-z_]/.test(text[pos])) pos++;
                if (pos > ks) emit(ks, pos - ks, "property");

                if (pos < text.length && text[pos] === "=") {
                    emit(pos, 1, "operator");
                    pos++;
                }

                
                const vs = pos;
                while (
                    pos < text.length &&
                    text[pos] !== "," &&
                    text[pos] !== "]"
                )
                    pos++;
                if (pos > vs) emit(vs, pos - vs, "enumMember");

                if (pos < text.length && text[pos] === ",") {
                    emit(pos, 1, "operator");
                    pos++;
                }
            }

            if (pos < text.length && text[pos] === "]") {
                emit(pos, 1, "operator");
                pos++;
            }
        }

        return { tokens, consumed: pos } as any;
    }

    

    private tokenizeNbtPath(text: string, baseOffset: number): any[] {
        const tokens: any[] = [];
        let pos = 0;
        const emit = (start: number, len: number, type: string) => {
            if (len > 0) {
                tokens.push({
                    start: baseOffset + start,
                    length: len,
                    tokenType: type,
                    tokenModifiers: [],
                });
            }
        };

        while (pos < text.length) {
            const ch = text[pos];
            if (ch === "{") {
                
                const sub = text.substring(pos);
                
                let depth = 0;
                let end = pos;
                for (let i = pos; i < text.length; i++) {
                    if (text[i] === "{") depth++;
                    else if (text[i] === "}") {
                        depth--;
                        if (depth === 0) {
                            end = i + 1;
                            break;
                        }
                    }
                }
                const nbtSlice = text.substring(pos, end);
                tokens.push(...this.tokenizeNbt(nbtSlice, baseOffset + pos));
                pos = end;
            } else if (ch === "[") {
                emit(pos, 1, "operator");
                pos++;
                
                if (pos < text.length && text[pos] === "{") {
                    
                    let depth = 0;
                    let end = pos;
                    for (let i = pos; i < text.length; i++) {
                        if (text[i] === "{") depth++;
                        else if (text[i] === "}") {
                            depth--;
                            if (depth === 0) {
                                end = i + 1;
                                break;
                            }
                        }
                    }
                    const nbtSlice = text.substring(pos, end);
                    tokens.push(
                        ...this.tokenizeNbt(nbtSlice, baseOffset + pos)
                    );
                    pos = end;
                } else {
                    
                    const ns = pos;
                    while (pos < text.length && /[0-9]/.test(text[pos])) pos++;
                    if (pos > ns) emit(ns, pos - ns, "number");
                }
                if (pos < text.length && text[pos] === "]") {
                    emit(pos, 1, "operator");
                    pos++;
                }
            } else if (ch === ".") {
                emit(pos, 1, "operator");
                pos++;
            } else if (ch === '"' || ch === "'") {
                const s = pos;
                const q = text[pos++];
                while (pos < text.length && text[pos] !== q) {
                    if (text[pos] === "\\") pos++;
                    pos++;
                }
                if (pos < text.length) pos++;
                emit(s, pos - s, "property");
            } else {
                
                const ks = pos;
                while (pos < text.length && /[a-zA-Z0-9_]/.test(text[pos]))
                    pos++;
                if (pos > ks) emit(ks, pos - ks, "property");
                if (pos === ks) pos++; 
            }
        }

        return tokens;
    }

    

    private tokenizeIdSuffix(text: string, baseOffset: number): any[] {
        const tokens: any[] = [];
        let pos = 0;

        
        if (pos < text.length && text[pos] === "[") {
            let depth = 0;
            let end = pos;
            for (let i = pos; i < text.length; i++) {
                if (text[i] === "[") depth++;
                else if (text[i] === "]") {
                    depth--;
                    if (depth === 0) {
                        end = i + 1;
                        break;
                    }
                }
            }
            const slice = text.substring(pos, end);
            const result = this.tokenizeBlockState(
                slice,
                baseOffset + pos
            ) as any;
            tokens.push(...result.tokens);
            pos = end;
        }

        
        if (pos < text.length && text[pos] === "{") {
            const nbtSlice = text.substring(pos);
            tokens.push(...this.tokenizeNbt(nbtSlice, baseOffset + pos));
        }

        return tokens;
    }

    

    private tokenizeSelector(text: string, baseOffset: number): any[] {
        const tokens: any[] = [];
        let pos = 0;

        const emit = (start: number, len: number, type: string) => {
            if (len > 0) {
                const token = {
                    start: baseOffset + start,
                    length: len,
                    tokenType: type,
                    tokenModifiers: [],
                };
                tokens.push(token);
            }
        };

        
        if (pos + 1 < text.length && text[pos] === "@") {
            emit(pos, 2, "enum"); 
            pos += 2;
        } else {
            
            emit(0, text.length, "variable");
            return tokens;
        }

        
        if (pos >= text.length || text[pos] !== "[") return tokens;

        emit(pos, 1, "operator"); 
        pos++;

        while (pos < text.length && text[pos] !== "]") {
            const startPos = pos;
            
            while (pos < text.length && text[pos] === " ") pos++;
            if (pos >= text.length || text[pos] === "]") break;

            
            const keyStart = pos;
            while (pos < text.length && /[a-z_]/.test(text[pos])) pos++;
            if (pos > keyStart) emit(keyStart, pos - keyStart, "property");

            
            while (pos < text.length && text[pos] === " ") pos++;

            
            if (pos < text.length && text[pos] === "=") {
                emit(pos, 1, "operator");
                pos++;
            }

            
            while (pos < text.length && text[pos] === " ") pos++;

            
            if (pos < text.length && text[pos] === "!") {
                emit(pos, 1, "operator");
                pos++;
            }

            
            while (pos < text.length && text[pos] === " ") pos++;

            
            const valueStart = pos;

            if (pos < text.length && text[pos] === "{") {
                
                let depth = 0;
                let nbtEnd = pos;
                for (let i = pos; i < text.length; i++) {
                    if (text[i] === "{") depth++;
                    else if (text[i] === "}") {
                        depth--;
                        if (depth === 0) {
                            nbtEnd = i + 1;
                            break;
                        }
                    }
                }
                const nbtSlice = text.substring(pos, nbtEnd);
                tokens.push(...this.tokenizeNbt(nbtSlice, baseOffset + pos));
                pos = nbtEnd;
            } else if (pos < text.length && text[pos] === '"') {
                
                const q = text[pos++];
                while (pos < text.length && text[pos] !== q) {
                    if (text[pos] === "\\") pos++;
                    pos++;
                }
                if (pos < text.length) pos++;
                emit(valueStart, pos - valueStart, "string");
            } else {
                
                while (
                    pos < text.length &&
                    text[pos] !== "," &&
                    text[pos] !== "]"
                ) {
                    pos++;
                }
                const valueText = text.substring(valueStart, pos);

                
                if (valueText.includes("..")) {
                    
                    const parts = valueText.split("..");
                    if (parts[0].length > 0 && /^-?\d+$/.test(parts[0])) {
                        emit(valueStart, parts[0].length, "number");
                    }
                    emit(valueStart + parts[0].length, 2, "operator");
                    if (
                        parts[1] &&
                        parts[1].length > 0 &&
                        /^-?\d+$/.test(parts[1])
                    ) {
                        emit(
                            valueStart + parts[0].length + 2,
                            parts[1].length,
                            "number"
                        );
                    }
                } else if (/^-?\d+(\.\d+)?$/.test(valueText)) {
                    
                    emit(valueStart, valueText.length, "number");
                } else if (valueText === "true" || valueText === "false") {
                    
                    emit(valueStart, valueText.length, "enumMember");
                } else if (valueText.includes(":")) {
                    
                    const ci = valueText.indexOf(":");
                    emit(valueStart, ci, "namespace");
                    emit(valueStart + ci, 1, "operator");
                    emit(
                        valueStart + ci + 1,
                        valueText.length - ci - 1,
                        "type"
                    );
                } else {
                    
                    
                    emit(valueStart, valueText.length, "class");
                }
            }

            
            if (pos < text.length && text[pos] === ",") {
                emit(pos, 1, "operator");
                pos++;
            }

            
            if (pos === startPos) {
                pos++;
            }
        }

        
        if (pos < text.length && text[pos] === "]") {
            emit(pos, 1, "operator");
            pos++;
        }

        return tokens;
    }

    

    private parseComplexArgument(
        text: string,
        startOffset: number,
        parser: string
    ): any[] {
        const tokens: any[] = [];

        if (
            parser === "minecraft:score_holder" ||
            parser === "minecraft:game_profile"
        ) {
            if (text.startsWith("@")) {
                return this.tokenizeSelector(text, startOffset);
            } else {
                tokens.push({
                    start: startOffset,
                    length: text.length,
                    tokenType: "parameter",
                    tokenModifiers: [],
                });
                return tokens;
            }
        } else if (parser.includes("entity")) {
            return this.tokenizeSelector(text, startOffset);
        } else if (
            parser === "minecraft:nbt_compound_tag" ||
            parser === "minecraft:nbt_tag"
        ) {
            
            return this.tokenizeNbt(text, startOffset);
        } else if (parser === "minecraft:nbt_path") {
            
            return this.tokenizeNbtPath(text, startOffset);
        } else if (
            parser === "minecraft:resource_location" ||
            parser === "minecraft:block_state" ||
            parser === "minecraft:block_predicate" ||
            parser === "minecraft:item_stack" ||
            parser === "minecraft:item_predicate" ||
            SpyglassManager.REGISTRY_PROPERTY_PARSERS.has(parser)
        ) {
            
            let tagOffset = 0;
            let workText = text;
            if (text.startsWith("#")) {
                tokens.push({
                    start: startOffset,
                    length: 1,
                    tokenType: "operator",
                    tokenModifiers: [],
                });
                tagOffset = 1;
                workText = text.substring(1);
            }

            const idMatch = workText.match(
                /^([a-z0-9_.-]+:[a-z0-9_./-]+|[a-z0-9_./-]+)/
            );
            if (idMatch) {
                const id = idMatch[0];
                const idStart = startOffset + tagOffset;
                const parts = id.split(":");

                
                let pathTokenType = "type"; 
                if (parser === "minecraft:function") {
                    pathTokenType = "method";
                } else if (
                    parser === "minecraft:resource_location" ||
                    parser === "minecraft:loot_table" ||
                    parser === "minecraft:loot_predicate"
                ) {
                    pathTokenType = "method";
                }

                if (parts.length > 1) {
                    tokens.push({
                        start: idStart,
                        length: parts[0].length,
                        tokenType: pathTokenType,
                        tokenModifiers: [],
                    });
                    tokens.push({
                        start: idStart + parts[0].length,
                        length: 1,
                        tokenType: "operator",
                        tokenModifiers: [],
                    });
                    tokens.push({
                        start: idStart + parts[0].length + 1,
                        length: parts[1].length,
                        tokenType: pathTokenType,
                        tokenModifiers: [],
                    });
                } else {
                    tokens.push({
                        start: idStart,
                        length: id.length,
                        tokenType: pathTokenType,
                        tokenModifiers: [],
                    });
                }

                
                if (workText.length > id.length) {
                    const remainder = workText.substring(id.length);
                    const remainderStart = idStart + id.length;
                    tokens.push(
                        ...this.tokenizeIdSuffix(remainder, remainderStart)
                    );
                }
            }
        }

        if (tokens.length === 0) {
            tokens.push({
                start: startOffset,
                length: text.length,
                tokenType: this.mapParserToTokenType(parser),
                tokenModifiers: [],
            });
        }

        return tokens;
    }

    private mapParserToTokenType(parser?: string): string {
        if (!parser) return "variable";

        
        if (parser === "brigadier:string" || parser === "brigadier:text")
            return "string";
        if (
            parser === "brigadier:integer" ||
            parser === "brigadier:float" ||
            parser === "brigadier:double" ||
            parser === "brigadier:long"
        )
            return "number";
        if (parser === "brigadier:bool") return "enumMember";

        
        if (
            parser.startsWith("minecraft:entity") ||
            parser === "minecraft:game_profile"
        )
            return "variable"; 
        if (parser === "minecraft:score_holder") return "variable"; 

        
        if (parser === "minecraft:objective") return "class"; 
        if (parser === "minecraft:objective_criteria") return "enum"; 
        if (parser === "minecraft:team") return "class"; 

        
        if (parser === "minecraft:function") return "method"; 
        if (
            parser === "minecraft:loot_table" ||
            parser === "minecraft:loot_predicate" ||
            parser === "minecraft:loot_modifier"
        )
            return "method"; 
        if (parser === "minecraft:resource_location") return "method"; 

        
        if (
            parser === "minecraft:resource_key" ||
            parser === "minecraft:resource" ||
            parser === "minecraft:resource_or_tag" ||
            parser === "minecraft:resource_or_tag_key" ||
            parser === "minecraft:resource_selector"
        )
            return "type"; 

        
        if (
            parser === "minecraft:block_state" ||
            parser === "minecraft:block_predicate"
        )
            return "type";
        if (
            parser === "minecraft:item_stack" ||
            parser === "minecraft:item_predicate"
        )
            return "type";

        
        if (
            parser === "minecraft:nbt_compound_tag" ||
            parser === "minecraft:nbt_tag"
        )
            return "interface"; 
        if (parser === "minecraft:nbt_path") return "property"; 

        
        if (parser === "minecraft:gamemode") return "enum";
        if (parser === "minecraft:color" || parser === "minecraft:hex_color")
            return "enum";

        
        if (
            parser === "minecraft:block_pos" ||
            parser === "minecraft:column_pos" ||
            parser === "minecraft:vec2" ||
            parser === "minecraft:vec3" ||
            parser === "minecraft:rotation"
        )
            return "number";
        if (
            parser === "minecraft:int_range" ||
            parser === "minecraft:float_range"
        )
            return "number";

        
        if (
            parser === "minecraft:message" ||
            parser === "minecraft:component" ||
            parser === "minecraft:style"
        )
            return "string";

        
        if (parser === "minecraft:dimension") return "namespace";

        
        if (parser === "minecraft:swizzle") return "property";
        if (parser === "minecraft:operation") return "operator";
        if (
            parser === "minecraft:item_slot" ||
            parser === "minecraft:item_slots"
        )
            return "property";
        if (parser === "minecraft:scoreboard_slot") return "property";
        if (parser === "minecraft:time") return "number";

        return "variable";
    }

    private tokenizeWithRanges(
        text: string
    ): { value: string; start: number; length: number }[] {
        const tokens: { value: string; start: number; length: number }[] = [];
        let current = "";
        let startIndex = -1;
        let inString = false;
        let braceDepth = 0;

        for (let i = 0; i < text.length; i++) {
            const c = text[i];

            if (startIndex === -1 && c !== " ") {
                startIndex = i;
            }

            if (c === '"' && text[i - 1] !== "\\\\") {
                inString = !inString;
                current += c;
            } else if (inString) {
                current += c;
            } else if (c === "{" || c === "[") {
                braceDepth++;
                current += c;
            } else if (c === "}" || c === "]") {
                braceDepth--;
                current += c;
            } else if (c === " " && braceDepth === 0) {
                if (current.length > 0) {
                    tokens.push({
                        value: current,
                        start: startIndex,
                        length: current.length,
                    });
                    current = "";
                    startIndex = -1;
                }
            } else {
                if (startIndex !== -1) {
                    
                    current += c;
                }
            }
        }

        if (current.length > 0) {
            tokens.push({
                value: current,
                start: startIndex,
                length: current.length,
            });
        }

        return tokens;
    }

    private fetchJson<T>(url: string, cacheFilename: string): Promise<T> {
        return new Promise((resolve, reject) => {
            if (this.cachePath) {
                const filePath = path.join(this.cachePath, cacheFilename);
                if (fs.existsSync(filePath)) {
                    try {
                        const data = fs.readFileSync(filePath, "utf-8");
                        resolve(JSON.parse(data));
                        return;
                    } catch (e) {
                        
                    }
                }
            }

            https
                .get(url, res => {
                    if (res.statusCode !== 200) {
                        reject(new Error(`Status: ${res.statusCode}`));
                        return;
                    }
                    let data = "";
                    res.on("data", c => (data += c));
                    res.on("end", () => {
                        try {
                            const parsed = JSON.parse(data);
                            resolve(parsed);
                            if (this.cachePath) {
                                try {
                                    fs.mkdirSync(this.cachePath, {
                                        recursive: true,
                                    });
                                    fs.writeFileSync(
                                        path.join(
                                            this.cachePath,
                                            cacheFilename
                                        ),
                                        data
                                    );
                                } catch (e) {}
                            }
                        } catch (e) {
                            reject(e);
                        }
                    });
                })
                .on("error", reject);
        });
    }

    private getFallbackCompletions(command: string): any[] {
        return [];
    }

    getFallbackSemanticTokens(command: string): any[] {
        const tokens: any[] = [];
        const ranges = this.tokenizeWithRanges(command);

        
        for (let i = 0; i < ranges.length; i++) {
            const token = ranges[i];
            let tokenValue = token.value;

            
            if (tokenValue.startsWith("/")) {
                tokenValue = tokenValue.substring(1);
            }

            
            if (i === 0) {
                tokens.push({
                    start: token.start + (token.value.startsWith("/") ? 1 : 0),
                    length: tokenValue.length,
                    tokenType: "keyword", 
                    tokenModifiers: [],
                });
                continue;
            }

            
            if (tokenValue.match(/^@[aeprs](\[.*\])?$/)) {
                const subTokens = this.tokenizeSelector(
                    tokenValue,
                    token.start
                );
                tokens.push(...subTokens);
                continue; 
            } else if (tokenValue.match(/^#?[a-z0-9_.-]+:[a-z0-9_/.:-]+$/)) {
                const parts = tokenValue.split(":");
                tokens.push({
                    start: token.start,
                    length: parts[0].length,
                    tokenType: "method",
                    tokenModifiers: [],
                });
                tokens.push({
                    start: token.start + parts[0].length,
                    length: 1,
                    tokenType: "operator",
                    tokenModifiers: [],
                });
                tokens.push({
                    start: token.start + parts[0].length + 1,
                    length: parts[1].length,
                    tokenType: "method",
                    tokenModifiers: [],
                });
            }
            
            else if (tokenValue.match(/^-?\d+(\.\d+)?[bslfd]?$/i)) {
                tokens.push({
                    start: token.start,
                    length: token.length,
                    tokenType: "number",
                    tokenModifiers: [],
                });
                continue;
            }
            
            else if (
                tokenValue.match(
                    /^(run|as|at|if|unless|store|positioned|rotated|anchored|objectives|players|add|set|remove|get|modify|merge|on|passengers)$/
                )
            ) {
                tokens.push({
                    start: token.start,
                    length: token.length,
                    tokenType: "function",
                    tokenModifiers: [],
                });
            }
            
            else {
                tokens.push({
                    start: token.start,
                    length: token.length,
                    tokenType: "variable",
                    tokenModifiers: [],
                });
            }
        }

        return tokens;
    }
}

let spyglassManager: SpyglassManager | null = null;

export function getSpyglassManager(): SpyglassManager {
    if (!spyglassManager) {
        spyglassManager = new SpyglassManager();
    }
    return spyglassManager;
}
