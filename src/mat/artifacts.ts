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

export interface QueryArtifacts {
  queryDir: string | null;
  queryZip: string | null;
  resultTxt: string | null;
  generatedFiles: string[];
}

export interface ReportArtifacts {
  reportDir: string | null;
  reportZip: string | null;
  generatedFiles: string[];
}

export interface IndexArtifacts {
  indexPresent: boolean;
  indexFiles: string[];
  threadsFile: string | null;
  lastModified: string | null;
}

function heapBases(heapPath: string): string[] {
  const base = path.basename(heapPath);
  const stem = path.parse(heapPath).name;
  return [...new Set([base, stem])];
}

function safeReadDir(directory: string): fs.Dirent[] {
  try {
    return fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }
}

function latestByMtime(paths: string[]): string | null {
  if (paths.length === 0) return null;
  return paths
    .map((p) => ({ p, mtime: fs.statSync(p).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)[0].p;
}

function isRecentEnough(fullPath: string, startedAtMs: number | undefined): boolean {
  if (startedAtMs === undefined) return true;
  try {
    return fs.statSync(fullPath).mtimeMs >= startedAtMs - 2000;
  } catch {
    return false;
  }
}

function discoverGeneratedNearHeap(heapPath: string, startedAtMs?: number): string[] {
  const parent = path.dirname(heapPath);
  const bases = heapBases(heapPath);
  const entries = safeReadDir(parent);

  return entries
    .filter((entry) => {
      const matchesBase = bases.some((base) => entry.name.startsWith(base));
      if (!matchesBase) {
        return false;
      }

      if (entry.name === path.basename(heapPath)) {
        return false;
      }

      const fullPath = path.join(parent, entry.name);
      return isRecentEnough(fullPath, startedAtMs);
    })
    .map((entry) => path.join(parent, entry.name))
    .sort();
}

function findQueryCommandText(queryDir: string, startedAtMs?: number): string | null {
  const pagesDir = path.join(queryDir, "pages");
  if (!fs.existsSync(pagesDir) || !fs.statSync(pagesDir).isDirectory()) {
    return null;
  }

  const candidates = safeReadDir(pagesDir)
    .filter((entry) => entry.isFile() && /^Query_Command[_\d]*\d+\.txt$/.test(entry.name))
    .map((entry) => path.join(pagesDir, entry.name))
    .filter((fullPath) => isRecentEnough(fullPath, startedAtMs));

  return latestByMtime(candidates);
}

export function resolveQueryArtifacts(heapPath: string, startedAtMs?: number): QueryArtifacts {
  const parent = path.dirname(heapPath);
  const bases = heapBases(heapPath);

  const queryDirCandidates: string[] = [];
  const queryZipCandidates: string[] = [];
  // Directories whose own mtime is stale but may contain recently-updated files
  const staleDirCandidates: string[] = [];

  for (const entry of safeReadDir(parent)) {
    const fullPath = path.join(parent, entry.name);

    const isMatchingQuery = bases.some((base) => entry.name === `${base}_Query` || entry.name.startsWith(`${base}_Query`));
    if (!isMatchingQuery) {
      continue;
    }

    if (entry.isDirectory()) {
      if (isRecentEnough(fullPath, startedAtMs)) {
        queryDirCandidates.push(fullPath);
      } else {
        staleDirCandidates.push(fullPath);
      }
    }
    if (entry.isFile() && entry.name.endsWith(".zip")) {
      if (isRecentEnough(fullPath, startedAtMs)) {
        queryZipCandidates.push(fullPath);
      }
    }
  }

  const queryDir = latestByMtime(queryDirCandidates);
  const queryZip = latestByMtime(queryZipCandidates);

  // Look for result txt in a recent directory first, then fall back to stale
  // directories whose individual files may have been updated (overwriting an
  // existing file does not bump the parent directory mtime on macOS/Linux).
  let resultTxt = queryDir ? findQueryCommandText(queryDir, startedAtMs) : null;
  if (!resultTxt) {
    for (const staleDir of staleDirCandidates) {
      resultTxt = findQueryCommandText(staleDir, startedAtMs);
      if (resultTxt) break;
    }
  }

  const generated = discoverGeneratedNearHeap(heapPath, startedAtMs);
  if (resultTxt && !generated.includes(resultTxt)) {
    generated.push(resultTxt);
    generated.sort();
  }

  return {
    queryDir: queryDir ?? (resultTxt ? path.dirname(path.dirname(resultTxt)) : null),
    queryZip,
    resultTxt,
    generatedFiles: generated,
  };
}

export function resolveReportArtifacts(heapPath: string, startedAtMs?: number): ReportArtifacts {
  const generated = discoverGeneratedNearHeap(heapPath, startedAtMs);
  const dirs = generated.filter((item) => {
    try {
      return fs.statSync(item).isDirectory();
    } catch {
      return false;
    }
  });
  const zips = generated.filter((item) => item.endsWith(".zip"));

  return {
    reportDir: latestByMtime(dirs),
    reportZip: latestByMtime(zips),
    generatedFiles: generated,
  };
}

export function resolveIndexArtifacts(heapPath: string): IndexArtifacts {
  const parent = path.dirname(heapPath);
  // MAT names index files using the heap stem (without extension):
  //   heap.hprof -> heap.index, heap.idx.index, heap.threads, etc.
  const heapStem = path.parse(heapPath).name;

  const indexFiles: string[] = [];
  let threadsFile: string | null = null;
  let lastModifiedMs = 0;

  for (const entry of safeReadDir(parent)) {
    if (!entry.isFile()) {
      continue;
    }

    const fullPath = path.join(parent, entry.name);
    if (!entry.name.startsWith(heapStem)) {
      continue;
    }

    const isIndex = entry.name.includes(".index");
    const isThreads = entry.name.endsWith(".threads") || entry.name.includes("threads");

    if (!isIndex && !isThreads) {
      continue;
    }

    const mtimeMs = fs.statSync(fullPath).mtimeMs;
    if (mtimeMs > lastModifiedMs) {
      lastModifiedMs = mtimeMs;
    }

    if (isIndex) {
      indexFiles.push(fullPath);
    }

    if (isThreads && threadsFile === null) {
      threadsFile = fullPath;
    }
  }

  return {
    indexPresent: indexFiles.length > 0,
    indexFiles: indexFiles.sort(),
    threadsFile,
    lastModified: lastModifiedMs > 0 ? new Date(lastModifiedMs).toISOString() : null,
  };
}