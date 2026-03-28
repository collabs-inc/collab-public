import { describe, test, expect, mock, beforeEach } from "bun:test";

// universal.ts uses window.addEventListener at module scope
if (typeof globalThis.window === "undefined") {
  (globalThis as Record<string, unknown>).window = {
    addEventListener: () => {},
  };
}

let invokedChannels: string[] = [];

mock.module("electron", () => ({
  contextBridge: {
    exposeInMainWorld: (_name: string, api: Record<string, unknown>) => {
      exposedApi = api;
    },
  },
  ipcRenderer: {
    invoke: (channel: string, ...args: unknown[]) => {
      invokedChannels.push(channel);
      return Promise.resolve();
    },
    send: () => {},
    on: () => {},
    removeListener: () => {},
  },
}));

let exposedApi: Record<string, unknown> = {};

describe("universal preload", () => {
  beforeEach(() => {
    invokedChannels = [];
    exposedApi = {};
  });

  test("exposes updateDownload that invokes update:download", async () => {
    await import("./universal");

    expect(exposedApi.updateDownload).toBeDefined();
    expect(typeof exposedApi.updateDownload).toBe("function");

    await (exposedApi.updateDownload as () => Promise<void>)();
    expect(invokedChannels).toContain("update:download");
  });
});
