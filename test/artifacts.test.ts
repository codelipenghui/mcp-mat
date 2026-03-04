import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveIndexArtifacts, resolveQueryArtifacts } from "../src/mat/artifacts.js";

function createHeapFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-mat-artifacts-"));
  const heap = path.join(root, "broker-0-heap.hprof");
  fs.writeFileSync(heap, "heap");
  return { root, heap };
}

test("resolveQueryArtifacts finds query directory, zip, and command txt", () => {
  const { root, heap } = createHeapFixture();
  const queryDir = path.join(root, "broker-0-heap_Query");
  const pagesDir = path.join(queryDir, "pages");
  fs.mkdirSync(pagesDir, { recursive: true });

  const resultFile = path.join(pagesDir, "Query_Command2.txt");
  fs.writeFileSync(resultFile, "line1\nline2\n");

  const queryZip = path.join(root, "broker-0-heap_Query.zip");
  fs.writeFileSync(queryZip, "zip");

  const artifacts = resolveQueryArtifacts(heap);
  assert.equal(artifacts.queryDir, queryDir);
  assert.equal(artifacts.queryZip, queryZip);
  assert.equal(artifacts.resultTxt, resultFile);
  assert.ok(artifacts.generatedFiles.some((item) => item.endsWith("_Query")));
});

test("resolveIndexArtifacts reports index files", () => {
  const { root, heap } = createHeapFixture();
  const index = path.join(root, "broker-0-heap.hprof.index");
  const lockIndex = path.join(root, "broker-0-heap.hprof.lock.index");
  const threads = path.join(root, "broker-0-heap.hprof.threads");
  fs.writeFileSync(index, "idx");
  fs.writeFileSync(lockIndex, "idx");
  fs.writeFileSync(threads, "th");

  const status = resolveIndexArtifacts(heap);
  assert.equal(status.indexPresent, true);
  assert.equal(status.indexFiles.length, 2);
  assert.equal(status.threadsFile, threads);
  assert.ok(status.lastModified);
});

test("resolveIndexArtifacts supports MAT files based on heap stem", () => {
  const { root, heap } = createHeapFixture();
  const index = path.join(root, "broker-0-heap.a2s.index");
  const domIn = path.join(root, "broker-0-heap.domIn.index");
  const threads = path.join(root, "broker-0-heap.threads");
  fs.writeFileSync(index, "idx");
  fs.writeFileSync(domIn, "idx");
  fs.writeFileSync(threads, "th");

  const status = resolveIndexArtifacts(heap);
  assert.equal(status.indexPresent, true);
  assert.equal(status.indexFiles.length, 2);
  assert.equal(status.threadsFile, threads);
  assert.ok(status.lastModified);
});
