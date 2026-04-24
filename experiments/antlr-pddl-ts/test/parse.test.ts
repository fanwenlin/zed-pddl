import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { parsePddlDocument } from "../src/index";

test("parses a minimal domain with zero syntax errors", () => {
  const result = parsePddlDocument(`(define (domain blocks)
  (:requirements :strips :typing)
  (:types block)
  (:predicates (clear ?x - block)))`);

  assert.equal(result.syntaxErrors.length, 0);
  assert.equal(result.tree.type, "pddlDoc");
});

test("parses repository sample domain and problem fixtures", () => {
  const repoRoot = path.resolve(__dirname, "../../../..");
  const domain = fs.readFileSync(path.join(repoRoot, "samples/domain.pddl"), "utf8");
  const problem = fs.readFileSync(path.join(repoRoot, "samples/problem.pddl"), "utf8");

  const domainResult = parsePddlDocument(domain);
  const problemResult = parsePddlDocument(problem);

  assert.equal(domainResult.syntaxErrors.length, 0);
  assert.equal(problemResult.syntaxErrors.length, 0);

  assert.ok(
    domainResult.tree.children.some((child) => child.type === "domain"),
    `expected domain subtree, got ${JSON.stringify(domainResult.tree, null, 2)}`,
  );
  assert.ok(
    problemResult.tree.children.some((child) => child.type === "problem"),
    `expected problem subtree, got ${JSON.stringify(problemResult.tree, null, 2)}`,
  );
});

test("parses a minimal problem with zero syntax errors", () => {
  const result = parsePddlDocument(`(define (problem blocks-problem)
  (:domain blocks)
  (:objects a - block)
  (:init (clear a))
  (:goal (clear a)))`);

  assert.equal(result.syntaxErrors.length, 0);
  assert.equal(result.tree.type, "pddlDoc");
});

test("parses a derived predicate definition", () => {
  const result = parsePddlDocument(`(define (domain d)
  (:requirements :strips :typing :derived-predicates)
  (:types thing)
  (:predicates (base ?x - thing))
  (:derived (goal ?x - thing) (base ?x)))`);

  assert.equal(result.syntaxErrors.length, 0);
});
