import { describe, test, expect } from "bun:test";
import { getTileLabel, getTileSubtitle, splitFilepath, positionTile } from "./tile-renderer.js";

// -- splitFilepath --

describe("splitFilepath", () => {
  test("splits a typical absolute path", () => {
    expect(splitFilepath("/Users/me/projects/app/index.ts")).toEqual({
      parent: "/Users/me/projects/app/",
      name: "index.ts",
    });
  });

  test("handles a single filename with no directory", () => {
    expect(splitFilepath("file.txt")).toEqual({
      parent: "",
      name: "file.txt",
    });
  });

  test("handles a path with one directory level", () => {
    expect(splitFilepath("src/file.ts")).toEqual({
      parent: "src/",
      name: "file.ts",
    });
  });

  test("handles trailing slash (directory path)", () => {
    // pop returns "" which is falsy, so fallback to full path as name
    const result = splitFilepath("/Users/me/projects/");
    expect(result.name).toBe("/Users/me/projects/");
    expect(result.parent).toBe("/Users/me/projects/");
  });

  test("handles root path", () => {
    const result = splitFilepath("/");
    expect(result.name).toBe("/");
  });
});

// -- getTileLabel --

describe("getTileLabel", () => {
  test("returns cwd basename for term tiles with cwd", () => {
    const label = getTileLabel({
      type: "term", id: "t1", cwd: "/Users/me/projects/collab",
    });
    expect(label.name).toBe("collab");
    expect(label.parent).toBe("/Users/me/projects/");
  });

  test("returns display name for term tiles without cwd", () => {
    const label = getTileLabel({
      type: "term", id: "t1", displayName: "PowerShell",
    });
    expect(label.name).toBe("PowerShell");
    expect(label.parent).toBe("");
  });

  test("returns 'Terminal' for term tiles without session info", () => {
    const label = getTileLabel({ type: "term", id: "t1" });
    expect(label.name).toBe("Terminal");
    expect(label.parent).toBe("");
  });

  test("returns hostname for browser tiles with URL", () => {
    const label = getTileLabel({
      type: "browser", id: "t1",
      url: "https://example.com/page",
    });
    expect(label.name).toBe("example.com");
  });

  test("returns raw URL for browser tiles with invalid URL", () => {
    const label = getTileLabel({
      type: "browser", id: "t1",
      url: "not-a-url",
    });
    expect(label.name).toBe("not-a-url");
  });

  test("returns 'Browser' for browser tiles without URL", () => {
    const label = getTileLabel({ type: "browser", id: "t1" });
    expect(label.name).toBe("Browser");
  });

  test("returns folder name for graph tiles with folderPath", () => {
    const label = getTileLabel({
      type: "graph", id: "t1",
      folderPath: "/Users/me/projects/myapp",
    });
    expect(label.name).toBe("myapp");
    expect(label.parent).toBe("/Users/me/projects/");
  });

  test("returns 'Graph' for graph tiles without folderPath", () => {
    const label = getTileLabel({ type: "graph", id: "t1" });
    expect(label.name).toBe("Graph");
  });

  test("returns filename for file-based tiles", () => {
    const label = getTileLabel({
      type: "note", id: "t1",
      filePath: "/Users/me/docs/readme.md",
    });
    expect(label.name).toBe("readme.md");
    expect(label.parent).toBe("/Users/me/docs/");
  });

  test("returns tile type for tiles without filePath", () => {
    const label = getTileLabel({ type: "code", id: "t1" });
    expect(label.name).toBe("code");
  });

  test("returns filename for image tiles", () => {
    const label = getTileLabel({
      type: "image", id: "t1",
      filePath: "/photos/cat.png",
    });
    expect(label.name).toBe("cat.png");
    expect(label.parent).toBe("/photos/");
  });
});

// -- getTileSubtitle --

describe("getTileSubtitle", () => {
  test("returns extension + parent for code tiles with filePath", () => {
    const sub = getTileSubtitle({
      type: "code", id: "t1",
      filePath: "/Users/me/projects/app/index.ts",
    });
    expect(sub).toBe(".ts \u2014 app");
  });

  test("returns extension only for code tiles with no parent dir", () => {
    const sub = getTileSubtitle({
      type: "code", id: "t1",
      filePath: "index.ts",
    });
    expect(sub).toBe(".ts");
  });

  test("returns empty for code tiles without filePath", () => {
    expect(getTileSubtitle({ type: "code", id: "t1" })).toBe("");
  });

  test("returns cwd for terminal tiles", () => {
    const sub = getTileSubtitle({
      type: "term", id: "t1", cwd: "/Users/me/projects",
    });
    expect(sub).toBe("/Users/me/projects");
  });

  test("returns empty for terminal tiles without cwd", () => {
    expect(getTileSubtitle({ type: "term", id: "t1" })).toBe("");
  });

  test("returns hostname for browser tiles", () => {
    const sub = getTileSubtitle({
      type: "browser", id: "t1",
      url: "https://docs.example.com/page",
    });
    expect(sub).toBe("docs.example.com");
  });

  test("returns empty for browser tiles without url", () => {
    expect(getTileSubtitle({ type: "browser", id: "t1" })).toBe("");
  });

  test("returns folderPath for graph tiles", () => {
    const sub = getTileSubtitle({
      type: "graph", id: "t1",
      folderPath: "/Users/me/projects/myapp",
    });
    expect(sub).toBe("/Users/me/projects/myapp");
  });

  test("returns filename for image tiles", () => {
    const sub = getTileSubtitle({
      type: "image", id: "t1",
      filePath: "/photos/cat.png",
    });
    expect(sub).toBe("cat.png");
  });

  test("returns empty for unknown tile types", () => {
    expect(getTileSubtitle({ type: "unknown", id: "t1" })).toBe("");
  });
});

// -- positionTile --

describe("positionTile", () => {
  function mockContainer() {
    const style: Record<string, string> = {};
    return { style };
  }

  test("sets position from tile coords + pan offset", () => {
    const container = mockContainer();
    const tile = { x: 100, y: 200, width: 400, height: 500, zIndex: 5 };
    positionTile(container, tile, 50, 30, 1);
    expect(container.style.left).toBe("150px");
    expect(container.style.top).toBe("230px");
  });

  test("applies zoom to screen position", () => {
    const container = mockContainer();
    const tile = { x: 100, y: 200, width: 400, height: 500, zIndex: 1 };
    positionTile(container, tile, 0, 0, 0.5);
    // screen x = 100 * 0.5 + 0 = 50
    // screen y = 200 * 0.5 + 0 = 100
    expect(container.style.left).toBe("50px");
    expect(container.style.top).toBe("100px");
    expect(container.style.transform).toBe("scale(0.5)");
  });

  test("sets width, height, and zIndex", () => {
    const container = mockContainer();
    const tile = { x: 0, y: 0, width: 400, height: 500, zIndex: 7 };
    positionTile(container, tile, 0, 0, 1);
    expect(container.style.width).toBe("400px");
    expect(container.style.height).toBe("500px");
    expect(container.style.zIndex).toBe("7");
  });

  test("sets transformOrigin to top left", () => {
    const container = mockContainer();
    const tile = { x: 0, y: 0, width: 100, height: 100, zIndex: 1 };
    positionTile(container, tile, 0, 0, 1);
    expect(container.style.transformOrigin).toBe("top left");
  });

  test("handles negative pan offset", () => {
    const container = mockContainer();
    const tile = { x: 100, y: 100, width: 100, height: 100, zIndex: 1 };
    positionTile(container, tile, -50, -50, 1);
    expect(container.style.left).toBe("50px");
    expect(container.style.top).toBe("50px");
  });

  test("handles negative tile coordinates", () => {
    const container = mockContainer();
    const tile = { x: -100, y: -200, width: 100, height: 100, zIndex: 1 };
    positionTile(container, tile, 500, 400, 1);
    expect(container.style.left).toBe("400px");
    expect(container.style.top).toBe("200px");
  });

  test("zoom and pan combine correctly", () => {
    const container = mockContainer();
    const tile = { x: 200, y: 300, width: 100, height: 100, zIndex: 1 };
    positionTile(container, tile, 10, 20, 0.75);
    // screen x = 200 * 0.75 + 10 = 160
    // screen y = 300 * 0.75 + 20 = 245
    expect(container.style.left).toBe("160px");
    expect(container.style.top).toBe("245px");
  });
});

// -- positionTile zoom crossfade --

describe("positionTile zoom crossfade", () => {
  function mockDOMContainer() {
    const contentStyle: Record<string, string> = {};
    const labelStyle: Record<string, string> = {};
    const titleBarStyle: Record<string, string> = {};
    const webviewStyle: Record<string, string> = {};
    const children: Record<string, any> = {
      ".tile-content": {
        style: contentStyle,
        querySelector: (sel: string) => {
          if (sel === "webview") return { style: webviewStyle };
          return null;
        },
      },
      ".tile-label-overlay": { style: labelStyle },
      ".tile-title-bar": { style: titleBarStyle },
      ".tile-content webview": { style: webviewStyle },
    };
    const style: Record<string, string> = {};
    return {
      style,
      querySelector: (sel: string) => children[sel] || null,
      _contentStyle: contentStyle,
      _labelStyle: labelStyle,
      _titleBarStyle: titleBarStyle,
      _webviewStyle: webviewStyle,
    };
  }

  test("at zoom >= 0.5 content is fully visible, label hidden", () => {
    const c = mockDOMContainer();
    const tile = { x: 0, y: 0, width: 100, height: 100, zIndex: 1 };
    positionTile(c, tile, 0, 0, 0.8);
    expect(c._contentStyle.opacity).toBe("1");
    expect(c._labelStyle.opacity).toBe("0");
    expect(c._titleBarStyle.opacity).toBe("1");
  });

  test("at zoom <= 0.35 content hidden, label fully visible", () => {
    const c = mockDOMContainer();
    const tile = { x: 0, y: 0, width: 100, height: 100, zIndex: 1 };
    positionTile(c, tile, 0, 0, 0.2);
    expect(c._contentStyle.opacity).toBe("0");
    expect(c._labelStyle.opacity).toBe("1");
    expect(c._titleBarStyle.opacity).toBe("0");
  });

  test("at zoom 0.425 content and label are half opacity", () => {
    const c = mockDOMContainer();
    const tile = { x: 0, y: 0, width: 100, height: 100, zIndex: 1 };
    positionTile(c, tile, 0, 0, 0.425);
    expect(parseFloat(c._contentStyle.opacity)).toBeCloseTo(0.5);
    expect(parseFloat(c._labelStyle.opacity)).toBeCloseTo(0.5);
  });

  test("webview hidden at zoom <= 0.35", () => {
    const c = mockDOMContainer();
    const tile = { x: 0, y: 0, width: 100, height: 100, zIndex: 1 };
    positionTile(c, tile, 0, 0, 0.3);
    expect(c._webviewStyle.visibility).toBe("hidden");
  });

  test("webview visible at zoom > 0.35", () => {
    const c = mockDOMContainer();
    const tile = { x: 0, y: 0, width: 100, height: 100, zIndex: 1 };
    positionTile(c, tile, 0, 0, 0.4);
    expect(c._webviewStyle.visibility).toBe("visible");
  });

  test("webview visible at zoom >= 0.5", () => {
    const c = mockDOMContainer();
    const tile = { x: 0, y: 0, width: 100, height: 100, zIndex: 1 };
    positionTile(c, tile, 0, 0, 1.0);
    expect(c._webviewStyle.visibility).toBe("visible");
  });
});
