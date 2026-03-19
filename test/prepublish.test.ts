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
