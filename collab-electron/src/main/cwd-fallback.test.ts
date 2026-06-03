import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { nearestExistingDir } from "./cwd-fallback";

describe("nearestExistingDir", () => {
  let root: string;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "cwd-fallback-"));
    fs.mkdirSync(path.join(root, "exists", "child"), { recursive: true });
    fs.writeFileSync(path.join(root, "exists", "a-file"), "x");
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("returns the directory itself when it exists", () => {
    const dir = path.join(root, "exists", "child");
    expect(nearestExistingDir(dir)).toBe(dir);
  });

  test("returns the nearest existing ancestor when the leaf is missing", () => {
    const missing = path.join(root, "exists", "gone");
    expect(nearestExistingDir(missing)).toBe(path.join(root, "exists"));
  });

  test("walks up multiple missing levels", () => {
    const deep = path.join(root, "exists", "gone", "deeper", "deepest");
    expect(nearestExistingDir(deep)).toBe(path.join(root, "exists"));
  });

  test("returns the parent directory when the path is a file", () => {
    const file = path.join(root, "exists", "a-file");
    expect(nearestExistingDir(file)).toBe(path.join(root, "exists"));
  });

  test("prefers an existing ancestor over the provided fallback", () => {
    const nowhere = path.join(root, "no", "such", "tree");
    // `root` is an existing ancestor, so the fallback is never used.
    expect(nearestExistingDir(nowhere, "/some/other/place")).toBe(root);
  });

  test("defaults the fallback to the home directory", () => {
    expect(nearestExistingDir(os.homedir())).toBe(os.homedir());
  });
});
