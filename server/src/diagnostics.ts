import { parsePddlDocument, PddlSyntaxError } from "@zed-pddl/antlr-pddl-ts";
import {
  Diagnostic,
  DiagnosticSeverity,
  TextDocument,
} from "vscode-languageserver/node";
import { ParsingProblem } from "pddl-workspace";

function pddlWorkspaceDiagnostic(problem: ParsingProblem): Diagnostic {
  const severityMap: Record<string, DiagnosticSeverity> = {
    error: DiagnosticSeverity.Error,
    warning: DiagnosticSeverity.Warning,
    info: DiagnosticSeverity.Information,
    hint: DiagnosticSeverity.Hint,
  };

  return {
    range: {
      start: {
        line: problem.range.start.line,
        character: problem.range.start.character,
      },
      end: {
        line: problem.range.end.line,
        character: problem.range.end.character,
      },
    },
    message: problem.problem,
    severity: severityMap[problem.severity] ?? DiagnosticSeverity.Error,
    source: "pddl-lsp",
  };
}

function antlrDiagnostic(error: PddlSyntaxError, document: TextDocument): Diagnostic {
  const line = Math.max(0, error.line - 1);
  const lineText = document.getText({
    start: { line, character: 0 },
    end: { line: line + 1, character: 0 },
  });
  const character = Math.max(0, error.column);
  const endCharacter = Math.min(
    Math.max(character + 1, lineText.replace(/\r?\n$/, "").length),
    character + 1,
  );

  return {
    range: {
      start: { line, character },
      end: { line, character: endCharacter },
    },
    message: error.message,
    severity: DiagnosticSeverity.Error,
    source: "antlr-pddl-ts",
  };
}

export function getAntlrSyntaxDiagnostics(document: TextDocument): Diagnostic[] {
  return parsePddlDocument(document.getText()).syntaxErrors.map((error) =>
    antlrDiagnostic(error, document),
  );
}

export function getPddlWorkspaceDiagnostics(
  problems: ParsingProblem[],
): Diagnostic[] {
  return problems.map(pddlWorkspaceDiagnostic);
}
