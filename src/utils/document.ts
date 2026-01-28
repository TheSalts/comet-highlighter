import * as vscode from "vscode";
import { Lexer } from "../lexer/lexer";
import { Parser, ParseError } from "../parser/parser";
import { Program } from "../parser/ast";
import { Scope, ScopeAnalyzer } from "../analysis/scope";

export interface ParseResult {
    program: Program;
    scope: Scope;
    errors: ParseError[];
    comments: any[]; 
    version: number;
}

export class DocumentManager {
    private cache: Map<string, ParseResult> = new Map();

    parse(document: vscode.TextDocument): ParseResult {
        const uri = document.uri.toString();
        const version = document.version;

        
        const cached = this.cache.get(uri);
        if (cached && cached.version === version) {
            return cached;
        }

        
        const text = document.getText();
        const lexer = new Lexer(text);
        const tokens = lexer.tokenize();

        const parser = new Parser(tokens);
        const program = parser.parse();
        const errors = parser.getErrors();

        const scopeAnalyzer = new ScopeAnalyzer();
        const scope = scopeAnalyzer.analyze(program);

        const result: ParseResult = {
            program,
            scope,
            errors,
            comments: parser.comments, 
            version,
        };

        
        this.cache.set(uri, result);

        return result;
    }

    clear(document: vscode.TextDocument): void {
        this.cache.delete(document.uri.toString());
    }

    clearAll(): void {
        this.cache.clear();
    }
}
