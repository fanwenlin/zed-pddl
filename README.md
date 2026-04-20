# zed-pddl

PDDL language support for Zed.

Current scope:

- `*.pddl` file association
- line comments and bracket pairing
- syntax highlighting for common PDDL forms and section keywords
- Node-backed LSP for diagnostics, hover, definitions, references, rename, symbols, and completion
- local dev-extension install flow for Zed

This extension uses the rebuilt `tree-sitter-pddl` grammar in `/Users/fwl/src/zed-pddl/tree-sitter-pddl` as its parser source and adds a Node-based PDDL language server that wraps `pddl-workspace`. Zed syntax highlighting is mapped directly from the current PDDL node types exposed by that grammar.

## Local development

1. Build the language server with `cd server && npm install && npm run build`.
2. Open Zed.
3. Run `zed: install dev extension`.
4. Select this repository.
5. Open one of the files in `samples/`.

You can also symlink this repository into:

`~/Library/Application Support/Zed/extensions/installed/pddl`

and restart Zed.

## LSP prerequisites

- `node` must be on your `PATH`, unless you override `lsp.pddl-semantic.binary.path`.
- The bundled server build output must exist at `server/dist/pddl-lsp.cjs`.

## Verification

The repository includes protocol-level tests for the bundled language server:

```bash
cd server
npm test
```

This validates:

- `initialize`
- `hover`
- `definition`
- `references`
- `completion`
- `rename`
- `documentSymbol`

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
