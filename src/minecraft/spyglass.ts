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

export class SpyglassManager {
    private initialized = false;
    private commandTree: CommandTree | null = null;
    private registries: RegistryData = {};
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
        "minecraft:dimension": "dimension_type",
        "minecraft:game_profile": "", // No registry
        "minecraft:score_holder": "", // Special handling
        "minecraft:resource_location": "", // Context dependent, usually generic
        "minecraft:function": "function", // Not a real registry in spyglass dump usually, but handled
        "minecraft:time": "",
        "minecraft:uuid": "",
        "minecraft:color": "",
        "minecraft:swizzle": "",
        "minecraft:team": "", // Dynamic
        "minecraft:objective": "", // Dynamic
    };

    // Parsers that carry properties.registry (1.21.11+)
    private static readonly REGISTRY_PROPERTY_PARSERS = new Set([
        "minecraft:resource_key",
        "minecraft:resource",
        "minecraft:resource_or_tag",
        "minecraft:resource_or_tag_key",
        "minecraft:resource_selector",
    ]);

    // How many space-separated tokens a parser consumes
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
            console.log(`Fetching Spyglass data for MC ${ver}...`);
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
            console.log(`Spyglass data for ${apiVersion} loaded successfully`);
        } catch (error) {
            console.warn(
                `Failed to fetch Spyglass data for ${apiVersion}, trying fallback to 1.21.1:`,
                error
            );
            try {
                // Fallback to known stable version
                const fallbackVersion = "1.21.1";
                const [commands, registries] = await fetchData(fallbackVersion);
                this.commandTree = commands;
                this.registries = registries;
                this.initialized = true;
                console.log(
                    `Spyglass fallback data (${fallbackVersion}) loaded successfully`
                );
            } catch (fallbackError) {
                console.warn(
                    "Failed to fetch fallback Spyglass data:",
                    fallbackError
                );
                this.initialized = false;
            }
        }
    }

    isInitialized(): boolean {
        return this.initialized;
    }

    getCommandCompletions(command: string, cursorOffset: number): any[] {
        if (!this.initialized || !this.commandTree) {
            return this.getFallbackCompletions(command);
        }

        // Handle leading slash or execute run
        const cleanCommand = command.startsWith("/")
            ? command.substring(1)
            : command;
        const offsetAdjustment = command.startsWith("/") ? 1 : 0;
        const effectiveOffset = cursorOffset - offsetAdjustment;

        if (effectiveOffset < 0) return []; // Cursor was on list slash?

        // Check for selector context manually
        const selectorMatch = cleanCommand
            .substring(0, effectiveOffset)
            .match(/(@[a-z])\[([^\]]*)$/);
        if (selectorMatch) {
            const selectorContent = selectorMatch[2];
            const items: any[] = [];

            // Check if we are in a value or a key
            // Split by commas, take last
            const parts = selectorContent.split(",");
            const lastPart = parts[parts.length - 1].trim();

            if (lastPart.includes("=")) {
                // Value completion
                const [key, val] = lastPart.split("=").map(s => s.trim());
                if (key === "type") {
                    this.addRegistryCompletions(
                        items,
                        "entity_type",
                        val,
                        new Set()
                    );
                    // Negative types
                    this.addRegistryCompletions(
                        items,
                        "entity_type",
                        val.replace("!", ""),
                        new Set(),
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
                } else if (key === "sort") {
                    ["nearest", "furthest", "random", "arbitrary"].forEach(
                        m => {
                            if (m.startsWith(val))
                                items.push({
                                    label: m,
                                    kind: vscode.CompletionItemKind.EnumMember,
                                });
                        }
                    );
                    return items;
                }
            } else {
                // Key completion
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

        // Tokenize partial input
        const tokens = this.tokenize(textBeforeCursor.trim());
        // Simple logic: if the textBeforeCursor ends with space, we are looking for the NEXT token.
        // If it doesn't end with space, we are completing the CURRENT token.
        const isNewToken = textBeforeCursor.endsWith(" ");

        const completedArgs = isNewToken ? tokens : tokens.slice(0, -1);
        const currentInput = isNewToken ? "" : tokens[tokens.length - 1] || "";

        // Traverse to find possible next nodes
        const { nodes: contextNodes, midCoord } = this.traverse(
            this.commandTree,
            completedArgs
        );

        const items: any[] = [];
        const seenLabels = new Set<string>();

        // If we are mid-way through a multi-token coordinate argument,
        // offer coordinate completions (individual axis values) instead of
        // normal children completions.
        if (midCoord > 0) {
            this.addSingleCoordinateCompletions(
                items,
                currentInput,
                seenLabels
            );
            return items;
        }

        // Check for NBT context in currentInput
        if (currentInput.includes("{")) {
            const nbtMatch = currentInput.match(/^([a-z0-9_.:]+)(\{.*)$/);
            if (nbtMatch) {
                const id = nbtMatch[1];
                const nbtContent = nbtMatch[2];
                // Check if cursor is inside braces
                // We crudely assume yes if we are here, but strictly we should check cursorOffset relative to token start.
                // For now, let's try to provide NBT completions if we can resolve the ID.

                // Determine category based on contextNodes?
                // Hard to know exact category (block vs item) just from string, but usually it's item or block.
                // Let's try item first, then block, then entity?
                // Or check the node parser?

                let category: "item" | "block" | "entity" | null = null;
                for (const node of contextNodes) {
                    for (const child of Object.values(node.children || {})) {
                        if (child.type === "argument" && child.parser) {
                            if (
                                child.parser === "minecraft:item_stack" ||
                                child.parser === "minecraft:item_predicate"
                            )
                                category = "item";
                            else if (
                                child.parser === "minecraft:block_state" ||
                                child.parser === "minecraft:block_predicate"
                            )
                                category = "block";
                            else if (child.parser === "minecraft:entity_summon")
                                category = "entity";
                            // New-style resource parsers with properties.registry
                            else if (
                                SpyglassManager.REGISTRY_PROPERTY_PARSERS.has(
                                    child.parser
                                ) &&
                                child.properties?.registry
                            ) {
                                const reg = child.properties.registry as string;
                                if (reg.includes("item")) category = "item";
                                else if (reg.includes("block"))
                                    category = "block";
                                else if (reg.includes("entity"))
                                    category = "entity";
                            }
                        }
                    }
                }

                if (!category && id.includes("minecraft:chest"))
                    category = "block"; // heuristic

                if (category) {
                    const mcdoc = getMcdocManager(); // Need import
                    const symbol = mcdoc.findSymbol(category, id);
                    if (symbol) {
                        // We are inside NBT, we probably want fields.
                        // But we need to know WHERE in NBT.
                        // Simple case: top level fields.
                        // If nbtContent is `{Di`, we want fields starting with Di.

                        const nbtinside = nbtContent.substring(1); // after {
                        // We need a proper NBT parser or at least split by comma to find current key
                        // Crude approach: take last split by comma
                        const parts = nbtinside.split(",");
                        const lastPart = parts[parts.length - 1].trim();
                        // If lastPart contains ':', it might be key:value. we don't complete values yet (except maybe enums)
                        if (!lastPart.includes(":")) {
                            const complications = mcdoc.getCompletions(symbol);
                            for (const comp of complications) {
                                if (
                                    comp.label.toString().startsWith(lastPart)
                                ) {
                                    items.push(comp);
                                }
                            }
                            return items; // Return mostly these
                        }
                    }
                }
            }
        }

        for (const node of contextNodes) {
            if (!node.children) continue;

            for (const [key, child] of Object.entries(node.children)) {
                if (child.type === "literal") {
                    // Suggest literal if it matches current input
                    if (key.startsWith(currentInput) && !seenLabels.has(key)) {
                        items.push({
                            label: key,
                            kind: vscode.CompletionItemKind.Keyword,
                            detail: "Literal",
                            sortText: "0_" + key, // Prioritize literals
                        });
                        seenLabels.add(key);
                    }
                } else if (child.type === "argument") {
                    // Suggest argument values
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

        // 1. New-style parsers with properties.registry (1.21.11+)
        if (SpyglassManager.REGISTRY_PROPERTY_PARSERS.has(parser)) {
            const reg: string | undefined = node.properties?.registry;
            if (reg) {
                // Strip "minecraft:" prefix to match registry data keys
                const key = reg.replace(/^minecraft:/, "");
                if (this.registries[key]) return key;
            }
            return undefined;
        }

        // 2. Direct parser → registry map
        const mapped = this.registryMap[parser];
        if (mapped && this.registries[mapped]) return mapped;

        // 3. Fallback: strip namespace from parser name
        if (mapped === undefined && parser.includes(":")) {
            const bareKey = parser.split(":")[1];
            if (this.registries[bareKey]) return bareKey;
        }

        // 4. resource_location heuristic by argument name
        if (parser === "minecraft:resource_location") {
            const heuristic = this.resourceLocationRegistryMap[nodeName];
            if (heuristic && this.registries[heuristic]) return heuristic;
        }

        // 5. Dedicated loot/function parsers
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

        // Full coordinate snippets
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

        // Also offer single axis starters
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

        // Coordinate parsers get special completions
        if (SpyglassManager.isCoordinateParser(parser)) {
            this.addCoordinateCompletions(
                items,
                parser,
                currentInput,
                seenLabels
            );
            return;
        }

        // Try to resolve a registry key from the node
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

            // For tag parsers, also suggest tag entries with # prefix
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

        // Special handling for parsers without registry
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
            // Generic resource_location without a resolved registry
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

    /**
     * Traverse the command tree consuming args.
     * Returns { nodes, midCoord } where midCoord > 0 means we are
     * partway through a multi-token coordinate argument and still
     * need midCoord more tokens before advancing to the next node.
     */
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
                // Exiting mid-way through a multi-token argument
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
        let braceDepth = 0; // simple tracking

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
                    // Start of NBT after space
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
        if (!this.initialized || !this.commandTree) return [];

        // Simple tokenization retaining range info
        const ranges = this.tokenizeWithRanges(command);
        const semanticTokens: any[] = [];

        // We use a simplified traversal that greedily matches literals
        let currentNodes: CommandNode[] = [this.commandTree];
        let tokenIndex = 0;

        while (tokenIndex < ranges.length) {
            const token = ranges[tokenIndex];
            const nextNodes: CommandNode[] = [];
            let matchedNode: CommandNode | null = null;
            let matchType = "variable";

            let tokenValue = token.value;
            if (tokenValue.startsWith("/"))
                tokenValue = tokenValue.substring(1);

            let foundLiteral = false;

            // 1. Try to find literal match first
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
                    matchType = "function"; // Literal command parts
                    foundLiteral = true;
                    break;
                }
            }

            if (!foundLiteral) {
                // 2. If not literal, any argument node is a candidate
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
                currentNodes = nextNodes;
                const parser = matchedNode.parser;

                // MULTI-TOKEN COORDINATE PARSERS
                if (parser && SpyglassManager.isCoordinateParser(parser)) {
                    const count = SpyglassManager.getParserTokenCount(parser);
                    // Highlight this token + next (count-1) tokens as "number"
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
                    continue; // skip the tokenIndex++ at bottom
                }

                // SPECIAL HANDLING FOR COMPLEX ARGUMENTS
                if (
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
                        SpyglassManager.REGISTRY_PROPERTY_PARSERS.has(parser))
                ) {
                    const subTokens = this.parseComplexArgument(
                        token.value,
                        token.start,
                        parser
                    );
                    semanticTokens.push(...subTokens);
                } else {
                    // Default handling
                    semanticTokens.push({
                        start: token.start,
                        length: token.length,
                        tokenType: matchType,
                        tokenModifiers: [],
                    });
                }
            } else {
                // No match found in tree, stop or mark rest as error/generic
                break;
            }

            tokenIndex++;
        }

        return semanticTokens;
    }

    // ── NBT tokenizer (recursive descent) ──────────────────────────

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
            const q = text[pos++]; // opening quote
            while (pos < text.length && text[pos] !== q) {
                if (text[pos] === "\\") pos++;
                pos++;
            }
            if (pos < text.length) pos++; // closing quote
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
                emit(start, ci, "namespace");
                emit(start + ci, 1, "operator");
                emit(start + ci + 1, word.length - ci - 1, "function");
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
            emit(pos, 1, "operator"); // {
            pos++;
            skipWs();

            while (pos < text.length && text[pos] !== "}") {
                skipWs();
                if (pos >= text.length || text[pos] === "}") break;

                // key
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

                // colon
                if (at(":")) {
                    emit(pos, 1, "operator");
                    pos++;
                }

                // value
                readValue();

                skipWs();
                if (at(",")) {
                    emit(pos, 1, "operator");
                    pos++;
                }
            }

            if (at("}")) {
                emit(pos, 1, "operator");
                pos++;
            }
        };

        const readList = () => {
            emit(pos, 1, "operator"); // [
            pos++;
            skipWs();

            // Typed array prefix: B; I; L;
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
                skipWs();
                if (pos >= text.length || text[pos] === "]") break;

                readValue();

                skipWs();
                if (at(",")) {
                    emit(pos, 1, "operator");
                    pos++;
                }
            }

            if (at("]")) {
                emit(pos, 1, "operator");
                pos++;
            }
        };

        // entry
        skipWs();
        if (pos < text.length) readValue();

        return tokens;
    }

    // ── Block-state tokenizer  [key=value,key2=value2] ───────────

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
                // key
                const ks = pos;
                while (pos < text.length && /[a-z_]/.test(text[pos])) pos++;
                if (pos > ks) emit(ks, pos - ks, "property");

                if (pos < text.length && text[pos] === "=") {
                    emit(pos, 1, "operator");
                    pos++;
                }

                // value
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

    // ── NBT-path tokenizer  (Items[0].id, {a:1}.b) ──────────────

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
                // compound filter – delegate to NBT tokenizer
                const sub = text.substring(pos);
                // find matching }
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
                // index or compound filter
                if (pos < text.length && text[pos] === "{") {
                    // compound filter inside []
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
                    // numeric index
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
                // key segment
                const ks = pos;
                while (pos < text.length && /[a-zA-Z0-9_]/.test(text[pos]))
                    pos++;
                if (pos > ks) emit(ks, pos - ks, "property");
                if (pos === ks) pos++; // safety advance
            }
        }

        return tokens;
    }

    // ── Resource-ID suffix: [block-state]{nbt} ───────────────────

    private tokenizeIdSuffix(text: string, baseOffset: number): any[] {
        const tokens: any[] = [];
        let pos = 0;

        // Block state: [key=value,...]
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

        // NBT: {compound}
        if (pos < text.length && text[pos] === "{") {
            const nbtSlice = text.substring(pos);
            tokens.push(...this.tokenizeNbt(nbtSlice, baseOffset + pos));
        }

        return tokens;
    }

    // ── Entity selector tokenizer  @e[key=value,key2=value2] ───

    private tokenizeSelector(text: string, baseOffset: number): any[] {
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

        // @e
        if (pos + 1 < text.length && text[pos] === "@") {
            emit(pos, 2, "keyword");
            pos += 2;
        } else {
            // player name or UUID
            emit(0, text.length, "variable");
            return tokens;
        }

        // [...]
        if (pos >= text.length || text[pos] !== "[") return tokens;

        emit(pos, 1, "operator"); // [
        pos++;

        while (pos < text.length && text[pos] !== "]") {
            // key
            const keyStart = pos;
            while (pos < text.length && /[a-z_]/.test(text[pos])) pos++;
            if (pos > keyStart) emit(keyStart, pos - keyStart, "property");

            // =
            if (pos < text.length && text[pos] === "=") {
                emit(pos, 1, "operator");
                pos++;
            }

            // ! (negation)
            if (pos < text.length && text[pos] === "!") {
                emit(pos, 1, "operator");
                pos++;
            }

            // value
            const valueStart = pos;

            if (pos < text.length && text[pos] === "{") {
                // NBT compound
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
                // Quoted string
                const q = text[pos++];
                while (pos < text.length && text[pos] !== q) {
                    if (text[pos] === "\\") pos++;
                    pos++;
                }
                if (pos < text.length) pos++;
                emit(valueStart, pos - valueStart, "string");
            } else {
                // Unquoted value: read until , or ]
                while (
                    pos < text.length &&
                    text[pos] !== "," &&
                    text[pos] !== "]"
                ) {
                    pos++;
                }
                const valueText = text.substring(valueStart, pos);

                // Classify the value
                if (valueText.includes("..")) {
                    // Range: ..10, 5..10, 5..
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
                    // Number
                    emit(valueStart, valueText.length, "number");
                } else if (valueText === "true" || valueText === "false") {
                    // Boolean
                    emit(valueStart, valueText.length, "enumMember");
                } else if (valueText.includes(":")) {
                    // Resource location
                    const ci = valueText.indexOf(":");
                    emit(valueStart, ci, "namespace");
                    emit(valueStart + ci, 1, "operator");
                    emit(
                        valueStart + ci + 1,
                        valueText.length - ci - 1,
                        "function"
                    );
                } else {
                    // Generic string value (tag names, etc.)
                    emit(valueStart, valueText.length, "string");
                }
            }

            // ,
            if (pos < text.length && text[pos] === ",") {
                emit(pos, 1, "operator");
                pos++;
            }
        }

        // ]
        if (pos < text.length && text[pos] === "]") {
            emit(pos, 1, "operator");
            pos++;
        }

        return tokens;
    }

    // ── Main complex argument dispatcher ─────────────────────────

    private parseComplexArgument(
        text: string,
        startOffset: number,
        parser: string
    ): any[] {
        const tokens: any[] = [];

        if (
            parser.includes("entity") ||
            parser === "minecraft:score_holder" ||
            parser === "minecraft:game_profile"
        ) {
            // Parse Selector: @e[type=cow,distance=..10]
            return this.tokenizeSelector(text, startOffset);
        } else if (
            parser === "minecraft:nbt_compound_tag" ||
            parser === "minecraft:nbt_tag"
        ) {
            // Standalone NBT argument (e.g. /data merge ... {key:value})
            return this.tokenizeNbt(text, startOffset);
        } else if (parser === "minecraft:nbt_path") {
            // NBT path (e.g. Items[0].id, {a:1}.b)
            return this.tokenizeNbtPath(text, startOffset);
        } else if (
            parser === "minecraft:resource_location" ||
            parser === "minecraft:block_state" ||
            parser === "minecraft:block_predicate" ||
            parser === "minecraft:item_stack" ||
            parser === "minecraft:item_predicate" ||
            SpyglassManager.REGISTRY_PROPERTY_PARSERS.has(parser)
        ) {
            // namespace:path  or  #namespace:path  or  path{nbt}  or  path[state]{nbt}
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
                if (parts.length > 1) {
                    tokens.push({
                        start: idStart,
                        length: parts[0].length,
                        tokenType: "namespace",
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
                        tokenType: "function",
                        tokenModifiers: [],
                    });
                } else {
                    tokens.push({
                        start: idStart,
                        length: id.length,
                        tokenType: "function",
                        tokenModifiers: [],
                    });
                }

                // Suffix: [block-state]{nbt}
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
            parser === "minecraft:score_holder" ||
            parser === "minecraft:game_profile"
        )
            return "variable";
        if (parser === "minecraft:resource_location") return "property";
        if (
            parser === "minecraft:resource_key" ||
            parser === "minecraft:resource" ||
            parser === "minecraft:resource_or_tag" ||
            parser === "minecraft:resource_or_tag_key" ||
            parser === "minecraft:resource_selector"
        )
            return "property";
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
            parser === "minecraft:message" ||
            parser === "minecraft:component" ||
            parser === "minecraft:style"
        )
            return "string";
        if (parser === "minecraft:swizzle") return "property";
        if (parser === "minecraft:gamemode") return "enumMember";
        if (parser === "minecraft:color" || parser === "minecraft:hex_color")
            return "enumMember";
        if (
            parser === "minecraft:int_range" ||
            parser === "minecraft:float_range"
        )
            return "number";
        if (
            parser === "minecraft:block_pos" ||
            parser === "minecraft:column_pos" ||
            parser === "minecraft:vec2" ||
            parser === "minecraft:vec3" ||
            parser === "minecraft:rotation"
        )
            return "number";
        if (
            parser === "minecraft:nbt_compound_tag" ||
            parser === "minecraft:nbt_tag" ||
            parser === "minecraft:nbt_path"
        )
            return "property";
        if (
            parser === "minecraft:loot_table" ||
            parser === "minecraft:loot_predicate" ||
            parser === "minecraft:loot_modifier"
        )
            return "property";
        if (parser === "minecraft:function") return "function";
        if (
            parser === "minecraft:objective" ||
            parser === "minecraft:objective_criteria"
        )
            return "variable";
        if (parser === "minecraft:team") return "variable";
        if (parser === "minecraft:time") return "number";
        if (
            parser === "minecraft:item_slot" ||
            parser === "minecraft:item_slots"
        )
            return "property";
        if (parser === "minecraft:dimension") return "namespace";
        if (parser === "minecraft:operation") return "operator";
        if (parser === "minecraft:scoreboard_slot") return "property";
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
                    // Only add if we started a token
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
                        // ignore
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
}

let spyglassManager: SpyglassManager | null = null;

export function getSpyglassManager(): SpyglassManager {
    if (!spyglassManager) {
        spyglassManager = new SpyglassManager();
    }
    return spyglassManager;
}
