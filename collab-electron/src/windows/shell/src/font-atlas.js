/**
 * FontAtlas — rasterizes terminal glyphs to a GPU texture atlas for WebGL2
 * instanced rendering.
 *
 * Designed for 120Hz 4K HiDPI displays with 20+ simultaneous terminals.
 * Glyphs are rendered as white-on-transparent so the fragment shader can
 * multiply by any foreground colour and sample the alpha channel for
 * sub-pixel coverage.
 *
 * @module font-atlas
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** First printable ASCII codepoint (space). */
const ASCII_START = 0x20;

/** Last printable ASCII codepoint (tilde). */
const ASCII_END = 0x7e;

/** Bold flag bit position in the flags bitmask. */
const FLAG_BOLD = 1;

/** Line-height multiplier applied to fontSize to derive cell height. */
const LINE_HEIGHT_FACTOR = 1.2;

/** Padding between glyph cells in the atlas (prevents LINEAR filter bleed). */
const GLYPH_PAD = 1;

/** Minimum atlas dimension (pixels). */
const MIN_ATLAS_SIZE = 256;

/** Maximum atlas dimension — WebGL2 guarantees at least 4096. */
const MAX_ATLAS_SIZE = 4096;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Return the smallest power-of-two >= value, clamped to [min, max].
 * @param {number} value
 * @param {number} [min]
 * @param {number} [max]
 * @returns {number}
 */
function nextPow2(value, min = MIN_ATLAS_SIZE, max = MAX_ATLAS_SIZE) {
  let p = min;
  while (p < value && p < max) p <<= 1;
  return p;
}

/**
 * Build a CSS font string.
 * @param {number} size  - font size in pixels
 * @param {string} family
 * @param {boolean} bold
 * @returns {string}
 */
/**
 * @param {number} size  - font size in pixels
 * @param {string} family
 * @param {boolean} bold
 * @param {string} [normalWeight="300"] - CSS font-weight for normal text
 * @param {string} [boldWeight="500"]   - CSS font-weight for bold text
 * @returns {string}
 */
function fontString(size, family, bold, normalWeight = "300", boldWeight = "500") {
  const weight = bold ? boldWeight : normalWeight;
  return `${weight} ${size}px ${family}`;
}

// ---------------------------------------------------------------------------
// FontAtlas
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} GlyphUV
 * @property {number} u  - normalised left   (0–1)
 * @property {number} v  - normalised top    (0–1)
 * @property {number} w  - normalised width  (0–1)
 * @property {number} h  - normalised height (0–1)
 */

/**
 * Rasterises monospace terminal glyphs into a power-of-2 texture atlas.
 *
 * Usage:
 * ```js
 * const atlas = new FontAtlas(14, '"JetBrains Mono", monospace', devicePixelRatio);
 * const glyph = atlas.getGlyph(0x41, 0);        // 'A', regular
 * const boldG = atlas.getGlyph(0x41, FLAG_BOLD); // 'A', bold
 * const tex   = atlas.uploadToGL(gl);
 * ```
 */
class FontAtlas {
  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  /**
   * @param {number} fontSize
   * @param {string} fontFamily
   * @param {number} [devicePixelRatio=1]
   * @param {{ cellWidth?: number, cellHeight?: number, baseline?: number, fontWeight?: string, fontWeightBold?: string }} [overrides]
   */
  constructor(fontSize, fontFamily, devicePixelRatio = 1, overrides = {}) {
    /** @type {number} Logical font size (CSS px). */
    this.fontSize = fontSize;

    /** @type {string} */
    this.fontFamily = fontFamily;

    /** @type {number} */
    this.dpr = devicePixelRatio;

    /** @type {number} Rasterisation size in device pixels. */
    this._renderSize = Math.round(fontSize * devicePixelRatio);

    // --- Measure the monospace cell ---
    const probe = new OffscreenCanvas(1, 1).getContext("2d");
    probe.font = fontString(this._renderSize, fontFamily, false);
    const metrics = probe.measureText("M");

    /**
     * Cell width in device pixels (one monospace column).
     * @type {number}
     */
    this.cellWidth = overrides.cellWidth || Math.ceil(metrics.width);

    /**
     * Cell height in device pixels.
     * @type {number}
     */
    this.cellHeight = overrides.cellHeight || Math.ceil(this._renderSize * LINE_HEIGHT_FACTOR);

    /**
     * Baseline offset in device pixels from the top of the cell.
     * Used to position glyphs identically to ghostty-web's renderer.
     * @type {number}
     */
    this._baseline = overrides.baseline || Math.round(this.cellHeight * 0.75);

    /** @type {string} CSS font-weight for normal text. */
    this._fontWeight = overrides.fontWeight || "300";

    /** @type {string} CSS font-weight for bold text. */
    this._fontWeightBold = overrides.fontWeightBold || "500";

    // --- Atlas bookkeeping ---

    /**
     * Map from composite key to UV rect.
     * Key = `(codepoint << 1) | boldBit` — cheap integer key.
     * @type {Map<number, GlyphUV>}
     * @private
     */
    this._glyphs = new Map();

    /**
     * Number of cell-width columns that fit in the atlas.
     * @type {number}
     * @private
     */
    this._cols = 0;

    /**
     * Number of cell-height rows that fit in the atlas.
     * @type {number}
     * @private
     */
    this._rows = 0;

    /**
     * Index of the next free slot (column-major within the grid).
     * @type {number}
     * @private
     */
    this._nextSlot = 0;

    /**
     * Number of slots consumed by pre-warmed ASCII glyphs.
     * Set by _prewarmASCII(); used by _evictNonASCII() to preserve ASCII.
     * @type {number}
     * @private
     */
    this._asciiSlotCount = 0;

    /**
     * Number of times non-ASCII eviction has fired (for log rate-limiting).
     * @type {number}
     * @private
     */
    this._evictionCount = 0;

    /**
     * Current atlas width in device pixels (always power-of-2).
     * @type {number}
     */
    this.atlasWidth = 0;

    /**
     * Current atlas height in device pixels (always power-of-2).
     * @type {number}
     */
    this.atlasHeight = 0;

    /**
     * The backing canvas for the atlas.
     * @type {OffscreenCanvas}
     */
    this.canvas = null;

    /**
     * The 2D context of the backing canvas.
     * @type {OffscreenCanvasRenderingContext2D}
     * @private
     */
    this._ctx = null;

    /**
     * True when the atlas has been modified since the last GPU upload.
     * @type {boolean}
     * @private
     */
    this._dirty = true;

    /**
     * Cached WebGL texture (created on first `uploadToGL` call).
     * @type {WebGLTexture|null}
     * @private
     */
    this._glTexture = null;

    /**
     * The GL context the cached texture belongs to.
     * @type {WebGL2RenderingContext|null}
     * @private
     */
    this._gl = null;

    // --- Initialise atlas and pre-warm ASCII ---
    this._initAtlas();
    this._prewarmASCII();
  }

  // -----------------------------------------------------------------------
  // Atlas initialisation
  // -----------------------------------------------------------------------

  /**
   * Allocate the initial atlas canvas.  We aim for a texture that can hold
   * at least the printable ASCII set (95 regular + 95 bold = 190 glyphs)
   * without immediately needing to grow.
   * @private
   */
  _initAtlas() {
    // Target ~256 slots for the initial atlas (covers ASCII regular + bold
    // with room to spare for common extended characters).
    const targetSlots = 256;

    // Pick a column count that keeps the atlas roughly square.
    this._cols = 16;
    const neededRows = Math.ceil(targetSlots / this._cols);

    const padW = this.cellWidth + GLYPH_PAD;
    const padH = this.cellHeight + GLYPH_PAD;
    const rawW = this._cols * padW;
    const rawH = neededRows * padH;

    this.atlasWidth = nextPow2(rawW);
    this.atlasHeight = nextPow2(rawH);

    // Recalculate grid dimensions to fill the power-of-2 texture.
    this._cols = Math.floor(this.atlasWidth / padW);
    this._rows = Math.floor(this.atlasHeight / padH);

    this.canvas = new OffscreenCanvas(this.atlasWidth, this.atlasHeight);
    this._ctx = this.canvas.getContext("2d", { willReadFrequently: false });
    // Fill with opaque black — subpixel (ClearType) antialiasing needs an
    // opaque background to produce per-channel coverage in R/G/B.
    this._ctx.fillStyle = "#000000";
    this._ctx.fillRect(0, 0, this.atlasWidth, this.atlasHeight);
    this._nextSlot = 0;
  }

  /**
   * Rasterise printable ASCII (0x20–0x7E) in both regular and bold weights
   * so the hot path never triggers on-demand rasterisation for common text.
   * @private
   */
  _prewarmASCII() {
    for (let bold = 0; bold <= 1; bold++) {
      const flags = bold; // bit 0 = bold
      for (let cp = ASCII_START; cp <= ASCII_END; cp++) {
        this._rasterize(cp, flags);
      }
    }
    // Record how many slots the pre-warmed ASCII glyphs consume.
    // These are never evicted.
    this._asciiSlotCount = this._nextSlot;
  }

  /**
   * Evict all non-ASCII glyphs from the atlas, freeing their slots for
   * re-use.  ASCII glyphs (pre-warmed during construction) are preserved.
   *
   * This is a generational eviction: everything beyond the ASCII region
   * is discarded at once.  Frequently-used non-ASCII glyphs will be
   * re-rasterized on the next `getGlyph` call.
   *
   * @returns {boolean} true if any glyphs were evicted.
   * @private
   */
  _evictNonASCII() {
    let evicted = 0;
    for (const [key] of this._glyphs) {
      const codepoint = key >> 1;
      if (codepoint < ASCII_START || codepoint > ASCII_END) {
        this._glyphs.delete(key);
        evicted++;
      }
    }
    if (evicted === 0) return false;

    // Reset the slot pointer to right after the ASCII region.
    this._nextSlot = this._asciiSlotCount;

    // Clear the non-ASCII area of the canvas (fill with black).
    const padW = this.cellWidth + GLYPH_PAD;
    const padH = this.cellHeight + GLYPH_PAD;
    const asciiRow = Math.ceil(this._asciiSlotCount / this._cols);
    const clearY = asciiRow * padH;
    if (clearY < this.atlasHeight) {
      this._ctx.fillStyle = "#000000";
      this._ctx.fillRect(0, clearY, this.atlasWidth, this.atlasHeight - clearY);
    }

    this._dirty = true;
    this._evictionCount = (this._evictionCount || 0) + 1;
    if (this._evictionCount <= 3) {
      console.warn(`[font-atlas] Evicted ${evicted} non-ASCII glyphs (atlas full at ${this.atlasWidth}x${this.atlasHeight})`);
    }
    return true;
  }

  // -----------------------------------------------------------------------
  // Glyph lookup
  // -----------------------------------------------------------------------

  /**
   * Compute the integer map key for a codepoint + flags pair.
   * Layout: bits [31..1] = codepoint, bit [0] = bold.
   * @param {number} codepoint
   * @param {number} flags
   * @returns {number}
   * @private
   */
  static _key(codepoint, flags) {
    return (codepoint << 1) | (flags & FLAG_BOLD);
  }

  /**
   * Look up (or rasterise on demand) a glyph and return its normalised UV
   * rectangle within the atlas texture.
   *
   * @param {number} codepoint  - Unicode codepoint
   * @param {number} [flags=0]  - bitmask: bit 0 = bold
   * @returns {GlyphUV}
   */
  getGlyph(codepoint, flags = 0) {
    const key = FontAtlas._key(codepoint, flags);
    let entry = this._glyphs.get(key);
    if (entry !== undefined) return entry;

    // Cache miss — rasterise on demand.
    entry = this._rasterize(codepoint, flags);
    if (entry !== null) return entry;

    // Fallback: return '?' glyph (always present from pre-warm).
    return this._glyphs.get(FontAtlas._key(0x3f, flags & FLAG_BOLD))
      || this._glyphs.get(FontAtlas._key(0x3f, 0));
  }

  // -----------------------------------------------------------------------
  // Rasterisation
  // -----------------------------------------------------------------------

  /**
   * Determine how many cell columns a codepoint occupies.
   * Uses a simple heuristic: CJK Unified Ideographs and several other
   * full-width ranges return 2; everything else returns 1.
   *
   * @param {number} cp
   * @returns {1|2}
   * @private
   */
  static _charWidth(cp) {
    // CJK Unified Ideographs
    if (cp >= 0x4e00 && cp <= 0x9fff) return 2;
    // CJK Extension A
    if (cp >= 0x3400 && cp <= 0x4dbf) return 2;
    // CJK Compatibility Ideographs
    if (cp >= 0xf900 && cp <= 0xfaff) return 2;
    // Hangul Syllables
    if (cp >= 0xac00 && cp <= 0xd7af) return 2;
    // Full-width Latin / Halfwidth Katakana block
    if (cp >= 0xff01 && cp <= 0xff60) return 2;
    if (cp >= 0xffe0 && cp <= 0xffe6) return 2;
    return 1;
  }

  /**
   * Rasterise a single glyph into the atlas.
   *
   * @param {number} codepoint
   * @param {number} flags
   * @returns {GlyphUV|null} The UV entry, or null if rasterisation failed.
   * @private
   */
  _rasterize(codepoint, flags) {
    const bold = (flags & FLAG_BOLD) !== 0;
    const charW = FontAtlas._charWidth(codepoint);
    const slotsNeeded = charW; // wide chars consume 2 adjacent slots

    // Ensure we have room.
    while (this._nextSlot + slotsNeeded > this._cols * this._rows) {
      if (!this._grow()) {
        // Atlas at max size — evict non-ASCII glyphs and reuse their slots.
        if (!this._evictNonASCII()) return null;
        break;
      }
    }

    const slot = this._nextSlot;
    const col = slot % this._cols;
    const row = Math.floor(slot / this._cols);

    // If a wide char would wrap past the row edge, skip to next row.
    if (col + slotsNeeded > this._cols) {
      this._nextSlot = (row + 1) * this._cols;
      return this._rasterize(codepoint, flags); // retry at row start
    }

    const padW = this.cellWidth + GLYPH_PAD;
    const padH = this.cellHeight + GLYPH_PAD;
    const x = col * padW;
    const y = row * padH;
    const drawW = this.cellWidth * charW;

    const ctx = this._ctx;
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#ffffff";

    // For non-ASCII, use symbol fonts first (Courier New has empty tofu glyphs
    // for many Unicode codepoints, preventing proper font fallback).
    if (codepoint > 0x7e) {
      ctx.font = `${this._renderSize}px "Segoe UI Symbol", "Segoe UI Emoji", "Apple Symbols", ${this.fontFamily}`;
    } else {
      ctx.font = fontString(this._renderSize, this.fontFamily, bold, this._fontWeight, this._fontWeightBold);
    }

    // Measure the actual glyph width. If it exceeds the cell, scale to fit.
    const measured = ctx.measureText(String.fromCodePoint(codepoint)).width;
    const str = String.fromCodePoint(codepoint);
    if (measured > drawW * 1.1) {
      const scale = drawW / measured;
      ctx.save();
      ctx.translate(x, y + this._baseline);
      ctx.scale(scale, 1);
      ctx.fillText(str, 0, 0);
      ctx.restore();
    } else {
      ctx.fillText(str, x, y + this._baseline);
    }

    // UV rect covers the glyph cell (not the padding)
    const uv = {
      u: x / this.atlasWidth,
      v: y / this.atlasHeight,
      w: drawW / this.atlasWidth,
      h: this.cellHeight / this.atlasHeight,
    };

    const key = FontAtlas._key(codepoint, flags);
    this._glyphs.set(key, uv);

    this._nextSlot += slotsNeeded;
    this._dirty = true;

    return uv;
  }

  // -----------------------------------------------------------------------
  // Atlas growth
  // -----------------------------------------------------------------------

  /**
   * Double the atlas size (alternating width and height) and copy the old
   * content into the new, larger canvas.
   *
   * @returns {boolean} true if growth succeeded, false if already at max.
   * @private
   */
  _grow() {
    let newW = this.atlasWidth;
    let newH = this.atlasHeight;

    // Grow whichever dimension is smaller (keeps texture roughly square).
    if (newW <= newH) {
      newW *= 2;
    } else {
      newH *= 2;
    }

    if (newW > MAX_ATLAS_SIZE && newH > MAX_ATLAS_SIZE) return false;
    newW = Math.min(newW, MAX_ATLAS_SIZE);
    newH = Math.min(newH, MAX_ATLAS_SIZE);

    const oldCanvas = this.canvas;
    const newCanvas = new OffscreenCanvas(newW, newH);
    const newCtx = newCanvas.getContext("2d", { willReadFrequently: false });

    // Fill with black for subpixel rendering, then copy old content.
    newCtx.fillStyle = "#000000";
    newCtx.fillRect(0, 0, newW, newH);
    newCtx.drawImage(oldCanvas, 0, 0);

    this.canvas = newCanvas;
    this._ctx = newCtx;

    this.atlasWidth = newW;
    this.atlasHeight = newH;

    // Recalculate grid dimensions (using padded cell size).
    const padW = this.cellWidth + GLYPH_PAD;
    const padH = this.cellHeight + GLYPH_PAD;
    this._cols = Math.floor(newW / padW);
    this._rows = Math.floor(newH / padH);

    // Re-normalise every existing glyph's UVs to the new texture size.
    for (const [key, glyph] of this._glyphs) {
      // Recover pixel coords from old normalised values.
      const px = glyph.u * oldCanvas.width;
      const py = glyph.v * oldCanvas.height;
      const pw = glyph.w * oldCanvas.width;
      const ph = glyph.h * oldCanvas.height;

      glyph.u = px / newW;
      glyph.v = py / newH;
      glyph.w = pw / newW;
      glyph.h = ph / newH;
    }

    this._dirty = true;
    return true;
  }

  // -----------------------------------------------------------------------
  // GPU upload
  // -----------------------------------------------------------------------

  /**
   * Create or update a WebGL2 `TEXTURE_2D` from the atlas canvas.
   *
   * The texture is cached and only re-uploaded when the atlas has changed
   * since the last call.  If the GL context changes (e.g. after a context
   * loss/restore), a new texture is created automatically.
   *
   * Texture format: `RGBA` / `UNSIGNED_BYTE`, `LINEAR` filtering,
   * `CLAMP_TO_EDGE` wrapping.
   *
   * @param {WebGL2RenderingContext} gl
   * @returns {WebGLTexture}
   */
  uploadToGL(gl) {
    // Detect context change — create a fresh texture.
    if (this._gl !== gl || this._glTexture === null) {
      this._glTexture = gl.createTexture();
      this._gl = gl;
      this._dirty = true; // force full upload
    }

    if (!this._dirty) return this._glTexture;

    gl.bindTexture(gl.TEXTURE_2D, this._glTexture);

    gl.texImage2D(
      gl.TEXTURE_2D,
      0,            // mip level
      gl.RGBA,      // internal format
      gl.RGBA,      // source format
      gl.UNSIGNED_BYTE,
      this.canvas,
    );

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this._dirty = false;

    return this._glTexture;
  }

  // -----------------------------------------------------------------------
  // Canvas access
  // -----------------------------------------------------------------------

  /**
   * Return the atlas backing canvas for use with `gl.texImage2D()`.
   * @returns {OffscreenCanvas}
   */
  getCanvasSource() {
    return this.canvas;
  }

  // -----------------------------------------------------------------------
  // Cleanup
  // -----------------------------------------------------------------------

  /**
   * Release GPU resources.  Call when the atlas is no longer needed.
   */
  destroy() {
    if (this._gl && this._glTexture) {
      this._gl.deleteTexture(this._glTexture);
    }
    this._glTexture = null;
    this._gl = null;
    this._glyphs.clear();
    this.canvas = null;
    this._ctx = null;
  }
}

export default FontAtlas;
