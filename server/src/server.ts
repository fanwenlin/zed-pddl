import {
  CompletionItem,
  createConnection,
  Diagnostic,
  DiagnosticSeverity,
  ProposedFeatures,
  SemanticTokensParams,
  TextDocumentSyncKind,
  TextDocuments,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { ParsingProblem } from "pddl-workspace";
import { getCompletionItems } from "./completion";
import { LspPddlWorkspace } from "./pddl-workspace";
import {
  getSemanticTokens,
  SEMANTIC_TOKEN_MODIFIERS,
  SEMANTIC_TOKEN_TYPES,
} from "./semantic";
import {
  buildRenameEdit,
  findSymbolReferences,
  getDocumentSymbols,
  resolveSymbol,
} from "./symbols";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
const workspace = new LspPddlWorkspace(documents);

function toDiagnostic(problem: ParsingProblem): Diagnostic {
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

async function publishDiagnostics(uri: string): Promise<void> {
  const fileInfo = await workspace.ensureParsed(uri);
  const diagnostics = fileInfo?.getParsingProblems().map(toDiagnostic) ?? [];
  connection.sendDiagnostics({ uri, diagnostics });
}

connection.onInitialize(() => ({
  capabilities: {
    textDocumentSync: TextDocumentSyncKind.Incremental,
    hoverProvider: true,
    definitionProvider: true,
    referencesProvider: true,
    renameProvider: {
      prepareProvider: true,
    },
    documentSymbolProvider: true,
    completionProvider: {
      triggerCharacters: ["(", ":", "?", "-"],
      resolveProvider: false,
    },
    semanticTokensProvider: {
      legend: {
        tokenTypes: [...SEMANTIC_TOKEN_TYPES],
        tokenModifiers: [...SEMANTIC_TOKEN_MODIFIERS],
      },
      full: true,
    },
  },
}));

documents.onDidOpen(async (event) => {
  await workspace.upsertAndParseDocument(event.document);
  await publishDiagnostics(event.document.uri);
});

documents.onDidChangeContent(async (event) => {
  await workspace.upsertAndParseDocument(event.document);
  await publishDiagnostics(event.document.uri);
});

documents.onDidSave(async (event) => {
  await workspace.upsertAndParseDocument(event.document);
  await publishDiagnostics(event.document.uri);
});

documents.onDidClose((event) => {
  connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
});

connection.onHover(async (params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return null;
  }

  await workspace.ensureParsed(document.uri);
  return (await resolveSymbol(workspace, document, params.position))?.hover ?? null;
});

connection.onDefinition(async (params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return null;
  }

  await workspace.ensureParsed(document.uri);
  return (await resolveSymbol(workspace, document, params.position))?.location ?? null;
});

connection.onReferences(async (params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return [];
  }

  await workspace.ensureParsed(document.uri);
  const symbol = await resolveSymbol(workspace, document, params.position);
  if (!symbol) {
    return [];
  }

  return findSymbolReferences(
    workspace,
    document,
    symbol,
    params.context.includeDeclaration,
  );
});

connection.onPrepareRename(async (params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return null;
  }

  await workspace.ensureParsed(document.uri);
  const symbol = await resolveSymbol(workspace, document, params.position);
  if (!symbol) {
    return null;
  }

  return symbol.location.uri === document.uri ? symbol.location.range : null;
});

connection.onRenameRequest(async (params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return null;
  }

  await workspace.ensureParsed(document.uri);
  return buildRenameEdit(workspace, document, params.position, params.newName);
});

connection.onDocumentSymbol(async (params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return [];
  }

  await workspace.ensureParsed(document.uri);
  return getDocumentSymbols(workspace, document);
});

connection.onCompletion(async (params): Promise<CompletionItem[]> => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return [];
  }

  await workspace.ensureParsed(document.uri);
  return getCompletionItems(workspace, document, params.position);
});

connection.languages.semanticTokens.on(
  async (params: SemanticTokensParams) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
      return { data: [] };
    }

    await workspace.ensureParsed(document.uri);
    return getSemanticTokens(workspace, document);
  },
);

documents.listen(connection);
connection.listen();
