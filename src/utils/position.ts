import * as vscode from 'vscode';

export interface Position {
  line: number;      // 0-based
  character: number; // 0-based
}

export interface Range {
  start: Position;
  end: Position;
}

export function createPosition(line: number, character: number): Position {
  return { line, character };
}

export function createRange(startLine: number, startChar: number, endLine: number, endChar: number): Range {
  return {
    start: createPosition(startLine, startChar),
    end: createPosition(endLine, endChar),
  };
}

export function containsPosition(range: Range, position: Position): boolean {
  if (position.line < range.start.line || position.line > range.end.line) {
    return false;
  }
  if (position.line === range.start.line && position.character < range.start.character) {
    return false;
  }
  if (position.line === range.end.line && position.character > range.end.character) {
    return false;
  }
  return true;
}

export function comparePosition(a: Position, b: Position): number {
  if (a.line !== b.line) {
    return a.line - b.line;
  }
  return a.character - b.character;
}

export function rangeToVscodeRange(range: Range): vscode.Range {
  return new vscode.Range(
    range.start.line,
    range.start.character,
    range.end.line,
    range.end.character
  );
}

export function vscodeRangeToRange(range: vscode.Range): Range {
  return {
    start: {
      line: range.start.line,
      character: range.start.character,
    },
    end: {
      line: range.end.line,
      character: range.end.character,
    },
  };
}

export function positionToVscodePosition(position: Position): vscode.Position {
  return new vscode.Position(position.line, position.character);
}

export function vscodePositionToPosition(position: vscode.Position): Position {
  return {
    line: position.line,
    character: position.character,
  };
}
