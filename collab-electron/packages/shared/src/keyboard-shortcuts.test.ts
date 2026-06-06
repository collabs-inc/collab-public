import { describe, expect, test } from "bun:test";
import {
  findKeyboardShortcutAction,
  findKeyboardShortcutConflicts,
  formatKeyboardShortcutBindings,
  getDefaultKeyboardShortcutBindings,
  getEffectiveKeyboardShortcutBindings,
  keyboardShortcutBindingFromInput,
  keyboardShortcutBindingToElectronAccelerator,
  normalizeKeyboardShortcutOverrides,
  validateKeyboardShortcutBinding,
  withKeyboardShortcutOverride,
  type KeyboardShortcutBinding,
} from "./keyboard-shortcuts";

function binding(
  code: string,
  key: string,
  modifiers: KeyboardShortcutBinding["modifiers"],
): KeyboardShortcutBinding {
  return { code, key, modifiers };
}

describe("keyboard shortcut defaults", () => {
  test("uses platform-specific fullscreen defaults", () => {
    expect(getDefaultKeyboardShortcutBindings(
      "toggle-full-screen",
      "darwin",
    )).toEqual([
      binding("KeyF", "F", { control: true, meta: true }),
    ]);
    expect(getDefaultKeyboardShortcutBindings(
      "toggle-full-screen",
      "win32",
    )).toEqual([binding("F11", "F11", {})]);
  });

  test("supports multiple default bindings for one action", () => {
    expect(getDefaultKeyboardShortcutBindings(
      "sidebar-files",
      "darwin",
    )).toEqual([
      binding("KeyB", "B", { cmdOrCtrl: true }),
      binding("Backslash", "\\", { cmdOrCtrl: true }),
    ]);
  });
});

describe("keyboard shortcut overrides", () => {
  test("missing override falls back to defaults", () => {
    expect(getEffectiveKeyboardShortcutBindings(
      "focus-tile-left",
      {},
      "darwin",
    )).toEqual([binding("ArrowLeft", "ArrowLeft", { alt: true })]);
  });

  test("null override disables an action", () => {
    const overrides = normalizeKeyboardShortcutOverrides({
      "focus-tile-left": null,
    });
    expect(getEffectiveKeyboardShortcutBindings(
      "focus-tile-left",
      overrides,
      "darwin",
    )).toEqual([]);
  });

  test("array override replaces defaults", () => {
    const overrides = normalizeKeyboardShortcutOverrides({
      "focus-tile-left": [
        binding("ArrowLeft", "ArrowLeft", { alt: true, shift: true }),
      ],
    });
    expect(getEffectiveKeyboardShortcutBindings(
      "focus-tile-left",
      overrides,
      "darwin",
    )).toEqual([
      binding("ArrowLeft", "ArrowLeft", { alt: true, shift: true }),
    ]);
  });

  test("withKeyboardShortcutOverride can reset to default", () => {
    const overrides = withKeyboardShortcutOverride(
      { "focus-tile-left": null },
      "focus-tile-left",
      undefined,
    );
    expect(Object.hasOwn(overrides, "focus-tile-left")).toBe(false);
  });
});

describe("keyboard shortcut matching", () => {
  test("matches configured Option+Shift+Arrow instead of default Option+Arrow", () => {
    const overrides = normalizeKeyboardShortcutOverrides({
      "focus-tile-left": [
        binding("ArrowLeft", "ArrowLeft", { alt: true, shift: true }),
      ],
    });
    expect(findKeyboardShortcutAction({
      type: "keyDown",
      code: "ArrowLeft",
      key: "ArrowLeft",
      alt: true,
    }, overrides, "darwin")).toBeNull();
    expect(findKeyboardShortcutAction({
      type: "keyDown",
      code: "ArrowLeft",
      key: "ArrowLeft",
      alt: true,
      shift: true,
    }, overrides, "darwin")).toBe("focus-tile-left");
  });

  test("does not match disabled actions", () => {
    const overrides = normalizeKeyboardShortcutOverrides({
      "focus-tile-left": null,
    });
    expect(findKeyboardShortcutAction({
      type: "keyDown",
      code: "ArrowLeft",
      key: "ArrowLeft",
      alt: true,
    }, overrides, "darwin")).toBeNull();
  });

  test("matches DOM KeyboardEvent style modifier names", () => {
    expect(findKeyboardShortcutAction({
      type: "keydown",
      code: "KeyK",
      key: "k",
      metaKey: true,
    }, {}, "darwin")).toBe("focus-file-search");
  });

  test("matches CmdOrCtrl to the platform primary modifier only", () => {
    expect(findKeyboardShortcutAction({
      type: "keydown",
      code: "KeyK",
      key: "k",
      ctrlKey: true,
    }, {}, "darwin")).toBeNull();
    expect(findKeyboardShortcutAction({
      type: "keydown",
      code: "KeyK",
      key: "k",
      metaKey: true,
      ctrlKey: true,
    }, {}, "darwin")).toBeNull();
    expect(findKeyboardShortcutAction({
      type: "keydown",
      code: "KeyK",
      key: "k",
      ctrlKey: true,
    }, {}, "win32")).toBe("focus-file-search");
  });
});

describe("keyboard shortcut recording", () => {
  test("creates a binding from a keyboard input", () => {
    expect(keyboardShortcutBindingFromInput({
      code: "ArrowLeft",
      key: "ArrowLeft",
      altKey: true,
      shiftKey: true,
    })).toEqual(binding("ArrowLeft", "ArrowLeft", {
      alt: true,
      shift: true,
    }));
  });

  test("ignores pure modifier input", () => {
    expect(keyboardShortcutBindingFromInput({
      code: "AltLeft",
      key: "Alt",
      altKey: true,
    })).toBeNull();
  });

  test("rejects bare printable keys but allows function keys", () => {
    expect(validateKeyboardShortcutBinding(
      binding("KeyK", "k", {}),
    )).toBe("Use at least one modifier key.");
    expect(validateKeyboardShortcutBinding(
      binding("F11", "F11", {}),
    )).toBeNull();
  });
});

describe("keyboard shortcut display and conflicts", () => {
  test("formats bindings for macOS and Windows", () => {
    const bindings = [
      binding("ArrowLeft", "ArrowLeft", { alt: true, shift: true }),
    ];
    expect(formatKeyboardShortcutBindings(bindings, "darwin")).toEqual([
      "⌥ ⇧ ←",
    ]);
    expect(formatKeyboardShortcutBindings(bindings, "win32")).toEqual([
      "Alt+Shift+←",
    ]);
  });

  test("detects duplicate effective bindings", () => {
    const conflicts = findKeyboardShortcutConflicts(
      binding("KeyK", "K", { cmdOrCtrl: true }),
      "toggle-settings",
      {},
      "darwin",
    );
    expect(conflicts.map((conflict) => conflict.id)).toEqual([
      "focus-file-search",
    ]);
  });

  test("treats recorded command keys as equivalent to CmdOrCtrl defaults", () => {
    const conflicts = findKeyboardShortcutConflicts(
      binding("KeyK", "k", { meta: true }),
      "toggle-settings",
      {},
      "darwin",
    );
    expect(conflicts.map((conflict) => conflict.id)).toEqual([
      "focus-file-search",
    ]);
  });

  test("does not collapse Ctrl+Cmd into a plain CmdOrCtrl binding", () => {
    const conflicts = findKeyboardShortcutConflicts(
      binding("KeyK", "k", { meta: true, control: true }),
      "toggle-settings",
      {},
      "darwin",
    );
    expect(conflicts.map((conflict) => conflict.id)).toEqual([]);
  });

  test("converts menu-friendly bindings to Electron accelerators", () => {
    expect(keyboardShortcutBindingToElectronAccelerator(
      binding("KeyK", "K", { cmdOrCtrl: true }),
    )).toBe("CommandOrControl+K");
    expect(keyboardShortcutBindingToElectronAccelerator(
      binding("KeyF", "F", { control: true, meta: true }),
    )).toBe("Ctrl+Command+F");
  });
});
