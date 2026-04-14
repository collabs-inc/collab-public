import { describe, test, expect } from "bun:test";
import { flattenTree } from "./useFileTree";

describe("flattenTree", () => {
  test("files at expected level", () => {
    const nodes = [
      { name: "readme.md", path: "/docs/readme.md", kind: "file" as const },
      { name: "todo.md", path: "/docs/todo.md", kind: "file" as const },
    ];
    const result = flattenTree(nodes, new Set(), 0, "alpha-asc", 1);
    expect(result).toHaveLength(2);
    expect(result[0]!.level).toBe(1);
    expect(result[0]!.kind).toBe("file");
    expect(result[1]!.level).toBe(1);
  });

  test("expanded folder shows children", () => {
    const nodes = [
      {
        name: "src",
        path: "/ws/src",
        kind: "folder" as const,
        children: [
          { name: "index.ts", path: "/ws/src/index.ts", kind: "file" as const },
        ],
      },
    ];
    const expanded = new Set(["/ws/src"]);
    const result = flattenTree(nodes, expanded, 0, "alpha-asc", 1);
    expect(result[0]!.kind).toBe("folder");
    expect(result[0]!.level).toBe(1);
    expect(result[0]!.isExpanded).toBe(true);
    expect(result[1]!.kind).toBe("file");
    expect(result[1]!.level).toBe(2);
  });

  test("collapsed folder hides children", () => {
    const nodes = [
      {
        name: "src",
        path: "/ws/src",
        kind: "folder" as const,
        children: [
          { name: "index.ts", path: "/ws/src/index.ts", kind: "file" as const },
        ],
      },
    ];
    const result = flattenTree(nodes, new Set(), 0, "alpha-asc", 1);
    expect(result).toHaveLength(1);
    expect(result[0]!.kind).toBe("folder");
    expect(result[0]!.isExpanded).toBe(false);
  });

  test("folders sorted before files", () => {
    const nodes = [
      { name: "z-file.md", path: "/ws/z-file.md", kind: "file" as const },
      { name: "a-folder", path: "/ws/a-folder", kind: "folder" as const },
    ];
    const result = flattenTree(nodes, new Set(), 0, "alpha-asc");
    expect(result[0]!.kind).toBe("folder");
    expect(result[1]!.kind).toBe("file");
  });

  test("empty node list returns empty", () => {
    const result = flattenTree([], new Set(), 0, "alpha-asc");
    expect(result).toHaveLength(0);
  });
});
