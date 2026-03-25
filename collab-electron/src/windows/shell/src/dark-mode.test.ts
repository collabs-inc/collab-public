import { describe, test, expect, beforeEach } from "bun:test";
import {
  applyCanvasOpacity,
  applyTileBorderColor,
  applyTileBorderWidth,
} from "./dark-mode.js";

function getCSSProperty(name: string): string {
  return document.documentElement.style.getPropertyValue(name);
}

beforeEach(() => {
  document.documentElement.style.cssText = "";
});

// -- applyTileBorderColor --

describe("applyTileBorderColor", () => {
  test("sets --tile-focus-border-color to the given hex color", () => {
    applyTileBorderColor("#ff0000");
    expect(getCSSProperty("--tile-focus-border-color")).toBe("#ff0000");
  });

  test("sets --tile-focus-border-color to an rgba value", () => {
    applyTileBorderColor("rgba(255, 255, 255, 0.5)");
    expect(getCSSProperty("--tile-focus-border-color")).toBe(
      "rgba(255, 255, 255, 0.5)",
    );
  });

  test("does not set property for empty string", () => {
    applyTileBorderColor("");
    expect(getCSSProperty("--tile-focus-border-color")).toBe("");
  });

  test("does not set property for whitespace-only string", () => {
    applyTileBorderColor("   ");
    expect(getCSSProperty("--tile-focus-border-color")).toBe("");
  });

  test("does not set property for non-string values", () => {
    applyTileBorderColor(null as unknown as string);
    expect(getCSSProperty("--tile-focus-border-color")).toBe("");

    applyTileBorderColor(undefined as unknown as string);
    expect(getCSSProperty("--tile-focus-border-color")).toBe("");

    applyTileBorderColor(123 as unknown as string);
    expect(getCSSProperty("--tile-focus-border-color")).toBe("");
  });
});

// -- applyTileBorderWidth --

describe("applyTileBorderWidth", () => {
  test("sets --tile-focus-border-width with px suffix", () => {
    applyTileBorderWidth(2);
    expect(getCSSProperty("--tile-focus-border-width")).toBe("2px");
  });

  test("clamps value to minimum 0", () => {
    applyTileBorderWidth(-1);
    expect(getCSSProperty("--tile-focus-border-width")).toBe("0px");
  });

  test("clamps value to maximum 4", () => {
    applyTileBorderWidth(10);
    expect(getCSSProperty("--tile-focus-border-width")).toBe("4px");
  });

  test("defaults to 1 for NaN input", () => {
    applyTileBorderWidth(NaN);
    expect(getCSSProperty("--tile-focus-border-width")).toBe("1px");
  });

  test("defaults to 1 for non-numeric input", () => {
    applyTileBorderWidth("abc" as unknown as number);
    expect(getCSSProperty("--tile-focus-border-width")).toBe("1px");
  });

  test("accepts 0 as valid value", () => {
    applyTileBorderWidth(0);
    expect(getCSSProperty("--tile-focus-border-width")).toBe("0px");
  });

  test("accepts boundary value 4", () => {
    applyTileBorderWidth(4);
    expect(getCSSProperty("--tile-focus-border-width")).toBe("4px");
  });
});
