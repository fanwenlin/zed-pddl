# PDDL LSP Design

## Goal

Add a real LSP-backed editing experience to the existing Zed PDDL extension.

## Scope

- Keep the current Tree-sitter based syntax/highlighting.
- Add an external language server for `PDDL`.
- Target these features first:
  - diagnostics
  - hover
  - go to definition
  - find references
  - completion
  - rename
  - document symbols

## Chosen Approach

Use a hybrid extension:

- Rust/Wasm Zed extension layer:
  - registers the language server in `extension.toml`
  - implements `language_server_command`
  - resolves runtime dependencies from the user environment
  - launches a Node-based PDDL LSP process over stdio
- Node LSP server:
  - uses `pddl-workspace` as the semantic model and parser backend
  - maps its workspace/symbol/diagnostic capabilities to standard LSP methods

## Why This Approach

- A pure syntax extension is already working; this adds semantics without replacing it.
- There is no clearly maintained standalone PDDL LSP with a simple binary install path.
- `pddl-workspace` already contains the domain/problem parsing and symbol logic we need.
- Zed officially supports this pattern through `language_server_command`.

## Rejected Alternatives

### Reuse a separate off-the-shelf PDDL LSP

Rejected because no strong standalone server surfaced during research.

### Port the full VS Code PDDL extension behavior

Rejected for now because it is much broader than the selected scope and contains planner, validation, webview, and session features that are not needed for the first Zed LSP milestone.

## Architecture

### Rust extension layer

- `Cargo.toml` builds the wasm extension.
- `src/lib.rs` implements the Zed extension trait.
- It starts the language server named `pddl-lsp`.
- It prefers user-installed runtimes on PATH instead of silently bundling a large toolchain.

### Node language server

- `server/package.json` defines the server package.
- `server/src/server.ts` implements the LSP entrypoint.
- `server/src/workspace.ts` adapts `pddl-workspace` to the LSP document/workspace model.
- `server/src/features/*` contains capability handlers if the server grows.

## Runtime Strategy

Initial implementation:

- Require `node` on PATH.
- Install workspace npm dependencies locally in the repo.
- Start the server with `node server/dist/server.js`.

This keeps the first version simple and debuggable. Auto-download or vendoring Node can be added later if needed.

## Error Handling

- If `node` is missing, return a clear startup error from the Rust extension.
- If the server build output is missing, return a clear startup error telling the user to build/install dependencies.
- If `pddl-workspace` fails to parse a document, surface diagnostics rather than crashing the server.

## Testing

- Open sample `.pddl` files in Zed and confirm the language stays `PDDL`.
- Confirm the language server starts from Zed logs.
- Verify diagnostics on malformed PDDL.
- Verify hover/definition/references/rename/document symbols on the sample domain/problem pair.

## Non-Goals

- planner integration
- VAL integration
- code actions beyond what falls out naturally from rename/diagnostics
- plan or happenings language support
