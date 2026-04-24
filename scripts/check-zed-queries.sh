#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TREE_SITTER="${TREE_SITTER:-}"

if [[ -z "$TREE_SITTER" ]]; then
  if [[ -x "$ROOT/tree-sitter-pddl/node_modules/.bin/tree-sitter" ]]; then
    TREE_SITTER="$ROOT/tree-sitter-pddl/node_modules/.bin/tree-sitter"
  else
    TREE_SITTER="$(command -v tree-sitter || true)"
  fi
fi

if [[ -z "$TREE_SITTER" || ! -x "$TREE_SITTER" ]]; then
  echo "tree-sitter CLI not found" >&2
  echo "Run: cd tree-sitter-pddl && npm install, or set TREE_SITTER=/path/to/tree-sitter" >&2
  exit 1
fi

CONFIG_DIR="$(mktemp -d)"
trap 'rm -rf "$CONFIG_DIR"' EXIT

cat >"$CONFIG_DIR/config.json" <<EOF
{"parser-directories":["$ROOT"]}
EOF

for query in brackets folds highlights outline; do
  "$TREE_SITTER" query \
    --config-path "$CONFIG_DIR/config.json" \
    --quiet \
    "$ROOT/languages/pddl/$query.scm" \
    "$ROOT/samples/domain.pddl" \
    "$ROOT/samples/problem.pddl"
done
