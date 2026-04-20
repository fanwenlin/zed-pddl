import http from "node:http";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const ROOT = "/Users/fwl/src/zed-pddl";
const GRAMMAR_DIR = path.join(ROOT, "tree-sitter-pddl");
const TREE_SITTER = "/opt/homebrew/bin/tree-sitter";
const HOST = "127.0.0.1";
const PORT = 4312;

const SAMPLE_ROOTS = [
  {
    label: "Repo Samples",
    root: path.join(ROOT, "samples"),
  },
  {
    label: "Agricola IPC",
    root: "/Users/fwl/src/tddd48-labs/demo/ipc/agricola-opt18-strips",
  },
];

function json(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function text(res, status, content, type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type });
  res.end(content);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function isAllowedPath(candidate) {
  const normalized = path.resolve(candidate);
  return SAMPLE_ROOTS.some(({ root }) => normalized.startsWith(path.resolve(root) + path.sep) || normalized === path.resolve(root));
}

async function listSamples() {
  const groups = [];
  for (const { label, root } of SAMPLE_ROOTS) {
    const entries = await fs.readdir(root, { withFileTypes: true });
    groups.push({
      label,
      root,
      files: entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".pddl"))
        .map((entry) => ({
          name: entry.name,
          path: path.join(root, entry.name),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    });
  }
  return groups;
}

async function parseSource(source, filename = "input.pddl") {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pddl-ast-"));
  const tempPath = path.join(tempDir, filename.endsWith(".pddl") ? filename : `${filename}.pddl`);
  await fs.writeFile(tempPath, source, "utf8");

  try {
    const [{ stdout: tree, stderr: treeErr }, { stdout: xml, stderr: xmlErr }] = await Promise.all([
      execFileAsync(TREE_SITTER, ["parse", tempPath], { cwd: GRAMMAR_DIR, maxBuffer: 10 * 1024 * 1024 }),
      execFileAsync(TREE_SITTER, ["parse", "--xml", tempPath], { cwd: GRAMMAR_DIR, maxBuffer: 10 * 1024 * 1024 }),
    ]);

    return {
      tree,
      treeErr,
      xml,
      xmlErr,
      ast: parseTreeXml(xml),
      tempPath,
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

function parseTreeXml(xml) {
  const tagPattern = /<[^>]+>/g;
  const stack = [];
  let root = null;

  for (const match of xml.matchAll(tagPattern)) {
    const tag = match[0];
    if (tag.startsWith("<?")) continue;
    if (tag.startsWith("</")) {
      stack.pop();
      continue;
    }

    const selfClosing = tag.endsWith("/>");
    const inner = tag.slice(1, selfClosing ? -2 : -1).trim();
    const [type, ...attrParts] = inner.split(/\s+/);
    const attrs = {};
    for (const attr of attrParts) {
      const eq = attr.indexOf("=");
      if (eq === -1) continue;
      const key = attr.slice(0, eq);
      const value = attr.slice(eq + 1).replace(/^"/, "").replace(/"$/, "");
      attrs[key] = value;
    }

    const node = {
      type,
      field: attrs.field ?? null,
      srow: Number(attrs.srow ?? 0),
      scol: Number(attrs.scol ?? 0),
      erow: Number(attrs.erow ?? 0),
      ecol: Number(attrs.ecol ?? 0),
      children: [],
    };

    if (stack.length > 0) {
      stack[stack.length - 1].children.push(node);
    } else {
      root = node;
    }

    if (!selfClosing) {
      stack.push(node);
    }
  }

  return root;
}

const INDEX_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>PDDL AST Explorer</title>
  <style>
    :root {
      --bg: #0e1117;
      --panel: #161b22;
      --panel-2: #1f2630;
      --text: #d7dde5;
      --muted: #94a0b2;
      --border: #2c3440;
      --accent: #64c8ff;
      --accent-2: #ffb45e;
      --danger: #ff7b72;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: linear-gradient(180deg, #0e1117 0%, #10151c 100%);
      color: var(--text);
      font: 14px/1.45 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      height: 100vh;
      display: grid;
      grid-template-rows: auto 1fr;
    }
    header {
      display: flex;
      gap: 12px;
      align-items: center;
      padding: 12px 16px;
      border-bottom: 1px solid var(--border);
      background: rgba(14, 17, 23, 0.9);
      backdrop-filter: blur(10px);
    }
    header strong { color: var(--accent); }
    header span { color: var(--muted); }
    main {
      display: grid;
      grid-template-columns: 1.05fr 0.95fr;
      min-height: 0;
    }
    section {
      min-width: 0;
      min-height: 0;
      display: flex;
      flex-direction: column;
      border-right: 1px solid var(--border);
    }
    section:last-child { border-right: 0; }
    .toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      padding: 12px 12px 10px;
      background: var(--panel);
      border-bottom: 1px solid var(--border);
    }
    select, button, input[type=file] {
      font: inherit;
    }
    select, button {
      border: 1px solid var(--border);
      background: var(--panel-2);
      color: var(--text);
      padding: 8px 10px;
      border-radius: 10px;
    }
    button.primary {
      background: linear-gradient(180deg, #17324a 0%, #112638 100%);
      border-color: #2a587f;
      color: #c8edff;
    }
    textarea, pre {
      margin: 0;
      border: 0;
      padding: 14px 16px;
      width: 100%;
      height: 100%;
      resize: none;
      background: #0d1117;
      color: var(--text);
      font: inherit;
    }
    .right {
      display: grid;
      grid-template-rows: auto 1fr;
      min-height: 0;
    }
    .tabs {
      display: flex;
      gap: 8px;
      padding: 12px;
      background: var(--panel);
      border-bottom: 1px solid var(--border);
    }
    .tab {
      padding: 7px 10px;
      border: 1px solid var(--border);
      border-radius: 999px;
      color: var(--muted);
      cursor: pointer;
      user-select: none;
    }
    .tab.active {
      color: var(--text);
      border-color: var(--accent);
      background: rgba(100, 200, 255, 0.08);
    }
    .panes {
      position: relative;
      min-height: 0;
      height: 100%;
    }
    .pane {
      position: absolute;
      inset: 0;
      display: none;
      overflow: auto;
    }
    .pane.active { display: block; }
    .meta {
      padding: 10px 16px;
      color: var(--muted);
      border-top: 1px solid var(--border);
      background: var(--panel);
    }
    .error { color: var(--danger); white-space: pre-wrap; }
    .tree {
      padding: 10px 12px 18px;
      min-height: 100%;
      background: #0d1117;
    }
    .tree-row {
      display: flex;
      align-items: center;
      gap: 6px;
      white-space: nowrap;
      padding: 1px 0;
      cursor: default;
      border-radius: 6px;
    }
    .tree-row:hover {
      background: rgba(100, 200, 255, 0.08);
    }
    .tree-row.selected {
      background: rgba(255, 180, 94, 0.12);
      outline: 1px solid rgba(255, 180, 94, 0.4);
    }
    .tree-toggle {
      width: 16px;
      color: var(--muted);
      user-select: none;
      cursor: pointer;
      text-align: center;
      flex: 0 0 16px;
    }
    .tree-spacer {
      width: 16px;
      flex: 0 0 16px;
    }
    .tree-type {
      color: var(--accent);
      font-weight: 600;
    }
    .tree-field {
      color: var(--accent-2);
    }
    .tree-range {
      color: var(--muted);
    }
    .tree-children {
      margin-left: 18px;
      border-left: 1px solid rgba(255,255,255,0.06);
      padding-left: 10px;
    }
  </style>
</head>
<body>
  <header>
    <strong>PDDL AST Explorer</strong>
    <span>Validate tree-sitter-pddl before integrating with Zed.</span>
  </header>
  <main>
    <section>
      <div class="toolbar">
        <select id="sampleSelect"></select>
        <button id="loadSample">Load Sample</button>
        <input id="fileInput" type="file" accept=".pddl" />
        <button class="primary" id="parseBtn">Parse</button>
      </div>
      <textarea id="source"></textarea>
      <div class="meta" id="sourceMeta">Ready.</div>
    </section>
    <section class="right">
      <div class="tabs">
        <div class="tab active" data-pane="tree">Tree</div>
        <div class="tab" data-pane="raw">Raw</div>
        <div class="tab" data-pane="xml">XML</div>
        <div class="tab" data-pane="stderr">stderr</div>
      </div>
      <div class="panes">
        <div class="pane active" id="pane-tree"><div id="treeOut" class="tree"></div></div>
        <div class="pane" id="pane-raw"><pre id="rawTreeOut"></pre></div>
        <div class="pane" id="pane-xml"><pre id="xmlOut"></pre></div>
        <div class="pane" id="pane-stderr"><pre id="stderrOut" class="error"></pre></div>
      </div>
    </section>
  </main>
  <script>
    const sampleSelect = document.getElementById('sampleSelect');
    const source = document.getElementById('source');
    const sourceMeta = document.getElementById('sourceMeta');
    const treeOut = document.getElementById('treeOut');
    const rawTreeOut = document.getElementById('rawTreeOut');
    const xmlOut = document.getElementById('xmlOut');
    const stderrOut = document.getElementById('stderrOut');
    const fileInput = document.getElementById('fileInput');
    let astState = null;
    let selectedNode = null;

    async function fetchJson(url, options = {}) {
      const res = await fetch(url, options);
      if (!res.ok) throw new Error(await res.text());
      return await res.json();
    }

    function setStatus(text) {
      sourceMeta.textContent = text;
    }

    function lineOffsets(text) {
      const lines = text.split('\\n');
      const offsets = [0];
      for (let i = 0; i < lines.length; i++) {
        offsets.push(offsets[offsets.length - 1] + lines[i].length + 1);
      }
      return offsets;
    }

    function highlightRange(node) {
      if (!node) return;
      const offsets = lineOffsets(source.value);
      const start = (offsets[node.srow] ?? 0) + node.scol;
      const end = (offsets[node.erow] ?? offsets[offsets.length - 1]) + node.ecol;
      source.focus();
      source.setSelectionRange(start, end);
    }

    function nodeId(node) {
      return [node.field || '_', node.type, node.srow, node.scol, node.erow, node.ecol].join(':');
    }

    function setSelectedNode(node, { highlight = true } = {}) {
      selectedNode = node;
      if (highlight) {
        highlightRange(node);
      }
      renderTree();
      const selectedEl = treeOut.querySelector('.tree-row.selected');
      if (selectedEl) {
        selectedEl.scrollIntoView({ block: 'nearest' });
      }
    }

    function makeNodeElement(node, depth = 0) {
      const wrapper = document.createElement('div');
      const row = document.createElement('div');
      row.className = 'tree-row';
      row.dataset.depth = String(depth);
      row.dataset.nodeId = nodeId(node);
      if (selectedNode && nodeId(selectedNode) === nodeId(node)) {
        row.classList.add('selected');
      }

      const hasChildren = node.children && node.children.length > 0;
      const toggle = document.createElement('div');
      toggle.className = hasChildren ? 'tree-toggle' : 'tree-spacer';
      toggle.textContent = hasChildren ? (node.expanded ? '−' : '+') : '';
      row.appendChild(toggle);

      const type = document.createElement('span');
      type.className = 'tree-type';
      type.textContent = node.type;
      if (node.field) {
        const field = document.createElement('span');
        field.className = 'tree-field';
        field.textContent = node.field + ':';
        row.appendChild(field);
      }
      row.appendChild(type);

      const range = document.createElement('span');
      range.className = 'tree-range';
      range.textContent = '[' + node.srow + ':' + node.scol + ' → ' + node.erow + ':' + node.ecol + ']';
      row.appendChild(range);

      row.addEventListener('mouseenter', () => {
        if (!selectedNode) {
          highlightRange(node);
        }
      });
      if (hasChildren) {
        toggle.addEventListener('click', (event) => {
          event.stopPropagation();
          node.expanded = !node.expanded;
          renderTree();
        });
        row.addEventListener('click', () => {
          node.expanded = !node.expanded;
          setSelectedNode(node);
        });
      } else {
        row.addEventListener('click', () => setSelectedNode(node));
      }

      wrapper.appendChild(row);

      if (hasChildren && node.expanded) {
        const children = document.createElement('div');
        children.className = 'tree-children';
        node.children.forEach(child => children.appendChild(makeNodeElement(child, depth + 1)));
        wrapper.appendChild(children);
      }

      return wrapper;
    }

    function initializeExpansion(node, depth = 0) {
      node.expanded = depth < 2;
      (node.children || []).forEach(child => initializeExpansion(child, depth + 1));
    }

    function containsOffset(node, start, end, offsets) {
      const nodeStart = (offsets[node.srow] ?? 0) + node.scol;
      const nodeEnd = (offsets[node.erow] ?? offsets[offsets.length - 1]) + node.ecol;
      return nodeStart <= start && nodeEnd >= end;
    }

    function findSmallestContaining(node, start, end, offsets) {
      if (!containsOffset(node, start, end, offsets)) {
        return null;
      }
      for (const child of node.children || []) {
        const found = findSmallestContaining(child, start, end, offsets);
        if (found) {
          return found;
        }
      }
      return node;
    }

    function expandPathToTarget(node, targetId) {
      let found = false;
      for (const child of node.children || []) {
        if (expandPathToTarget(child, targetId)) {
          node.expanded = true;
          found = true;
        }
      }
      return found || nodeId(node) === targetId;
    }

    function syncSelectionFromSource() {
      if (!astState) return;
      const start = Math.min(source.selectionStart, source.selectionEnd);
      const end = Math.max(source.selectionStart, source.selectionEnd);
      const offsets = lineOffsets(source.value);
      const target = findSmallestContaining(astState, start, end, offsets);
      if (!target) return;
      expandPathToTarget(astState, nodeId(target));
      setSelectedNode(target, { highlight: false });
    }

    function renderTree() {
      treeOut.innerHTML = '';
      if (!astState) {
        treeOut.textContent = 'No AST yet.';
        return;
      }
      treeOut.appendChild(makeNodeElement(astState));
    }

    function activateTab(name) {
      document.querySelectorAll('.tab').forEach(el => el.classList.toggle('active', el.dataset.pane === name));
      document.querySelectorAll('.pane').forEach(el => el.classList.toggle('active', el.id === 'pane-' + name));
    }

    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => activateTab(tab.dataset.pane));
    });

    async function loadSamples() {
      const groups = await fetchJson('/api/samples');
      sampleSelect.innerHTML = '';
      for (const group of groups) {
        const optgroup = document.createElement('optgroup');
        optgroup.label = group.label;
        for (const file of group.files) {
          const option = document.createElement('option');
          option.value = file.path;
          option.textContent = file.name;
          optgroup.appendChild(option);
        }
        sampleSelect.appendChild(optgroup);
      }
    }

    async function loadSample() {
      const filePath = sampleSelect.value;
      if (!filePath) return;
      const result = await fetchJson('/api/load?path=' + encodeURIComponent(filePath));
      source.value = result.content;
      setStatus('Loaded ' + result.path);
    }

    async function parseSource() {
      const payload = {
        source: source.value,
        filename: sampleSelect.value ? sampleSelect.value.split('/').pop() : 'input.pddl',
      };
      setStatus('Parsing...');
      const result = await fetchJson('/api/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      astState = result.ast;
      initializeExpansion(astState);
      selectedNode = astState;
      renderTree();
      rawTreeOut.textContent = result.tree;
      xmlOut.textContent = result.xml;
      stderrOut.textContent = [result.treeErr, result.xmlErr].filter(Boolean).join('\\n\\n') || '(empty)';
      setStatus('Parsed ' + payload.filename);
      activateTab('tree');
    }

    document.getElementById('loadSample').addEventListener('click', loadSample);
    document.getElementById('parseBtn').addEventListener('click', parseSource);
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      if (!file) return;
      source.value = await file.text();
      setStatus('Loaded uploaded file ' + file.name);
    });

    source.addEventListener('mouseup', syncSelectionFromSource);
    source.addEventListener('keyup', syncSelectionFromSource);

    loadSamples().then(loadSample).catch(err => {
      stderrOut.textContent = String(err);
      activateTab('stderr');
    });
  </script>
</body>
</html>`;

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/") {
      return text(res, 200, INDEX_HTML, "text/html; charset=utf-8");
    }

    if (req.method === "GET" && url.pathname === "/api/samples") {
      return json(res, 200, await listSamples());
    }

    if (req.method === "GET" && url.pathname === "/api/load") {
      const filePath = url.searchParams.get("path");
      if (!filePath || !isAllowedPath(filePath)) {
        return json(res, 400, { error: "invalid path" });
      }
      const content = await fs.readFile(filePath, "utf8");
      return json(res, 200, { path: filePath, content });
    }

    if (req.method === "POST" && url.pathname === "/api/parse") {
      const body = JSON.parse(await readBody(req));
      const source = String(body.source ?? "");
      const filename = String(body.filename ?? `input-${randomUUID()}.pddl`);
      return json(res, 200, await parseSource(source, filename));
    }

    return json(res, 404, { error: "not found" });
  } catch (error) {
    return json(res, 500, { error: String(error?.stack ?? error) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`PDDL AST Explorer: http://${HOST}:${PORT}`);
});
