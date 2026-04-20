import {
  CompletionItem,
  CompletionItemKind,
  Position,
  TextDocument,
} from "vscode-languageserver/node";
import { DomainInfo, FileInfo, ProblemInfo } from "pddl-workspace";
import { LspPddlWorkspace } from "./pddl-workspace";

const COLON_KEYWORDS = [
  ":requirements",
  ":types",
  ":constants",
  ":predicates",
  ":functions",
  ":constraints",
  ":action",
  ":durative-action",
  ":derived",
  ":parameters",
  ":precondition",
  ":effect",
  ":duration",
  ":objects",
  ":init",
  ":goal",
  ":metric",
  ":domain",
];

const FORM_KEYWORDS = [
  "define",
  "domain",
  "problem",
  "and",
  "or",
  "not",
  "imply",
  "when",
  "forall",
  "exists",
  "either",
  "assign",
  "increase",
  "decrease",
  "scale-up",
  "scale-down",
  "minimize",
  "maximize",
  "at",
  "over",
  "start",
  "end",
];

function pushUnique(
  target: Map<string, CompletionItem>,
  item: CompletionItem,
): void {
  target.set(item.label, item);
}

function extractParameters(linePrefix: string): string[] {
  return [...linePrefix.matchAll(/\?([A-Za-z][\w-]*)/g)].map((match) => match[1]);
}

export async function getCompletionItems(
  workspace: LspPddlWorkspace,
  document: TextDocument,
  position: Position,
): Promise<CompletionItem[]> {
  const fileInfo = workspace.getFileInfo<FileInfo>(document.uri);
  if (!fileInfo) {
    return [];
  }

  const domainInfo = workspace.asDomain(fileInfo);
  const items = new Map<string, CompletionItem>();
  const line = document.getText({
    start: { line: position.line, character: 0 },
    end: position,
  });

  for (const keyword of COLON_KEYWORDS) {
    pushUnique(items, { label: keyword, kind: CompletionItemKind.Keyword });
  }
  for (const keyword of FORM_KEYWORDS) {
    pushUnique(items, { label: keyword, kind: CompletionItemKind.Keyword });
  }

  if (domainInfo) {
    for (const predicate of domainInfo.getPredicates()) {
      pushUnique(items, {
        label: predicate.name,
        detail: predicate.declaredName,
        kind: CompletionItemKind.Function,
      });
    }
    for (const fn of domainInfo.getFunctions()) {
      pushUnique(items, {
        label: fn.name,
        detail: fn.declaredName,
        kind: CompletionItemKind.Function,
      });
    }
    for (const action of domainInfo.getActions()) {
      if (!action.name) continue;
      pushUnique(items, {
        label: action.name,
        kind: CompletionItemKind.Method,
      });
    }
    for (const typeName of domainInfo.getTypes()) {
      pushUnique(items, {
        label: typeName,
        kind: CompletionItemKind.Class,
      });
    }
  }

  if (fileInfo.isProblem()) {
    const problemInfo = fileInfo as ProblemInfo;
    const types = domainInfo?.getTypesInclObject() ?? ["object"];
    for (const typeName of types) {
      for (const objectName of problemInfo.getObjects(typeName)) {
        pushUnique(items, {
          label: objectName,
          detail: typeName,
          kind: CompletionItemKind.Variable,
        });
      }
    }
  }

  for (const parameterName of extractParameters(line)) {
    pushUnique(items, {
      label: `?${parameterName}`,
      kind: CompletionItemKind.Variable,
    });
  }

  return [...items.values()];
}
