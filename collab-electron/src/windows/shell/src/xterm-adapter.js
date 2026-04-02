/**
 * XtermAdapter — reads xterm.js buffer API and packs terminal cell data
 * directly into Float32Array buffers with zero per-frame heap allocation.
 *
 * Designed for the GPU terminal renderer pipeline (120Hz 4K, 20+ terminals).
 *
 * @module xterm-adapter
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Number of floats per background instance: col, row, width, r, g, b, a */
const BG_FLOATS = 7;

/** Number of floats per foreground (glyph) instance: col, row, u, v, uw, uh, r, g, b */
const FG_FLOATS = 9;

/** Flag bit: foreground uses default colour. */
const FLAG_FG_DEFAULT = 0x20;

/** Flag bit: background uses default colour. */
const FLAG_BG_DEFAULT = 0x40;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse a CSS hex colour string to RGB floats (0–1).
 * Accepts "#RGB", "#RRGGBB", or "#RRGGBBAA".
 * Writes into the provided output array at the given offset.
 *
 * @param {string} hex
 * @param {number[]|Float32Array} out
 * @param {number} offset
 */
function hexToRgb(hex, out, offset) {
  if (!hex || hex.charAt(0) !== '#') {
    out[offset] = 0;
    out[offset + 1] = 0;
    out[offset + 2] = 0;
    return;
  }
  let r, g, b;
  if (hex.length === 4) {
    // #RGB
    r = parseInt(hex.charAt(1) + hex.charAt(1), 16);
    g = parseInt(hex.charAt(2) + hex.charAt(2), 16);
    b = parseInt(hex.charAt(3) + hex.charAt(3), 16);
  } else {
    r = parseInt(hex.substring(1, 3), 16);
    g = parseInt(hex.substring(3, 5), 16);
    b = parseInt(hex.substring(5, 7), 16);
  }
  out[offset] = r / 255;
  out[offset + 1] = g / 255;
  out[offset + 2] = b / 255;
}

// ---------------------------------------------------------------------------
// Standard ANSI colour names used in xterm.js theme objects
// ---------------------------------------------------------------------------

/** @type {string[]} Theme property names for ANSI colours 0–7. */
const ANSI_NORMAL = [
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
];

/** @type {string[]} Theme property names for bright ANSI colours 8–15. */
const ANSI_BRIGHT = [
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow',
  'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite',
];

/** @type {string[]} Default hex values for ANSI colours 0–7. */
const ANSI_NORMAL_DEFAULTS = [
  '#000000', '#cc0000', '#4e9a06', '#c4a000',
  '#3465a4', '#75507b', '#06989a', '#d3d7cf',
];

/** @type {string[]} Default hex values for bright ANSI colours 8–15. */
const ANSI_BRIGHT_DEFAULTS = [
  '#555753', '#ef2929', '#8ae234', '#fce94f',
  '#729fcf', '#ad7fa8', '#34e2e2', '#eeeeec',
];

// ---------------------------------------------------------------------------
// XtermAdapter
// ---------------------------------------------------------------------------

export class XtermAdapter {
  /**
   * @param {import('xterm').Terminal} term  - xterm.js Terminal instance
   * @param {import('./font-atlas.js').default} fontAtlas - FontAtlas instance
   */
  constructor(term, fontAtlas) {
    /** @type {import('xterm').Terminal} */
    this._term = term;

    /** @type {import('./font-atlas.js').default} */
    this._atlas = fontAtlas;

    /**
     * Reusable cell object — xterm's two-arg getCell(col, cell) fills this
     * in-place, avoiding per-cell allocation on the hot path.
     * @type {import('xterm').IBufferCell|null}
     * @private
     */
    this._reusableCell = null;
    const firstLine = term.buffer.active.getLine(0);
    if (firstLine) {
      this._reusableCell = firstLine.getCell(0);
    }

    /**
     * Per-row dirty flags. 1 = row needs repacking.
     * @type {Uint8Array}
     * @private
     */
    this._dirtyRows = new Uint8Array(term.rows);

    /**
     * When true, all rows are considered dirty (e.g. after resize or init).
     * @type {boolean}
     * @private
     */
    this._fullDirty = true;

    /**
     * 256-entry RGB float palette. Layout: [R0, G0, B0, R1, G1, B1, ...].
     * @type {Float32Array}
     * @private
     */
    this._palette = new Float32Array(256 * 3);
    this._buildPalette(term.options.theme);

    /**
     * Disposable for the onRender subscription.
     * @type {{ dispose(): void }|null}
     * @private
     */
    this._onRenderDisposable = term.onRender(({ start, end }) => {
      for (let r = start; r <= end; r++) {
        if (r < this._dirtyRows.length) {
          this._dirtyRows[r] = 1;
        }
      }
    });
  }

  // -------------------------------------------------------------------------
  // Palette
  // -------------------------------------------------------------------------

  /**
   * Build the 256-entry RGB float palette from an xterm.js theme.
   *
   * - 0–7:     standard ANSI from theme
   * - 8–15:    bright ANSI from theme
   * - 16–231:  6x6x6 colour cube
   * - 232–255: grayscale ramp
   *
   * @param {Record<string, string>} [theme]
   * @private
   */
  _buildPalette(theme) {
    const pal = this._palette;

    // Entries 0–7: standard ANSI
    for (let i = 0; i < 8; i++) {
      const hex = (theme && theme[ANSI_NORMAL[i]]) || ANSI_NORMAL_DEFAULTS[i];
      hexToRgb(hex, pal, i * 3);
    }

    // Entries 8–15: bright ANSI
    for (let i = 0; i < 8; i++) {
      const hex = (theme && theme[ANSI_BRIGHT[i]]) || ANSI_BRIGHT_DEFAULTS[i];
      hexToRgb(hex, pal, (8 + i) * 3);
    }

    // Entries 16–231: 6x6x6 colour cube
    for (let i = 16; i <= 231; i++) {
      const n = i - 16;
      const r5 = Math.floor(n / 36);
      const g5 = Math.floor((n % 36) / 6);
      const b5 = n % 6;
      const off = i * 3;
      pal[off] = r5 === 0 ? 0 : (55 + r5 * 40) / 255;
      pal[off + 1] = g5 === 0 ? 0 : (55 + g5 * 40) / 255;
      pal[off + 2] = b5 === 0 ? 0 : (55 + b5 * 40) / 255;
    }

    // Entries 232–255: grayscale ramp
    for (let i = 232; i <= 255; i++) {
      const v = (8 + (i - 232) * 10) / 255;
      const off = i * 3;
      pal[off] = v;
      pal[off + 1] = v;
      pal[off + 2] = v;
    }
  }

  // -------------------------------------------------------------------------
  // Hot path: pack a single row
  // -------------------------------------------------------------------------

  /**
   * Pack one terminal row into pre-allocated Float32Array buffers.
   *
   * CRITICAL: This is the hot path — no heap allocation inside the loop.
   * All data is written via indexed Float32Array access only.
   *
   * @param {number} row            - viewport row index (0-based)
   * @param {Float32Array} bgData   - output buffer for BG instances
   * @param {number} bgOffset       - float offset into bgData to start writing
   * @param {Float32Array} fgData   - output buffer for FG instances
   * @param {number} fgOffset       - float offset into fgData to start writing
   * @param {number[]|Float32Array} defaultBg - [r, g, b] default background
   * @param {number[]|Float32Array} defaultFg - [r, g, b] default foreground
   * @returns {{ bgCount: number, fgCount: number }}
   */
  packRow(row, bgData, bgOffset, fgData, fgOffset, defaultBg, defaultFg) {
    const buf = this._term.buffer.active;
    const line = buf.getLine(buf.viewportY + row);
    if (!line) return { bgCount: 0, fgCount: 0 };

    const cell = this._reusableCell;
    const cols = line.length;
    const pal = this._palette;
    const atlas = this._atlas;

    let bgIdx = bgOffset;
    let fgIdx = fgOffset;
    let bgCount = 0;
    let fgCount = 0;

    let bgR, bgG, bgB;
    let fgR, fgG, fgB;
    let rgb, palOff, cp, glyph, cellW;

    for (let x = 0; x < cols; x++) {
      line.getCell(x, cell);

      // --- Resolve foreground colour ---
      if (cell.isFgDefault()) {
        fgR = defaultFg[0];
        fgG = defaultFg[1];
        fgB = defaultFg[2];
      } else if (cell.isFgPalette()) {
        palOff = cell.getFgColor() * 3;
        fgR = pal[palOff];
        fgG = pal[palOff + 1];
        fgB = pal[palOff + 2];
      } else {
        rgb = cell.getFgColor();
        fgR = ((rgb >> 16) & 0xFF) / 255;
        fgG = ((rgb >> 8) & 0xFF) / 255;
        fgB = (rgb & 0xFF) / 255;
      }

      // --- Resolve background colour ---
      if (cell.isBgDefault()) {
        bgR = defaultBg[0];
        bgG = defaultBg[1];
        bgB = defaultBg[2];
      } else if (cell.isBgPalette()) {
        palOff = cell.getBgColor() * 3;
        bgR = pal[palOff];
        bgG = pal[palOff + 1];
        bgB = pal[palOff + 2];
      } else {
        rgb = cell.getBgColor();
        bgR = ((rgb >> 16) & 0xFF) / 255;
        bgG = ((rgb >> 8) & 0xFF) / 255;
        bgB = (rgb & 0xFF) / 255;
      }

      // --- Pack BG instance (7 floats) ---
      cellW = cell.getWidth() || 1;
      bgData[bgIdx] = x;           // col
      bgData[bgIdx + 1] = row;     // row
      bgData[bgIdx + 2] = cellW;   // width
      bgData[bgIdx + 3] = bgR;
      bgData[bgIdx + 4] = bgG;
      bgData[bgIdx + 5] = bgB;
      bgData[bgIdx + 6] = 1.0;     // alpha
      bgIdx += BG_FLOATS;
      bgCount++;

      // --- Pack FG instance (9 floats) — only for visible glyphs ---
      if (cell.getChars().length > 0) {
        cp = cell.getChars().codePointAt(0);
        if (cp > 0x20) {
          glyph = atlas.getGlyph(cp, cell.isBold() ? 1 : 0);
          if (glyph) {
            fgData[fgIdx] = x;           // col
            fgData[fgIdx + 1] = row;     // row
            fgData[fgIdx + 2] = glyph.u;
            fgData[fgIdx + 3] = glyph.v;
            fgData[fgIdx + 4] = glyph.w;
            fgData[fgIdx + 5] = glyph.h;
            fgData[fgIdx + 6] = fgR;
            fgData[fgIdx + 7] = fgG;
            fgData[fgIdx + 8] = fgB;
            fgIdx += FG_FLOATS;
            fgCount++;
          }
        }
      }
    }

    return { bgCount, fgCount };
  }

  // -------------------------------------------------------------------------
  // Convenience: pack all dirty rows
  // -------------------------------------------------------------------------

  /**
   * Pack all dirty rows into a draw state.
   * TODO(step-05): flesh out with TerminalDrawState integration, GL buffer
   * uploads via bufferData/bufferSubData, and partial-update optimisation.
   *
   * @param {object} drawState - TerminalDrawState (shape TBD in step 05)
   */
  packInto(drawState) {
    // Placeholder — will be implemented in step 05.
    void drawState;
  }

  // -------------------------------------------------------------------------
  // Dirty tracking
  // -------------------------------------------------------------------------

  /** Clear all dirty flags after a frame has been packed and uploaded. */
  clearDirty() {
    this._dirtyRows.fill(0);
    this._fullDirty = false;
  }

  /**
   * Handle terminal resize — reallocate dirty tracking.
   * @param {number} newRows
   */
  resize(newRows) {
    this._dirtyRows = new Uint8Array(newRows);
    this._fullDirty = true;
  }

  // -------------------------------------------------------------------------
  // Font metric extraction
  // -------------------------------------------------------------------------

  /**
   * Measure a terminal's cell dimensions by probing the DOM after the
   * terminal has been opened. Returns metrics suitable for passing as
   * FontAtlas constructor overrides.
   *
   * @param {import('xterm').Terminal} term - an opened Terminal instance
   * @returns {{ cellWidth: number, cellHeight: number }}
   */
  static extractCellMetrics(term) {
    const testSpan = document.createElement('span');
    testSpan.style.font = `${term.options.fontSize}px ${term.options.fontFamily}`;
    testSpan.style.position = 'absolute';
    testSpan.style.visibility = 'hidden';
    testSpan.textContent = 'M';
    document.body.appendChild(testSpan);
    const rect = testSpan.getBoundingClientRect();
    document.body.removeChild(testSpan);
    return { cellWidth: rect.width, cellHeight: rect.height };
  }

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  /** Dispose subscriptions and release references. */
  dispose() {
    if (this._onRenderDisposable) {
      this._onRenderDisposable.dispose();
      this._onRenderDisposable = null;
    }
    this._term = null;
    this._atlas = null;
    this._reusableCell = null;
    this._dirtyRows = null;
    this._palette = null;
  }
}

export { BG_FLOATS, FG_FLOATS, FLAG_FG_DEFAULT, FLAG_BG_DEFAULT };
export default XtermAdapter;
