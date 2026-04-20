# PDDL Highlighting Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove stale pre-rebuild grammar artifacts and align Zed highlighting with the current `tree-sitter-pddl` syntax tree.

**Architecture:** Treat `/Users/fwl/src/zed-pddl/tree-sitter-pddl` as the only authoritative grammar source, delete the stale duplicate grammar tree, and map Zed highlight styles directly to the rebuilt node types in `tree-sitter-pddl/src/node-types.json`. Keep syntax highlighting and semantic token styling consistent so Tree-sitter and the language server describe the same symbols the same way.

**Tech Stack:** Zed extension manifests, Tree-sitter query files, TypeScript LSP semantic tokens, Rust extension bootstrap, Node-based tests

---

### Task 1: Remove stale grammar source and update repository metadata

**Files:**
- Modify: `/Users/fwl/src/zed-pddl/README.md`
- Modify: `/Users/fwl/src/zed-pddl/extension.toml`
- Delete: `/Users/fwl/src/zed-pddl/grammars/pddl`

- [ ] **Step 1: Confirm the stale grammar copy is not the active source**

Run: `rg -n "grammars/pddl|tree-sitter-pddl|Common Lisp Tree-sitter" /Users/fwl/src/zed-pddl`
Expected: active grammar references point at `tree-sitter-pddl`, while stale README text still mentions the Common Lisp backend.

- [ ] **Step 2: Delete the stale grammar directory**

Run: `rm -rf /Users/fwl/src/zed-pddl/grammars/pddl`
Expected: the duplicate grammar source disappears and only the active grammar tree remains.

- [ ] **Step 3: Rewrite repository metadata to match the rebuilt parser**

Update the docs and manifest so they describe the extension as using the rebuilt PDDL Tree-sitter grammar instead of layering on Common Lisp.

- [ ] **Step 4: Re-scan references**

Run: `rg -n "grammars/pddl|Common Lisp Tree-sitter" /Users/fwl/src/zed-pddl`
Expected: no remaining references to the deleted grammar copy or the obsolete parser description.

### Task 2: Remap syntax highlighting to current Tree-sitter nodes

**Files:**
- Modify: `/Users/fwl/src/zed-pddl/languages/pddl/highlights.scm`
- Modify: `/Users/fwl/src/zed-pddl/languages/pddl/semantic_token_rules.json`
- Reference: `/Users/fwl/src/zed-pddl/tree-sitter-pddl/src/node-types.json`

- [ ] **Step 1: Identify the semantic categories exposed by the rebuilt grammar**

Run: `rg -n 'action_name|predicate_name|function_name|type_name|constant_name|object_name|domain_name|comparison_expression|assign_effect|derived_definition' /Users/fwl/src/zed-pddl/tree-sitter-pddl/src/node-types.json`
Expected: the rebuilt grammar exposes stable node names for declarations, references, and numeric/logical operators.

- [ ] **Step 2: Write the highlight query against concrete node types**

Add query rules for declaration sites and operator tokens using `action_name`, `predicate_name`, `function_name`, `type_name`, `constant_name`, `object_name`, `domain_name`, `comparison_expression`, `assign_effect`, `goal_*`, and `effect_*` nodes rather than broad fallback matching.

- [ ] **Step 3: Keep semantic token style fallback aligned**

Update the JSON style map so LSP semantic token categories still land on the same Zed styles chosen by the syntax query.

- [ ] **Step 4: Re-read the final query for redundant broad matches**

Run: `sed -n '1,240p' /Users/fwl/src/zed-pddl/languages/pddl/highlights.scm`
Expected: node-specific mappings take precedence and generic `(name)` catches are limited to true fallbacks.

### Task 3: Verify references and runtime checks

**Files:**
- Modify if needed: `/Users/fwl/src/zed-pddl/server/src/semantic.ts`
- Test: `/Users/fwl/src/zed-pddl/server/src/test/protocol.test.ts`
- Test: `/Users/fwl/src/zed-pddl/server/src/test/symbols.test.ts`

- [ ] **Step 1: Check whether semantic token generation still matches the intended categories**

Run: `sed -n '1,260p' /Users/fwl/src/zed-pddl/server/src/semantic.ts`
Expected: semantic token categories still correspond to the remapped highlight classes, or obvious mismatches are identified and fixed.

- [ ] **Step 2: Run language-server tests**

Run: `cd /Users/fwl/src/zed-pddl/server && npm test`
Expected: test suite passes.

- [ ] **Step 3: Run a repository-wide stale reference scan**

Run: `rg -n "grammars/pddl|Common Lisp Tree-sitter|layers PDDL-specific highlight queries on top" /Users/fwl/src/zed-pddl`
Expected: no stale references remain.
