import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

test("cli prints a JSON parse tree for a PDDL file", () => {
  const distRoot = path.resolve(__dirname, "..");
  const cliPath = path.join(distRoot, "src/cli.js");
  const repoRoot = path.resolve(__dirname, "../../../..");
  const samplePath = path.join(repoRoot, "samples/domain.pddl");

  const stdout = execFileSync(process.execPath, [cliPath, samplePath], {
    encoding: "utf8",
  });
  const payload = JSON.parse(stdout);

  assert.equal(payload.syntaxErrors.length, 0);
  assert.equal(payload.tree.type, "pddlDoc");
});

test("cli prints a JSON summary when asked", () => {
  const distRoot = path.resolve(__dirname, "..");
  const cliPath = path.join(distRoot, "src/cli.js");
  const repoRoot = path.resolve(__dirname, "../../../..");
  const samplePath = path.join(repoRoot, "samples/problem.pddl");

  const stdout = execFileSync(process.execPath, [cliPath, "--summary", samplePath], {
    encoding: "utf8",
  });
  const payload = JSON.parse(stdout);

  assert.equal(payload.kind, "problem");
  assert.equal(payload.domainName, "blocks");
  assert.deepEqual(payload.problemSections, [":domain", ":objects", ":init", ":goal"]);
});
