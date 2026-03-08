# Technical Design: Headless MCP Server for Eclipse MAT

## 1. Overview

This document proposes a production-ready design for an MCP server that runs Eclipse Memory Analyzer Tool (MAT) in headless mode and exposes heap analysis tools (including OQL) to MCP clients.

Primary target workflow:

1. Client provides a heap dump path and query/report request.
2. MCP server executes MAT headlessly.
3. MCP server returns structured metadata and artifact paths (TXT/HTML/ZIP).

## 2. Goals and Non-Goals

### Goals

- Support offline Java heap dump analysis (`.hprof`, other MAT-supported dumps) via MCP.
- Support OQL execution and report generation without any UI dependency.
- Provide stable tool contracts for AI clients.
- Reuse MAT indexes when available for performance.
- Produce predictable machine-consumable output paths.

### Non-Goals

- Re-implement MAT parsing logic in the MCP server.
- Provide GUI integration or embedded SWT UI.
- Support remote heap capture (focus is analysis of existing dump files).

## 3. Constraints and Findings

### Confirmed runtime behavior

- MAT CLI functionality is provided by the Equinox application `org.eclipse.mat.api.parse`.
- `ParseHeapDump.sh` is the standard entrypoint on Linux/macOS, but on macOS in some headless contexts it can crash due to AppKit initialization.
- A robust headless invocation is:

```bash
java -Xmx4g --add-exports=java.base/jdk.internal.org.objectweb.asm=ALL-UNNAMED \
  -jar "$MAT_LAUNCHER" \
  -consolelog -nosplash \
  -configuration /tmp/mat-config \
  -data /tmp/mat-workspace \
  -application org.eclipse.mat.api.parse \
  <heap> <options...> <report-id>
```

### File system behavior

- MAT creates lock/index artifacts adjacent to the heap dump (for example: `.index`, `.lock.index`).
- Output reports are written near the heap dump by default (`*_Query`, `*_Leak_Suspects`, zip variants).
- MCP runtime must have write permission in the heap directory or use a staging copy.

## 4. Proposed Architecture

### 4.1 Components

1. MCP Transport Layer
- Implemented with official MCP SDK (Python or TypeScript).
- Handles tool registration, request validation, and responses.

2. MAT Runner
- Builds MAT command lines.
- Runs subprocesses with timeout/cancellation.
- Captures stdout/stderr and exit code.

3. Artifact Resolver
- Locates generated outputs (`*_Query/pages/Query_Command*.txt`, zip files, index files).
- Returns normalized absolute paths and summary stats.

4. Error Classifier
- Maps MAT logs and exit codes to stable MCP error types.
- Provides actionable remediation hints.

5. Security Guardrails
- Path allowlist checks.
- Query/report argument sanitization.
- Output size/time limits.

### 4.2 Deployment shape

- Single process MCP server.
- Local filesystem access only.
- MAT binary/launcher configured via environment variables.

## 5. Tool Contracts (MCP API)

### 5.1 `mat_healthcheck`

Purpose: Validate MAT availability and runtime prerequisites.

Input:
- optional `mat_home`
- optional `java_path`

Output:
- `ok` (boolean)
- `mat_launcher` (resolved path)
- `java_version`
- `notes` (array)

### 5.2 `mat_parse_report`

Purpose: Run a predefined MAT report (`suspects`, `overview`, `top_components`, `compare`, `suspects2`, `overview2`).

Input:
- `heap_path` (required)
- `report_id` (required, full ID such as `org.eclipse.mat.api:suspects`)
- optional `options` map (e.g. `baseline`, `snapshot2`, `format`, `limit`)
- optional `xmx_mb` (default 4096)
- optional `timeout_sec` (default 1800)

Output:
- `status` (`ok` or `error`)
- `exit_code`
- `report_dir` (if unzipped)
- `report_zip`
- `generated_files` (array)
- `stdout_tail`
- `stderr_tail`

### 5.3 `mat_oql_query`

Purpose: Run a single OQL query and return text results path.

Input:
- `heap_path` (required)
- `oql` (required, raw OQL expression)
- optional `format` (`txt` default, `html`, `csv`)
- optional `unzip` (default `true`)
- optional `limit`
- optional `xmx_mb`
- optional `timeout_sec`

Output:
- `status`
- `exit_code`
- `query_dir`
- `query_zip`
- `result_txt` (primary parsed file path for `txt`)
- `result_preview` (first N lines)
- `generated_files` (array)
- `stdout_tail`
- `stderr_tail`

### 5.4 `mat_index_status`

Purpose: Show whether MAT index files already exist for a heap dump.

Input:
- `heap_path`

Output:
- `index_present` (boolean)
- `index_files` (array)
- `threads_file`
- `last_modified`

### 5.5 `mat_run_command`

Purpose: Execute any of the 56 built-in MAT analysis commands headlessly and return result artifacts. This is the general-purpose command runner for MAT CLI commands that are not OQL queries or predefined reports.

Input:
- `heap_path` (required)
- `command_name` (required, e.g. `histogram`, `dominator_tree`, `path2gc`, `thread_overview`)
- optional `command_args` (format depends on command, e.g. an object address like `0x12345678` for `path2gc`, or a class pattern for `histogram`)
- optional `format` (`txt` default, `html`, `csv`)
- optional `unzip` (default `true`)
- optional `limit`
- optional `xmx_mb`
- optional `timeout_sec`

Output:
- `status` (`ok` or `error`)
- `exit_code`
- `query_dir`
- `query_zip`
- `result_txt` (primary parsed file path for `txt`)
- `result_preview` (first N lines)
- `generated_files` (array)
- `stdout_tail`
- `stderr_tail`

Supported commands (56 total):

| Category | Commands |
|---|---|
| Dominator tree | `dominator_tree`, `show_dominator_tree`, `immediate_dominators`, `big_drops_in_dominator_tree` |
| Path to GC roots | `path2gc`, `merge_shortest_paths`, `gc_roots` |
| Histogram & objects | `histogram`, `delta_histogram`\*, `list_objects`, `group_by_value`, `duplicate_classes` |
| Leak detection | `leakhunter`, `leakhunter2`\*, `find_leaks`, `find_leaks2`\*, `reference_leak` |
| Thread analysis | `thread_overview`, `thread_details`, `thread_stack` |
| Collection analysis | `collection_fill_ratio`, `collections_grouped_by_size`, `array_fill_ratio`, `arrays_grouped_by_size`, `hash_entries`, `map_collision_ratio`, `extract_list_values`, `hash_set_values`, `primitive_arrays_with_a_constant_value` |
| Reference analysis | `references_statistics`, `weak_references_statistics`, `soft_references_statistics`, `phantom_references_statistics`, `finalizer_references_statistics` |
| Finalizer analysis | `finalizer_overview`, `finalizer_thread`, `finalizer_queue`, `finalizer_in_processing`, `finalizer_thread_locals` |
| Retained set | `show_retained_set`, `customized_retained_set` |
| Component & top consumers | `component_report`, `component_report_top`, `top_consumers`, `top_consumers_html`, `pie_biggest_objects` |
| String & memory waste | `find_strings`, `waste_in_char_arrays` |
| Heap info & misc | `heap_dump_overview`, `unreachable_objects`, `system_properties`, `class_references`, `comparison_report`\* |
| Eclipse/OSGi | `bundle_registry`, `leaking_bundles` |
| Export | `export_hprof` |

\* Requires a `baseline` heap dump (second `.hprof` file).

### 5.6 `mat_oql_spec`

Purpose: Return OQL parser-mode guidance, supported patterns, and known limitations. This is a static reference tool that does not execute any MAT process.

Input: (none)

Output:
- `oql_spec` (structured object with OQL syntax guidance including supported SELECT/FROM/WHERE patterns, built-in functions, field access syntax, and known parser limitations)

## 6. Command Construction

### 6.1 Environment variables

Required:
- `MAT_ALLOWED_ROOTS` (comma-separated absolute directories where heap files are allowed)

Optional (at least one of `MAT_HOME` or `MAT_LAUNCHER` must be set for MAT to work):
- `MAT_HOME` (for example: `/Applications/MemoryAnalyzer.app/Contents/Eclipse`)
- `MAT_LAUNCHER` (resolved `org.eclipse.equinox.launcher_*.jar`)
- `MAT_XMX_MB` (default 4096)
- `MAT_CONFIG_DIR` (default `/tmp/mat-config`)
- `MAT_DATA_DIR` (default `/tmp/mat-workspace`)

### 6.2 Execution template

```bash
java -Xmx${MAT_XMX_MB}m --add-exports=java.base/jdk.internal.org.objectweb.asm=ALL-UNNAMED \
  -jar "$MAT_LAUNCHER" \
  -consolelog -nosplash \
  -configuration "$MAT_CONFIG_DIR" \
  -data "$MAT_DATA_DIR" \
  -application org.eclipse.mat.api.parse \
  "$HEAP_PATH" \
  "$OPTION_1" "$OPTION_2" ... \
  "$REPORT_ID"
```

For OQL:

```bash
"-command=oql \"${OQL}\"" -format=txt -unzip org.eclipse.mat.api:query
```

For generic commands (`mat_run_command`):

```bash
"-command=${COMMAND_NAME} ${COMMAND_ARGS}" -format=txt -unzip org.eclipse.mat.api:query
```

Implementation requirement: pass arguments as an array to `subprocess` (no shell interpolation) to avoid quoting bugs and injection.

## 7. Error Model

MCP error categories:

1. `MAT_NOT_FOUND`
- Launcher jar or Java not found.

2. `HEAP_NOT_FOUND`
- Heap path missing or unreadable.

3. `WRITE_PERMISSION_DENIED`
- MAT cannot create lock/index/output next to heap dump.

4. `MAT_PARSE_FAILED`
- MAT exited non-zero during parse/report/query.

5. `MAT_TIMEOUT`
- Process exceeded configured timeout.

6. `INVALID_QUERY`
- OQL parse/validation error.

Each error response must include:
- `category`
- `message`
- `hint`
- `stdout_tail`
- `stderr_tail`

## 8. Security and Safety

- Enforce allowlisted roots for `heap_path` (configurable).
- Reject paths with traversal after canonicalization.
- Enforce max query size (for example 16 KiB).
- Enforce process timeout and memory cap.
- Do not execute arbitrary MAT application IDs; only known report IDs + query report.
- Log command arguments with OQL redaction option for sensitive data workflows.

## 9. Performance and Caching

- Keep MAT index files beside dump (default behavior) for faster repeat queries.
- Detect existing indexes via `mat_index_status`.
- Avoid reparsing when index files are already valid.
- For very large heaps, allow `-discard_*` options behind explicit opt-in.

## 10. Observability

Per request capture:

- request id
- heap path hash (not raw path if privacy mode enabled)
- report/query type
- elapsed time
- exit code
- artifact paths
- truncated stdout/stderr tails

Expose a debug mode that saves full MAT console logs to a configured log directory.

## 11. Testing Strategy

### Unit tests

- Path validation and allowlist logic.
- Command argument construction.
- Error parser/classifier.
- Artifact discovery logic.

### Integration tests

- `mat_healthcheck` on CI image with MAT installed.
- `mat_parse_report` on sample heap dump.
- `mat_oql_query` TXT output and expected `Query_Command*.txt` detection.

### End-to-end tests

- MCP client calls tool and receives successful structured response.
- Timeout scenario.
- Permission-denied scenario.
- Invalid OQL scenario.

## 12. Rollout Plan

1. Phase 1: Internal alpha (complete)
- Implement `mat_healthcheck`, `mat_oql_query`.
- Validate on macOS and Linux.

2. Phase 2: Beta (complete)
- Add `mat_parse_report`, `mat_index_status`.
- Add stronger logging and error mapping.

3. Phase 3: Production (complete)
- Add `mat_run_command` (56 built-in commands) and `mat_oql_spec`.
- Harden allowlists and resource limits.
- Document operational runbook and troubleshooting.

## 13. Operational Runbook

Startup checks:

1. Resolve `MAT_HOME` and `MAT_LAUNCHER`.
2. Verify Java runtime.
3. Verify writable config/data directories.
4. Verify heap directory write permissions.

Common remediation:

- If `WRITE_PERMISSION_DENIED`, run server with access to dump directory or copy heap into writable workspace.
- If AppKit crash on macOS launcher scripts, use direct `java -jar` invocation described above.

## 14. Example MCP Response (OQL success)

```json
{
  "status": "ok",
  "exit_code": 0,
  "query_dir": "/path/broker-0-heap_Query",
  "query_zip": "/path/broker-0-heap_Query.zip",
  "result_txt": "/path/broker-0-heap_Query/pages/Query_Command2.txt",
  "result_preview": [
    "Class Name | Shallow Heap | Retained Heap",
    "java.lang.String @ 0x..."
  ]
}
```

## 15. Default Decisions

- Use `java -jar org.eclipse.equinox.launcher_*.jar` as primary execution path.
- Use `-format=txt -unzip` as default for OQL tools.
- Use 4 GiB default heap for MAT process (`-Xmx4g`).
- Return artifact paths, not full file payloads, by default.
