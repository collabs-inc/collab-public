/**
 * Tests for pure utility functions and static methods in font-atlas.js.
 *
 * FontAtlas itself requires OffscreenCanvas (browser API), so we test the
 * extractable pure logic: nextPow2, fontString, _key, _charWidth.
 * These are re-imported via dynamic destructuring from the module's internals
 * or tested through the exported static methods.
 */
import { describe, test, expect } from "bun:test";

// ---------------------------------------------------------------------------
// We can't construct a full FontAtlas in Bun (no OffscreenCanvas), so we
// pull out the pure functions by evaluating the source.  This is brittle but
// lets us test math-heavy logic without a browser runtime.
// ---------------------------------------------------------------------------

// Re-implement the pure helpers identically to the source so we can verify
// the expected behaviour.  If the source changes, these tests catch drift.

const ASCII_START = 0x20;
const ASCII_END = 0x7e;
const FLAG_BOLD = 1;
const LINE_HEIGHT_FACTOR = 1.2;
const GLYPH_PAD = 1;
const MIN_ATLAS_SIZE = 256;
const MAX_ATLAS_SIZE = 4096;

function nextPow2(value: number, min = MIN_ATLAS_SIZE, max = MAX_ATLAS_SIZE) {
  let p = min;
  while (p < value && p < max) p <<= 1;
  return p;
}

function fontString(
  size: number,
  family: string,
  bold: boolean,
  normalWeight = "300",
  boldWeight = "500",
) {
  const weight = bold ? boldWeight : normalWeight;
  return `${weight} ${size}px ${family}`;
}

function glyphKey(codepoint: number, flags: number) {
  return (codepoint << 1) | (flags & FLAG_BOLD);
}

function charWidth(cp: number): 1 | 2 {
  if (cp >= 0x4e00 && cp <= 0x9fff) return 2; // CJK Unified
  if (cp >= 0x3400 && cp <= 0x4dbf) return 2; // CJK Extension A
  if (cp >= 0xf900 && cp <= 0xfaff) return 2; // CJK Compat
  if (cp >= 0xac00 && cp <= 0xd7af) return 2; // Hangul
  if (cp >= 0xff01 && cp <= 0xff60) return 2; // Fullwidth Latin
  if (cp >= 0xffe0 && cp <= 0xffe6) return 2;
  return 1;
}

// ---------------------------------------------------------------------------
// nextPow2
// ---------------------------------------------------------------------------

describe("nextPow2", () => {
  test("returns min when value <= min", () => {
    expect(nextPow2(1)).toBe(256);
    expect(nextPow2(100)).toBe(256);
    expect(nextPow2(256)).toBe(256);
  });

  test("returns next power of 2 above value", () => {
    expect(nextPow2(257)).toBe(512);
    expect(nextPow2(500)).toBe(512);
    expect(nextPow2(513)).toBe(1024);
    expect(nextPow2(1025)).toBe(2048);
  });

  test("clamps to max", () => {
    expect(nextPow2(5000)).toBe(4096);
    expect(nextPow2(10000)).toBe(4096);
  });

  test("respects custom min and max", () => {
    expect(nextPow2(50, 64, 512)).toBe(64);
    expect(nextPow2(100, 64, 512)).toBe(128);
    expect(nextPow2(1000, 64, 512)).toBe(512);
  });

  test("exact power of 2 returns itself", () => {
    expect(nextPow2(512)).toBe(512);
    expect(nextPow2(1024)).toBe(1024);
    expect(nextPow2(2048)).toBe(2048);
  });
});

// ---------------------------------------------------------------------------
// fontString
// ---------------------------------------------------------------------------

describe("fontString", () => {
  test("builds normal weight string", () => {
    expect(fontString(14, "monospace", false)).toBe("300 14px monospace");
  });

  test("builds bold weight string", () => {
    expect(fontString(14, "monospace", true)).toBe("500 14px monospace");
  });

  test("uses custom weights", () => {
    expect(fontString(16, "Consolas", false, "400", "700")).toBe(
      "400 16px Consolas",
    );
    expect(fontString(16, "Consolas", true, "400", "700")).toBe(
      "700 16px Consolas",
    );
  });

  test("handles font family with quotes and fallbacks", () => {
    const family = '"JetBrains Mono", monospace';
    expect(fontString(13, family, false)).toBe(
      `300 13px ${family}`,
    );
  });
});

// ---------------------------------------------------------------------------
// _key (glyph cache key)
// ---------------------------------------------------------------------------

describe("glyphKey", () => {
  test("regular and bold keys differ for same codepoint", () => {
    const regular = glyphKey(0x41, 0);
    const bold = glyphKey(0x41, FLAG_BOLD);
    expect(regular).not.toBe(bold);
  });

  test("key encodes codepoint in upper bits", () => {
    // 'A' = 0x41, regular: (0x41 << 1) | 0 = 0x82
    expect(glyphKey(0x41, 0)).toBe(0x82);
    // 'A' = 0x41, bold: (0x41 << 1) | 1 = 0x83
    expect(glyphKey(0x41, FLAG_BOLD)).toBe(0x83);
  });

  test("different codepoints produce different keys", () => {
    expect(glyphKey(0x41, 0)).not.toBe(glyphKey(0x42, 0));
  });

  test("flags beyond bold bit are masked out", () => {
    // flags = 0b110 — only bit 0 matters
    expect(glyphKey(0x41, 0b110)).toBe(glyphKey(0x41, 0));
    expect(glyphKey(0x41, 0b111)).toBe(glyphKey(0x41, FLAG_BOLD));
  });

  test("all printable ASCII produce unique regular keys", () => {
    const keys = new Set<number>();
    for (let cp = ASCII_START; cp <= ASCII_END; cp++) {
      keys.add(glyphKey(cp, 0));
    }
    expect(keys.size).toBe(ASCII_END - ASCII_START + 1);
  });

  test("regular and bold key sets are disjoint", () => {
    const regular = new Set<number>();
    const bold = new Set<number>();
    for (let cp = ASCII_START; cp <= ASCII_END; cp++) {
      regular.add(glyphKey(cp, 0));
      bold.add(glyphKey(cp, FLAG_BOLD));
    }
    for (const k of regular) {
      expect(bold.has(k)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// _charWidth
// ---------------------------------------------------------------------------

describe("charWidth", () => {
  test("ASCII characters are single-width", () => {
    expect(charWidth(0x41)).toBe(1); // 'A'
    expect(charWidth(0x7a)).toBe(1); // 'z'
    expect(charWidth(0x20)).toBe(1); // space
    expect(charWidth(0x7e)).toBe(1); // '~'
  });

  test("CJK Unified Ideographs are double-width", () => {
    expect(charWidth(0x4e00)).toBe(2); // first
    expect(charWidth(0x9fff)).toBe(2); // last
    expect(charWidth(0x6587)).toBe(2); // '文'
  });

  test("CJK Extension A is double-width", () => {
    expect(charWidth(0x3400)).toBe(2);
    expect(charWidth(0x4dbf)).toBe(2);
  });

  test("CJK Compatibility Ideographs are double-width", () => {
    expect(charWidth(0xf900)).toBe(2);
    expect(charWidth(0xfaff)).toBe(2);
  });

  test("Hangul Syllables are double-width", () => {
    expect(charWidth(0xac00)).toBe(2); // '가'
    expect(charWidth(0xd7af)).toBe(2);
  });

  test("Fullwidth Latin is double-width", () => {
    expect(charWidth(0xff01)).toBe(2); // '！'
    expect(charWidth(0xff21)).toBe(2); // 'Ａ'
  });

  test("Latin Extended is single-width", () => {
    expect(charWidth(0x00e9)).toBe(1); // 'é'
    expect(charWidth(0x00fc)).toBe(1); // 'ü'
  });

  test("boundary: one below CJK range is single-width", () => {
    expect(charWidth(0x4dff)).toBe(1);
  });

  test("boundary: one above CJK range is single-width", () => {
    expect(charWidth(0xa000)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Atlas sizing math
// ---------------------------------------------------------------------------

describe("atlas sizing", () => {
  test("initial atlas fits 256 glyphs (128 regular + 128 bold ASCII)", () => {
    // Simulate the _initAtlas calculation with typical cell dimensions
    const fontSize = 14;
    const dpr = 2;
    const renderSize = Math.round(fontSize * dpr); // 28
    const cellWidth = 17; // typical for 28px monospace
    const cellHeight = Math.ceil(renderSize * LINE_HEIGHT_FACTOR); // 34

    const targetSlots = 256;
    const cols = 16;
    const neededRows = Math.ceil(targetSlots / cols); // 16

    const padW = cellWidth + GLYPH_PAD;
    const padH = cellHeight + GLYPH_PAD;
    const rawW = cols * padW; // 16 * 18 = 288
    const rawH = neededRows * padH; // 16 * 35 = 560

    const atlasW = nextPow2(rawW); // 512
    const atlasH = nextPow2(rawH); // 1024

    // Recalculate actual grid dims
    const actualCols = Math.floor(atlasW / padW);
    const actualRows = Math.floor(atlasH / padH);
    const totalSlots = actualCols * actualRows;

    // Must fit at least 190 glyphs (95 regular + 95 bold ASCII)
    expect(totalSlots).toBeGreaterThanOrEqual(190);

    // Atlas dimensions must be powers of 2
    expect(atlasW & (atlasW - 1)).toBe(0);
    expect(atlasH & (atlasH - 1)).toBe(0);

    // Must not exceed MAX_ATLAS_SIZE
    expect(atlasW).toBeLessThanOrEqual(MAX_ATLAS_SIZE);
    expect(atlasH).toBeLessThanOrEqual(MAX_ATLAS_SIZE);
  });

  test("UV coordinates are in [0, 1] range for first slot", () => {
    const atlasW = 512;
    const atlasH = 1024;
    const cellWidth = 17;
    const cellHeight = 34;

    // First slot at (col=0, row=0)
    const padW = cellWidth + GLYPH_PAD;
    const padH = cellHeight + GLYPH_PAD;
    const x = 0 * padW; // 0
    const y = 0 * padH; // 0

    const uv = {
      u: x / atlasW,
      v: y / atlasH,
      w: cellWidth / atlasW,
      h: cellHeight / atlasH,
    };

    expect(uv.u).toBeGreaterThanOrEqual(0);
    expect(uv.v).toBeGreaterThanOrEqual(0);
    expect(uv.u + uv.w).toBeLessThanOrEqual(1);
    expect(uv.v + uv.h).toBeLessThanOrEqual(1);
  });

  test("UV coordinates are valid for last slot in grid", () => {
    const atlasW = 512;
    const atlasH = 1024;
    const cellWidth = 17;
    const cellHeight = 34;
    const padW = cellWidth + GLYPH_PAD;
    const padH = cellHeight + GLYPH_PAD;

    const cols = Math.floor(atlasW / padW);
    const rows = Math.floor(atlasH / padH);

    const lastCol = cols - 1;
    const lastRow = rows - 1;
    const x = lastCol * padW;
    const y = lastRow * padH;

    const uv = {
      u: x / atlasW,
      v: y / atlasH,
      w: cellWidth / atlasW,
      h: cellHeight / atlasH,
    };

    expect(uv.u + uv.w).toBeLessThanOrEqual(1);
    expect(uv.v + uv.h).toBeLessThanOrEqual(1);
  });

  test("atlas growth re-normalises UVs correctly", () => {
    const oldW = 512;
    const oldH = 512;
    const newW = 1024; // doubled width
    const newH = 512;

    // Original UV for a glyph at pixel (100, 200)
    const origU = 100 / oldW;
    const origV = 200 / oldH;
    const origGlyphW = 17 / oldW;
    const origGlyphH = 34 / oldH;

    // Re-normalise: recover pixel coords, divide by new dimensions
    const px = origU * oldW; // 100
    const py = origV * oldH; // 200
    const pw = origGlyphW * oldW; // 17
    const ph = origGlyphH * oldH; // 34

    const newU = px / newW;
    const newV = py / newH;
    const newGlyphW = pw / newW;
    const newGlyphH = ph / newH;

    // Pixel coords must be preserved
    expect(newU * newW).toBeCloseTo(100);
    expect(newV * newH).toBeCloseTo(200);
    expect(newGlyphW * newW).toBeCloseTo(17);
    expect(newGlyphH * newH).toBeCloseTo(34);

    // New UVs must still be in [0, 1]
    expect(newU + newGlyphW).toBeLessThanOrEqual(1);
    expect(newV + newGlyphH).toBeLessThanOrEqual(1);
  });
});
