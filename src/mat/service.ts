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
import { ALLOWED_COMMANDS, ALLOWED_REPORT_IDS, type ServerConfig } from "../config.js";
import {
  createRequestContext,
  logRequestEnd,
  logRequestStart,
  persistDebugLog,
  type RequestContext,
} from "../logging.js";
import { ensureAllowedHeapPath, ensureWriteAccessNearHeap } from "../security/pathGuard.js";
import {
  MatMcpError,
  type MatHealthcheckSuccess,
  type MatIndexStatusSuccess,
  type MatOqlQuerySuccess,
  type MatOqlSpecSuccess,
  type MatParseReportSuccess,
  type MatRunCommandSuccess,
  type MatErrorResponse,
  type RunCommand,
  type RunResult,
} from "../types.js";
import { resolveIndexArtifacts, resolveQueryArtifacts, resolveReportArtifacts } from "./artifacts.js";
import { buildGenericCommand, buildOqlCommand, buildParseReportCommand } from "./commandBuilder.js";
import { classifyRunFailure, classifySpawnError } from "./errorClassifier.js";
import { detectJavaVersion, resolveMatLauncher } from "./launcher.js";
import { MAT_OQL_SPEC, normalizeOqlInput } from "./oqlSpec.js";
import { runCommand, tail } from "./runner.js";

export interface ParseReportInput {
  heap_path: string;
  report_id: string;
  options?: Record<string, string | number | boolean>;
  xmx_mb?: number;
  timeout_sec?: number;
}

export interface OqlQueryInput {
  heap_path: string;
  oql: string;
  format?: "txt" | "html" | "csv";
  unzip?: boolean;
  limit?: number;
  xmx_mb?: number;
  timeout_sec?: number;
}

export interface HealthcheckInput {
  mat_home?: string;
  java_path?: string;
}

export interface IndexStatusInput {
  heap_path: string;
}

export interface RunCommandInput {
  heap_path: string;
  command_name: string;
  command_args?: string;
  format?: "txt" | "html" | "csv";
  unzip?: boolean;
  limit?: number;
  xmx_mb?: number;
  timeout_sec?: number;
}

export interface MatServiceDeps {
  runCommand: (command: RunCommand) => Promise<RunResult>;
}

const PATH_OPTION_KEYS = new Set(["baseline", "snapshot2"]);

export class MatService {
  private readonly deps: MatServiceDeps;

  constructor(private readonly config: ServerConfig, deps?: Partial<MatServiceDeps>) {
    this.deps = {
      runCommand,
      ...deps,
    };
  }

  async matHealthcheck(input: HealthcheckInput): Promise<MatHealthcheckSuccess | MatErrorResponse> {
    const context = createRequestContext("mat_healthcheck", undefined, this.config.privacyMode);
    logRequestStart(context);
    try {
      const launcher = resolveMatLauncher({
        matLauncher: this.config.matLauncher,
        matHome: input.mat_home ?? this.config.matHome,
      });
      const javaVersion = detectJavaVersion(input.java_path ?? this.config.javaPath);

      const notes = [
        `allowed_roots=${this.config.allowedRoots.length}`,
        `debug_logging=${this.config.debug ? "enabled" : "disabled"}`,
      ];

      logRequestEnd(context, {
        status: "ok",
        elapsedMs: Date.now() - context.startedAtMs,
      });

      return {
        status: "ok",
        ok: true,
        mat_launcher: launcher,
        java_version: javaVersion,
        notes,
      };
    } catch (error) {
      return this.handleToolError(context, error, "MAT_NOT_FOUND");
    }
  }

  async matParseReport(input: ParseReportInput): Promise<MatParseReportSuccess | MatErrorResponse> {
    const context = createRequestContext("mat_parse_report", input.heap_path, this.config.privacyMode);
    logRequestStart(context);

    try {
      const reportId = this.validateReportId(input.report_id);
      const heapPath = ensureAllowedHeapPath(input.heap_path, this.config.allowedRoots);
      ensureWriteAccessNearHeap(heapPath);
      const launcher = this.resolveLauncher();

      const options = this.sanitizeOptions(input.options ?? {});
      const command = buildParseReportCommand(
        {
          javaPath: this.config.javaPath,
          launcherPath: launcher,
          heapPath,
          configDir: this.config.matConfigDir,
          dataDir: this.config.matDataDir,
          xmxMb: this.validateBoundedInt(input.xmx_mb, this.config.defaultXmxMb, 256, 262144, "xmx_mb"),
          timeoutSec: this.validateBoundedInt(input.timeout_sec, this.config.defaultTimeoutSec, 5, 172800, "timeout_sec"),
        },
        reportId,
        options,
      );

      const run = await this.executeMat(command);
      persistDebugLog({
        enabled: this.config.debug,
        logDir: this.config.debugLogDir,
        context,
        run,
        privacyMode: this.config.privacyMode,
      });

      if (run.exitCode !== 0) {
        throw classifyRunFailure(run, this.config.stdioTailChars, command.timeoutSec);
      }

      const artifacts = resolveReportArtifacts(heapPath, context.startedAtMs);
      const response: MatParseReportSuccess = {
        status: "ok",
        exit_code: run.exitCode ?? 0,
        report_dir: artifacts.reportDir,
        report_zip: artifacts.reportZip,
        generated_files: artifacts.generatedFiles,
        stdout_tail: tail(run.stdout, this.config.stdioTailChars),
        stderr_tail: tail(run.stderr, this.config.stdioTailChars),
      };

      logRequestEnd(context, {
        status: "ok",
        elapsedMs: Date.now() - context.startedAtMs,
        exitCode: run.exitCode,
        artifacts: artifacts.generatedFiles,
      });
      return response;
    } catch (error) {
      return this.handleToolError(context, error, "MAT_PARSE_FAILED");
    }
  }

  async matOqlQuery(input: OqlQueryInput): Promise<MatOqlQuerySuccess | MatErrorResponse> {
    const context = createRequestContext("mat_oql_query", input.heap_path, this.config.privacyMode);
    logRequestStart(context);

    try {
      const heapPath = ensureAllowedHeapPath(input.heap_path, this.config.allowedRoots);
      ensureWriteAccessNearHeap(heapPath);
      const launcher = this.resolveLauncher();

      const normalizedOql = normalizeOqlInput(input.oql);
      const oqlBytes = Buffer.byteLength(normalizedOql, "utf8");
      if (oqlBytes > this.config.oqlMaxBytes) {
        throw new MatMcpError({
          category: "INVALID_QUERY",
          message: `OQL exceeds max size (${oqlBytes} > ${this.config.oqlMaxBytes} bytes).`,
          hint: "Reduce query size or increase MAT_OQL_MAX_BYTES.",
        });
      }

      const command = buildOqlCommand(
        {
          javaPath: this.config.javaPath,
          launcherPath: launcher,
          heapPath,
          configDir: this.config.matConfigDir,
          dataDir: this.config.matDataDir,
          xmxMb: this.validateBoundedInt(input.xmx_mb, this.config.defaultXmxMb, 256, 262144, "xmx_mb"),
          timeoutSec: this.validateBoundedInt(input.timeout_sec, this.config.defaultTimeoutSec, 5, 172800, "timeout_sec"),
        },
        {
          oql: normalizedOql,
          format: input.format ?? "txt",
          unzip: input.unzip ?? true,
          limit: input.limit === undefined ? undefined : this.validateBoundedInt(input.limit, input.limit!, 1, 10_000_000, "limit"),
        },
      );

      const run = await this.executeMat(command);
      persistDebugLog({
        enabled: this.config.debug,
        logDir: this.config.debugLogDir,
        context,
        run,
        privacyMode: this.config.privacyMode,
      });

      if (run.exitCode !== 0) {
        throw classifyRunFailure(run, this.config.stdioTailChars, command.timeoutSec);
      }

      const artifacts = resolveQueryArtifacts(heapPath, context.startedAtMs);
      const resultPreview = artifacts.resultTxt ? readResultPreview(artifacts.resultTxt, this.config.resultPreviewLines) : [];
      const response: MatOqlQuerySuccess = {
        status: "ok",
        exit_code: run.exitCode ?? 0,
        query_dir: artifacts.queryDir,
        query_zip: artifacts.queryZip,
        result_txt: artifacts.resultTxt,
        result_preview: resultPreview,
        generated_files: artifacts.generatedFiles,
        stdout_tail: tail(run.stdout, this.config.stdioTailChars),
        stderr_tail: tail(run.stderr, this.config.stdioTailChars),
      };

      logRequestEnd(context, {
        status: "ok",
        elapsedMs: Date.now() - context.startedAtMs,
        exitCode: run.exitCode,
        artifacts: artifacts.generatedFiles,
      });
      return response;
    } catch (error) {
      return this.handleToolError(context, error, "MAT_PARSE_FAILED");
    }
  }

  async matRunCommand(input: RunCommandInput): Promise<MatRunCommandSuccess | MatErrorResponse> {
    const context = createRequestContext("mat_run_command", input.heap_path, this.config.privacyMode);
    logRequestStart(context);

    try {
      const commandName = this.validateCommandName(input.command_name);
      const heapPath = ensureAllowedHeapPath(input.heap_path, this.config.allowedRoots);
      ensureWriteAccessNearHeap(heapPath);
      const launcher = this.resolveLauncher();

      if (input.command_args !== undefined) {
        const argsBytes = Buffer.byteLength(input.command_args, "utf8");
        if (argsBytes > this.config.oqlMaxBytes) {
          throw new MatMcpError({
            category: "INVALID_QUERY",
            message: `command_args exceeds max size (${argsBytes} > ${this.config.oqlMaxBytes} bytes).`,
            hint: "Reduce command_args size or increase MAT_OQL_MAX_BYTES.",
          });
        }
      }

      const command = buildGenericCommand(
        {
          javaPath: this.config.javaPath,
          launcherPath: launcher,
          heapPath,
          configDir: this.config.matConfigDir,
          dataDir: this.config.matDataDir,
          xmxMb: this.validateBoundedInt(input.xmx_mb, this.config.defaultXmxMb, 256, 262144, "xmx_mb"),
          timeoutSec: this.validateBoundedInt(input.timeout_sec, this.config.defaultTimeoutSec, 5, 172800, "timeout_sec"),
        },
        {
          commandName,
          commandArgs: input.command_args,
          format: input.format ?? "txt",
          unzip: input.unzip ?? true,
          limit: input.limit === undefined ? undefined : this.validateBoundedInt(input.limit, input.limit!, 1, 10_000_000, "limit"),
        },
      );

      const run = await this.executeMat(command);
      persistDebugLog({
        enabled: this.config.debug,
        logDir: this.config.debugLogDir,
        context,
        run,
        privacyMode: this.config.privacyMode,
      });

      if (run.exitCode !== 0) {
        throw classifyRunFailure(run, this.config.stdioTailChars, command.timeoutSec);
      }

      const artifacts = resolveQueryArtifacts(heapPath, context.startedAtMs);
      const resultPreview = artifacts.resultTxt ? readResultPreview(artifacts.resultTxt, this.config.resultPreviewLines) : [];
      const response: MatRunCommandSuccess = {
        status: "ok",
        exit_code: run.exitCode ?? 0,
        command_name: commandName,
        query_dir: artifacts.queryDir,
        query_zip: artifacts.queryZip,
        result_txt: artifacts.resultTxt,
        result_preview: resultPreview,
        generated_files: artifacts.generatedFiles,
        stdout_tail: tail(run.stdout, this.config.stdioTailChars),
        stderr_tail: tail(run.stderr, this.config.stdioTailChars),
      };

      logRequestEnd(context, {
        status: "ok",
        elapsedMs: Date.now() - context.startedAtMs,
        exitCode: run.exitCode,
        artifacts: artifacts.generatedFiles,
      });
      return response;
    } catch (error) {
      return this.handleToolError(context, error, "MAT_PARSE_FAILED");
    }
  }

  matOqlSpec(): MatOqlSpecSuccess {
    const context = createRequestContext("mat_oql_spec", undefined, this.config.privacyMode);
    logRequestStart(context);
    const response: MatOqlSpecSuccess = {
      status: "ok",
      ...MAT_OQL_SPEC,
    };
    logRequestEnd(context, {
      status: "ok",
      elapsedMs: Date.now() - context.startedAtMs,
    });
    return response;
  }

  matIndexStatus(input: IndexStatusInput): MatIndexStatusSuccess | MatErrorResponse {
    const context = createRequestContext("mat_index_status", input.heap_path, this.config.privacyMode);
    logRequestStart(context);

    try {
      const heapPath = ensureAllowedHeapPath(input.heap_path, this.config.allowedRoots);
      const artifacts = resolveIndexArtifacts(heapPath);

      const response: MatIndexStatusSuccess = {
        status: "ok",
        index_present: artifacts.indexPresent,
        index_files: artifacts.indexFiles,
        threads_file: artifacts.threadsFile,
        last_modified: artifacts.lastModified,
      };

      logRequestEnd(context, {
        status: "ok",
        elapsedMs: Date.now() - context.startedAtMs,
        artifacts: artifacts.indexFiles,
      });
      return response;
    } catch (error) {
      return this.handleToolError(context, error, "HEAP_NOT_FOUND");
    }
  }

  private resolveLauncher(): string {
    return resolveMatLauncher({
      matLauncher: this.config.matLauncher,
      matHome: this.config.matHome,
    });
  }

  private validateReportId(reportId: string): string {
    if ((ALLOWED_REPORT_IDS as readonly string[]).includes(reportId)) {
      return reportId;
    }
    throw new MatMcpError({
      category: "MAT_PARSE_FAILED",
      message: `Unsupported report_id: ${reportId}`,
      hint: `Use one of: ${ALLOWED_REPORT_IDS.join(", ")}`,
    });
  }

  private validateCommandName(commandName: string): string {
    const trimmed = commandName.trim();
    if ((ALLOWED_COMMANDS as readonly string[]).includes(trimmed)) {
      return trimmed;
    }
    throw new MatMcpError({
      category: "MAT_PARSE_FAILED",
      message: `Unsupported command_name: ${trimmed}`,
      hint: `Use one of: ${(ALLOWED_COMMANDS as readonly string[]).join(", ")}`,
    });
  }

  private sanitizeOptions(options: Record<string, string | number | boolean>): Record<string, string | number | boolean> {
    const sanitized: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(options)) {
      if (!/^[a-zA-Z0-9_.-]+$/.test(key)) {
        throw new MatMcpError({
          category: "MAT_PARSE_FAILED",
          message: `Invalid option key: ${key}`,
          hint: "Option keys must contain only letters, numbers, underscore, dot, or dash.",
        });
      }

      if (PATH_OPTION_KEYS.has(key)) {
        if (typeof value !== "string") {
          throw new MatMcpError({
            category: "MAT_PARSE_FAILED",
            message: `Option ${key} must be a file path string.`,
            hint: "Provide an absolute path for compare/baseline options.",
          });
        }
        sanitized[key] = ensureAllowedHeapPath(value, this.config.allowedRoots);
        continue;
      }

      sanitized[key] = value;
    }
    return sanitized;
  }

  private validateBoundedInt(value: number | undefined, fallback: number, min: number, max: number, field: string): number {
    const resolved = value ?? fallback;
    if (!Number.isInteger(resolved) || resolved < min || resolved > max) {
      throw new MatMcpError({
        category: "MAT_PARSE_FAILED",
        message: `${field} must be an integer between ${min} and ${max}.`,
        hint: `Set ${field} within the valid range.`,
      });
    }
    return resolved;
  }

  private async executeMat(command: RunCommand): Promise<RunResult> {
    try {
      return await this.deps.runCommand(command);
    } catch (error) {
      throw classifySpawnError(error);
    }
  }

  private handleToolError(
    context: RequestContext,
    error: unknown,
    fallbackCategory: "MAT_NOT_FOUND" | "MAT_PARSE_FAILED" | "HEAP_NOT_FOUND",
  ): MatErrorResponse {
    const response = this.normalizeError(error, fallbackCategory);
    logRequestEnd(context, {
      status: "error",
      category: response.category,
      elapsedMs: Date.now() - context.startedAtMs,
      exitCode: response.exit_code,
    });
    return response;
  }

  private normalizeError(error: unknown, fallbackCategory: "MAT_NOT_FOUND" | "MAT_PARSE_FAILED" | "HEAP_NOT_FOUND"): MatErrorResponse {
    if (error instanceof MatMcpError) {
      return error.toResponse();
    }

    const message = error instanceof Error ? error.message : String(error);
    return new MatMcpError({
      category: fallbackCategory,
      message,
      hint: "Unexpected runtime error. Check server logs for details.",
    }).toResponse();
  }
}

function readResultPreview(filePath: string, lineLimit: number): string[] {
  let fd: number;
  try {
    fd = fs.openSync(filePath, "r");
  } catch {
    return [];
  }

  try {
    const lines: string[] = [];
    const buf = Buffer.alloc(8192);
    let remainder = "";
    let bytesRead: number;

    while ((bytesRead = fs.readSync(fd, buf)) > 0) {
      const chunk = remainder + buf.toString("utf8", 0, bytesRead);
      const parts = chunk.split(/\r?\n/);
      remainder = parts.pop() ?? "";

      for (const part of parts) {
        if (part.length > 0) {
          lines.push(part);
          if (lines.length >= lineLimit) return lines;
        }
      }
    }

    if (remainder.length > 0 && lines.length < lineLimit) {
      lines.push(remainder);
    }
    return lines;
  } finally {
    fs.closeSync(fd);
  }
}