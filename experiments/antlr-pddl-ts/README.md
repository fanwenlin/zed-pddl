# antlr-pddl-ts

This directory contains the retained TypeScript parser-generator path built from the upstream `Pddl.g4` grammar:

- source grammar: [antlr/grammars-v4 `pddl/Pddl.g4`](https://github.com/antlr/grammars-v4/blob/master/pddl/Pddl.g4)
- generator/runtime: `antlr4ts` + `antlr4ts-cli`

What it does today:

- regenerates a TypeScript lexer/parser from `grammar/Pddl.g4`
- exposes `parsePddlDocument(text)` from [src/index.ts](/Users/fwl/src/zed-pddl/experiments/antlr-pddl-ts/src/index.ts)
- exposes `summarizePddlDocument(text)` for normalized domain/problem structure extraction
- returns collected syntax errors plus a plain JSON parse tree
- supports a `--summary` CLI mode for file-based JSON summaries
- verifies parsing against minimal fixtures and this repo's `samples/domain.pddl` and `samples/problem.pddl`

Scope boundaries:

- It is not a replacement for `tree-sitter-pddl`, which remains the Zed syntax parser.
- It is not an actual generated tree-sitter grammar.
- The Zed extension starts the TypeScript LSP from `server/dist/pddl-lsp.cjs`; this package remains the ANTLR parser-generation and validation workspace.

Useful commands:

```bash
cd /Users/fwl/src/zed-pddl/experiments/antlr-pddl-ts
npm install
npm test
npm run parse:file -- /Users/fwl/src/zed-pddl/samples/domain.pddl
npm run summarize:file -- /Users/fwl/src/zed-pddl/samples/problem.pddl
```

The build regenerates ANTLR output into `src/generated/` on every run, and that directory is intentionally git-ignored.
