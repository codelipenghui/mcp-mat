# mcp-mat

Headless MCP server for Eclipse MAT using direct `java -jar org.eclipse.equinox.launcher_*.jar` execution.

## Features

- `mat_healthcheck` — Validate MAT launcher and Java runtime availability
- `mat_parse_report` — Run predefined MAT reports (leak suspects, system overview, etc.)
- `mat_oql_query` — Execute OQL queries and return inline results
- `mat_run_command` — Execute 56 built-in MAT analysis commands (histogram, dominator_tree, path2gc, thread_overview, etc.)
- `mat_index_status` — Check whether MAT index artifacts exist for a heap dump
- `mat_oql_spec` — Return OQL parser guidance and supported patterns

## Supported Commands (`mat_run_command`)

### Dominator tree analysis
`dominator_tree`, `show_dominator_tree`, `immediate_dominators`, `big_drops_in_dominator_tree`

### Path to GC roots
`path2gc`, `merge_shortest_paths`, `gc_roots`

### Histogram & object listing
`histogram`, `delta_histogram`*, `list_objects`, `group_by_value`, `duplicate_classes`

### Leak detection
`leakhunter`, `leakhunter2`*, `find_leaks`, `find_leaks2`*, `reference_leak`

### Thread analysis
`thread_overview`, `thread_details`, `thread_stack`

### Collection analysis
`collection_fill_ratio`, `collections_grouped_by_size`, `array_fill_ratio`, `arrays_grouped_by_size`, `hash_entries`, `map_collision_ratio`, `extract_list_values`, `hash_set_values`, `primitive_arrays_with_a_constant_value`

### Reference analysis
`references_statistics`, `weak_references_statistics`, `soft_references_statistics`, `phantom_references_statistics`, `finalizer_references_statistics`

### Finalizer analysis
`finalizer_overview`, `finalizer_thread`, `finalizer_queue`, `finalizer_in_processing`, `finalizer_thread_locals`

### Retained set
`show_retained_set`, `customized_retained_set`

### Component & top consumers
`component_report`, `component_report_top`, `top_consumers`, `top_consumers_html`, `pie_biggest_objects`

### String & memory waste
`find_strings`, `waste_in_char_arrays`

### Heap info & misc
`heap_dump_overview`, `unreachable_objects`, `system_properties`, `class_references`, `comparison_report`*

### Eclipse/OSGi specific
`bundle_registry`, `leaking_bundles`

### Export
`export_hprof`

\* Requires a `baseline` heap dump (second `.hprof` file).

## OQL mode notes

- This server normalizes client OQL input and wraps it for MAT parse-app command mode.
- You can send OQL with or without outer quotes.
- For class ranking and top consumers, prefer `mat_parse_report` with `org.eclipse.mat.api:overview` and parse `Class_Histogram*.txt`.
- For object inspection, use simple field-level OQL patterns (`INSTANCEOF`, `OBJECTS 0x...`).

## Environment

All environment variables are optional:

- `MAT_HOME`
- `MAT_LAUNCHER`
- `JAVA_PATH` (default `java`)
- `MAT_XMX_MB` (default `4096`)
- `MAT_TIMEOUT_SEC` (default `1800`)
- `MAT_CONFIG_DIR` (default `/tmp/mat-config`)
- `MAT_DATA_DIR` (default `/tmp/mat-workspace`)
- `MAT_DEBUG` (default `false`)
- `MAT_DEBUG_LOG_DIR` (default `/tmp/mcp-mat-logs`)
- `MAT_PRIVACY_MODE` (default `false`)
- `MAT_OQL_MAX_BYTES` (default `16384`)
- `MAT_RESULT_PREVIEW_LINES` (default `20`)
- `MAT_STDIO_TAIL_CHARS` (default `4000`)

## Run

```bash
npm install
npm run build
MAT_HOME=/path/to/mat node dist/src/server.js
```

## Test

```bash
npm test
```

## Install via npx

No build step required. Install directly from npm:

### Claude Code

Add to `~/.claude/settings.json` or project `.claude/settings.json`:

```json
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
```

### Codex

```bash
codex mcp add \
  --env MAT_HOME=/Applications/MemoryAnalyzer.app/Contents/Eclipse \
  mat \
  npx -y mcp-mat
```

## Install in Claude Code (from source)

Add the MCP server to Claude Code settings (`~/.claude/settings.json` or project `.claude/settings.json`):

```json
{
  "mcpServers": {
    "mat": {
      "command": "node",
      "args": ["/path/to/mcp-mat/dist/src/server.js"],
      "env": {
        "MAT_HOME": "/Applications/MemoryAnalyzer.app/Contents/Eclipse"
      }
    }
  }
}
```

## Install in Codex (from source)

Build first:

```bash
cd /path/to/mcp-mat
npm install
npm run build
```

Add MCP server to Codex:

```bash
codex mcp add \
  --env MAT_HOME=/Applications/MemoryAnalyzer.app/Contents/Eclipse \
  mat \
  node /path/to/mcp-mat/dist/src/server.js
```

Verify:

```bash
codex mcp list
codex mcp get mat --json
```

If you need to update the entry:

```bash
codex mcp remove mat
# then run codex mcp add ... again
```

Equivalent `~/.codex/config.toml` entry:

```toml
[mcp_servers.mat]
command = "node"
args = ["/path/to/mcp-mat/dist/src/server.js"]

[mcp_servers.mat.env]
MAT_HOME = "/Applications/MemoryAnalyzer.app/Contents/Eclipse"
```
