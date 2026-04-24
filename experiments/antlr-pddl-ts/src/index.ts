import fs from "node:fs";

import { ANTLRErrorListener } from "antlr4ts/ANTLRErrorListener";
import { CharStreams } from "antlr4ts/CharStreams";
import { CommonTokenStream } from "antlr4ts/CommonTokenStream";
import { ParserRuleContext } from "antlr4ts/ParserRuleContext";
import { RecognitionException } from "antlr4ts/RecognitionException";
import { Recognizer } from "antlr4ts/Recognizer";
import { Token } from "antlr4ts/Token";
import { ParseTree } from "antlr4ts/tree/ParseTree";
import { TerminalNode } from "antlr4ts/tree/TerminalNode";

import { PddlLexer } from "./generated/grammar/PddlLexer";
import {
  AtomicFormulaSkeletonContext,
  AtomicFunctionSkeletonContext,
  DerivedDefContext,
  DomainContext,
  MetricSpecContext,
  PddlDocContext,
  PddlParser,
  ProblemContext,
  SingleTypeNameListContext,
  SingleTypeVarListContext,
  Type_Context,
  TypedNameListContext,
  TypedVariableListContext,
} from "./generated/grammar/PddlParser";

export interface PddlSyntaxError {
  line: number;
  column: number;
  message: string;
}

export interface PddlTreePosition {
  line: number;
  column: number;
  index: number;
}

export interface PddlTreeNode {
  type: string;
  text: string;
  terminal: boolean;
  children: PddlTreeNode[];
  start: PddlTreePosition | null;
  stop: PddlTreePosition | null;
}

export interface ParsePddlResult {
  syntaxErrors: PddlSyntaxError[];
  tree: PddlTreeNode;
}

export interface PddlTypedEntry {
  name: string;
  types: string[];
}

export interface PddlCallableSummary {
  name: string;
  parameters: PddlTypedEntry[];
}

export interface PddlActionSummary {
  name: string;
  kind: "action" | "durative-action";
}

export interface PddlMetricSummary {
  optimization: string;
  expression: string;
}

export interface PddlDocumentSummary {
  kind: "domain" | "problem" | "unknown";
  name?: string;
  domainName?: string;
  requirements: string[];
  problemSections: string[];
  types: string[];
  typeParents: Record<string, string[]>;
  constants: PddlTypedEntry[];
  objects: PddlTypedEntry[];
  predicates: PddlCallableSummary[];
  functions: PddlCallableSummary[];
  derived: PddlCallableSummary[];
  actions: PddlActionSummary[];
  metric?: PddlMetricSummary;
  syntaxErrors: PddlSyntaxError[];
}

interface ParsedPddlInternal {
  parser: PddlParser;
  tree: PddlDocContext;
  sourceText: string;
  syntaxErrors: PddlSyntaxError[];
}

const RESERVED_WORDS = [
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
  "start",
  "end",
  "over",
  "all",
  "always",
  "sometime",
  "within",
  "at-most-once",
  "sometime-after",
  "sometime-before",
  "always-within",
  "hold-during",
  "hold-after",
  "preference",
  "total-time",
  "is-violated",
];

export function parsePddlDocument(text: string): ParsePddlResult {
  const parsed = parseInternal(text);
  return {
    syntaxErrors: parsed.syntaxErrors,
    tree: serializeParseTree(parsed.tree, parsed.parser, parsed.sourceText),
  };
}

export function parsePddlFile(filePath: string): ParsePddlResult {
  return parsePddlDocument(fs.readFileSync(filePath, "utf8"));
}

export function summarizePddlDocument(text: string): PddlDocumentSummary {
  const parsed = parseInternal(text);
  return summarizeParsedDocument(parsed);
}

export function summarizePddlFile(filePath: string): PddlDocumentSummary {
  return summarizePddlDocument(fs.readFileSync(filePath, "utf8"));
}

function parseInternal(text: string): ParsedPddlInternal {
  const syntaxErrors: PddlSyntaxError[] = [];
  const errorListener = createErrorListener(syntaxErrors);

  const lexer = new PddlLexer(CharStreams.fromString(normalizeForParsing(text)));
  lexer.removeErrorListeners();
  lexer.addErrorListener(errorListener);

  const tokens = new CommonTokenStream(lexer);
  const parser = new PddlParser(tokens);
  parser.removeErrorListeners();
  parser.addErrorListener(errorListener);

  return {
    parser,
    tree: parser.pddlDoc(),
    sourceText: text,
    syntaxErrors,
  };
}

function summarizeParsedDocument(parsed: ParsedPddlInternal): PddlDocumentSummary {
  const domain = parsed.tree.domain();
  if (domain) {
    return summarizeDomain(domain, parsed.sourceText, parsed.syntaxErrors);
  }

  const problem = parsed.tree.problem();
  if (problem) {
    return summarizeProblem(problem, parsed.sourceText, parsed.syntaxErrors);
  }

  return {
    kind: "unknown",
    requirements: [],
    problemSections: [],
    types: [],
    typeParents: {},
    constants: [],
    objects: [],
    predicates: [],
    functions: [],
    derived: [],
    actions: [],
    syntaxErrors: parsed.syntaxErrors,
  };
}

function summarizeDomain(
  domain: DomainContext,
  sourceText: string,
  syntaxErrors: PddlSyntaxError[],
): PddlDocumentSummary {
  const typeEntries = extractTypedNameEntries(domain.typesDef()?.typedNameList(), sourceText);
  const typeParents = Object.fromEntries(
    typeEntries
      .filter((entry) => entry.types.length > 0)
      .map((entry) => [entry.name, entry.types]),
  );

  const predicates = (domain.predicatesDef()?.atomicFormulaSkeleton() ?? []).map(
    (predicate) => summarizePredicate(predicate, sourceText),
  );
  const functions = (
    domain.functionsDef()?.functionList().atomicFunctionSkeleton() ?? []
  ).map((func) => summarizeFunction(func, sourceText));
  const actions: PddlActionSummary[] = [];
  const derived: PddlCallableSummary[] = [];

  for (const structure of domain.structureDef()) {
    const action = structure.actionDef();
    if (action) {
      actions.push({
        name: textOfTerminal(action.actionSymbol().NAME(), sourceText),
        kind: "action" as const,
      });
      continue;
    }

    const durativeAction = structure.durativeActionDef();
    if (durativeAction) {
      actions.push({
        name: textOfTerminal(durativeAction.actionSymbol().NAME(), sourceText),
        kind: "durative-action" as const,
      });
      continue;
    }

    const derivedDef = structure.derivedDef();
    if (derivedDef) {
      derived.push(summarizeDerived(derivedDef, sourceText));
    }
  }

  const name = textOfTerminal(domain.domainName().NAME(), sourceText);
  return {
    kind: "domain",
    name,
    domainName: name,
    requirements: textOfTerminalNodes(domain.requireDef()?.REQUIRE_KEY() ?? [], sourceText),
    problemSections: [],
    types: typeEntries.map((entry) => entry.name),
    typeParents,
    constants: extractTypedNameEntries(domain.constantsDef()?.typedNameList(), sourceText),
    objects: [],
    predicates,
    functions,
    derived,
    actions,
    syntaxErrors,
  };
}

function summarizeProblem(
  problem: ProblemContext,
  sourceText: string,
  syntaxErrors: PddlSyntaxError[],
): PddlDocumentSummary {
  const problemSections = [sectionNameFromContext(problem.problemDomain(), sourceText)];
  const requireDef = problem.requireDef();
  if (requireDef) {
    problemSections.push(sectionNameFromContext(requireDef, sourceText));
  }
  const objectDecl = problem.objectDecl();
  if (objectDecl) {
    problemSections.push(sectionNameFromContext(objectDecl, sourceText));
  }
  problemSections.push(
    sectionNameFromContext(problem.init_(), sourceText),
    sectionNameFromContext(problem.goal(), sourceText),
  );
  const probConstraints = problem.probConstraints();
  if (probConstraints) {
    problemSections.push(sectionNameFromContext(probConstraints, sourceText));
  }
  const metricSpec = problem.metricSpec();
  if (metricSpec) {
    problemSections.push(sectionNameFromContext(metricSpec, sourceText));
  }

  return {
    kind: "problem",
    name: textOfTerminal(problem.problemDecl().NAME(), sourceText),
    domainName: textOfTerminal(problem.problemDomain().NAME(), sourceText),
    requirements: textOfTerminalNodes(problem.requireDef()?.REQUIRE_KEY() ?? [], sourceText),
    problemSections,
    types: [],
    typeParents: {},
    constants: [],
    objects: extractTypedNameEntries(problem.objectDecl()?.typedNameList(), sourceText),
    predicates: [],
    functions: [],
    derived: [],
    actions: [],
    metric: summarizeMetric(metricSpec),
    syntaxErrors,
  };
}

function summarizePredicate(
  predicate: AtomicFormulaSkeletonContext,
  sourceText: string,
): PddlCallableSummary {
  return {
    name: textOfTerminal(predicate.predicate().NAME(), sourceText),
    parameters: extractTypedVariableEntries(predicate.typedVariableList(), sourceText),
  };
}

function summarizeFunction(
  func: AtomicFunctionSkeletonContext,
  sourceText: string,
): PddlCallableSummary {
  return {
    name: textOfTerminal(func.functionSymbol().NAME(), sourceText),
    parameters: extractTypedVariableEntries(func.typedVariableList(), sourceText),
  };
}

function summarizeDerived(
  derived: DerivedDefContext,
  sourceText: string,
): PddlCallableSummary {
  return {
    name: textOfTerminal(derived.predicate().NAME(), sourceText),
    parameters: extractTypedVariableEntries(derived.typedVariableList(), sourceText),
  };
}

function summarizeMetric(
  metric: MetricSpecContext | undefined,
): PddlMetricSummary | undefined {
  if (!metric) {
    return undefined;
  }

  return {
    optimization: metric.optimization().text,
    expression: metric.metricFExp().text,
  };
}

function extractTypedNameEntries(
  list: TypedNameListContext | undefined,
  sourceText: string,
): PddlTypedEntry[] {
  if (!list) {
    return [];
  }

  const entries: PddlTypedEntry[] = [];
  for (const child of list.children ?? []) {
    if (child instanceof SingleTypeNameListContext) {
      const typeStartIndex = child.type_()?.start.tokenIndex ?? Number.MAX_SAFE_INTEGER;
      const typeNames = extractTypeNames(child.type_(), sourceText);
      for (const nameNode of child.NAME()) {
        if (nameNode.symbol.tokenIndex < typeStartIndex) {
          entries.push({
            name: textOfTerminal(nameNode, sourceText),
            types: typeNames,
          });
        }
      }
    } else if (
      child instanceof TerminalNode
      && child.symbol.type === PddlParser.NAME
    ) {
      entries.push({
        name: textOfTerminal(child, sourceText),
        types: [],
      });
    }
  }
  return entries;
}

function extractTypedVariableEntries(
  list: TypedVariableListContext | undefined,
  sourceText: string,
): PddlTypedEntry[] {
  if (!list) {
    return [];
  }

  const entries: PddlTypedEntry[] = [];
  for (const child of list.children ?? []) {
    if (child instanceof SingleTypeVarListContext) {
      const typeStartIndex = child.type_()?.start.tokenIndex ?? Number.MAX_SAFE_INTEGER;
      const typeNames = extractTypeNames(child.type_(), sourceText);
      for (const variableNode of child.VARIABLE()) {
        if (variableNode.symbol.tokenIndex < typeStartIndex) {
          entries.push({
            name: textOfTerminal(variableNode, sourceText),
            types: typeNames,
          });
        }
      }
    } else if (
      child instanceof TerminalNode
      && child.symbol.type === PddlParser.VARIABLE
    ) {
      entries.push({
        name: textOfTerminal(child, sourceText),
        types: [],
      });
    }
  }
  return entries;
}

function extractTypeNames(
  typeContext: Type_Context | undefined,
  sourceText: string,
): string[] {
  return typeContext?.primType().map((typeNode) => textOfTerminal(typeNode.NAME(), sourceText)) ?? [];
}

function createErrorListener(
  target: PddlSyntaxError[],
): ANTLRErrorListener<number> & ANTLRErrorListener<Token> {
  return {
    syntaxError: <TSymbol>(
      _recognizer: Recognizer<TSymbol, any>,
      _offendingSymbol: TSymbol | undefined,
      line: number,
      charPositionInLine: number,
      msg: string,
      _e: RecognitionException | undefined,
    ) => {
      target.push({
        line,
        column: charPositionInLine,
        message: msg,
      });
    },
  };
}

function serializeParseTree(
  tree: ParseTree,
  parser: PddlParser,
  sourceText: string,
): PddlTreeNode {
  if (tree instanceof TerminalNode) {
    const token = tree.symbol;
    return {
      type: tokenTypeName(token, parser),
      text: textOfToken(token, sourceText) ?? tree.text,
      terminal: true,
      children: [],
      start: tokenStart(token),
      stop: tokenStop(token),
    };
  }

  const context = tree as ParserRuleContext;
  const children: PddlTreeNode[] = [];
  for (let index = 0; index < context.childCount; index += 1) {
    children.push(serializeParseTree(context.getChild(index), parser, sourceText));
  }

  return {
    type: parser.ruleNames[context.ruleIndex] ?? "unknown",
    text: context.text,
    terminal: false,
    children,
    start: tokenStart(context.start),
    stop: context.stop ? tokenStop(context.stop) : tokenStop(context.start),
  };
}

function tokenTypeName(token: Token, parser: PddlParser): string {
  if (token.type === Token.EOF) {
    return "EOF";
  }

  return (
    parser.vocabulary.getSymbolicName(token.type)
    ?? parser.vocabulary.getLiteralName(token.type)
    ?? `TOKEN_${token.type}`
  );
}

function tokenStart(token: Token | undefined): PddlTreePosition | null {
  if (!token) {
    return null;
  }

  return {
    line: token.line,
    column: token.charPositionInLine,
    index: token.startIndex,
  };
}

function tokenStop(token: Token | undefined): PddlTreePosition | null {
  if (!token) {
    return null;
  }

  const textLength = token.text?.length ?? 0;
  return {
    line: token.line,
    column: token.charPositionInLine + Math.max(textLength - 1, 0),
    index: token.stopIndex,
  };
}

function textOfTerminal(node: TerminalNode, sourceText: string): string {
  return textOfToken(node.symbol, sourceText) ?? node.text;
}

function textOfTerminalNodes(nodes: TerminalNode[], sourceText: string): string[] {
  return nodes.map((node) => textOfTerminal(node, sourceText));
}

function sectionNameFromContext(
  context: ParserRuleContext,
  sourceText: string,
): string {
  const text = textOfContext(context, sourceText);
  const match = /:[^\s()]+/u.exec(text);
  return match?.[0] ?? text;
}

function textOfContext(context: ParserRuleContext, sourceText: string): string {
  return textOfRange(context.start, context.stop ?? context.start, sourceText) ?? context.text;
}

function textOfToken(token: Token, sourceText: string): string | undefined {
  return textOfRange(token, token, sourceText) ?? token.text;
}

function textOfRange(
  start: Token | undefined,
  stop: Token | undefined,
  sourceText: string,
): string | undefined {
  if (!start || !stop || start.startIndex < 0 || stop.stopIndex < start.startIndex) {
    return undefined;
  }
  return sourceText.slice(start.startIndex, stop.stopIndex + 1);
}

function normalizeForParsing(text: string): string {
  let normalized = text;
  for (const word of RESERVED_WORDS) {
    const pattern = new RegExp(
      `(?<![A-Za-z0-9_?\\-])${escapeRegExp(word)}(?![A-Za-z0-9_?\\-])`,
      "giu",
    );
    normalized = normalized.replace(pattern, word.toLowerCase());
  }
  return normalized;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
