# npm and MCP Registry Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `mcp-mat` installable via `npx mcp-mat` and discoverable on the Official MCP Registry.

**Architecture:** Add npm publishing metadata (`bin`, `files`, `mcpName`) to `package.json`, create a `scripts/prepublish.mjs` for shebang injection and version sync validation, create `server.json` for MCP Registry metadata, and update the README with `npx`-based install instructions.

**Tech Stack:** Node.js, npm, MCP Registry (`mcp-publisher` CLI)

**Spec:** `docs/superpowers/specs/2026-03-18-npm-and-mcp-registry-publishing-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `package.json` | Modify | Add `mcpName`, `bin`, `files`, `repository`, `keywords`, `engines`, `prepublishOnly` |
| `scripts/prepublish.mjs` | Create | Version sync check + shebang injection (ESM-compatible) |
| `server.json` | Create | MCP Registry metadata |
| `README.md` | Modify | Add npx install sections, keep build-from-source for developers |
| `test/prepublish.test.ts` | Create | Tests for prepublish script logic |

---

### Task 1: Create `scripts/prepublish.mjs`

**Files:**
- Create: `scripts/prepublish.mjs`
- Test: `test/prepublish.test.ts`

- [ ] **Step 1: Write the test for version sync check**

Create `test/prepublish.test.ts`. The project uses Node.js built-in test runner (`node:test`) and `node:assert/strict`.

```typescript
// Copyright 2025 Penghui Li
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("package.json and server.json versions are in sync", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const server = JSON.parse(fs.readFileSync(path.join(ROOT, "server.json"), "utf8"));

  assert.equal(pkg.version, server.version,
    `package.json version (${pkg.version}) != server.json version (${server.version})`);
  assert.equal(pkg.version, server.packages[0].version,
    `package.json version (${pkg.version}) != server.json packages[0].version (${server.packages[0].version})`);
});

test("package.json mcpName matches server.json name", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const server = JSON.parse(fs.readFileSync(path.join(ROOT, "server.json"), "utf8"));

  assert.equal(pkg.mcpName, server.name,
    `package.json mcpName (${pkg.mcpName}) != server.json name (${server.name})`);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test test/prepublish.test.ts`
Expected: FAIL — `server.json` and `mcpName` don't exist yet.

- [ ] **Step 3: Create `server.json`**

Create `server.json` at the project root with exact contents from spec:

```json
{
  "$schema": "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
  "name": "io.github.codelipenghui/mcp-mat",
  "description": "Headless Eclipse MAT MCP server for Java heap dump analysis",
  "repository": {
    "url": "https://github.com/codelipenghui/mcp-mat",
    "source": "github"
  },
  "version": "0.1.0",
  "packages": [
    {
      "registryType": "npm",
      "identifier": "mcp-mat",
      "version": "0.1.0",
      "transport": {
        "type": "stdio"
      },
      "environmentVariables": [
        {
          "name": "MAT_HOME",
          "description": "Path to Eclipse MAT installation directory (e.g., /Applications/MemoryAnalyzer.app/Contents/Eclipse)",
          "isRequired": false,
          "format": "string",
          "isSecret": false
        },
        {
          "name": "JAVA_PATH",
          "description": "Path to Java executable (default: java)",
          "isRequired": false,
          "format": "string",
          "isSecret": false
        },
        {
          "name": "MAT_XMX_MB",
          "description": "Maximum JVM heap size in MB for MAT (default: 4096)",
          "isRequired": false,
          "format": "string",
          "isSecret": false
        }
      ]
    }
  ]
}
```

- [ ] **Step 4: Add `mcpName` to `package.json`**

Add this field to `package.json` (after `"description"`):

```json
"mcpName": "io.github.codelipenghui/mcp-mat",
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx --test test/prepublish.test.ts`
Expected: PASS — both tests green.

- [ ] **Step 6: Create `scripts/prepublish.mjs`**

Create `scripts/prepublish.mjs`:

```javascript
// Copyright 2025 Penghui Li
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import fs from "node:fs";

// 1. Version sync check
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const server = JSON.parse(fs.readFileSync("server.json", "utf8"));

if (pkg.version !== server.version) {
  console.error(`Version mismatch: package.json (${pkg.version}) != server.json (${server.version})`);
  process.exit(1);
}
if (pkg.version !== server.packages[0].version) {
  console.error(`Version mismatch: package.json (${pkg.version}) != server.json packages[0].version (${server.packages[0].version})`);
  process.exit(1);
}
if (pkg.mcpName !== server.name) {
  console.error(`Name mismatch: package.json mcpName (${pkg.mcpName}) != server.json name (${server.name})`);
  process.exit(1);
}

// 2. Shebang injection
const serverJs = "dist/src/server.js";
const content = fs.readFileSync(serverJs, "utf8");
if (!content.startsWith("#!")) {
  fs.writeFileSync(serverJs, "#!/usr/bin/env node\n" + content);
  console.log("Prepended shebang to " + serverJs);
} else {
  console.log("Shebang already present in " + serverJs);
}

console.log("Prepublish checks passed.");
```

- [ ] **Step 7: Verify prepublish script works end-to-end**

Run: `npm run build && node scripts/prepublish.mjs`
Expected: "Prepended shebang to dist/src/server.js" and "Prepublish checks passed."

Then verify: `head -1 dist/src/server.js`
Expected: `#!/usr/bin/env node`

- [ ] **Step 8: Commit**

```bash
git add package.json scripts/prepublish.mjs server.json test/prepublish.test.ts
git commit -m "feat: add server.json and prepublish script for npm/MCP Registry publishing"
```

---

### Task 2: Update `package.json` with publishing metadata

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add all publishing fields to `package.json`**

Add the following fields (some already added in Task 1 — `mcpName`):

```json
"bin": {
  "mcp-mat": "dist/src/server.js"
},
"files": [
  "dist/src"
],
"repository": {
  "type": "git",
  "url": "https://github.com/codelipenghui/mcp-mat.git"
},
"keywords": [
  "mcp",
  "eclipse-mat",
  "heap-dump",
  "memory-analysis",
  "java"
],
"engines": {
  "node": ">=18"
},
```

And add to the `"scripts"` section:

```json
"prepublishOnly": "npm run build && node scripts/prepublish.mjs"
```

- [ ] **Step 2: Verify the build still works**

Run: `npm run build`
Expected: No errors.

- [ ] **Step 3: Verify prepublish flow works**

Run: `npm run build && node scripts/prepublish.mjs`
Expected: Build succeeds, shebang injected, version checks pass.

- [ ] **Step 4: Verify existing tests still pass**

Run: `npm test`
Expected: All existing tests pass.

- [ ] **Step 5: Verify npm pack produces a clean package**

Run: `npm pack --dry-run`
Expected: `package.json`, `README.md`, `LICENSE`, and `dist/src/**` files listed. No `test/`, no `src/*.ts`, no `node_modules/`.

- [ ] **Step 6: Commit**

```bash
git add package.json
git commit -m "feat: add npm publishing metadata (bin, files, engines, prepublishOnly)"
```

---

### Task 3: Update README with npx install instructions

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add "Install via npx" section**

Insert a new section **before** the existing "Install in Claude Code" section (before line 99). The new section:

```markdown
## Install via npx

No build step required. Install directly from npm:

### Claude Code

Add to `~/.claude/settings.json` or project `.claude/settings.json`:

\```json
{
  "mcpServers": {
    "mat": {
      "command": "npx",
      "args": ["-y", "mcp-mat"],
      "env": {
        "MAT_HOME": "/Applications/MemoryAnalyzer.app/Contents/Eclipse"
      }
    }
  }
}
\```

### Codex

\```bash
codex mcp add \
  --env MAT_HOME=/Applications/MemoryAnalyzer.app/Contents/Eclipse \
  mat \
  npx -y mcp-mat
\```
```

- [ ] **Step 2: Rename existing sections to clarify they are for development**

Rename "Install in Claude Code" to "Install in Claude Code (from source)" and "Install in Codex" to "Install in Codex (from source)".

- [ ] **Step 3: Verify README renders correctly**

Skim the README to confirm section ordering makes sense: Features → Commands → OQL notes → Environment → Run → Test → **Install via npx** → Install in Claude Code (from source) → Install in Codex (from source).

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: add npx installation instructions to README"
```

---

### Task 4: Final validation

**Files:** None (verification only)

- [ ] **Step 1: Run all tests**

Run: `npm test`
Expected: All tests pass (including the new `test/prepublish.test.ts`).

- [ ] **Step 2: Run full prepublish flow**

Run: `npm run build && node scripts/prepublish.mjs`
Expected: Build, version check, shebang injection all succeed.

- [ ] **Step 3: Verify npm pack output**

Run: `npm pack --dry-run 2>&1 | head -30`
Expected: `package.json`, `README.md`, `LICENSE`, and `dist/src/` files. Package size should be small (well under 1MB). No `test/`, no `src/*.ts`.

- [ ] **Step 4: Verify shebang in built output**

Run: `head -1 dist/src/server.js`
Expected: `#!/usr/bin/env node`

- [ ] **Step 5: Verify local tarball install works**

Run: `npm pack && npm install -g ./mcp-mat-0.1.0.tgz && mcp-mat 2>&1 & sleep 1 && kill %1 && npm uninstall -g mcp-mat && rm mcp-mat-0.1.0.tgz`
Expected: No module-not-found errors, no crash. The server starts on stdio (will hang until killed — that's expected for an MCP server).
