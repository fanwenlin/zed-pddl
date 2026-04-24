import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { readFile } from "node:fs/promises";

type JsonRpcMessage = {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
};

const ROOT = path.resolve(__dirname, "../../..");
const SERVER = path.resolve(ROOT, "server/dist/pddl-lsp.cjs");
const DOMAIN = path.resolve(ROOT, "samples/domain.pddl");
const PROBLEM = path.resolve(ROOT, "samples/problem.pddl");

function encodeMessage(message: JsonRpcMessage): Buffer {
  const raw = Buffer.from(JSON.stringify(message), "utf8");
  return Buffer.concat([
    Buffer.from(`Content-Length: ${raw.length}\r\n\r\n`, "ascii"),
    raw,
  ]);
}

class JsonRpcClient {
  private nextId = 1;
  private stdoutBuffer = Buffer.alloc(0);
  private stderrBuffer = "";
  private messageQueue: JsonRpcMessage[] = [];

  constructor(
    private readonly server = spawn(process.execPath, [SERVER, "--stdio"], {
      cwd: path.dirname(PROBLEM),
      stdio: ["pipe", "pipe", "pipe"],
    }),
  ) {
    this.server.stdout.on("data", (chunk: Buffer) => {
      this.stdoutBuffer = Buffer.concat([this.stdoutBuffer, chunk]);
      this.drainStdout();
    });
    this.server.stderr.on("data", (chunk: Buffer) => {
      this.stderrBuffer += chunk.toString("utf8");
    });
  }

  private drainStdout(): void {
    while (true) {
      const separator = this.stdoutBuffer.indexOf("\r\n\r\n");
      if (separator === -1) {
        return;
      }

      const header = this.stdoutBuffer.subarray(0, separator).toString("ascii");
      const contentLengthLine = header
        .split("\r\n")
        .find((line) => line.toLowerCase().startsWith("content-length:"));
      if (!contentLengthLine) {
        throw new Error(`Missing content-length header: ${header}`);
      }

      const contentLength = Number(contentLengthLine.split(":")[1].trim());
      const bodyStart = separator + 4;
      if (this.stdoutBuffer.length < bodyStart + contentLength) {
        return;
      }

      const body = this.stdoutBuffer.subarray(bodyStart, bodyStart + contentLength);
      this.stdoutBuffer = this.stdoutBuffer.subarray(bodyStart + contentLength);
      this.messageQueue.push(JSON.parse(body.toString("utf8")) as JsonRpcMessage);
    }
  }

  send(message: JsonRpcMessage): void {
    this.server.stdin.write(encodeMessage(message));
  }

  notify(method: string, params?: unknown): void {
    this.send({ jsonrpc: "2.0", method, params });
  }

  async request(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId++;
    this.send({ jsonrpc: "2.0", id, method, params });
    const deadline = Date.now() + 5000;

    while (Date.now() < deadline) {
      const hit = this.messageQueue.find((message) => message.id === id);
      if (hit) {
        this.messageQueue = this.messageQueue.filter((message) => message !== hit);
        if (hit.error) {
          throw new Error(`${method} failed: ${JSON.stringify(hit.error)}\nstderr=${this.stderrBuffer}`);
        }
        return hit.result;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    throw new Error(`Timed out waiting for ${method}\nstderr=${this.stderrBuffer}`);
  }

  async waitForNotification(
    method: string,
    predicate: (message: JsonRpcMessage) => boolean = () => true,
  ): Promise<JsonRpcMessage> {
    const deadline = Date.now() + 5000;

    while (Date.now() < deadline) {
      const hit = this.messageQueue.find(
        (message) => message.method === method && predicate(message),
      );
      if (hit) {
        this.messageQueue = this.messageQueue.filter((message) => message !== hit);
        return hit;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    throw new Error(`Timed out waiting for ${method}\nstderr=${this.stderrBuffer}`);
  }

  async shutdown(): Promise<void> {
    await this.request("shutdown", null);
    this.notify("exit");
    await new Promise((resolve) => this.server.on("exit", resolve));
  }

  get stderr(): string {
    return this.stderrBuffer;
  }
}

test("protocol smoke test covers semantic features", async () => {
  const client = new JsonRpcClient();
  const rootUri = new URL(`file://${path.dirname(PROBLEM)}/`).toString();
  const domainUri = new URL(`file://${DOMAIN}`).toString();
  const problemUri = new URL(`file://${PROBLEM}`).toString();
  const domainText = await readFile(DOMAIN, "utf8");
  const problemText = await readFile(PROBLEM, "utf8");

  const initialize = (await client.request("initialize", {
    processId: null,
    rootUri,
    capabilities: {},
    workspaceFolders: [{ uri: rootUri, name: "samples" }],
  })) as { capabilities: Record<string, unknown> };

  client.notify("initialized", {});
  client.notify("textDocument/didOpen", {
    textDocument: {
      uri: domainUri,
      languageId: "pddl",
      version: 1,
      text: domainText,
    },
  });
  client.notify("textDocument/didOpen", {
    textDocument: {
      uri: problemUri,
      languageId: "pddl",
      version: 1,
      text: problemText,
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 100));

  const hover = (await client.request("textDocument/hover", {
    textDocument: { uri: problemUri },
    position: { line: 5, character: 7 },
  })) as { contents?: { value?: string } };

  const definition = (await client.request("textDocument/definition", {
    textDocument: { uri: problemUri },
    position: { line: 5, character: 7 },
  })) as { uri?: string };

  const references = (await client.request("textDocument/references", {
    textDocument: { uri: problemUri },
    position: { line: 5, character: 7 },
    context: { includeDeclaration: true },
  })) as Array<unknown>;

  const completion = (await client.request("textDocument/completion", {
    textDocument: { uri: problemUri },
    position: { line: 11, character: 3 },
  })) as Array<{ label: string }>;

  const rename = (await client.request("textDocument/rename", {
    textDocument: { uri: problemUri },
    position: { line: 5, character: 7 },
    newName: "ontable2",
  })) as { changes?: Record<string, unknown> };

  const symbols = (await client.request("textDocument/documentSymbol", {
    textDocument: { uri: domainUri },
  })) as Array<{ name: string }>;

  const semanticTokens = (await client.request("textDocument/semanticTokens/full", {
    textDocument: { uri: domainUri },
  })) as { data?: number[] };

  const signatureHelp = (await client.request("textDocument/signatureHelp", {
    textDocument: { uri: problemUri },
    position: { line: 14, character: 12 },
  })) as { signatures?: Array<{ label?: string }> };

  const highlights = (await client.request("textDocument/documentHighlight", {
    textDocument: { uri: problemUri },
    position: { line: 5, character: 7 },
  })) as Array<{ range?: { start?: { line?: number }; end?: { line?: number } } }>;

  const links = (await client.request("textDocument/documentLink", {
    textDocument: { uri: problemUri },
  })) as Array<{ target?: string; range?: { start?: { line?: number; character?: number } } }>;

  await client.shutdown();

  assert.equal(initialize.capabilities.hoverProvider, true);
  assert.equal(initialize.capabilities.documentHighlightProvider, true);
  assert.deepEqual(initialize.capabilities.documentLinkProvider, { resolveProvider: false });
  assert.match(hover.contents?.value ?? "", /Predicate/);
  assert.match(definition.uri ?? "", /domain\.pddl$/);
  assert.ok(references.length >= 2);
  assert.ok(completion.some((item) => item.label === ":goal"));
  assert.ok(completion.some((item) => item.label === "ontable"));
  assert.deepEqual(Object.keys(rename.changes ?? {}).sort(), [domainUri, problemUri]);
  assert.ok(symbols.some((item) => item.name === "pickup"));
  assert.ok((semanticTokens.data?.length ?? 0) > 0);
  assert.ok(
    signatureHelp.signatures?.some((signature) =>
      signature.label?.includes("(on ?x ?y - block)"),
    ),
  );
  assert.deepEqual(
    highlights.map((highlight) => highlight.range?.start?.line).sort(),
    [5, 6],
  );
  assert.ok(links.some((link) =>
    link.target === domainUri &&
    link.range?.start?.line === 2 &&
    link.range.start.character === 11
  ));
  assert.equal(client.stderr, "");
});

test("publishes ANTLR syntax diagnostics for malformed documents", async () => {
  const client = new JsonRpcClient();
  const rootUri = new URL(`file://${path.dirname(PROBLEM)}/`).toString();
  const brokenUri = new URL(`file://${path.resolve(path.dirname(PROBLEM), "broken.pddl")}`).toString();

  await client.request("initialize", {
    processId: null,
    rootUri,
    capabilities: {},
    workspaceFolders: [{ uri: rootUri, name: "samples" }],
  });

  client.notify("initialized", {});
  client.notify("textDocument/didOpen", {
    textDocument: {
      uri: brokenUri,
      languageId: "pddl",
      version: 1,
      text: `(define (domain broken)
  (:predicates (ready)
  (:action move
    :parameters ()
    :precondition (ready)
    :effect (ready)))`,
    },
  });

  const diagnostics = await client.waitForNotification(
    "textDocument/publishDiagnostics",
    (message) => {
      const params = message.params as { uri?: string; diagnostics?: Array<{ source?: string }> };
      return params.uri === brokenUri && (params.diagnostics?.length ?? 0) > 0;
    },
  );

  await client.shutdown();

  const params = diagnostics.params as {
    diagnostics: Array<{ source?: string; severity?: number; message?: string }>;
  };
  assert.ok(
    params.diagnostics.some((diagnostic) => diagnostic.source === "antlr-pddl-ts"),
    JSON.stringify(params.diagnostics, null, 2),
  );
});

test("publishes semantic diagnostics for unresolved PDDL references", async () => {
  const client = new JsonRpcClient();
  const rootUri = new URL(`file://${path.dirname(PROBLEM)}/`).toString();
  const domainUri = new URL(`file://${path.resolve(path.dirname(PROBLEM), "semantic-domain.pddl")}`).toString();
  const problemUri = new URL(`file://${path.resolve(path.dirname(PROBLEM), "semantic-problem.pddl")}`).toString();

  await client.request("initialize", {
    processId: null,
    rootUri,
    capabilities: {},
    workspaceFolders: [{ uri: rootUri, name: "samples" }],
  });

  client.notify("initialized", {});
  client.notify("textDocument/didOpen", {
    textDocument: {
      uri: domainUri,
      languageId: "pddl",
      version: 1,
      text: `(define (domain semantic)
  (:requirements :strips :typing)
  (:types block)
  (:predicates (clear ?x - block))
  (:functions (height ?x - block) - number))`,
    },
  });
  client.notify("textDocument/didOpen", {
    textDocument: {
      uri: problemUri,
      languageId: "pddl",
      version: 1,
      text: `(define (problem semantic-problem)
  (:domain semantic)
  (:objects a b - block)
  (:init
    (clear a b)
    (missing a)
    (= (height a b) 1))
  (:goal (clear a)))`,
    },
  });

  const diagnostics = await client.waitForNotification(
    "textDocument/publishDiagnostics",
    (message) => {
      const params = message.params as { uri?: string; diagnostics?: Array<{ source?: string }> };
      return (
        params.uri === problemUri &&
        (params.diagnostics?.some((diagnostic) => diagnostic.source === "pddl-semantic") ?? false)
      );
    },
  );

  await client.shutdown();

  const params = diagnostics.params as {
    diagnostics: Array<{ source?: string; severity?: number; message?: string }>;
  };
  const messages = params.diagnostics.map((diagnostic) => diagnostic.message ?? "");
  assert.ok(messages.some((message) => message.includes("`clear` expects 1 argument")));
  assert.ok(messages.some((message) => message.includes("Undefined predicate or function `missing`")));
  assert.ok(messages.some((message) => message.includes("`height` expects 1 argument")));
  assert.equal(client.stderr, "");
});

test("refreshes open problem diagnostics after a domain document opens", async () => {
  const client = new JsonRpcClient();
  const rootUri = new URL(`file://${path.dirname(PROBLEM)}/`).toString();
  const domainUri = new URL(`file://${path.resolve(path.dirname(PROBLEM), "late-domain.pddl")}`).toString();
  const problemUri = new URL(`file://${path.resolve(path.dirname(PROBLEM), "late-problem.pddl")}`).toString();

  await client.request("initialize", {
    processId: null,
    rootUri,
    capabilities: {},
    workspaceFolders: [{ uri: rootUri, name: "samples" }],
  });

  client.notify("initialized", {});
  client.notify("textDocument/didOpen", {
    textDocument: {
      uri: problemUri,
      languageId: "pddl",
      version: 1,
      text: `(define (problem late-problem)
  (:domain late)
  (:init)
  (:goal (ready)))`,
    },
  });

  await client.waitForNotification(
    "textDocument/publishDiagnostics",
    (message) => {
      const params = message.params as { uri?: string; diagnostics?: Array<{ message?: string }> };
      return (
        params.uri === problemUri &&
        (params.diagnostics?.some((diagnostic) =>
          diagnostic.message?.includes("No domain file found for `late`"),
        ) ?? false)
      );
    },
  );

  client.notify("textDocument/didOpen", {
    textDocument: {
      uri: domainUri,
      languageId: "pddl",
      version: 1,
      text: `(define (domain late)
  (:requirements :strips)
  (:predicates (ready)))`,
    },
  });

  const refreshed = await client.waitForNotification(
    "textDocument/publishDiagnostics",
    (message) => {
      const params = message.params as { uri?: string; diagnostics?: Array<{ message?: string }> };
      return (
        params.uri === problemUri &&
        (params.diagnostics?.every((diagnostic) =>
          !diagnostic.message?.includes("No domain file found for `late`"),
        ) ?? false)
      );
    },
  );

  await client.shutdown();

  const params = refreshed.params as {
    diagnostics: Array<{ source?: string; severity?: number; message?: string }>;
  };
  assert.equal(params.diagnostics.length, 0, JSON.stringify(params.diagnostics, null, 2));
  assert.equal(client.stderr, "");
});

test("provides a quick fix for missing requirement diagnostics", async () => {
  const client = new JsonRpcClient();
  const rootUri = new URL(`file://${path.dirname(PROBLEM)}/`).toString();
  const domainUri = new URL(`file://${path.resolve(path.dirname(PROBLEM), "requirements-fix-domain.pddl")}`).toString();

  try {
    const initialize = (await client.request("initialize", {
      processId: null,
      rootUri,
      capabilities: {},
      workspaceFolders: [{ uri: rootUri, name: "samples" }],
    })) as { capabilities: Record<string, unknown> };

    client.notify("initialized", {});
    client.notify("textDocument/didOpen", {
      textDocument: {
        uri: domainUri,
        languageId: "pddl",
        version: 1,
        text: `(define (domain requirements-fix)
  (:requirements :typing)
  (:types block)
  (:predicates (ready))
  (:functions (score) - number)
  (:action wait
    :parameters ()
    :precondition (ready)
    :effect (increase (score) 1)))`,
      },
    });

    const diagnosticsNotification = await client.waitForNotification(
      "textDocument/publishDiagnostics",
      (message) => {
        const params = message.params as { uri?: string; diagnostics?: Array<{ message?: string }> };
        return (
          params.uri === domainUri &&
          (params.diagnostics?.some((diagnostic) =>
            diagnostic.message?.includes("Missing :fluents requirement"),
          ) ?? false)
        );
      },
    );

    const diagnostics = (diagnosticsNotification.params as {
      diagnostics: Array<{ range: unknown; message?: string; source?: string }>;
    }).diagnostics;
    const diagnostic = diagnostics.find((item) =>
      item.message?.includes("Missing :fluents requirement"),
    );
    assert.ok(diagnostic);

    const actions = (await client.request("textDocument/codeAction", {
      textDocument: { uri: domainUri },
      range: diagnostic.range,
      context: { diagnostics: [diagnostic] },
    })) as Array<{
      title?: string;
      kind?: string;
      edit?: { changes?: Record<string, Array<{ newText?: string }>> };
    }>;

    assert.deepEqual(initialize.capabilities.codeActionProvider, {
      codeActionKinds: ["quickfix"],
    });
    assert.ok(actions.some((action) =>
      action.title === "Add :fluents requirement" &&
      action.kind === "quickfix" &&
      action.edit?.changes?.[domainUri]?.some((edit) => edit.newText === " :fluents")
    ));
  } finally {
    await client.shutdown();
  }

  assert.equal(client.stderr, "");
});
