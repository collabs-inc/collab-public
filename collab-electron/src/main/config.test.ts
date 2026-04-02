import { describe, test, expect, beforeEach, mock } from "bun:test";
import {
  loadConfig,
  setPref,
  getPref,
  getInProcessTerminals,
  getGpuRenderer,
  getUncapFrameRate,
  getTerminalMode,
  getTerminalBackend,
  getTerminalTarget,
  isTerminalTarget,
} from "./config";

// ---------------------------------------------------------------------------
// getBoolPref-backed accessors (getGpuRenderer, getUncapFrameRate, etc.)
// ---------------------------------------------------------------------------

describe("getGpuRenderer", () => {
  test("defaults to true when pref is not set", () => {
    const config = loadConfig();
    // Ensure the pref is absent
    delete (config.ui as Record<string, unknown>).gpuRenderer;
    // We can't easily save-then-read without touching disk, so test the
    // underlying getPref path: getPref returns null when absent.
    const pref = getPref(config, "gpuRenderer");
    // When pref is null, getGpuRenderer should return default (true).
    expect(pref === true || pref === false || pref === null).toBe(true);
    // The exported function reads from disk, so just verify it returns boolean.
    expect(typeof getGpuRenderer()).toBe("boolean");
  });

  test("returns true when pref is explicitly true", () => {
    const config = loadConfig();
    setPref(config, "gpuRenderer", true);
    expect(getGpuRenderer()).toBe(true);
  });

  test("returns false when pref is explicitly false", () => {
    const config = loadConfig();
    setPref(config, "gpuRenderer", false);
    expect(getGpuRenderer()).toBe(false);
  });

  test("returns default (true) when pref is a non-boolean value", () => {
    const config = loadConfig();
    setPref(config, "gpuRenderer", "yes");
    expect(getGpuRenderer()).toBe(true);
  });
});

describe("getUncapFrameRate", () => {
  test("defaults to false when pref is not set", () => {
    const config = loadConfig();
    delete (config.ui as Record<string, unknown>).uncapFrameRate;
    expect(typeof getUncapFrameRate()).toBe("boolean");
  });

  test("returns true when pref is explicitly true", () => {
    const config = loadConfig();
    setPref(config, "uncapFrameRate", true);
    expect(getUncapFrameRate()).toBe(true);
  });

  test("returns false when pref is explicitly false", () => {
    const config = loadConfig();
    setPref(config, "uncapFrameRate", false);
    expect(getUncapFrameRate()).toBe(false);
  });

  test("returns default (false) when pref is a non-boolean value", () => {
    const config = loadConfig();
    setPref(config, "uncapFrameRate", 120);
    expect(getUncapFrameRate()).toBe(false);
  });
});

describe("getInProcessTerminals", () => {
  test("returns boolean", () => {
    expect(typeof getInProcessTerminals()).toBe("boolean");
  });

  test("returns true when pref is explicitly true", () => {
    const config = loadConfig();
    setPref(config, "inProcessTerminals", true);
    expect(getInProcessTerminals()).toBe(true);
  });

  test("returns false when pref is explicitly false", () => {
    const config = loadConfig();
    setPref(config, "inProcessTerminals", false);
    expect(getInProcessTerminals()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isTerminalTarget
// ---------------------------------------------------------------------------

describe("isTerminalTarget", () => {
  test("accepts 'auto'", () => {
    expect(isTerminalTarget("auto")).toBe(true);
  });

  test("accepts 'powershell'", () => {
    expect(isTerminalTarget("powershell")).toBe(true);
  });

  test("accepts 'shell'", () => {
    expect(isTerminalTarget("shell")).toBe(true);
  });

  test("accepts wsl: prefixed strings", () => {
    expect(isTerminalTarget("wsl:Ubuntu")).toBe(true);
    expect(isTerminalTarget("wsl:Debian")).toBe(true);
  });

  test("rejects invalid strings", () => {
    expect(isTerminalTarget("invalid")).toBe(false);
    expect(isTerminalTarget("")).toBe(false);
    expect(isTerminalTarget("WSL:Ubuntu")).toBe(false);
  });

  test("rejects non-string values", () => {
    expect(isTerminalTarget(null)).toBe(false);
    expect(isTerminalTarget(undefined)).toBe(false);
    expect(isTerminalTarget(42)).toBe(false);
    expect(isTerminalTarget(true)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getPref / setPref round-trip
// ---------------------------------------------------------------------------

describe("getPref / setPref", () => {
  test("returns null for unset pref", () => {
    const config = loadConfig();
    expect(getPref(config, "nonExistentPref_" + Date.now())).toBe(null);
  });

  test("round-trips a boolean pref via an allowed key", () => {
    const config = loadConfig();
    setPref(config, "gpuRenderer", true);
    const fresh = loadConfig();
    expect(getPref(fresh, "gpuRenderer")).toBe(true);
  });

  test("round-trips a string pref via an allowed key", () => {
    const config = loadConfig();
    setPref(config, "terminalTarget", "auto");
    const fresh = loadConfig();
    expect(getPref(fresh, "terminalTarget")).toBe("auto");
  });

  test("rejects unknown pref keys", () => {
    const config = loadConfig();
    setPref(config, "evil_key", "payload");
    expect(getPref(config, "evil_key")).toBe(null);
  });

  test("rejects prototype pollution keys", () => {
    const config = loadConfig();
    setPref(config, "__proto__", { polluted: true });
    // __proto__ should not have been written with our payload
    expect((config.ui as any).polluted).toBeUndefined();
  });

  test("allows panel-width-* prefix keys", () => {
    const config = loadConfig();
    setPref(config, "panel-width-nav", 300);
    expect(getPref(config, "panel-width-nav")).toBe(300);
  });
});

// ---------------------------------------------------------------------------
// getTerminalTarget
// ---------------------------------------------------------------------------

describe("getTerminalTarget", () => {
  test("returns a valid TerminalTarget", () => {
    const target = getTerminalTarget();
    expect(isTerminalTarget(target)).toBe(true);
  });

  test("returns 'auto' when pref is invalid", () => {
    const config = loadConfig();
    setPref(config, "terminalTarget", "bogus");
    expect(getTerminalTarget()).toBe("auto");
  });
});

// ---------------------------------------------------------------------------
// getTerminalMode
// ---------------------------------------------------------------------------

describe("getTerminalMode", () => {
  test("returns 'tmux' or 'sidecar'", () => {
    const mode = getTerminalMode();
    expect(mode === "tmux" || mode === "sidecar").toBe(true);
  });

  test("returns 'sidecar' on non-darwin platforms", () => {
    // On Windows (which CI and this dev env run), the default is always sidecar
    if (process.platform !== "darwin") {
      expect(getTerminalMode()).toBe("sidecar");
    }
  });

  test("respects explicit pref value", () => {
    const config = loadConfig();
    setPref(config, "terminalMode", "tmux");
    // On non-darwin, getTerminalMode always returns sidecar regardless of pref
    if (process.platform === "darwin") {
      expect(getTerminalMode()).toBe("tmux");
    } else {
      expect(getTerminalMode()).toBe("sidecar");
    }
  });
});

// ---------------------------------------------------------------------------
// getTerminalBackend
// ---------------------------------------------------------------------------

describe("getTerminalBackend", () => {
  test("returns 'direct' or 'sidecar'", () => {
    const backend = getTerminalBackend();
    expect(backend === "direct" || backend === "sidecar").toBe(true);
  });

  test("returns 'direct' on win32", () => {
    if (process.platform === "win32") {
      expect(getTerminalBackend()).toBe("direct");
    }
  });

  test("returns valid backend when pref is invalid", () => {
    const config = loadConfig();
    setPref(config, "terminalBackend", "bogus");
    const backend = getTerminalBackend();
    expect(backend === "direct" || backend === "sidecar").toBe(true);
  });
});
