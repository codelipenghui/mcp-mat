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

import type { RunCommand } from "../types.js";

const ASM_EXPORT = "--add-exports=java.base/jdk.internal.org.objectweb.asm=ALL-UNNAMED";
const PARSE_APP_ID = "org.eclipse.mat.api.parse";

export interface BaseMatCommandArgs {
  javaPath: string;
  launcherPath: string;
  heapPath: string;
  configDir: string;
  dataDir: string;
  xmxMb: number;
  timeoutSec: number;
}

function buildCommonArgs(base: BaseMatCommandArgs): string[] {
  return [
    `-Xmx${base.xmxMb}m`,
    ASM_EXPORT,
    "-jar",
    base.launcherPath,
    "-consolelog",
    "-nosplash",
    "-configuration",
    base.configDir,
    "-data",
    base.dataDir,
    "-application",
    PARSE_APP_ID,
    base.heapPath,
  ];
}

function optionToArg(key: string, value: string | number | boolean): string | null {
  if (typeof value === "boolean") {
    return value ? `-${key}` : `-${key}=false`;
  }
  if (typeof value === "number") {
    return `-${key}=${value}`;
  }
  if (value.trim().length === 0) {
    return null;
  }
  return `-${key}=${value}`;
}

export function formatOqlForMatCommand(oql: string): string {
  const escaped = oql.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
  return `"${escaped}"`;
}

export function buildParseReportCommand(
  base: BaseMatCommandArgs,
  reportId: string,
  options?: Record<string, string | number | boolean>,
): RunCommand {
  const args = buildCommonArgs(base);
  for (const [key, value] of Object.entries(options ?? {})) {
    const arg = optionToArg(key, value);
    if (arg) {
      args.push(arg);
    }
  }
  args.push(reportId);

  return {
    command: base.javaPath,
    args,
    timeoutSec: base.timeoutSec,
  };
}

function buildQueryStyleCommand(
  base: BaseMatCommandArgs,
  commandStr: string,
  params: { format: "txt" | "html" | "csv"; unzip: boolean; limit?: number },
): RunCommand {
  const args = buildCommonArgs(base);
  args.push(`-command=${commandStr}`);
  args.push(`-format=${params.format}`);
  if (params.unzip) {
    args.push("-unzip");
  }
  if (params.limit !== undefined) {
    args.push(`-limit=${params.limit}`);
  }
  args.push("org.eclipse.mat.api:query");

  return {
    command: base.javaPath,
    args,
    timeoutSec: base.timeoutSec,
  };
}

export function buildOqlCommand(
  base: BaseMatCommandArgs,
  params: {
    oql: string;
    format: "txt" | "html" | "csv";
    unzip: boolean;
    limit?: number;
  },
): RunCommand {
  return buildQueryStyleCommand(
    base,
    `oql ${formatOqlForMatCommand(params.oql)}`,
    params,
  );
}

export function buildGenericCommand(
  base: BaseMatCommandArgs,
  params: {
    commandName: string;
    commandArgs?: string;
    format: "txt" | "html" | "csv";
    unzip: boolean;
    limit?: number;
  },
): RunCommand {
  const commandStr = params.commandArgs
    ? `${params.commandName} ${params.commandArgs}`
    : params.commandName;
  return buildQueryStyleCommand(base, commandStr, params);
}
