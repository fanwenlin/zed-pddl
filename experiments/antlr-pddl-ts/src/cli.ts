#!/usr/bin/env node

import path from "node:path";

import { parsePddlFile, summarizePddlFile } from "./index";

function main(): void {
  const args = process.argv.slice(2);
  const summaryMode = args[0] === "--summary";
  const filePath = summaryMode ? args[1] : args[0];
  if (!filePath) {
    console.error("Usage: node dist/src/cli.js [--summary] <file.pddl>");
    process.exit(1);
  }

  const resolvedPath = path.resolve(filePath);
  const result = summaryMode
    ? summarizePddlFile(resolvedPath)
    : parsePddlFile(resolvedPath);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main();
