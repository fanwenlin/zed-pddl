import { DocumentLink, Range, TextDocument } from "vscode-languageserver/node";
import { FileInfo, ProblemInfo } from "pddl-workspace";
import { LspPddlWorkspace } from "./pddl-workspace";

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function domainReferenceRange(
  document: TextDocument,
  domainName: string,
): Range | undefined {
  const text = document.getText();
  const pattern = new RegExp(
    `\\(:domain\\s+(${escapeRegExp(domainName)})(?=[\\s\\)])`,
    "i",
  );
  const match = pattern.exec(text);
  if (!match || match.index === undefined) {
    return undefined;
  }

  const start = match.index + match[0].lastIndexOf(match[1]);
  const end = start + match[1].length;
  return {
    start: document.positionAt(start),
    end: document.positionAt(end),
  };
}

export function getDocumentLinks(
  workspace: LspPddlWorkspace,
  document: TextDocument,
): DocumentLink[] {
  const fileInfo = workspace.getFileInfo<FileInfo>(document.uri);
  if (!fileInfo?.isProblem()) {
    return [];
  }

  const problemInfo = fileInfo as ProblemInfo;
  const domainInfo = workspace.getDomainFileFor(problemInfo);
  if (!domainInfo) {
    return [];
  }

  const range = domainReferenceRange(document, problemInfo.domainName);
  if (!range) {
    return [];
  }

  return [{ range, target: domainInfo.fileUri.toString() }];
}
