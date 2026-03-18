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
import path from "node:path";
import { MatMcpError } from "../types.js";

export function ensureValidHeapPath(heapPath: string): string {
  const absoluteInput = path.resolve(heapPath);

  let canonical: string;
  try {
    canonical = fs.realpathSync(absoluteInput);
  } catch {
    throw new MatMcpError({
      category: "HEAP_NOT_FOUND",
      message: `Heap path does not exist: ${absoluteInput}`,
      hint: "Verify the heap dump path and server filesystem permissions.",
    });
  }

  const stat = fs.statSync(canonical);
  if (!stat.isFile()) {
    throw new MatMcpError({
      category: "HEAP_NOT_FOUND",
      message: `Heap path is not a file: ${canonical}`,
      hint: "Provide a MAT-supported heap dump file path.",
    });
  }

  try {
    fs.accessSync(canonical, fs.constants.R_OK);
  } catch {
    throw new MatMcpError({
      category: "HEAP_NOT_FOUND",
      message: `Heap path is not readable: ${canonical}`,
      hint: "Grant read permission for the heap file and parent directory.",
    });
  }

  return canonical;
}

export function ensureWriteAccessNearHeap(heapPath: string): void {
  const parentDir = path.dirname(heapPath);
  try {
    fs.accessSync(parentDir, fs.constants.W_OK);
  } catch {
    throw new MatMcpError({
      category: "WRITE_PERMISSION_DENIED",
      message: `Missing write access near heap: ${parentDir}`,
      hint: "Grant write access near the heap or copy it to a writable location.",
    });
  }
}