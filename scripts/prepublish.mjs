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

// 1. Version sync check
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const server = JSON.parse(fs.readFileSync("server.json", "utf8"));

if (pkg.version !== server.version) {
  console.error(`Version mismatch: package.json (${pkg.version}) != server.json (${server.version})`);
  process.exit(1);
}
if (pkg.version !== server.packages[0].version) {
  console.error(`Version mismatch: package.json (${pkg.version}) != server.json packages[0].version (${server.packages[0].version})`);
  process.exit(1);
}
if (pkg.mcpName !== server.name) {
  console.error(`Name mismatch: package.json mcpName (${pkg.mcpName}) != server.json name (${server.name})`);
  process.exit(1);
}

// 2. Shebang injection
const serverJs = "dist/src/server.js";
const content = fs.readFileSync(serverJs, "utf8");
if (!content.startsWith("#!")) {
  fs.writeFileSync(serverJs, "#!/usr/bin/env node\n" + content);
  console.log("Prepended shebang to " + serverJs);
} else {
  console.log("Shebang already present in " + serverJs);
}

console.log("Prepublish checks passed.");
