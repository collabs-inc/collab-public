import { describe, test, expect, beforeEach } from "bun:test";
import { buildIndex, updateFile, removeFile, batchUpdate } from "./wikilink-index";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("wikilink-index batch update", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `wikilink-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  test("batchUpdate processes multiple files without errors", async () => {
    const paths: string[] = [];
    for (let i = 0; i < 20; i++) {
      const filePath = join(testDir, `file-${i}.md`);
      await writeFile(filePath, `# File ${i}\n[[file-${(i + 1) % 20}]]`);
      paths.push(filePath);
    }

    await buildIndex(testDir);
    await batchUpdate(paths);

    // Wait for the debounced flush (500ms + buffer)
    await new Promise((r) => setTimeout(r, 700));
    // If we got here without error, batch processing succeeded
  });

  test("removeFile clears pending batch entry", async () => {
    const filePath = join(testDir, "test.md");
    await writeFile(filePath, "# Test\n[[other]]");
    await buildIndex(testDir);

    // Queue an update then immediately remove
    await batchUpdate([filePath]);
    removeFile(filePath);

    // Wait for flush — should not crash on deleted file
    await new Promise((r) => setTimeout(r, 700));
  });
});
