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
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { ServerConfig } from "../src/config.js";
import { MatService } from "../src/mat/service.js";
import type { RunCommand, RunResult } from "../src/types.js";

function setupRuntime() {
  const rootRaw = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-mat-service-"));
  const heapRaw = path.join(rootRaw, "heap.hprof");
  fs.writeFileSync(heapRaw, "heap");

  const root = fs.realpathSync(rootRaw);
  const heap = fs.realpathSync(heapRaw);

  const launcher = path.join(root, "org.eclipse.equinox.launcher_1.0.0.jar");
  fs.writeFileSync(launcher, "jar");

  const config: ServerConfig = {
    matLauncher: launcher,
    matHome: undefined,
    javaPath: "java",
    defaultXmxMb: 4096,
    defaultTimeoutSec: 300,
    matConfigDir: path.join(root, "config"),
    matDataDir: path.join(root, "workspace"),
    debug: false,
    debugLogDir: path.join(root, "logs"),
    privacyMode: false,
    oqlMaxBytes: 16 * 1024,
    resultPreviewLines: 20,
    stdioTailChars: 1000,
  };
  fs.mkdirSync(config.matConfigDir, { recursive: true });
  fs.mkdirSync(config.matDataDir, { recursive: true });

  return { root, heap, config };
}

function successRunResult(command: RunCommand): RunResult {
  return {
    command: command.command,
    args: command.args,
    exitCode: 0,
    signal: null,
    timedOut: false,
    stdout: "ok",
    stderr: "",
    durationMs: 10,
  };
}

test("matParseReport returns generated artifacts when run succeeds", async () => {
  const { root, heap, config } = setupRuntime();
  const reportDir = path.join(root, "heap_Leak_Suspects");
  const reportZip = path.join(root, "heap_Leak_Suspects.zip");

  const service = new MatService(config, {
    runCommand: async (command) => {
      fs.mkdirSync(reportDir, { recursive: true });
      fs.writeFileSync(reportZip, "zip");
      return successRunResult(command);
    },
  });

  const result = await service.matParseReport({
    heap_path: heap,
    report_id: "org.eclipse.mat.api:suspects",
  });

  assert.equal(result.status, "ok");
  if (result.status === "ok") {
    assert.equal(result.report_dir, reportDir);
    assert.equal(result.report_zip, reportZip);
  }
});

test("matOqlQuery returns INVALID_QUERY on non-zero oql syntax failure", async () => {
  const { heap, config } = setupRuntime();
  const service = new MatService(config, {
    runCommand: async (command) => ({
      ...successRunResult(command),
      exitCode: 1,
      stderr: "OQL parse error: invalid query",
    }),
  });

  const result = await service.matOqlQuery({
    heap_path: heap,
    oql: "select from",
  });

  assert.equal(result.status, "error");
  if (result.status === "error") {
    assert.equal(result.category, "INVALID_QUERY");
  }
});

test("matOqlQuery enforces max oql size", async () => {
  const { heap, config } = setupRuntime();
  const service = new MatService(config, {
    runCommand: async (command) => successRunResult(command),
  });

  const oversized = "a".repeat(config.oqlMaxBytes + 1);
  const result = await service.matOqlQuery({
    heap_path: heap,
    oql: oversized,
  });

  assert.equal(result.status, "error");
  if (result.status === "error") {
    assert.equal(result.category, "INVALID_QUERY");
  }
});

test("matOqlQuery accepts user-quoted input and wraps command safely", async () => {
  const { heap, config } = setupRuntime();
  let commandArg = "";
  const service = new MatService(config, {
    runCommand: async (command) => {
      commandArg = command.args.find((arg) => arg.startsWith("-command=oql ")) ?? "";
      return successRunResult(command);
    },
  });

  const result = await service.matOqlQuery({
    heap_path: heap,
    oql: '"SELECT p FROM INSTANCEOF com.example.Topic p"',
  });

  assert.equal(result.status, "ok");
  assert.equal(commandArg, '-command=oql "SELECT p FROM INSTANCEOF com.example.Topic p"');
});

test("matIndexStatus returns index metadata", () => {
  const { root, heap, config } = setupRuntime();
  fs.writeFileSync(path.join(root, "heap.hprof.index"), "idx");
  fs.writeFileSync(path.join(root, "heap.hprof.threads"), "th");

  const service = new MatService(config, {
    runCommand: async (command) => successRunResult(command),
  });

  const result = service.matIndexStatus({ heap_path: heap });
  assert.equal(result.status, "ok");
  if (result.status === "ok") {
    assert.equal(result.index_present, true);
    assert.ok(result.index_files.length >= 1);
  }
});

test("matRunCommand returns query artifacts on success", async () => {
  const { root, heap, config } = setupRuntime();
  const queryDir = path.join(root, "heap_Query");
  const pagesDir = path.join(queryDir, "pages");

  let capturedCommandArg = "";
  const service = new MatService(config, {
    runCommand: async (command) => {
      capturedCommandArg = command.args.find((arg) => arg.startsWith("-command=")) ?? "";
      fs.mkdirSync(pagesDir, { recursive: true });
      fs.writeFileSync(path.join(pagesDir, "Query_Command1.txt"), "result line 1\nresult line 2\n");
      return successRunResult(command);
    },
  });

  const result = await service.matRunCommand({
    heap_path: heap,
    command_name: "histogram",
  });

  assert.equal(result.status, "ok");
  if (result.status === "ok") {
    assert.equal(result.command_name, "histogram");
    assert.equal(result.query_dir, queryDir);
    assert.ok(result.result_txt?.includes("Query_Command1.txt"));
    assert.ok(result.result_preview.length > 0);
  }
  assert.equal(capturedCommandArg, "-command=histogram");
});

test("matRunCommand passes command_args correctly", async () => {
  const { heap, config } = setupRuntime();

  let capturedCommandArg = "";
  const service = new MatService(config, {
    runCommand: async (command) => {
      capturedCommandArg = command.args.find((arg) => arg.startsWith("-command=")) ?? "";
      return successRunResult(command);
    },
  });

  const result = await service.matRunCommand({
    heap_path: heap,
    command_name: "path2gc",
    command_args: "0x12345678",
  });

  assert.equal(result.status, "ok");
  assert.equal(capturedCommandArg, "-command=path2gc 0x12345678");
});

test("matRunCommand rejects unknown command names", async () => {
  const { heap, config } = setupRuntime();
  const service = new MatService(config, {
    runCommand: async (command) => successRunResult(command),
  });

  const result = await service.matRunCommand({
    heap_path: heap,
    command_name: "not_a_real_command",
  });

  assert.equal(result.status, "error");
  if (result.status === "error") {
    assert.equal(result.category, "MAT_PARSE_FAILED");
    assert.ok(result.message.includes("Unsupported command_name"));
  }
});

test("matRunCommand returns error on non-zero exit", async () => {
  const { heap, config } = setupRuntime();
  const service = new MatService(config, {
    runCommand: async (command) => ({
      ...successRunResult(command),
      exitCode: 1,
      stderr: "Command execution error",
    }),
  });

  const result = await service.matRunCommand({
    heap_path: heap,
    command_name: "histogram",
  });

  assert.equal(result.status, "error");
});

test("matOqlSpec returns oql parser guidance", () => {
  const { config } = setupRuntime();
  const service = new MatService(config, {
    runCommand: async (command) => successRunResult(command),
  });

  const result = service.matOqlSpec();
  assert.equal(result.status, "ok");
  assert.ok(result.parser_mode.includes("parse-application"));
  assert.ok(result.supported_patterns.length >= 3);
});