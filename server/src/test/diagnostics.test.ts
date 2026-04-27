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

test("diagnoses undeclared problem objects in callable arguments", async () => {
  const { workspace, documents } = await parseDocuments(
    {
      uri: "file:///objects-domain.pddl",
      text: `(define (domain delivery)
  (:requirements :strips :typing)
  (:types city package)
  (:predicates (at-package ?p - package ?c - city)))`,
    },
    {
      uri: "file:///objects-problem.pddl",
      text: `(define (problem p)
  (:domain delivery)
  (:objects c1 - city pkg1 - package)
  (:init (at-package pkg2 c1))
  (:goal (at-package pkg1 c2)))`,
    },
  );

  const diagnostics = await getSemanticDiagnostics(workspace, documents[1]);
  const messages = diagnostics.map((diagnostic) => diagnostic.message);

  assert.ok(messages.some((message) => message.includes("Undefined object or constant `pkg2`")));
  assert.ok(messages.some((message) => message.includes("Undefined object or constant `c2`")));
});

test("diagnoses callable argument type mismatches", async () => {
  const { workspace, documents } = await parseDocuments(
    {
      uri: "file:///types-domain.pddl",
      text: `(define (domain delivery)
  (:requirements :strips :typing)
  (:types city vehicle truck - vehicle package)
  (:constants hub - city)
  (:predicates (road ?from ?to - city) (at-truck ?t - truck ?c - city) (loaded ?p - package ?t - truck)))`,
    },
    {
      uri: "file:///types-problem.pddl",
      text: `(define (problem p)
  (:domain delivery)
  (:objects c1 - city truck1 - truck pkg1 - package)
  (:init
    (road c1 hub)
    (road truck1 c1)
    (loaded c1 truck1)
    (at-truck pkg1 c1))
  (:goal (and)))`,
    },
  );

  const diagnostics = await getSemanticDiagnostics(workspace, documents[1]);
  const messages = diagnostics.map((diagnostic) => diagnostic.message);

  assert.ok(messages.some((message) => message.includes("`truck1` has type `truck`, but `road` expects `city`")));
  assert.ok(messages.some((message) => message.includes("`c1` has type `city`, but `loaded` expects `package`")));
  assert.ok(messages.some((message) => message.includes("`pkg1` has type `package`, but `at-truck` expects `truck`")));
  assert.ok(!messages.some((message) => message.includes("hub")));
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
