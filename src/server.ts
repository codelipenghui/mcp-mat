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
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { loadConfig } from "./config.js";
import { MatService } from "./mat/service.js";
import { executeTool } from "./tools/dispatcher.js";
import { toolDefinitions } from "./tools/schemas.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function findPackageJson(): string {
  let dir = __dirname;
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(dir, "package.json");
    if (fs.existsSync(candidate)) return candidate;
    dir = path.dirname(dir);
  }
  throw new Error("Could not locate package.json");
}

const pkg = JSON.parse(fs.readFileSync(findPackageJson(), "utf8")) as { version: string };

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig(process.env);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Configuration error: ${message}\n`);
    process.exit(1);
    return;
  }

  const service = new MatService(config);

  const server = new Server(
    {
      name: "mcp-mat",
      version: pkg.version,
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: toolDefinitions.map((definition) => ({
        name: definition.name,
        description: definition.description,
        inputSchema: definition.inputSchema,
      })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name;
    const toolArgs = request.params.arguments;
    const result = await executeTool(toolName, toolArgs, service);

    return {
      isError: result.status === "error",
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

void main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`Fatal server error: ${message}\n`);
  process.exit(1);
});