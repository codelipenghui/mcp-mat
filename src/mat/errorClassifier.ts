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

import { tail } from "./runner.js";
import { MatMcpError, type RunResult } from "../types.js";

const WRITE_PERMISSION_PATTERNS = [
  /permission denied/i,
  /access is denied/i,
  /read-only file system/i,
  /cannot create/i,
  /failed to create/i,
  /lock\.index/i,
];

const INVALID_QUERY_PATTERNS = [
  /syntax/i,
  /parse error/i,
  /unexpected token/i,
  /invalid query/i,
  /query command/i,
];

function includesPattern(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

export function classifyRunFailure(run: RunResult, tailChars: number, timeoutSec?: number): MatMcpError {
  const stdoutTail = tail(run.stdout, tailChars);
  const stderrTail = tail(run.stderr, tailChars);
  const merged = `${stdoutTail}\n${stderrTail}`;

  if (run.timedOut) {
    const durationStr = `${Math.round(run.durationMs / 1000)}s`;
    const limitStr = timeoutSec !== undefined ? `, limit ${timeoutSec}s` : "";
    return new MatMcpError({
      category: "MAT_TIMEOUT",
      message: `MAT process exceeded timeout (ran ${durationStr}${limitStr}).`,
      hint: "Increase timeout_sec or run a smaller report/query.",
      stdoutTail,
      stderrTail,
      exitCode: run.exitCode,
    });
  }

  if (includesPattern(merged, WRITE_PERMISSION_PATTERNS)) {
    return new MatMcpError({
      category: "WRITE_PERMISSION_DENIED",
      message: "MAT could not write lock/index/report artifacts near the heap dump.",
      hint: "Grant write permission on the heap directory or analyze a copy in writable storage.",
      stdoutTail,
      stderrTail,
      exitCode: run.exitCode,
    });
  }

  const likelyInvalidQuery = includesPattern(merged, INVALID_QUERY_PATTERNS) && /oql/i.test(merged);
  if (likelyInvalidQuery) {
    return new MatMcpError({
      category: "INVALID_QUERY",
      message: "MAT rejected the OQL query.",
      hint: "Validate OQL syntax and use mat_oql_spec for parser-mode-safe query patterns.",
      stdoutTail,
      stderrTail,
      exitCode: run.exitCode,
    });
  }

  return new MatMcpError({
    category: "MAT_PARSE_FAILED",
    message: "MAT exited with a non-zero status.",
    hint: "Inspect stderr_tail for MAT diagnostics.",
    stdoutTail,
    stderrTail,
    exitCode: run.exitCode,
  });
}

export function classifySpawnError(error: unknown): MatMcpError {
  const message = error instanceof Error ? error.message : String(error);
  const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;

  if (code === "EACCES") {
    return new MatMcpError({
      category: "MAT_NOT_FOUND",
      message: `Permission denied launching MAT process: ${message}`,
      hint: "Ensure JAVA_PATH points to an executable file with proper permissions.",
    });
  }

  return new MatMcpError({
    category: "MAT_NOT_FOUND",
    message: `Failed to launch MAT process: ${message}`,
    hint: code === "ENOENT"
      ? "Java binary not found. Install Java or set JAVA_PATH to a valid java executable."
      : "Verify JAVA_PATH and MAT_LAUNCHER are valid and executable.",
  });
}
