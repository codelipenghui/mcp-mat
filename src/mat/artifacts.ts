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

function findQueryCommandText(queryDir: string): string | null {
  const pagesDir = path.join(queryDir, "pages");
  if (!fs.existsSync(pagesDir) || !fs.statSync(pagesDir).isDirectory()) {
    return null;
  }

  const candidates = safeReadDir(pagesDir)
    .filter((entry) => entry.isFile() && /^Query_Command\d+\.txt$/.test(entry.name))
    .map((entry) => path.join(pagesDir, entry.name));

  return latestByMtime(candidates);
}

export function resolveQueryArtifacts(heapPath: string, startedAtMs?: number): QueryArtifacts {
  const parent = path.dirname(heapPath);
  const bases = heapBases(heapPath);

  const queryDirCandidates: string[] = [];
  const queryZipCandidates: string[] = [];

  for (const entry of safeReadDir(parent)) {
    const fullPath = path.join(parent, entry.name);

    const isMatchingQuery = bases.some((base) => entry.name === `${base}_Query` || entry.name.startsWith(`${base}_Query`));
    if (!isMatchingQuery) {
      continue;
    }

    if (!isRecentEnough(fullPath, startedAtMs)) {
      continue;
    }

    if (entry.isDirectory()) {
      queryDirCandidates.push(fullPath);
    }
    if (entry.isFile() && entry.name.endsWith(".zip")) {
      queryZipCandidates.push(fullPath);
    }
  }

  const queryDir = latestByMtime(queryDirCandidates);
  const queryZip = latestByMtime(queryZipCandidates);
  const resultTxt = queryDir ? findQueryCommandText(queryDir) : null;
  const generated = discoverGeneratedNearHeap(heapPath, startedAtMs);
  if (resultTxt && !generated.includes(resultTxt)) {
    generated.push(resultTxt);
    generated.sort();
  }

  return {
    queryDir,
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
  const bases = heapBases(heapPath);

  const indexFiles: string[] = [];
  let threadsFile: string | null = null;
  let lastModifiedMs = 0;

  for (const entry of safeReadDir(parent)) {
    if (!entry.isFile()) {
      continue;
    }

    const fullPath = path.join(parent, entry.name);
    const startsWithHeap = bases.some((base) => entry.name.startsWith(base));
    if (!startsWithHeap) {
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
