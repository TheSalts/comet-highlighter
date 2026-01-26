import * as vscode from 'vscode';
import { Lexer } from '../lexer/lexer';
import { Parser } from '../parser/parser';
import { Program } from '../parser/ast';
import { Scope, ScopeAnalyzer } from '../analysis/scope';

export interface ParseResult {
  program: Program;
  scope: Scope;
  errors: string[];
  version: number;
}

export class DocumentManager {
  private cache: Map<string, ParseResult> = new Map();

  parse(document: vscode.TextDocument): ParseResult {
    const uri = document.uri.toString();
    const version = document.version;

    // Check cache
    const cached = this.cache.get(uri);
    if (cached && cached.version === version) {
      return cached;
    }

    // Parse document
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
      version,
    };

    // Update cache
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
