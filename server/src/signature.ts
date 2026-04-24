import {
  Position,
  SignatureHelp,
  SignatureInformation,
  TextDocument,
} from "vscode-languageserver/node";
import { DomainInfo, FileInfo, Variable } from "pddl-workspace";
import { LspPddlWorkspace } from "./pddl-workspace";

function callableNameAtPosition(
  document: TextDocument,
  position: Position,
): string | undefined {
  const text = document.getText();
  const offset = document.offsetAt(position);

  for (let index = offset - 1, depth = 0; index >= 0; index--) {
    const char = text[index];
    if (char === ")") {
      depth++;
      continue;
    }
    if (char !== "(") {
      continue;
    }
    if (depth > 0) {
      depth--;
      continue;
    }

    const match = text.slice(index + 1, offset).match(/^\s*([A-Za-z_][A-Za-z0-9_-]*)/);
    return match?.[1];
  }

  return undefined;
}

function variableSignature(variable: Variable): SignatureInformation {
  return {
    label: `(${variable.declaredName})`,
    parameters: variable.parameters.map((parameter) => ({
      label: parameter.toPddlString(),
    })),
  };
}

function findCallable(domainInfo: DomainInfo, callableName: string): Variable | undefined {
  return [...domainInfo.getPredicates(), ...domainInfo.getFunctions()].find((candidate) =>
    candidate.matchesShortNameCaseInsensitive(callableName),
  );
}

export function getSignatureHelp(
  workspace: LspPddlWorkspace,
  document: TextDocument,
  position: Position,
): SignatureHelp | null {
  const fileInfo = workspace.getFileInfo<FileInfo>(document.uri);
  if (!fileInfo) {
    return null;
  }

  const domainInfo = workspace.asDomain(fileInfo);
  if (!domainInfo) {
    return null;
  }

  const callableName = callableNameAtPosition(document, position);
  if (!callableName) {
    return null;
  }

  const callable = findCallable(domainInfo, callableName);
  if (!callable) {
    return null;
  }

  return {
    signatures: [variableSignature(callable)],
    activeSignature: 0,
    activeParameter: 0,
  };
}
