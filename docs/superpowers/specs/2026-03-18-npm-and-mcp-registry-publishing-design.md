# Design: Publish mcp-mat to npm and the Official MCP Registry

**Date:** 2026-03-18
**Status:** Draft

## Goal

Make `mcp-mat` installable via `npx mcp-mat` and discoverable on the Official MCP Registry at `registry.modelcontextprotocol.io`, removing the requirement to build from source.

## Current State

- TypeScript MCP server built with `@modelcontextprotocol/sdk`
- Users must clone the repo, run `npm install && npm run build`, then point their MCP client at `dist/src/server.js`
- Package name: `mcp-mat`, version `0.1.0`, unscoped
- Entry point: `dist/src/server.js` (ES module, stdio transport)

## Design

### 1. package.json Changes

Add the following fields to `package.json`:

- **`mcpName`**: `"io.github.codelipenghui/mcp-mat"` — required by the MCP Registry to verify the npm package matches its registry entry.
- **`bin`**: `{ "mcp-mat": "dist/src/server.js" }` — enables `npx mcp-mat` usage.
- **`files`**: `["dist/src"]` — allowlist for npm publish. Keeps the package small by excluding test files, source TypeScript, and config files.
- **`repository`**: `{ "type": "git", "url": "https://github.com/codelipenghui/mcp-mat.git" }` — standard npm metadata.
- **`keywords`**: `["mcp", "eclipse-mat", "heap-dump", "memory-analysis", "java"]` — npm discoverability.
- **`engines`**: `{ "node": ">=18" }` — the code uses ES2022 features and ESM.

### 2. Shebang Handling and Publish Checks

TypeScript (`tsc`) does not emit shebangs. The `bin` entry requires `dist/src/server.js` to start with `#!/usr/bin/env node` for `npx` execution.

Create `scripts/prepublish.mjs` — a standalone ESM script that:
1. Verifies `version` in `package.json` matches `version` and `packages[0].version` in `server.json` (fails the publish if mismatched)
2. Prepends `#!/usr/bin/env node\n` to `dist/src/server.js` if not already present

Note: A standalone `.mjs` script is used instead of an inline `node -e` one-liner because the project uses `"type": "module"`, which means `require()` is not available in `node -e` context.

Add a `prepublishOnly` script to `package.json`:

```
"prepublishOnly": "npm run build && node scripts/prepublish.mjs"
```

This runs automatically before `npm publish`, ensuring:
1. The project is built fresh
2. Versions are consistent between `package.json` and `server.json`
3. The shebang is prepended if not already present

### 3. server.json for the MCP Registry

Create `server.json` at the project root:

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

Only the three most user-relevant env vars are declared. Debug/advanced vars (`MAT_DEBUG`, `MAT_CONFIG_DIR`, etc.) are documented in the README but not in registry metadata.

### 4. README Updates

Update the README to add an `npx` installation section before the existing manual build instructions:

**New section — "Install via npx":**
- Claude Code: `"command": "npx", "args": ["-y", "mcp-mat"]` with `MAT_HOME` env var
- Codex: `codex mcp add --env MAT_HOME=... mat npx -y mcp-mat`

The existing "build from source" instructions remain for contributors/developers.

### 5. Publishing Workflow

**First-time setup (manual steps, not automated):**

1. `npm adduser` — authenticate to npm (if not already)
2. `npm publish --access public` — publishes to npm (triggers `prepublishOnly` automatically)
3. Install `mcp-publisher` CLI: `brew install mcp-publisher`
4. `mcp-publisher login github` — authenticate with MCP Registry using GitHub
5. `mcp-publisher publish` — publish `server.json` to the MCP Registry

**For future version updates:**

1. Bump `version` in `package.json` and `server.json` (keep in sync)
2. `npm publish` — publishes new version to npm
3. `mcp-publisher publish` — updates the MCP Registry entry

### 6. Files Changed

| File | Action | Description |
|------|--------|-------------|
| `package.json` | Modify | Add `mcpName`, `bin`, `files`, `repository`, `keywords`, `engines`, `prepublishOnly` script |
| `scripts/prepublish.mjs` | Create | ESM script for shebang injection and version sync check |
| `server.json` | Create | MCP Registry metadata |
| `README.md` | Modify | Add npx installation instructions |

## Out of Scope

- CI/CD automation for publishing (can be added later via GitHub Actions)
- Listing on other registries (Smithery, Anthropic Connectors Directory)
- Docker image or standalone binary distribution
