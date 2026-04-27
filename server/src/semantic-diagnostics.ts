import {
  Diagnostic,
  DiagnosticSeverity,
  Range,
  TextDocument,
} from "vscode-languageserver/node";
import {
  DomainInfo,
  FileInfo,
  ProblemInfo,
  TypeObjectMap,
  Variable,
} from "pddl-workspace";
import { LspPddlWorkspace } from "./pddl-workspace";

type AtomNode = {
  kind: "atom";
  text: string;
  start: number;
  end: number;
};

type ListNode = {
  kind: "list";
  children: SexpNode[];
  start: number;
  end: number;
};

type SexpNode = AtomNode | ListNode;

type CallableIndex = Map<string, Variable>;

const SOURCE = "pddl-semantic";

const RESERVED_FORMS = new Set([
  "define",
  "domain",
  "problem",
  "and",
  "or",
  "not",
  "imply",
  "exists",
  "forall",
  "when",
  "at",
  "over",
  "all",
  "start",
  "end",
  "either",
  "preference",
  "always",
  "sometime",
  "within",
  "at-most-once",
  "sometime-after",
  "sometime-before",
  "always-within",
  "hold-during",
  "hold-after",
  "assign",
  "increase",
  "decrease",
  "scale-up",
  "scale-down",
  "minimize",
  "maximize",
  "total-time",
  "is-violated",
  "+",
  "-",
  "*",
  "/",
  ">",
  "<",
  "=",
  ">=",
  "<=",
]);

const DECLARATION_SECTIONS = new Set([
  ":requirements",
  ":types",
  ":constants",
  ":objects",
  ":predicates",
  ":functions",
]);

const REQUIRED_FEATURES = [
  {
    requirement: ":durative-actions",
    pattern: /\B:durative-action\b/i,
    feature: "durative actions",
  },
  {
    requirement: ":fluents",
    pattern: /\B:functions\b|\b(assign|increase|decrease|scale-up|scale-down)\b/i,
    feature: "numeric fluents",
  },
  {
    requirement: ":constraints",
    pattern: /\B:constraints\b|\b(always|sometime|within|at-most-once|always-within|hold-during|hold-after)\b/i,
    feature: "constraints",
  },
  {
    requirement: ":derived-predicates",
    pattern: /\B:derived\b/i,
    feature: "derived predicates",
  },
] as const;

function diagnostic(
  message: string,
  range: Range,
  severity: DiagnosticSeverity = DiagnosticSeverity.Error,
): Diagnostic {
  return { message, range, severity, source: SOURCE };
}

function rangeFromOffsets(
  document: TextDocument,
  start: number,
  end: number,
): Range {
  return {
    start: document.positionAt(start),
    end: document.positionAt(Math.max(end, start + 1)),
  };
}

function tokenize(text: string): AtomNode[] {
  const tokens: AtomNode[] = [];

  for (let index = 0; index < text.length;) {
    const char = text[index];
    if (/\s/.test(char)) {
      index++;
      continue;
    }
    if (char === ";") {
      while (index < text.length && text[index] !== "\n") index++;
      continue;
    }
    if (char === "(" || char === ")") {
      tokens.push({ kind: "atom", text: char, start: index, end: index + 1 });
      index++;
      continue;
    }

    const start = index;
    while (index < text.length && !/\s|\(|\)|;/.test(text[index])) index++;
    tokens.push({ kind: "atom", text: text.slice(start, index), start, end: index });
  }

  return tokens;
}

function parseSexprs(text: string): SexpNode[] {
  const tokens = tokenize(text);
  const root: ListNode = { kind: "list", children: [], start: 0, end: text.length };
  const stack = [root];

  for (const token of tokens) {
    if (token.text === "(") {
      const node: ListNode = {
        kind: "list",
        children: [],
        start: token.start,
        end: token.end,
      };
      stack[stack.length - 1].children.push(node);
      stack.push(node);
      continue;
    }

    if (token.text === ")") {
      const node = stack.pop();
      if (node && node !== root) {
        node.end = token.end;
      }
      continue;
    }

    stack[stack.length - 1].children.push(token);
  }

  return root.children;
}

function firstAtom(node: ListNode): AtomNode | undefined {
  return node.children.find((child): child is AtomNode => child.kind === "atom");
}

function lower(text: string): string {
  return text.toLowerCase();
}

function callableIndex(variables: Variable[]): CallableIndex {
  return new Map(variables.map((variable) => [lower(variable.name), variable]));
}

function directArgumentCount(node: ListNode): number {
  return node.children.slice(1).filter((child) => child.kind === "atom").length;
}

function directArgumentAtoms(node: ListNode): AtomNode[] {
  return node.children.slice(1).filter((child): child is AtomNode => child.kind === "atom");
}

function expectedArgumentCount(variable: Variable): number {
  return variable.parameters.length;
}

function isCallableContext(name: string): boolean {
  return !name.startsWith(":") && !name.startsWith("?") && !RESERVED_FORMS.has(lower(name));
}

function isObjectArgument(name: string): boolean {
  return !name.startsWith("?") && !/^-?\d+(?:\.\d+)?$/.test(name);
}

function problemObjects(domainInfo: DomainInfo, problemInfo: ProblemInfo): TypeObjectMap {
  return domainInfo.getConstants().merge(problemInfo.getObjectsTypeMap());
}

function typeMatches(
  domainInfo: DomainInfo,
  actualType: string,
  expectedType: string,
): boolean {
  if (lower(expectedType) === "object" || lower(actualType) === lower(expectedType)) {
    return true;
  }

  return domainInfo
    .getTypesInheritingFromPlusSelf(expectedType)
    .some((typeName) => lower(typeName) === lower(actualType));
}

function collectArgumentDiagnostics(
  document: TextDocument,
  node: ListNode,
  callable: Variable,
  domainInfo: DomainInfo,
  problemInfo: ProblemInfo | undefined,
  diagnostics: Diagnostic[],
): void {
  if (!problemInfo) {
    return;
  }

  const objects = problemObjects(domainInfo, problemInfo);
  const arguments_ = directArgumentAtoms(node);

  for (const [index, argument] of arguments_.entries()) {
    if (!isObjectArgument(argument.text)) {
      continue;
    }

    const objectType = objects.getTypeOfCaseInsensitive(argument.text);
    if (!objectType) {
      diagnostics.push(
        diagnostic(
          `Undefined object or constant \`${argument.text}\`.`,
          rangeFromOffsets(document, argument.start, argument.end),
        ),
      );
      continue;
    }

    const parameter = callable.parameters[index];
    if (!parameter || typeMatches(domainInfo, objectType.type, parameter.type)) {
      continue;
    }

    const callableName = firstAtom(node)?.text ?? callable.name;
    diagnostics.push(
      diagnostic(
        `\`${argument.text}\` has type \`${objectType.type}\`, but \`${callableName}\` expects \`${parameter.type}\`.`,
        rangeFromOffsets(document, argument.start, argument.end),
      ),
    );
  }
}

function collectCallableDiagnostics(
  document: TextDocument,
  node: SexpNode,
  predicates: CallableIndex,
  functions: CallableIndex,
  domainInfo: DomainInfo,
  problemInfo: ProblemInfo | undefined,
  diagnostics: Diagnostic[],
): void {
  if (node.kind === "atom") return;

  const head = firstAtom(node);
  if (!head) {
    return;
  }

  const name = head.text;
  const normalizedName = lower(name);

  if (DECLARATION_SECTIONS.has(normalizedName)) {
    return;
  }

  for (const child of node.children.slice(1)) {
    collectCallableDiagnostics(
      document,
      child,
      predicates,
      functions,
      domainInfo,
      problemInfo,
      diagnostics,
    );
  }

  if (!isCallableContext(name)) {
    return;
  }

  const callable = predicates.get(normalizedName) ?? functions.get(normalizedName);
  if (!callable) {
    diagnostics.push(
      diagnostic(
        `Undefined predicate or function \`${name}\`.`,
        rangeFromOffsets(document, head.start, head.end),
      ),
    );
    return;
  }

  const expected = expectedArgumentCount(callable);
  const actual = directArgumentCount(node);
  if (actual !== expected) {
    diagnostics.push(
      diagnostic(
        `\`${name}\` expects ${expected} argument${expected === 1 ? "" : "s"}, but got ${actual}.`,
        rangeFromOffsets(document, head.start, head.end),
      ),
    );
  }

  collectArgumentDiagnostics(
    document,
    node,
    callable,
    domainInfo,
    problemInfo,
    diagnostics,
  );
}

function findWordRange(document: TextDocument, word: string): Range {
  const text = document.getText();
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`\\b${escaped}\\b`, "i").exec(text);
  if (!match) {
    return {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 1 },
    };
  }
  return rangeFromOffsets(document, match.index, match.index + match[0].length);
}

function diagnosticsForMissingDomain(
  workspace: LspPddlWorkspace,
  document: TextDocument,
  fileInfo: FileInfo,
): Diagnostic[] {
  if (!fileInfo.isProblem()) {
    return [];
  }

  const problemInfo = fileInfo as ProblemInfo;
  if (workspace.getDomainFileFor(problemInfo)) {
    return [];
  }

  return [
    diagnostic(
      `No domain file found for \`${problemInfo.domainName}\`.`,
      findWordRange(document, problemInfo.domainName),
    ),
  ];
}

function diagnosticsForRequirements(
  document: TextDocument,
  fileInfo: FileInfo,
): Diagnostic[] {
  const text = document.getText();
  const declared = new Set(fileInfo.getRequirements().map(lower));
  const diagnostics: Diagnostic[] = [];

  for (const feature of REQUIRED_FEATURES) {
    if (declared.has(feature.requirement)) {
      continue;
    }
    const match = feature.pattern.exec(text);
    if (!match) {
      continue;
    }
    diagnostics.push(
      diagnostic(
        `Missing ${feature.requirement} requirement for ${feature.feature}.`,
        rangeFromOffsets(document, match.index, match.index + match[0].length),
        DiagnosticSeverity.Warning,
      ),
    );
  }

  return diagnostics;
}

function domainForDocument(
  workspace: LspPddlWorkspace,
  fileInfo: FileInfo,
): DomainInfo | undefined {
  const domainInfo = workspace.asDomain(fileInfo);
  if (domainInfo) {
    return domainInfo;
  }

  if (fileInfo.isProblem()) {
    return workspace.getDomainFileFor(fileInfo as ProblemInfo);
  }

  return undefined;
}

function diagnosticsForCallables(
  workspace: LspPddlWorkspace,
  document: TextDocument,
  fileInfo: FileInfo,
): Diagnostic[] {
  const domainInfo = domainForDocument(workspace, fileInfo);
  if (!domainInfo) {
    return [];
  }

  const diagnostics: Diagnostic[] = [];
  const predicates = callableIndex(domainInfo.getPredicates());
  const functions = callableIndex(domainInfo.getFunctions());
  const problemInfo = fileInfo.isProblem() ? (fileInfo as ProblemInfo) : undefined;
  for (const expression of parseSexprs(document.getText())) {
    collectCallableDiagnostics(
      document,
      expression,
      predicates,
      functions,
      domainInfo,
      problemInfo,
      diagnostics,
    );
  }

  return diagnostics;
}

export async function getSemanticDiagnostics(
  workspace: LspPddlWorkspace,
  document: TextDocument,
): Promise<Diagnostic[]> {
  const fileInfo = await workspace.ensureParsed(document.uri);
  if (!fileInfo) {
    return [];
  }

  return [
    ...diagnosticsForMissingDomain(workspace, document, fileInfo),
    ...diagnosticsForRequirements(document, fileInfo),
    ...diagnosticsForCallables(workspace, document, fileInfo),
  ];
}
