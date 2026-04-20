import { PddlRange } from "pddl-workspace";
import { Position, Range } from "vscode-languageserver/node";

export function toLspPosition(line: number, character: number): Position {
  return { line, character };
}

export function toLspRange(range: PddlRange): Range {
  return {
    start: toLspPosition(range.start.line, range.start.character),
    end: toLspPosition(range.end.line, range.end.character),
  };
}

export function sameRange(left: Range, right: Range): boolean {
  return (
    left.start.line === right.start.line &&
    left.start.character === right.start.character &&
    left.end.line === right.end.line &&
    left.end.character === right.end.character
  );
}
