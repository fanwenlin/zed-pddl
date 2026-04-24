import test from "node:test";
import assert from "node:assert/strict";
import { TextDocuments } from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { LspPddlWorkspace } from "../pddl-workspace";
import { getSemanticDiagnostics } from "../semantic-diagnostics";

async function parseDocuments(...fixtures: Array<{ uri: string; text: string }>) {
  const documents = new TextDocuments(TextDocument);
  const workspace = new LspPddlWorkspace(documents);
  const parsed = [];

  for (const fixture of fixtures) {
    const document = TextDocument.create(fixture.uri, "pddl", 1, fixture.text);
    await workspace.upsertAndParseDocument(document);
    parsed.push(document);
  }

  return { workspace, documents: parsed };
}

test("diagnoses a problem that references a missing domain", async () => {
  const { workspace, documents } = await parseDocuments({
    uri: "file:///missing-domain-problem.pddl",
    text: `(define (problem p)
  (:domain missing)
  (:init)
  (:goal (and)))`,
  });

  const diagnostics = await getSemanticDiagnostics(workspace, documents[0]);

  assert.ok(
    diagnostics.some((diagnostic) =>
      diagnostic.message.includes("No domain file found for `missing`"),
    ),
  );
});

test("diagnoses undefined callables and callable arity mismatches", async () => {
  const { workspace, documents } = await parseDocuments(
    {
      uri: "file:///blocks-domain.pddl",
      text: `(define (domain blocks)
  (:requirements :strips :typing)
  (:types block)
  (:predicates (clear ?x - block))
  (:functions (height ?x - block) - number))`,
    },
    {
      uri: "file:///blocks-problem.pddl",
      text: `(define (problem p)
  (:domain blocks)
  (:objects a b - block)
  (:init
    (clear a b)
    (missing a)
    (= (height a b) 1))
  (:goal (clear a)))`,
    },
  );

  const diagnostics = await getSemanticDiagnostics(workspace, documents[1]);
  const messages = diagnostics.map((diagnostic) => diagnostic.message);

  assert.ok(messages.some((message) => message.includes("`clear` expects 1 argument")));
  assert.ok(messages.some((message) => message.includes("Undefined predicate or function `missing`")));
  assert.ok(messages.some((message) => message.includes("`height` expects 1 argument")));
});

test("diagnoses requirements missing for used PDDL features", async () => {
  const { workspace, documents } = await parseDocuments({
    uri: "file:///requirements-domain.pddl",
    text: `(define (domain requirements)
  (:requirements :typing)
  (:types block)
  (:predicates (ready))
  (:functions (score) - number)
  (:constraints (always (ready)))
  (:durative-action wait
    :parameters ()
    :duration (= ?duration 1)
    :condition (at start (ready))
    :effect (increase (score) 1)))`,
  });

  const diagnostics = await getSemanticDiagnostics(workspace, documents[0]);
  const messages = diagnostics.map((diagnostic) => diagnostic.message);

  assert.ok(messages.some((message) => message.includes(":durative-actions")));
  assert.ok(messages.some((message) => message.includes(":fluents")));
  assert.ok(messages.some((message) => message.includes(":constraints")));
});
