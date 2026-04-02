import { describe, test, expect, beforeEach, afterAll, mock } from "bun:test";
import { Window } from "happy-dom";

// Register happy-dom globals for DOM access, clean up after suite
const win = new Window();
const savedDoc = globalThis.document;
const savedWin = globalThis.window;
const savedHTML = globalThis.HTMLElement;
globalThis.document = win.document;
globalThis.window = win;
globalThis.HTMLElement = win.HTMLElement;
afterAll(() => {
  globalThis.document = savedDoc;
  globalThis.window = savedWin;
  globalThis.HTMLElement = savedHTML;
});

// Minimal DOM stub
function makePanel(id) {
  const el = document.createElement("div");
  el.id = id;
  el.getBoundingClientRect = () => ({
    width: 280, height: 600, top: 0, left: 0, right: 280, bottom: 600,
  });
  return el;
}

function makeButton(id) {
  const btn = document.createElement("button");
  btn.id = id;
  return btn;
}

describe("createPanel", () => {
  let panel, resizeHandle, toggle, viewer, panelsEl;

  beforeEach(() => {
    document.body.innerHTML = "";
    panelsEl = document.createElement("div");
    panelsEl.id = "panels";
    panelsEl.getBoundingClientRect = () => ({
      width: 1200, height: 600, top: 0, left: 0, right: 1200, bottom: 600,
    });
    document.body.appendChild(panelsEl);

    panel = makePanel("panel-nav");
    resizeHandle = document.createElement("div");
    resizeHandle.id = "nav-resize";
    toggle = makeButton("nav-toggle");
    viewer = makePanel("panel-viewer");

    panelsEl.appendChild(panel);
    panelsEl.appendChild(resizeHandle);
    panelsEl.appendChild(viewer);
    document.body.appendChild(toggle);

    // Stub CSS custom properties
    document.documentElement.style.setProperty("--panel-nav-min", "100");
    document.documentElement.style.setProperty("--panel-nav-max", "1000");
    document.documentElement.style.setProperty("--panel-terminal-min", "100");
    document.documentElement.style.setProperty("--panel-terminal-max", "1000");

    // Stub shellApi
    window.shellApi = {
      setPref: mock(() => {}),
      getPref: mock(() => Promise.resolve(null)),
    };
  });

  test("starts visible by default", async () => {
    const { createPanel } = await import("./panel-manager.js");
    const mgr = createPanel("nav", {
      panel, viewer, resizeHandle, toggle,
      label: "Navigator",
      defaultWidth: 280,
      direction: 1,
    });
    mgr.initPrefs(null, null);
    expect(mgr.isVisible()).toBe(true);
  });

  test("toggles visibility", async () => {
    const { createPanel } = await import("./panel-manager.js");
    const mgr = createPanel("nav", {
      panel, viewer, resizeHandle, toggle,
      label: "Navigator",
      defaultWidth: 280,
      direction: 1,
    });
    mgr.initPrefs(null, null);
    mgr.toggle();
    expect(mgr.isVisible()).toBe(false);
    expect(window.shellApi.setPref).toHaveBeenCalledWith(
      "panel-visible-nav", false,
    );
  });

  test("persists width on pref key panel-width-{side}", async () => {
    const { createPanel } = await import("./panel-manager.js");
    const mgr = createPanel("nav", {
      panel, viewer, resizeHandle, toggle,
      label: "Navigator",
      defaultWidth: 280,
      direction: 1,
    });
    mgr.initPrefs(350, true);
    mgr.applyVisibility();
    expect(panel.style.flex).toBe("0 0 350px");
  });

  test("uses direction=-1 for right panels", async () => {
    const { createPanel } = await import("./panel-manager.js");
    const termPanel = makePanel("panel-terminal");
    const termResize = document.createElement("div");
    const termToggle = makeButton("terminal-toggle");
    panelsEl.appendChild(termResize);
    panelsEl.appendChild(termPanel);
    document.body.appendChild(termToggle);

    const mgr = createPanel("terminal", {
      panel: termPanel, viewer, resizeHandle: termResize,
      toggle: termToggle,
      label: "Terminals",
      defaultWidth: 240,
      direction: -1,
    });
    mgr.initPrefs(null, null);
    expect(mgr.isVisible()).toBe(true);
  });
});
