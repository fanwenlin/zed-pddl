# zed-pddl

PDDL language support for Zed.

Current scope:

- `*.pddl` file association
- line comments and bracket pairing
- syntax highlighting for common PDDL forms and section keywords
- Node-backed TypeScript LSP for ANTLR syntax diagnostics, semantic diagnostics for PDDL references, objects, types, and requirements, hover, signature help, definitions, references, rename, symbols, completion, and semantic tokens
- ANTLR-generated TypeScript parser workspace for validating and summarizing PDDL documents
- local dev-extension install flow for Zed

This extension uses the rebuilt `tree-sitter-pddl` grammar in `/Users/fwl/src/zed-pddl/tree-sitter-pddl` as its Zed parser source and runs the bundled TypeScript language server from `server/dist/pddl-lsp.cjs`. The ANTLR generator in `experiments/antlr-pddl-ts` is the retained parser-generation path for grammar validation and document summaries.

## Local development

1. Build the language server with `cd server && npm install && npm run build`.
   The server build bootstraps the local ANTLR parser package under `experiments/antlr-pddl-ts`.
2. Open Zed.
3. Run `zed: install dev extension`.
4. Select this repository.
5. Open one of the files in `samples/`.

You can also symlink this repository into:

`~/Library/Application Support/Zed/extensions/installed/pddl`

and restart Zed.

## LSP prerequisites

- The bundled server build output must exist at `server/dist/pddl-lsp.cjs` before compiling the extension.
- Zed provides the Node runtime for the default server command.
- You can override the command with `lsp.pddl-semantic.binary.path`.

## Verification

The repository includes protocol-level tests for the bundled language server:

```bash
cd server
npm test
```

This validates:

- `initialize`
- `hover`
- `signatureHelp`
- `definition`
- `references`
- `completion`
- `rename`
- `documentSymbol`
- `documentHighlight`
- `documentLink`
- `codeAction` quick fixes for missing requirements
- `semanticTokens/full`
- syntax and semantic diagnostics

The tree-sitter grammar has its own corpus tests:

```bash
cd tree-sitter-pddl
npm test
```

The Zed query files can be checked against the current grammar and samples:

```bash
./scripts/check-zed-queries.sh
```

The ANTLR generator path is verified separately:

```bash
cd experiments/antlr-pddl-ts
npm test
```

Example override:

```json
{
  "lsp": {
    "pddl-semantic": {
      "binary": {
        "path": "/absolute/path/to/your-wrapper-command",
        "arguments": []
      }
    }
  }
}
```
