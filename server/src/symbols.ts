import {
  Action,
  DomainInfo,
  FileInfo,
  ModelHierarchy,
  PddlRange,
  ProblemInfo,
  Variable,
  parser,
} from "pddl-workspace";
import {
  DocumentSymbol,
  Hover,
  Location,
  MarkupKind,
  Position,
  Range,
  SymbolKind,
  TextDocument,
  WorkspaceEdit,
  TextEdit,
} from "vscode-languageserver/node";
import { LspPddlWorkspace } from "./pddl-workspace";
import { sameRange, toLspRange } from "./conversion";

interface WordOnPositionContext {
  before: string;
  word: string;
  after: string;
  line: string;
  range: Range;
}

class DocSymbol {
  constructor(
    readonly name: string,
    readonly range: Range,
    readonly line: string,
  ) {}

  isPrefixedBy(prefix: string): boolean {
    return this.line.substring(0, this.range.start.character).endsWith(prefix);
  }
}

class ResolvedSymbol {
  constructor(
    readonly hover: Hover,
    readonly location: Location,
  ) {}
}

class VariableInfo extends ResolvedSymbol {
  constructor(
    hover: Hover,
    location: Location,
    readonly variable: Variable,
  ) {
    super(hover, location);
  }
}

class TypeInfo extends ResolvedSymbol {
  constructor(
    hover: Hover,
    location: Location,
    readonly typeName: string,
  ) {
    super(hover, location);
  }
}

class ActionInfo extends ResolvedSymbol {
  constructor(
    hover: Hover,
    location: Location,
    readonly action: Action,
  ) {
    super(hover, location);
  }
}

class ParameterInfo extends ResolvedSymbol {
  constructor(
    hover: Hover,
    location: Location,
    readonly scopeNode: parser.PddlSyntaxNode,
    readonly name: string,
  ) {
    super(hover, location);
  }
}

function toLocation(uri: string, range: PddlRange): Location {
  return { uri, range: toLspRange(range) };
}

function nodeToRange(
  document: TextDocument,
  node: parser.PddlSyntaxNode,
): Range {
  return {
    start: document.positionAt(node.getStart()),
    end: document.positionAt(node.getEnd()),
  };
}

function createHover(
  title: string | undefined,
  symbolName: string,
  documentation: string[],
  range: Range,
): Hover {
  const parts = [title ? `**${title}**` : "", "```pddl", symbolName, "```"]
    .filter(Boolean)
    .join("\n");
  const docs = documentation.length ? `\n\n${documentation.join("\n\n")}` : "";
  return {
    contents: {
      kind: MarkupKind.Markdown,
      value: `${parts}${docs}`,
    },
    range,
  };
}

function createActionHover(action: Action, range: Range): Hover {
  const label = action.isDurative() ? "Durative Action" : "Action";
  const parameters = action.parameters.length
    ? `\n\nParameters:\n${action.parameters
        .map((parameter) => `- \`${parameter.toPddlString()}\``)
        .join("\n")}`
    : "";
  const docs = action.getDocumentation().length
    ? `\n\n${action.getDocumentation().join("\n\n")}`
    : "";

  return {
    contents: {
      kind: MarkupKind.Markdown,
      value: `**${label}**\n\n\`\`\`pddl\n${action.name ?? ""}\n\`\`\`${parameters}${docs}`,
    },
    range,
  };
}

function getWordAtDocumentPosition(
  document: TextDocument,
  position: Position,
): WordOnPositionContext | undefined {
  const lines = document.getText().split(/\r?\n/);
  const line = lines[position.line];
  if (line === undefined) {
    return undefined;
  }

  const before = line.slice(0, position.character);
  const after = line.slice(position.character);
  const leadingMatch = before.match(/[\w-]+$/);
  const trailingMatch = after.match(/^[\w-]+/);
  const left = leadingMatch?.[0] ?? "";
  const right = trailingMatch?.[0] ?? "";
  const word = left + right;

  if (!word) {
    return undefined;
  }

  return {
    before: line.slice(0, position.character - left.length),
    word,
    after: line.slice(position.character + right.length),
    line,
    range: {
      start: { line: position.line, character: position.character - left.length },
      end: { line: position.line, character: position.character + right.length },
    },
  };
}

function getSymbolAtPosition(
  document: TextDocument,
  position: Position,
): DocSymbol | undefined {
  const wordContext = getWordAtDocumentPosition(document, position);
  if (!wordContext || wordContext.before.includes(";")) {
    return undefined;
  }

  return new DocSymbol(wordContext.word, wordContext.range, wordContext.line);
}

function parameterReferenceLocations(
  scopeNode: parser.PddlSyntaxNode,
  parameterName: string,
  document: TextDocument,
): Location[] {
  const matches: Location[] = [];
  scopeNode.getChildrenRecursively(
    (node) =>
      node.isType(parser.PddlTokenType.Parameter) &&
      node.getToken().tokenText === `?${parameterName}`,
    (node) => {
      matches.push({ uri: document.uri, range: nodeToRange(document, node) });
    },
  );
  return matches;
}

export async function resolveSymbol(
  workspace: LspPddlWorkspace,
  document: TextDocument,
  position: Position,
): Promise<ResolvedSymbol | undefined> {
  const fileInfo = workspace.getFileInfo<FileInfo>(document.uri);
  if (!fileInfo) {
    return undefined;
  }

  const domainInfo = workspace.asDomain(fileInfo);
  if (!domainInfo) {
    return undefined;
  }

  const symbol = getSymbolAtPosition(document, position);
  if (!symbol) {
    return undefined;
  }

  if (symbol.isPrefixedBy("(")) {
    const predicate = domainInfo
      .getPredicates()
      .find((candidate) => candidate.matchesShortNameCaseInsensitive(symbol.name));
    if (predicate?.getLocation()) {
      return new VariableInfo(
        createHover(
          "Predicate",
          `(${predicate.declaredName})`,
          predicate.getDocumentation(),
          symbol.range,
        ),
        toLocation(domainInfo.fileUri.toString(), predicate.getLocation()!),
        predicate,
      );
    }

    const fn = domainInfo
      .getFunctions()
      .find((candidate) => candidate.matchesShortNameCaseInsensitive(symbol.name));
    if (fn?.getLocation()) {
      return new VariableInfo(
        createHover(
          "Function",
          `(${fn.declaredName})`,
          fn.getDocumentation(),
          symbol.range,
        ),
        toLocation(domainInfo.fileUri.toString(), fn.getLocation()!),
        fn,
      );
    }

    const derived = domainInfo
      .getDerived()
      .find((candidate) => candidate.matchesShortNameCaseInsensitive(symbol.name));
    if (derived?.getLocation()) {
      return new VariableInfo(
        createHover(
          "Derived Predicate/Function",
          `(${derived.declaredName})`,
          derived.getDocumentation(),
          symbol.range,
        ),
        toLocation(domainInfo.fileUri.toString(), derived.getLocation()!),
        derived,
      );
    }

    const action = domainInfo
      .getActions()
      .find((candidate) => candidate.name?.toLowerCase() === symbol.name.toLowerCase());
    if (action) {
      return new ActionInfo(
        createActionHover(action, symbol.range),
        toLocation(domainInfo.fileUri.toString(), action.getLocation()),
        action,
      );
    }
  }

  if (symbol.isPrefixedBy("- ") || domainInfo.getTypes().includes(symbol.name)) {
    if (domainInfo.getTypes().includes(symbol.name)) {
      const parents = domainInfo.getTypeInheritance().getVerticesWithEdgesFrom(symbol.name);
      const inheritsText =
        parents && parents.length > 0 ? [`Inherits from: ${parents.join(", ")}`] : [];
      const typeLocation = domainInfo.getTypeLocation(symbol.name);
      if (!typeLocation) {
        return undefined;
      }
      return new TypeInfo(
        createHover("Type", symbol.name, inheritsText, symbol.range),
        toLocation(domainInfo.fileUri.toString(), typeLocation),
        symbol.name,
      );
    }
  }

  if (symbol.isPrefixedBy("?") && fileInfo.isDomain()) {
    const parameterNode = domainInfo.syntaxTree.getNodeAt(document.offsetAt(position));
    const scopeNode = parameterNode.findParametrisableScope(symbol.name);
    if (!scopeNode) {
      return undefined;
    }

    const parameterLocations = parameterReferenceLocations(scopeNode, symbol.name, document);
    const declaration = parameterLocations[0];
    if (!declaration) {
      return undefined;
    }

    return new ParameterInfo(
      createHover("Parameter", `?${symbol.name}`, [], symbol.range),
      declaration,
      scopeNode,
      symbol.name,
    );
  }

  return undefined;
}

export async function findSymbolReferences(
  workspace: LspPddlWorkspace,
  document: TextDocument,
  resolved: ResolvedSymbol,
  includeDeclaration: boolean,
): Promise<Location[]> {
  const fileInfo = workspace.getFileInfo<FileInfo>(document.uri);
  if (!fileInfo) {
    return [];
  }

  const domainInfo = workspace.asDomain(fileInfo);
  if (!domainInfo) {
    return [];
  }

  const problemFiles = workspace.getProblemFiles(domainInfo);
  const locations: Location[] = [];

  if (resolved instanceof VariableInfo) {
    let includeReference = includeDeclaration;
    for (const range of domainInfo.getVariableReferences(resolved.variable)) {
      if (includeReference) {
        locations.push(toLocation(domainInfo.fileUri.toString(), range));
      } else {
        includeReference = true;
      }
    }

    for (const problemFile of problemFiles) {
      for (const range of problemFile.getVariableReferences(resolved.variable)) {
        locations.push(toLocation(problemFile.fileUri.toString(), range));
      }
    }
  } else if (resolved instanceof TypeInfo) {
    if (includeDeclaration) {
      locations.push(resolved.location);
    }

    for (const range of domainInfo.getTypeReferences(resolved.typeName)) {
      const location = toLocation(domainInfo.fileUri.toString(), range);
      if (!sameRange(location.range, resolved.location.range)) {
        locations.push(location);
      }
    }

    for (const problemFile of problemFiles) {
      for (const range of problemFile.getTypeReferences(resolved.typeName)) {
        locations.push(toLocation(problemFile.fileUri.toString(), range));
      }
    }
  } else if (resolved instanceof ParameterInfo) {
    const parameterLocations = parameterReferenceLocations(
      resolved.scopeNode,
      resolved.name,
      document,
    );
    return includeDeclaration ? parameterLocations : parameterLocations.slice(1);
  }

  return locations;
}

export async function buildRenameEdit(
  workspace: LspPddlWorkspace,
  document: TextDocument,
  position: Position,
  newName: string,
): Promise<WorkspaceEdit | null> {
  const resolved = await resolveSymbol(workspace, document, position);
  if (
    !resolved ||
    !(
      resolved instanceof VariableInfo ||
      resolved instanceof TypeInfo ||
      resolved instanceof ParameterInfo
    )
  ) {
    return null;
  }

  if (!/^\w[-\w]*$/.test(newName)) {
    throw new Error(`Invalid PDDL identifier: ${newName}`);
  }

  const currentWord = getWordAtDocumentPosition(document, position)?.word;
  if (!currentWord) {
    return null;
  }

  const references = await findSymbolReferences(workspace, document, resolved, true);
  const changes: Record<string, TextEdit[]> = {};

  for (const reference of references) {
    const referenceDocument = await workspace.getTextDocument(reference.uri);
    const oldText = referenceDocument.getText(reference.range);
    const newText = oldText.replace(currentWord, newName);
    changes[reference.uri] ??= [];
    changes[reference.uri].push({
      range: reference.range,
      newText,
    });
  }

  return { changes };
}

export async function getDocumentSymbols(
  workspace: LspPddlWorkspace,
  document: TextDocument,
): Promise<DocumentSymbol[]> {
  const fileInfo = workspace.getFileInfo<FileInfo>(document.uri);
  if (!fileInfo) {
    return [];
  }

  if (fileInfo.isDomain()) {
    const domainInfo = fileInfo as DomainInfo;
    const symbols: DocumentSymbol[] = [];

    symbols.push(
      ...domainInfo.getActions().map((action) => ({
        name: action.name ?? "unnamed action",
        kind: SymbolKind.Module,
        range: toLspRange(action.getLocation()),
        selectionRange: toLspRange(action.getLocation()),
      })),
    );
    symbols.push(
      ...(domainInfo.getProcesses() ?? []).map((process) => ({
        name: process.name ?? "unnamed process",
        kind: SymbolKind.Struct,
        range: toLspRange(process.getLocation()),
        selectionRange: toLspRange(process.getLocation()),
      })),
    );
    symbols.push(
      ...(domainInfo.getEvents() ?? []).map((event) => ({
        name: event.name ?? "unnamed event",
        kind: SymbolKind.Event,
        range: toLspRange(event.getLocation()),
        selectionRange: toLspRange(event.getLocation()),
      })),
    );
    symbols.push(
      ...domainInfo
        .getPredicates()
        .filter((predicate) => predicate.getLocation())
        .map((predicate) => ({
          name: predicate.declaredName,
          kind: SymbolKind.Boolean,
          range: toLspRange(predicate.getLocation()!),
          selectionRange: toLspRange(predicate.getLocation()!),
        })),
    );
    symbols.push(
      ...domainInfo
        .getFunctions()
        .filter((fn) => fn.getLocation())
        .map((fn) => ({
          name: fn.declaredName,
          kind: SymbolKind.Function,
          range: toLspRange(fn.getLocation()!),
          selectionRange: toLspRange(fn.getLocation()!),
        })),
    );

    return symbols;
  }

  if (fileInfo.isProblem()) {
    const problemInfo = fileInfo as ProblemInfo;
    const defineNode = problemInfo.syntaxTree.getDefineNode();
    if (!defineNode) {
      return [];
    }

    const fullRange = nodeToRange(document, defineNode);
    const selectionRange: Range = {
      start: fullRange.start,
      end: { line: fullRange.start.line + 1, character: 0 },
    };

    const root: DocumentSymbol = {
      name: "problem",
      detail: problemInfo.name,
      kind: SymbolKind.Namespace,
      range: fullRange,
      selectionRange,
      children: defineNode
        .getChildrenOfType(parser.PddlTokenType.OpenBracketOperator, /\(\s*:/)
        .map((node) => ({
          name: node.getToken().tokenText.slice(1),
          kind: SymbolKind.Package,
          range: nodeToRange(document, node),
          selectionRange: {
            start: document.positionAt(node.getToken().getStart() + 1),
            end: document.positionAt(node.getToken().getEnd()),
          },
        })),
    };

    return [root];
  }

  return [];
}
