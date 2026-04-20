import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { TextDocuments } from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { LspPddlWorkspace } from "../pddl-workspace";
import { getCompletionItems } from "../completion";
import { getDocumentSymbols, resolveSymbol } from "../symbols";

async function loadFixture(name: string): Promise<{ uri: string; text: string }> {
  const filePath = path.resolve(__dirname, "../../../samples", name);
  return {
    uri: `file://${filePath}`,
    text: await fs.readFile(filePath, "utf8"),
  };
}

async function createWorkspace() {
  const documents = new TextDocuments(TextDocument);
  const workspace = new LspPddlWorkspace(documents);
  const domain = await loadFixture("domain.pddl");
  const problem = await loadFixture("problem.pddl");
  const domainDocument = TextDocument.create(domain.uri, "pddl", 1, domain.text);
  const problemDocument = TextDocument.create(problem.uri, "pddl", 1, problem.text);
  await workspace.upsertAndParseDocument(domainDocument);
  await workspace.upsertAndParseDocument(problemDocument);
  return { workspace, domainDocument, problemDocument };
}

test("document symbols include domain actions", async () => {
  const { workspace, domainDocument } = await createWorkspace();
  const symbols = await getDocumentSymbols(workspace, domainDocument);
  assert.ok(
    symbols.some((symbol) => "name" in symbol && symbol.name === "pickup"),
  );
});

test("hover/definition resolve predicate usage back to the domain", async () => {
  const { workspace, problemDocument } = await createWorkspace();
  const symbol = await resolveSymbol(workspace, problemDocument, {
    line: 5,
    character: 7,
  });
  assert.ok(symbol);
  assert.match(symbol.location.uri, /domain\.pddl$/);
});

test("completion includes PDDL section keywords and domain predicates", async () => {
  const { workspace, problemDocument } = await createWorkspace();
  const items = await getCompletionItems(workspace, problemDocument, {
    line: 11,
    character: 3,
  });
  assert.ok(items.some((item) => item.label === ":goal"));
  assert.ok(items.some((item) => item.label === "ontable"));
});
