import {
  FileInfo,
  parser,
} from "pddl-workspace";
import {
  SemanticTokenModifiers,
  SemanticTokens,
  SemanticTokensBuilder,
  SemanticTokenTypes,
  TextDocument,
} from "vscode-languageserver/node";
import { LspPddlWorkspace } from "./pddl-workspace";

export const SEMANTIC_TOKEN_TYPES = [
  SemanticTokenTypes.keyword,
  SemanticTokenTypes.comment,
  SemanticTokenTypes.operator,
  SemanticTokenTypes.parameter,
  SemanticTokenTypes.method,
  SemanticTokenTypes.function,
  SemanticTokenTypes.type,
  SemanticTokenTypes.enumMember,
  SemanticTokenTypes.namespace,
] as const;

export const SEMANTIC_TOKEN_MODIFIERS = [
  SemanticTokenModifiers.declaration,
] as const;

const KEYWORDS = new Set([
  "define",
  "domain",
  "problem",
  ":domain",
  ":requirements",
  ":types",
  ":constants",
  ":predicates",
  ":functions",
  ":constraints",
  ":objects",
  ":init",
  ":goal",
  ":metric",
  ":action",
  ":durative-action",
  ":derived",
  ":parameters",
  ":precondition",
  ":effect",
  ":duration",
  ":condition",
  ":process",
  ":event",
  ":job",
  "and",
  "or",
  "not",
  "imply",
  "when",
  "forall",
  "exists",
  "either",
  "minimize",
  "maximize",
  "total-time",
  "at",
  "at start",
  "at end",
  "over",
  "over all",
  "all",
  "start",
  "end",
  "oneof",
  "unknown",
]);

const OPERATOR_HEADS = new Set([
  "assign",
  "increase",
  "decrease",
  "scale-up",
  "scale-down",
  "=",
  ">",
  "<",
  ">=",
  "<=",
]);

const DECLARATION_HEADS = new Set([
  ":action",
  ":durative-action",
  ":derived",
  ":process",
  ":event",
  ":job",
]);

const TOKEN_TYPE_INDEX = new Map(
  SEMANTIC_TOKEN_TYPES.map((tokenType, index) => [tokenType, index]),
);

const DECLARATION_MODIFIER_INDEX = 1 << 0;

function stripOpenBracket(tokenText: string): string {
  return tokenText.replace(/^\(\s*/, "");
}

function walk(node: parser.PddlSyntaxNode, visit: (node: parser.PddlSyntaxNode) => void): void {
  visit(node);
  for (const child of node.getChildren()) {
    walk(child, visit);
  }
}

function firstMeaningfulChildren(node: parser.PddlSyntaxNode): parser.PddlSyntaxNode[] {
  return node.getChildren().filter(
    (child) =>
      child.isNoneOf([parser.PddlTokenType.Whitespace, parser.PddlTokenType.Comment]),
  );
}

function previousMeaningfulSibling(node: parser.PddlSyntaxNode): parser.PddlSyntaxNode | undefined {
  return node
    .getPrecedingSiblings()
    .filter((candidate) =>
      candidate.isNoneOf([parser.PddlTokenType.Whitespace, parser.PddlTokenType.Comment]),
    )
    .at(-1);
}

function enclosingSection(node: parser.PddlSyntaxNode): string | undefined {
  const section = node.findAncestor(
    parser.PddlTokenType.OpenBracketOperator,
    /^\(\s*:(domain|types|constants|objects|predicates|functions|constraints|init|goal)\b/i,
  );
  if (!section) {
    return undefined;
  }
  return stripOpenBracket(section.getToken().tokenText).toLowerCase();
}

function pushToken(
  builder: SemanticTokensBuilder,
  document: TextDocument,
  startOffset: number,
  endOffset: number,
  tokenType: (typeof SEMANTIC_TOKEN_TYPES)[number],
  declaration = false,
): void {
  if (endOffset <= startOffset) {
    return;
  }
  const start = document.positionAt(startOffset);
  const end = document.positionAt(endOffset);
  if (start.line !== end.line) {
    return;
  }
  builder.push(
    start.line,
    start.character,
    end.character - start.character,
    TOKEN_TYPE_INDEX.get(tokenType) ?? 0,
    declaration ? DECLARATION_MODIFIER_INDEX : 0,
  );
}

function declarationNameNode(node: parser.PddlSyntaxNode): parser.PddlSyntaxNode | undefined {
  const meaningfulChildren = firstMeaningfulChildren(node);
  return meaningfulChildren.find((child) =>
    child.isAnyOf([parser.PddlTokenType.Other, parser.PddlTokenType.Parameter]),
  );
}

export async function getSemanticTokens(
  workspace: LspPddlWorkspace,
  document: TextDocument,
): Promise<SemanticTokens> {
  const fileInfo = workspace.getFileInfo<FileInfo>(document.uri);
  if (!fileInfo) {
    return { data: [] };
  }

  const builder = new SemanticTokensBuilder();
  const root = fileInfo.syntaxTree.getRootNode();

  walk(root, (node) => {
    const token = node.getToken();
    const tokenText = token.tokenText;

    switch (token.type) {
      case parser.PddlTokenType.Comment:
        pushToken(builder, document, node.getStart(), node.getToken().getEnd(), SemanticTokenTypes.comment);
        return;
      case parser.PddlTokenType.Keyword:
        pushToken(builder, document, node.getStart(), node.getToken().getEnd(), SemanticTokenTypes.keyword);
        return;
      case parser.PddlTokenType.Dash:
        pushToken(builder, document, node.getStart(), node.getToken().getEnd(), SemanticTokenTypes.operator);
        return;
      case parser.PddlTokenType.Parameter:
        pushToken(builder, document, node.getStart(), node.getToken().getEnd(), SemanticTokenTypes.parameter);
        return;
      case parser.PddlTokenType.OpenBracketOperator: {
        const head = stripOpenBracket(tokenText);
        const headOffset = node.getStart() + tokenText.indexOf(head);
        const headEndOffset = headOffset + head.length;
        if (OPERATOR_HEADS.has(head)) {
          pushToken(builder, document, headOffset, headEndOffset, SemanticTokenTypes.operator);
        } else if (KEYWORDS.has(head)) {
          pushToken(builder, document, headOffset, headEndOffset, SemanticTokenTypes.keyword);
        } else {
          pushToken(builder, document, headOffset, headEndOffset, SemanticTokenTypes.function);
        }

        if (DECLARATION_HEADS.has(head)) {
          const nameNode = declarationNameNode(node);
          if (nameNode) {
            pushToken(
              builder,
              document,
              nameNode.getStart(),
              nameNode.getToken().getEnd(),
              SemanticTokenTypes.method,
              true,
            );
          }
        }
        return;
      }
      case parser.PddlTokenType.Other: {
        if (tokenText === "domain" || tokenText === "problem") {
          pushToken(builder, document, node.getStart(), node.getToken().getEnd(), SemanticTokenTypes.keyword);
          return;
        }

        const section = enclosingSection(node);
        const previous = previousMeaningfulSibling(node);

        if (section === ":domain") {
          pushToken(builder, document, node.getStart(), node.getToken().getEnd(), SemanticTokenTypes.namespace);
          return;
        }

        if (section === ":types") {
          pushToken(builder, document, node.getStart(), node.getToken().getEnd(), SemanticTokenTypes.type, true);
          return;
        }

        if (previous?.isType(parser.PddlTokenType.Dash)) {
          pushToken(builder, document, node.getStart(), node.getToken().getEnd(), SemanticTokenTypes.type);
          return;
        }

        if (section === ":constants" || section === ":objects") {
          pushToken(builder, document, node.getStart(), node.getToken().getEnd(), SemanticTokenTypes.enumMember, true);
          return;
        }

        if (section === ":predicates" || section === ":functions") {
          pushToken(builder, document, node.getStart(), node.getToken().getEnd(), SemanticTokenTypes.function, true);
          return;
        }

        if (
          previous?.isType(parser.PddlTokenType.OpenBracket)
          || node.getParent()?.isType(parser.PddlTokenType.OpenBracket)
        ) {
          pushToken(builder, document, node.getStart(), node.getToken().getEnd(), SemanticTokenTypes.function);
          return;
        }

        if (/^[A-Z][A-Z0-9_\-]*$/.test(tokenText)) {
          pushToken(builder, document, node.getStart(), node.getToken().getEnd(), SemanticTokenTypes.enumMember);
          return;
        }

        if (tokenText === fileInfo.name) {
          pushToken(builder, document, node.getStart(), node.getToken().getEnd(), SemanticTokenTypes.namespace);
        }
      }
    }
  });

  return builder.build();
}
