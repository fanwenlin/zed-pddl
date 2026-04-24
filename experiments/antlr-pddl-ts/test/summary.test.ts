import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { summarizePddlDocument } from "../src/index";

test("summarizes the repository sample domain", () => {
  const repoRoot = path.resolve(__dirname, "../../../..");
  const text = fs.readFileSync(path.join(repoRoot, "samples/domain.pddl"), "utf8");

  const summary = summarizePddlDocument(text);

  assert.equal(summary.kind, "domain");
  assert.equal(summary.name, "blocks");
  assert.deepEqual(summary.requirements, [":strips", ":typing"]);
  assert.deepEqual(summary.types, ["block"]);
  assert.deepEqual(
    summary.predicates.map((predicate) => predicate.name),
    ["on", "ontable", "clear", "holding", "handempty"],
  );
  assert.deepEqual(
    summary.actions.map((action) => action.name),
    ["pickup", "putdown", "stack", "unstack"],
  );
});

test("summarizes the repository sample problem", () => {
  const repoRoot = path.resolve(__dirname, "../../../..");
  const text = fs.readFileSync(path.join(repoRoot, "samples/problem.pddl"), "utf8");

  const summary = summarizePddlDocument(text);

  assert.equal(summary.kind, "problem");
  assert.equal(summary.name, "blocks-4-0");
  assert.equal(summary.domainName, "blocks");
  assert.deepEqual(summary.problemSections, [":domain", ":objects", ":init", ":goal"]);
  assert.deepEqual(summary.objects.map((entry) => entry.name), ["a", "b", "c", "d"]);
});

test("summarizes derived predicates and type inheritance", () => {
  const summary = summarizePddlDocument(`(define (domain d)
  (:requirements :strips :typing :derived-predicates)
  (:types car truck - vehicle thing vehicle)
  (:predicates (base ?x - thing))
  (:functions (score ?x - thing) - number)
  (:derived (goal ?x - thing) (base ?x)))`);

  assert.equal(summary.kind, "domain");
  assert.deepEqual(summary.functions.map((entry) => entry.name), ["score"]);
  assert.deepEqual(summary.derived.map((entry) => entry.name), ["goal"]);
  assert.deepEqual(summary.typeParents, {
    car: ["vehicle"],
    truck: ["vehicle"],
  });
});

test("parses uppercase problem sections and preserves original section spelling", () => {
  const summary = summarizePddlDocument(`(define (problem SeedSet-small)
(:domain SeedSet)
(:objects )
(:INIT
  (a)
  (= (total-cost) 0))
(:goal (AND
  (b)
  (c)))
(:metric minimize (total-cost))
)`);

  assert.equal(summary.syntaxErrors.length, 0);
  assert.deepEqual(summary.problemSections, [":domain", ":objects", ":INIT", ":goal", ":metric"]);
});

test("normalizes empty object section names without trailing parentheses", () => {
  const summary = summarizePddlDocument(`(define (problem p)
(:domain d)
(:objects)
(:init)
(:goal (and)))`);

  assert.equal(summary.syntaxErrors.length, 0);
  assert.deepEqual(summary.problemSections, [":domain", ":objects", ":init", ":goal"]);
});
