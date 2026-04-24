import {
  CodeAction,
  CodeActionKind,
  Diagnostic,
  Range,
  TextDocument,
} from "vscode-languageserver/node";

const SEMANTIC_SOURCE = "pddl-semantic";
const MISSING_REQUIREMENT_PATTERN = /^Missing (:[\w-]+) requirement\b/;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function insertionAt(document: TextDocument, offset: number): Range {
  const position = document.positionAt(offset);
  return { start: position, end: position };
}

function requirementInsertionEdit(
  document: TextDocument,
  requirement: string,
): { range: Range; newText: string } | undefined {
  const text = document.getText();
  const requirementsMatch = /\(:requirements\b[^)]*\)/i.exec(text);
  if (requirementsMatch) {
    const requirementPattern = new RegExp(
      `(^|\\s)${escapeRegExp(requirement)}(?=\\s|\\))`,
      "i",
    );
    if (requirementPattern.test(requirementsMatch[0])) {
      return undefined;
    }

    const closeOffset = requirementsMatch.index + requirementsMatch[0].lastIndexOf(")");
    return {
      range: insertionAt(document, closeOffset),
      newText: ` ${requirement}`,
    };
  }

  const headerMatch = /\(define\s+\((?:domain|problem)\s+[^)]+\)/i.exec(text);
  if (!headerMatch) {
    return undefined;
  }

  return {
    range: insertionAt(document, headerMatch.index + headerMatch[0].length),
    newText: `\n  (:requirements ${requirement})`,
  };
}

function requirementFromDiagnostic(diagnostic: Diagnostic): string | undefined {
  if (diagnostic.source !== SEMANTIC_SOURCE) {
    return undefined;
  }

  return MISSING_REQUIREMENT_PATTERN.exec(diagnostic.message)?.[1];
}

export function getCodeActions(
  document: TextDocument,
  diagnostics: Diagnostic[],
): CodeAction[] {
  const actions: CodeAction[] = [];
  const seen = new Set<string>();

  for (const diagnostic of diagnostics) {
    const requirement = requirementFromDiagnostic(diagnostic);
    if (!requirement || seen.has(requirement)) {
      continue;
    }

    const edit = requirementInsertionEdit(document, requirement);
    if (!edit) {
      continue;
    }

    seen.add(requirement);
    actions.push({
      title: `Add ${requirement} requirement`,
      kind: CodeActionKind.QuickFix,
      diagnostics: [diagnostic],
      edit: {
        changes: {
          [document.uri]: [edit],
        },
      },
    });
  }

  return actions;
}
