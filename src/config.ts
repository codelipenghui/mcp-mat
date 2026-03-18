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
import os from "node:os";
import path from "node:path";
import { z } from "zod";

export const ALLOWED_REPORT_IDS = [
  "org.eclipse.mat.api:suspects",
  "org.eclipse.mat.api:overview",
  "org.eclipse.mat.api:top_components",
  "org.eclipse.mat.api:compare",
  "org.eclipse.mat.api:suspects2",
  "org.eclipse.mat.api:overview2",
] as const;

export const ALLOWED_COMMANDS = [
  // Dominator tree analysis
  "dominator_tree",
  "show_dominator_tree",
  "immediate_dominators",
  "big_drops_in_dominator_tree",

  // Path to GC roots
  "path2gc",
  "merge_shortest_paths",
  "gc_roots",

  // Histogram & object listing
  "histogram",
  "delta_histogram",
  "list_objects",
  "group_by_value",
  "duplicate_classes",

  // Leak detection
  "leakhunter",
  "leakhunter2",
  "find_leaks",
  "find_leaks2",
  "reference_leak",

  // Thread analysis
  "thread_overview",
  "thread_details",
  "thread_stack",

  // Collection analysis
  "collection_fill_ratio",
  "collections_grouped_by_size",
  "array_fill_ratio",
  "arrays_grouped_by_size",
  "hash_entries",
  "map_collision_ratio",
  "extract_list_values",
  "hash_set_values",
  "primitive_arrays_with_a_constant_value",

  // Reference analysis
  "references_statistics",
  "weak_references_statistics",
  "soft_references_statistics",
  "phantom_references_statistics",
  "finalizer_references_statistics",

  // Finalizer analysis
  "finalizer_overview",
  "finalizer_thread",
  "finalizer_queue",
  "finalizer_in_processing",
  "finalizer_thread_locals",

  // Retained set
  "show_retained_set",
  "customized_retained_set",

  // Component & top consumers
  "component_report",
  "component_report_top",
  "top_consumers",
  "top_consumers_html",
  "pie_biggest_objects",

  // String & memory waste
  "find_strings",
  "waste_in_char_arrays",

  // Heap info & misc
  "heap_dump_overview",
  "unreachable_objects",
  "system_properties",
  "class_references",
  "comparison_report",

  // Eclipse/OSGi specific
  "bundle_registry",
  "leaking_bundles",

  // Export
  "export_hprof",
] as const;

const envSchema = z
  .object({
    MAT_HOME: z.string().optional(),
    MAT_LAUNCHER: z.string().optional(),
    JAVA_PATH: z.string().optional(),
    MAT_XMX_MB: z.string().optional(),
    MAT_TIMEOUT_SEC: z.string().optional(),
    MAT_CONFIG_DIR: z.string().optional(),
    MAT_DATA_DIR: z.string().optional(),
    MAT_DEBUG: z.string().optional(),
    MAT_DEBUG_LOG_DIR: z.string().optional(),
    MAT_PRIVACY_MODE: z.string().optional(),
    MAT_OQL_MAX_BYTES: z.string().optional(),
    MAT_RESULT_PREVIEW_LINES: z.string().optional(),
    MAT_STDIO_TAIL_CHARS: z.string().optional(),
  })
  .passthrough();

export interface ServerConfig {
  matHome?: string;
  matLauncher?: string;
  javaPath: string;
  defaultXmxMb: number;
  defaultTimeoutSec: number;
  matConfigDir: string;
  matDataDir: string;
  debug: boolean;
  debugLogDir: string;
  privacyMode: boolean;
  oqlMaxBytes: number;
  resultPreviewLines: number;
  stdioTailChars: number;
}

function parseIntInRange(name: string, value: string | undefined, fallback: number, min: number, max: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  return parsed;
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  throw new Error(`Invalid boolean value: ${value}`);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const parsed = envSchema.parse(env);

  const matConfigDir = path.resolve(parsed.MAT_CONFIG_DIR ?? path.join(os.tmpdir(), "mat-config"));
  const matDataDir = path.resolve(parsed.MAT_DATA_DIR ?? path.join(os.tmpdir(), "mat-workspace"));
  fs.mkdirSync(matConfigDir, { recursive: true });
  fs.mkdirSync(matDataDir, { recursive: true });

  const debug = parseBool(parsed.MAT_DEBUG, false);
  const debugLogDir = path.resolve(parsed.MAT_DEBUG_LOG_DIR ?? path.join(os.tmpdir(), "mcp-mat-logs"));
  if (debug) {
    fs.mkdirSync(debugLogDir, { recursive: true });
  }

  const matHome = parsed.MAT_HOME ? path.resolve(parsed.MAT_HOME) : undefined;
  if (matHome && !fs.existsSync(matHome)) {
    throw new Error(`MAT_HOME does not exist: ${matHome}`);
  }

  const matLauncher = parsed.MAT_LAUNCHER ? path.resolve(parsed.MAT_LAUNCHER) : undefined;
  if (matLauncher && !fs.existsSync(matLauncher)) {
    throw new Error(`MAT_LAUNCHER does not exist: ${matLauncher}`);
  }

  return {
    matHome,
    matLauncher,
    javaPath: parsed.JAVA_PATH?.trim() || "java",
    defaultXmxMb: parseIntInRange("MAT_XMX_MB", parsed.MAT_XMX_MB, 4096, 256, 262144),
    defaultTimeoutSec: parseIntInRange("MAT_TIMEOUT_SEC", parsed.MAT_TIMEOUT_SEC, 1800, 5, 172800),
    matConfigDir,
    matDataDir,
    debug,
    debugLogDir,
    privacyMode: parseBool(parsed.MAT_PRIVACY_MODE, false),
    oqlMaxBytes: parseIntInRange("MAT_OQL_MAX_BYTES", parsed.MAT_OQL_MAX_BYTES, 16 * 1024, 256, 1024 * 1024),
    resultPreviewLines: parseIntInRange("MAT_RESULT_PREVIEW_LINES", parsed.MAT_RESULT_PREVIEW_LINES, 20, 1, 2000),
    stdioTailChars: parseIntInRange("MAT_STDIO_TAIL_CHARS", parsed.MAT_STDIO_TAIL_CHARS, 4000, 256, 100000),
  };
}