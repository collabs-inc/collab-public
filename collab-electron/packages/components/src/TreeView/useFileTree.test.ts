import { describe, test, expect } from "bun:test";

function getAffectedDirs(
  oldPath: string,
  newPath: string,
  loadedDirs: Set<string>,
): Set<string> {
  const dirs = new Set<string>();
  const oldParent = oldPath.substring(0, oldPath.lastIndexOf("/"));
  if (loadedDirs.has(oldParent)) dirs.add(oldParent);
  const newParent = newPath.substring(0, newPath.lastIndexOf("/"));
  if (loadedDirs.has(newParent)) dirs.add(newParent);
  return dirs;
}

function getStaleDirKeys(oldPath: string, allDirKeys: string[]): string[] {
  const oldPrefix = oldPath + "/";
  return allDirKeys.filter((k) => k.startsWith(oldPrefix));
}

describe("file tree smart reload on rename", () => {
  test("same-directory rename: 1 reload", () => {
    const loaded = new Set(["/src", "/lib", "/test"]);
    const dirs = getAffectedDirs("/src/old.ts", "/src/new.ts", loaded);
    expect(dirs.size).toBe(1);
    expect(dirs.has("/src")).toBe(true);
  });

  test("cross-directory move: 2 reloads", () => {
    const loaded = new Set(["/src", "/lib"]);
    const dirs = getAffectedDirs("/src/file.ts", "/lib/file.ts", loaded);
    expect(dirs.size).toBe(2);
    expect(dirs.has("/src")).toBe(true);
    expect(dirs.has("/lib")).toBe(true);
  });

  test("destination not expanded: only source reloaded", () => {
    const loaded = new Set(["/src"]);
    const dirs = getAffectedDirs("/src/file.ts", "/other/file.ts", loaded);
    expect(dirs.size).toBe(1);
    expect(dirs.has("/src")).toBe(true);
  });

  test("50 expanded dirs, rename in one: only 1 affected", () => {
    const loaded = new Set<string>();
    for (let i = 0; i < 50; i++) loaded.add(`/dir-${i}`);
    const dirs = getAffectedDirs("/dir-5/file.ts", "/dir-5/renamed.ts", loaded);
    expect(dirs.size).toBe(1);
    expect(dirs.has("/dir-5")).toBe(true);
  });

  test("folder rename: stale child entries detected", () => {
    const allKeys = ["/src", "/src/old-folder", "/src/old-folder/sub1", "/src/old-folder/sub2", "/lib"];
    const stale = getStaleDirKeys("/src/old-folder", allKeys);
    expect(stale).toEqual(["/src/old-folder/sub1", "/src/old-folder/sub2"]);
  });

  test("folder rename: no stale entries when no children loaded", () => {
    const allKeys = ["/src", "/lib"];
    const stale = getStaleDirKeys("/src/old-folder", allKeys);
    expect(stale).toEqual([]);
  });
});
