import test from "node:test";
import assert from "node:assert/strict";
import { TextDocuments } from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { LspPddlWorkspace } from "../pddl-workspace";
import {
  getSemanticTokens,
  SEMANTIC_TOKEN_TYPES,
} from "../semantic";

type DecodedToken = {
  text: string;
  type: string;
  declaration: boolean;
};

async function parseDocument(uri: string, text: string) {
  const documents = new TextDocuments(TextDocument);
  const workspace = new LspPddlWorkspace(documents);
  const document = TextDocument.create(uri, "pddl", 1, text);
  await workspace.upsertAndParseDocument(document);
  return { workspace, document };
}

function decodeTokens(document: TextDocument, data: number[]): DecodedToken[] {
  const decoded: DecodedToken[] = [];
  const text = document.getText();
  let line = 0;
  let character = 0;

  for (let i = 0; i < data.length; i += 5) {
    const [deltaLine, deltaStart, length, tokenType, modifiers] = data.slice(i, i + 5);
    line += deltaLine;
    character = deltaLine === 0 ? character + deltaStart : deltaStart;

    const start = document.offsetAt({ line, character });
    const end = document.offsetAt({ line, character: character + length });

    decoded.push({
      text: text.slice(start, end),
      type: SEMANTIC_TOKEN_TYPES[tokenType],
      declaration: modifiers !== 0,
    });
  }

  return decoded;
}

test("semantic tokens include callable references and numeric operators", async () => {
  const text = `(define (domain tokens)
  (:requirements :strips :typing :action-costs)
  (:types block)
  (:constants home - block)
  (:predicates
    (clear ?x - block))
  (:functions
    (score) - number)
  (:action touch
    :parameters (?x - block)
    :precondition (clear ?x)
    :effect (and
      (not (clear ?x))
      (increase (score) 1))))`;

  const { workspace, document } = await parseDocument("file:///semantic-domain.pddl", text);
  const tokens = decodeTokens(document, (await getSemanticTokens(workspace, document)).data);

  const clearTokens = tokens.filter((token) => token.text === "clear");
  assert.ok(clearTokens.some((token) => token.type === "function" && token.declaration));
  assert.ok(clearTokens.some((token) => token.type === "function" && !token.declaration));

  const scoreTokens = tokens.filter((token) => token.text === "score");
  assert.ok(scoreTokens.some((token) => token.type === "function" && token.declaration));
  assert.ok(scoreTokens.some((token) => token.type === "function" && !token.declaration));

  assert.ok(tokens.some((token) => token.text === "increase" && token.type === "operator"));
});

test("semantic tokens mark problem domain references as namespaces", async () => {
  const text = `(define (problem tokens-problem)
  (:domain tokens)
  (:objects a - block)
  (:init (clear a))
  (:goal (clear a)))`;

  const { workspace, document } = await parseDocument("file:///semantic-problem.pddl", text);
  const tokens = decodeTokens(document, (await getSemanticTokens(workspace, document)).data);

  assert.ok(tokens.some((token) => token.text === "tokens" && token.type === "namespace"));
});
