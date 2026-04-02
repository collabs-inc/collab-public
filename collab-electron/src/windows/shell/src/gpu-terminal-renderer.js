/**
 * WebGL2 Instanced Terminal Renderer
 *
 * Drop-in replacement for ghostty-web's Canvas2D CanvasRenderer.
 * Uses instanced quads with 3-pass rendering (backgrounds, glyphs, cursor)
 * for sub-millisecond frame times at any grid size.
 *
 * Usage:
 *   const renderer = new WebGL2TerminalRenderer(canvas, options);
 *   terminal.renderer = renderer;
 *
 * @module gpu-terminal-renderer
 */

import FontAtlas from "./font-atlas.js";

// ---------------------------------------------------------------------------
// FontAtlas expected interface:
//   new FontAtlas(fontSize, fontFamily, dpr)
//   .cellWidth:  number   — pixel width of one cell (at native DPR)
//   .cellHeight: number   — pixel height of one cell (at native DPR)
//   .getGlyph(codepoint): { u, v, w, h } | null — normalized UV rect
//   .getCanvasSource():   OffscreenCanvas | HTMLCanvasElement — atlas image
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Number of floats per background instance: col, row, width, r, g, b */
const BG_FLOATS_PER_INSTANCE = 6;

/** Number of floats per foreground (glyph) instance: col, row, u, v, uw, uh, r, g, b */
const FG_FLOATS_PER_INSTANCE = 9;

/** Number of floats per selection instance: col, row, width, r, g, b, a */
const SEL_FLOATS_PER_INSTANCE = 7;

/** Number of floats per cursor instance: col, row, width, height, r, g, b, a */
const CURSOR_FLOATS_PER_INSTANCE = 8;

/** Cell flag bitmasks from GhosttyCell.flags */
const CellFlags = {
	BOLD:          1,
	ITALIC:        2,
	UNDERLINE:     4,
	STRIKETHROUGH: 8,
	INVERSE:       16,
};

/** Default-color flag bits (set by XtermAdapter when cell uses theme default) */
const FLAG_FG_DEFAULT = 0x20;
const FLAG_BG_DEFAULT = 0x40;

/** Default blink interval in ms */
const BLINK_INTERVAL_MS = 530;

// ---------------------------------------------------------------------------
// Shader sources
// ---------------------------------------------------------------------------

const BG_VERTEX_SRC = `#version 300 es
// Unit quad (triangle strip)
const vec2 quad[4] = vec2[4](
	vec2(0.0, 0.0), vec2(1.0, 0.0),
	vec2(0.0, 1.0), vec2(1.0, 1.0)
);

// Per-instance data
layout(location = 0) in float aCol;
layout(location = 1) in float aRow;
layout(location = 2) in float aWidth;   // cell-width (1 or 2 for wide chars)
layout(location = 3) in float aR;
layout(location = 4) in float aG;
layout(location = 5) in float aB;

uniform vec2 uCellSize;   // cell size in normalized [0,1] coords
uniform vec2 uGridOrigin;

flat out vec3 vColor;

void main() {
	vec2 pos = quad[gl_VertexID];
	vec2 size = vec2(uCellSize.x * aWidth, uCellSize.y);
	vec2 cellPos = uGridOrigin + vec2(aCol * uCellSize.x, aRow * uCellSize.y);
	vec2 screenPos = cellPos + pos * size;
	gl_Position = vec4(screenPos * 2.0 - 1.0, 0.0, 1.0);
	gl_Position.y = -gl_Position.y;
	vColor = vec3(aR, aG, aB);
}
`;

const BG_FRAGMENT_SRC = `#version 300 es
precision mediump float;
flat in vec3 vColor;
out vec4 fragColor;
void main() {
	fragColor = vec4(vColor, 1.0);
}
`;

const SEL_VERTEX_SRC = `#version 300 es
const vec2 quad[4] = vec2[4](
	vec2(0.0, 0.0), vec2(1.0, 0.0),
	vec2(0.0, 1.0), vec2(1.0, 1.0)
);

layout(location = 0) in float aCol;
layout(location = 1) in float aRow;
layout(location = 2) in float aWidth;
layout(location = 3) in float aR;
layout(location = 4) in float aG;
layout(location = 5) in float aB;
layout(location = 6) in float aA;

uniform vec2 uCellSize;
uniform vec2 uGridOrigin;

flat out vec4 vColor;

void main() {
	vec2 pos = quad[gl_VertexID];
	vec2 size = vec2(uCellSize.x * aWidth, uCellSize.y);
	vec2 cellPos = uGridOrigin + vec2(aCol * uCellSize.x, aRow * uCellSize.y);
	vec2 screenPos = cellPos + pos * size;
	gl_Position = vec4(screenPos * 2.0 - 1.0, 0.0, 1.0);
	gl_Position.y = -gl_Position.y;
	vColor = vec4(aR, aG, aB, aA);
}
`;

const SEL_FRAGMENT_SRC = `#version 300 es
precision mediump float;
flat in vec4 vColor;
out vec4 fragColor;
void main() {
	fragColor = vColor;
}
`;

const FG_VERTEX_SRC = `#version 300 es
const vec2 quad[4] = vec2[4](
	vec2(0.0, 0.0), vec2(1.0, 0.0),
	vec2(0.0, 1.0), vec2(1.0, 1.0)
);

// Per-instance: col, row, u, v, uw, uh, r, g, b
layout(location = 0) in float aCol;
layout(location = 1) in float aRow;
layout(location = 2) in float aU;
layout(location = 3) in float aV;
layout(location = 4) in float aUW;
layout(location = 5) in float aUH;
layout(location = 6) in float aR;
layout(location = 7) in float aG;
layout(location = 8) in float aB;

uniform vec2 uCellSize;
uniform vec2 uGridOrigin;

out vec2 vTexCoord;
flat out vec3 vColor;

void main() {
	vec2 pos = quad[gl_VertexID];
	vec2 cellPos = uGridOrigin + vec2(aCol * uCellSize.x, aRow * uCellSize.y);
	vec2 screenPos = cellPos + pos * uCellSize;
	gl_Position = vec4(screenPos * 2.0 - 1.0, 0.0, 1.0);
	gl_Position.y = -gl_Position.y;
	vTexCoord = vec2(aU, aV) + pos * vec2(aUW, aUH);
	vColor = vec3(aR, aG, aB);
}
`;

const FG_FRAGMENT_SRC = `#version 300 es
precision mediump float;
uniform sampler2D uAtlas;
in vec2 vTexCoord;
flat in vec3 vColor;
out vec4 fragColor;
void main() {
	// Subpixel rendering: atlas has white-on-black text with per-channel
	// coverage from ClearType. Use each RGB channel as subpixel alpha.
	vec3 coverage = texture(uAtlas, vTexCoord).rgb;
	float maxCoverage = max(max(coverage.r, coverage.g), coverage.b);
	if (maxCoverage < 0.02) discard;
	// Blend foreground color with per-subpixel coverage
	fragColor = vec4(vColor * coverage, maxCoverage);
}
`;

const CURSOR_VERTEX_SRC = `#version 300 es
const vec2 quad[4] = vec2[4](
	vec2(0.0, 0.0), vec2(1.0, 0.0),
	vec2(0.0, 1.0), vec2(1.0, 1.0)
);

layout(location = 0) in float aCol;
layout(location = 1) in float aRow;
layout(location = 2) in float aWidth;
layout(location = 3) in float aHeight;
layout(location = 4) in float aR;
layout(location = 5) in float aG;
layout(location = 6) in float aB;
layout(location = 7) in float aA;

uniform vec2 uCellSize;
uniform vec2 uGridOrigin;

flat out vec4 vColor;

void main() {
	vec2 pos = quad[gl_VertexID];
	vec2 size = vec2(uCellSize.x * aWidth, uCellSize.y * aHeight);
	vec2 cellPos = uGridOrigin + vec2(aCol * uCellSize.x, aRow * uCellSize.y);
	// For underline/bar, offset to bottom/left of cell
	vec2 screenPos = cellPos + pos * size;
	gl_Position = vec4(screenPos * 2.0 - 1.0, 0.0, 1.0);
	gl_Position.y = -gl_Position.y;
	vColor = vec4(aR, aG, aB, aA);
}
`;

const CURSOR_FRAGMENT_SRC = `#version 300 es
precision mediump float;
flat in vec4 vColor;
out vec4 fragColor;
void main() {
	fragColor = vColor;
}
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse a CSS hex color string to normalized RGB floats.
 * Accepts "#rgb", "#rrggbb", "#rrggbbaa".
 * @param {string} hex
 * @returns {{ r: number, g: number, b: number }}
 */
function hexToRgb(hex) {
	if (!hex || hex[0] !== "#") return { r: 0, g: 0, b: 0 };
	let r = 0, g = 0, b = 0;
	if (hex.length === 4) {
		r = parseInt(hex[1] + hex[1], 16) / 255;
		g = parseInt(hex[2] + hex[2], 16) / 255;
		b = parseInt(hex[3] + hex[3], 16) / 255;
	} else if (hex.length >= 7) {
		r = parseInt(hex.slice(1, 3), 16) / 255;
		g = parseInt(hex.slice(3, 5), 16) / 255;
		b = parseInt(hex.slice(5, 7), 16) / 255;
	}
	return { r, g, b };
}

/**
 * Compile a WebGL2 shader, throwing on failure.
 * @param {WebGL2RenderingContext} gl
 * @param {number} type - gl.VERTEX_SHADER or gl.FRAGMENT_SHADER
 * @param {string} source
 * @returns {WebGLShader}
 */
function compileShader(gl, type, source) {
	const shader = gl.createShader(type);
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		const info = gl.getShaderInfoLog(shader);
		gl.deleteShader(shader);
		throw new Error(`Shader compile error: ${info}`);
	}
	return shader;
}

/**
 * Link a WebGL2 program from compiled vertex and fragment shaders.
 * @param {WebGL2RenderingContext} gl
 * @param {WebGLShader} vs
 * @param {WebGLShader} fs
 * @returns {WebGLProgram}
 */
function linkProgram(gl, vs, fs) {
	const program = gl.createProgram();
	gl.attachShader(program, vs);
	gl.attachShader(program, fs);
	gl.linkProgram(program);
	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		const info = gl.getProgramInfoLog(program);
		gl.deleteProgram(program);
		throw new Error(`Program link error: ${info}`);
	}
	return program;
}

/**
 * Create a shader program from source strings.
 * @param {WebGL2RenderingContext} gl
 * @param {string} vsSrc
 * @param {string} fsSrc
 * @returns {WebGLProgram}
 */
function createProgram(gl, vsSrc, fsSrc) {
	const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc);
	const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
	return linkProgram(gl, vs, fs);
}

/**
 * Configure a VAO for instanced rendering with N float attributes per instance.
 * Each attribute is a single float at its own location.
 * @param {WebGL2RenderingContext} gl
 * @param {WebGLVertexArrayObject} vao
 * @param {WebGLBuffer} buffer
 * @param {number} floatsPerInstance
 */
function _setupInstanceVAO(gl, vao, buffer, floatsPerInstance) {
	gl.bindVertexArray(vao);
	gl.bindBuffer(gl.ARRAY_BUFFER, buffer);

	const stride = floatsPerInstance * 4;
	for (let i = 0; i < floatsPerInstance; i++) {
		gl.enableVertexAttribArray(i);
		gl.vertexAttribPointer(i, 1, gl.FLOAT, false, stride, i * 4);
		gl.vertexAttribDivisor(i, 1);
	}

	gl.bindVertexArray(null);
}

// ---------------------------------------------------------------------------
// SharedGPUResources
// ---------------------------------------------------------------------------

/**
 * Holds compiled shader programs, cached uniform locations, and the shared
 * font atlas texture. One instance can drive multiple TerminalDrawState
 * objects via drawTerminal().
 *
 * @param {WebGL2RenderingContext} gl - externally owned GL context
 */
export class SharedGPUResources {
	/**
	 * @param {WebGL2RenderingContext} gl
	 */
	constructor(gl) {
		/** @type {WebGL2RenderingContext} */
		this._gl = gl;

		// -- Background pass --
		this._bgProgram = createProgram(gl, BG_VERTEX_SRC, BG_FRAGMENT_SRC);
		this._bgUCellSize = gl.getUniformLocation(this._bgProgram, "uCellSize");
		this._bgUGridOrigin = gl.getUniformLocation(this._bgProgram, "uGridOrigin");

		// -- Selection pass --
		this._selProgram = createProgram(gl, SEL_VERTEX_SRC, SEL_FRAGMENT_SRC);
		this._selUCellSize = gl.getUniformLocation(this._selProgram, "uCellSize");
		this._selUGridOrigin = gl.getUniformLocation(this._selProgram, "uGridOrigin");

		// -- Foreground (glyph) pass --
		this._fgProgram = createProgram(gl, FG_VERTEX_SRC, FG_FRAGMENT_SRC);
		this._fgUCellSize = gl.getUniformLocation(this._fgProgram, "uCellSize");
		this._fgUGridOrigin = gl.getUniformLocation(this._fgProgram, "uGridOrigin");
		this._fgUAtlas = gl.getUniformLocation(this._fgProgram, "uAtlas");

		// -- Cursor pass --
		this._cursorProgram = createProgram(gl, CURSOR_VERTEX_SRC, CURSOR_FRAGMENT_SRC);
		this._cursorUCellSize = gl.getUniformLocation(this._cursorProgram, "uCellSize");
		this._cursorUGridOrigin = gl.getUniformLocation(this._cursorProgram, "uGridOrigin");

		// Atlas texture
		this._atlasTexture = gl.createTexture();
	}

	/**
	 * Upload the font atlas canvas data to the GPU texture.
	 * @param {FontAtlas} fontAtlas
	 */
	uploadAtlas(fontAtlas) {
		const gl = this._gl;
		gl.bindTexture(gl.TEXTURE_2D, this._atlasTexture);
		gl.texImage2D(
			gl.TEXTURE_2D, 0, gl.RGBA,
			gl.RGBA, gl.UNSIGNED_BYTE,
			fontAtlas.getCanvasSource(),
		);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	}

	/**
	 * Perform the 4-pass instanced draw for a single terminal.
	 *
	 * Does NOT bind/unbind FBOs — that is the caller's responsibility.
	 *
	 * @param {TerminalDrawState} drawState
	 * @param {{ bgColor: { r: number, g: number, b: number }, cols: number, rows: number, drawCursor: boolean }} options
	 */
	drawTerminal(drawState, options) {
		const gl = this._gl;
		const { bgColor, cols, rows, drawCursor } = options;

		const cellSizeX = 1.0 / cols;
		const cellSizeY = 1.0 / rows;

		gl.clearColor(bgColor.r, bgColor.g, bgColor.b, 1.0);
		gl.clear(gl.COLOR_BUFFER_BIT);

		// Pass 1: Backgrounds
		if (drawState.bgCount > 0) {
			gl.useProgram(this._bgProgram);
			gl.uniform2f(this._bgUCellSize, cellSizeX, cellSizeY);
			gl.uniform2f(this._bgUGridOrigin, 0, 0);
			gl.bindVertexArray(drawState.bgVAO);
			gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, drawState.bgCount);
		}

		// Pass 2: Selection overlay
		if (drawState.selCount > 0) {
			gl.enable(gl.BLEND);
			gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
			gl.useProgram(this._selProgram);
			gl.uniform2f(this._selUCellSize, cellSizeX, cellSizeY);
			gl.uniform2f(this._selUGridOrigin, 0, 0);
			gl.bindVertexArray(drawState.selVAO);
			gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, drawState.selCount);
			gl.disable(gl.BLEND);
		}

		// Pass 3: Glyphs
		if (drawState.fgCount > 0) {
			gl.enable(gl.BLEND);
			gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
			gl.useProgram(this._fgProgram);
			gl.uniform2f(this._fgUCellSize, cellSizeX, cellSizeY);
			gl.uniform2f(this._fgUGridOrigin, 0, 0);
			gl.activeTexture(gl.TEXTURE0);
			gl.bindTexture(gl.TEXTURE_2D, this._atlasTexture);
			gl.uniform1i(this._fgUAtlas, 0);
			gl.bindVertexArray(drawState.fgVAO);
			gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, drawState.fgCount);
			gl.disable(gl.BLEND);
		}

		// Pass 4: Cursor
		if (drawCursor) {
			gl.enable(gl.BLEND);
			gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
			gl.useProgram(this._cursorProgram);
			gl.uniform2f(this._cursorUCellSize, cellSizeX, cellSizeY);
			gl.uniform2f(this._cursorUGridOrigin, 0, 0);
			gl.bindVertexArray(drawState.cursorVAO);
			gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, 1);
			gl.disable(gl.BLEND);
		}

		gl.bindVertexArray(null);
	}

	/**
	 * Release all GPU resources owned by this instance.
	 */
	dispose() {
		const gl = this._gl;

		gl.deleteProgram(this._bgProgram);
		gl.deleteProgram(this._selProgram);
		gl.deleteProgram(this._fgProgram);
		gl.deleteProgram(this._cursorProgram);

		gl.deleteTexture(this._atlasTexture);
	}
}

// ---------------------------------------------------------------------------
// TerminalDrawState
// ---------------------------------------------------------------------------

/**
 * Per-terminal instance data: VAOs, instance buffers, and Float32Array
 * backing stores for the 4 rendering passes.
 *
 * @param {WebGL2RenderingContext} gl - externally owned GL context
 * @param {number} cols - initial grid columns
 * @param {number} rows - initial grid rows
 */
export class TerminalDrawState {
	/**
	 * @param {WebGL2RenderingContext} gl
	 * @param {number} cols
	 * @param {number} rows
	 */
	constructor(gl, cols, rows) {
		/** @type {WebGL2RenderingContext} */
		this._gl = gl;

		// Create VAOs and buffers for each pass
		/** @type {WebGLVertexArrayObject} */
		this.bgVAO = gl.createVertexArray();
		/** @type {WebGLBuffer} */
		this.bgInstanceBuf = gl.createBuffer();
		_setupInstanceVAO(gl, this.bgVAO, this.bgInstanceBuf, BG_FLOATS_PER_INSTANCE);

		/** @type {WebGLVertexArrayObject} */
		this.selVAO = gl.createVertexArray();
		/** @type {WebGLBuffer} */
		this.selInstanceBuf = gl.createBuffer();
		_setupInstanceVAO(gl, this.selVAO, this.selInstanceBuf, SEL_FLOATS_PER_INSTANCE);

		/** @type {WebGLVertexArrayObject} */
		this.fgVAO = gl.createVertexArray();
		/** @type {WebGLBuffer} */
		this.fgInstanceBuf = gl.createBuffer();
		_setupInstanceVAO(gl, this.fgVAO, this.fgInstanceBuf, FG_FLOATS_PER_INSTANCE);

		/** @type {WebGLVertexArrayObject} */
		this.cursorVAO = gl.createVertexArray();
		/** @type {WebGLBuffer} */
		this.cursorInstanceBuf = gl.createBuffer();
		_setupInstanceVAO(gl, this.cursorVAO, this.cursorInstanceBuf, CURSOR_FLOATS_PER_INSTANCE);

		// Allocate typed arrays
		this.bgData = null;
		this.fgData = null;
		this.selData = null;
		this.cursorData = null;
		this.rowBgOffsets = null;
		this.rowFgOffsets = null;
		this.bgCount = 0;
		this.fgCount = 0;
		this.selCount = 0;
		this.needsFullPack = true;

		this._allocateArrays(cols, rows);
	}

	/**
	 * Allocate (or reallocate) typed arrays for the given grid dimensions.
	 * @param {number} cols
	 * @param {number} rows
	 */
	_allocateArrays(cols, rows) {
		const totalCells = cols * rows;

		this.bgData = new Float32Array(totalCells * BG_FLOATS_PER_INSTANCE);
		this.selData = new Float32Array(totalCells * SEL_FLOATS_PER_INSTANCE);
		this.fgData = new Float32Array(totalCells * FG_FLOATS_PER_INSTANCE);
		this.cursorData = new Float32Array(CURSOR_FLOATS_PER_INSTANCE);

		this.rowBgOffsets = new Uint32Array(rows);
		this.rowFgOffsets = new Uint32Array(rows);

		this.bgCount = 0;
		this.fgCount = 0;
		this.selCount = 0;

		this.needsFullPack = true;
	}

	/**
	 * Resize to new grid dimensions — reallocates buffers and VAOs.
	 * @param {number} cols
	 * @param {number} rows
	 */
	resize(cols, rows) {
		const gl = this._gl;

		// Delete old VAOs and buffers, create fresh ones
		gl.deleteVertexArray(this.bgVAO);
		gl.deleteVertexArray(this.selVAO);
		gl.deleteVertexArray(this.fgVAO);
		gl.deleteVertexArray(this.cursorVAO);
		gl.deleteBuffer(this.bgInstanceBuf);
		gl.deleteBuffer(this.selInstanceBuf);
		gl.deleteBuffer(this.fgInstanceBuf);
		gl.deleteBuffer(this.cursorInstanceBuf);

		this.bgVAO = gl.createVertexArray();
		this.bgInstanceBuf = gl.createBuffer();
		_setupInstanceVAO(gl, this.bgVAO, this.bgInstanceBuf, BG_FLOATS_PER_INSTANCE);

		this.selVAO = gl.createVertexArray();
		this.selInstanceBuf = gl.createBuffer();
		_setupInstanceVAO(gl, this.selVAO, this.selInstanceBuf, SEL_FLOATS_PER_INSTANCE);

		this.fgVAO = gl.createVertexArray();
		this.fgInstanceBuf = gl.createBuffer();
		_setupInstanceVAO(gl, this.fgVAO, this.fgInstanceBuf, FG_FLOATS_PER_INSTANCE);

		this.cursorVAO = gl.createVertexArray();
		this.cursorInstanceBuf = gl.createBuffer();
		_setupInstanceVAO(gl, this.cursorVAO, this.cursorInstanceBuf, CURSOR_FLOATS_PER_INSTANCE);

		this._allocateArrays(cols, rows);

		// Pre-allocate GPU buffer storage so draw calls never hit empty buffers
		gl.bindBuffer(gl.ARRAY_BUFFER, this.bgInstanceBuf);
		gl.bufferData(gl.ARRAY_BUFFER, this.bgData, gl.DYNAMIC_DRAW);
		gl.bindBuffer(gl.ARRAY_BUFFER, this.selInstanceBuf);
		gl.bufferData(gl.ARRAY_BUFFER, this.selData, gl.DYNAMIC_DRAW);
		gl.bindBuffer(gl.ARRAY_BUFFER, this.fgInstanceBuf);
		gl.bufferData(gl.ARRAY_BUFFER, this.fgData, gl.DYNAMIC_DRAW);
		gl.bindBuffer(gl.ARRAY_BUFFER, this.cursorInstanceBuf);
		gl.bufferData(gl.ARRAY_BUFFER, this.cursorData, gl.DYNAMIC_DRAW);
		gl.bindBuffer(gl.ARRAY_BUFFER, null);
	}

	/**
	 * Release all GPU resources (VAOs and buffers).
	 */
	dispose() {
		const gl = this._gl;

		gl.deleteVertexArray(this.bgVAO);
		gl.deleteVertexArray(this.selVAO);
		gl.deleteVertexArray(this.fgVAO);
		gl.deleteVertexArray(this.cursorVAO);

		gl.deleteBuffer(this.bgInstanceBuf);
		gl.deleteBuffer(this.selInstanceBuf);
		gl.deleteBuffer(this.fgInstanceBuf);
		gl.deleteBuffer(this.cursorInstanceBuf);

		this.bgData = null;
		this.fgData = null;
		this.selData = null;
		this.cursorData = null;
	}
}

// ---------------------------------------------------------------------------
// WebGL2TerminalRenderer
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} RendererOptions
 * @property {number}  [fontSize=14]
 * @property {string}  [fontFamily='Menlo, Monaco, "Courier New", monospace']
 * @property {Object}  [theme]       - ITheme object with named hex colors
 * @property {number}  [devicePixelRatio=1]
 * @property {number}  [cellWidth]   - Override atlas cell width (px, at DPR)
 * @property {number}  [cellHeight]  - Override atlas cell height (px, at DPR)
 */

/**
 * @typedef {Object} GhosttyCell
 * @property {number} codepoint
 * @property {number} fg_r
 * @property {number} fg_g
 * @property {number} fg_b
 * @property {number} bg_r
 * @property {number} bg_g
 * @property {number} bg_b
 * @property {number} flags
 * @property {number} width
 * @property {number} hyperlink_id
 * @property {number} grapheme_len
 */

/**
 * @typedef {Object} IRenderable
 * @property {(y: number) => GhosttyCell[] | null} getLine
 * @property {() => { x: number, y: number, visible: boolean }} getCursor
 * @property {() => { cols: number, rows: number }} getDimensions
 * @property {(y: number) => boolean} isRowDirty
 * @property {() => boolean} [needsFullRedraw]
 * @property {() => void} clearDirty
 */

/**
 * @typedef {Object} IScrollbackProvider
 * @property {(offset: number) => GhosttyCell[]} getScrollbackLine
 */

/**
 * @typedef {Object} SelectionManager
 * @property {() => { startRow: number, startCol: number, endRow: number, endCol: number } | null} getSelection
 */

export default class WebGL2TerminalRenderer {
	/**
	 * @param {HTMLCanvasElement} canvas
	 * @param {RendererOptions} [options]
	 */
	constructor(canvas, options = {}) {
		const {
			fontSize = 14,
			fontFamily = 'Menlo, Monaco, "Courier New", monospace',
			theme = null,
			devicePixelRatio = window.devicePixelRatio || 1,
			cellWidth = 0,
			cellHeight = 0,
			baseline = 0,
			fontWeight = "300",
			fontWeightBold = "500",
		} = options;

		/** @type {HTMLCanvasElement} */
		this._canvas = canvas;

		/** @type {number} */
		this._dpr = devicePixelRatio;

		/** @type {number} */
		this._fontSize = fontSize;

		/** @type {string} */
		this._fontFamily = fontFamily;

		/** @type {number} */
		this._cols = 80;

		/** @type {number} */
		this._rows = 24;

		// Theme colors (normalized RGB floats)
		/** @type {{ r: number, g: number, b: number }} */
		this._bgColor = { r: 0.031, g: 0.031, b: 0.031 };
		/** @type {{ r: number, g: number, b: number }} */
		this._fgColor = { r: 0.831, g: 0.831, b: 0.831 };
		/** @type {{ r: number, g: number, b: number }} */
		this._cursorColor = { r: 0.831, g: 0.831, b: 0.831 };
		/** @type {{ r: number, g: number, b: number }} */
		this._selectionColor = { r: 0.149, g: 0.310, b: 0.471 };

		if (theme) {
			this._applyTheme(theme);
		}

		// Cursor state
		/** @type {'block' | 'underline' | 'bar'} */
		this._cursorStyle = "block";
		/** @type {boolean} */
		this._cursorBlink = true;
		/** @type {boolean} */
		this._cursorVisible = true;
		/** @type {number} */
		this._blinkTimer = 0;
		/** @type {number} */
		this._lastBlinkToggle = 0;

		// Selection and hyperlink state
		/** @type {SelectionManager | null} */
		this._selectionManager = null;
		/** @type {number} */
		this._hoveredHyperlinkId = 0;
		/** @type {{ startRow: number, startCol: number, endRow: number, endCol: number } | null} */
		this._hoveredLinkRange = null;

		// Font atlas — pass ghostty-web's actual cell metrics to match exactly
		/** @type {{ cellWidth?: number, cellHeight?: number }} */
		this._atlasOverrides = {};
		if (cellWidth > 0) this._atlasOverrides.cellWidth = cellWidth;
		if (cellHeight > 0) this._atlasOverrides.cellHeight = cellHeight;
		if (baseline > 0) this._atlasOverrides.baseline = baseline;
		this._atlasOverrides.fontWeight = fontWeight;
		this._atlasOverrides.fontWeightBold = fontWeightBold;
		this._atlas = new FontAtlas(fontSize, fontFamily, this._dpr, this._atlasOverrides);

		// Initialize WebGL2
		const gl = canvas.getContext("webgl2", {
			antialias: false,
			alpha: false,
			premultipliedAlpha: false,
			preserveDrawingBuffer: true, // needed for OffscreenCanvas + drawImage
			powerPreference: "high-performance",
		});
		if (!gl) {
			throw new Error("WebGL2 not available");
		}

		/** @type {WebGL2RenderingContext} */
		this._gl = gl;

		/** @type {boolean} */
		this._disposed = false;

		/** @type {boolean} */
		this._contextLost = false;

		// Context loss handling
		this._onContextLost = (/** @type {Event} */ e) => {
			e.preventDefault();
			this._contextLost = true;
			console.warn("[gpu-terminal-renderer] WebGL2 context lost");
		};
		this._onContextRestored = () => {
			console.info("[gpu-terminal-renderer] WebGL2 context restored, reinitializing");
			this._contextLost = false;
			this._initGL();
		};
		if (canvas.addEventListener) {
			canvas.addEventListener("webglcontextlost", this._onContextLost);
			canvas.addEventListener("webglcontextrestored", this._onContextRestored);
		}

		// Perform initial GL setup
		this._initGL();

		// Allocate instance buffers for initial grid size
		this._allocateBuffers(this._cols, this._rows);

		// Resize the canvas to match the grid
		this._updateCanvasSize();
	}

	// -----------------------------------------------------------------------
	// GL initialization
	// -----------------------------------------------------------------------

	_initGL() {
		const gl = this._gl;

		// Create shared GPU resources (programs, uniforms, atlas texture)
		this._sharedResources = new SharedGPUResources(gl);

		// Upload atlas texture
		this._sharedResources.uploadAtlas(this._atlas);
	}

	/**
	 * Upload the font atlas canvas data to the GPU texture.
	 */
	_uploadAtlasTexture() {
		this._sharedResources.uploadAtlas(this._atlas);
	}

	// -----------------------------------------------------------------------
	// Buffer allocation
	// -----------------------------------------------------------------------

	/**
	 * Pre-allocate typed arrays for the given grid dimensions.
	 * Called on construction and on resize. No per-frame allocation.
	 * @param {number} cols
	 * @param {number} rows
	 */
	_allocateBuffers(cols, rows) {
		const gl = this._gl;

		if (this._drawState) {
			this._drawState.dispose();
		}

		this._drawState = new TerminalDrawState(gl, cols, rows);

		// Alias draw state arrays onto the renderer for backward compat
		// with _packRow, _packSelection, _packCursor, _repackAllFg
		this._bgData = this._drawState.bgData;
		this._fgData = this._drawState.fgData;
		this._selData = this._drawState.selData;
		this._cursorData = this._drawState.cursorData;
		this._rowBgOffsets = this._drawState.rowBgOffsets;
		this._rowFgOffsets = this._drawState.rowFgOffsets;
		this._needsFullPack = true;
	}

	// -----------------------------------------------------------------------
	// Canvas sizing
	// -----------------------------------------------------------------------

	_updateCanvasSize() {
		const cellWidth = this._atlas.cellWidth;
		const cellHeight = this._atlas.cellHeight;
		const pixelWidth = this._cols * cellWidth;
		const pixelHeight = this._rows * cellHeight;

		// Only update canvas pixel dimensions if not externally managed.
		// When used as an overlay (terminal-embed.js), canvas size is synced
		// from ghostty-web's canvas and CSS is kept at 100%.
		if (!this._externalCanvasSize) {
			this._canvas.width = pixelWidth;
			this._canvas.height = pixelHeight;
			if (this._canvas.style) {
				this._canvas.style.width = `${pixelWidth / this._dpr}px`;
				this._canvas.style.height = `${pixelHeight / this._dpr}px`;
			}
		}

		if (!this._contextLost) {
			this._gl.viewport(0, 0, this._canvas.width, this._canvas.height);
		}
	}

	// -----------------------------------------------------------------------
	// Theme
	// -----------------------------------------------------------------------

	/**
	 * Apply an ITheme object, extracting default bg/fg/cursor/selection colors.
	 * @param {Object} theme
	 */
	_applyTheme(theme) {
		if (theme.background) this._bgColor = hexToRgb(theme.background);
		if (theme.foreground) this._fgColor = hexToRgb(theme.foreground);
		if (theme.cursor) this._cursorColor = hexToRgb(theme.cursor);
		if (theme.selectionBackground) this._selectionColor = hexToRgb(theme.selectionBackground);
	}

	// -----------------------------------------------------------------------
	// Instance data packing
	// -----------------------------------------------------------------------

	/**
	 * Pack a single row of cells into the bg and fg instance arrays.
	 * @param {GhosttyCell[]} cells
	 * @param {number} row - visual row index
	 * @param {number} bgOffset - starting float index into _bgData
	 * @param {number} fgOffset - starting float index into _fgData
	 * @returns {{ bgWritten: number, fgWritten: number }}
	 */
	_packRow(cells, row, bgOffset, fgOffset) {
		const bgData = this._bgData;
		const fgData = this._fgData;
		const defaultBg = this._bgColor;
		const defaultFg = this._fgColor;
		let bgIdx = bgOffset;
		let fgIdx = fgOffset;
		let bgR, bgG, bgB, fgR, fgG, fgB;

		for (let c = 0; c < cells.length; c++) {
			const cell = cells[c];
			if (!cell) continue;

			const isInverse = (cell.flags & CellFlags.INVERSE) !== 0;

			// Resolve BG color — when inverse, fg sources become bg and vice versa.
			// Flag bits (FLAG_FG_DEFAULT / FLAG_BG_DEFAULT) are authoritative when
			// set by XtermAdapter; the (0,0,0) sentinel is a legacy fallback for
			// the ghostty IRenderable path where genuine black is not used.
			if (isInverse) {
				if (cell.flags & FLAG_FG_DEFAULT) {
					bgR = defaultFg.r; bgG = defaultFg.g; bgB = defaultFg.b;
				} else if (cell.fg_r === 0 && cell.fg_g === 0 && cell.fg_b === 0) {
					bgR = defaultFg.r; bgG = defaultFg.g; bgB = defaultFg.b;
				} else {
					bgR = cell.fg_r / 255; bgG = cell.fg_g / 255; bgB = cell.fg_b / 255;
				}
			} else {
				if (cell.flags & FLAG_BG_DEFAULT) {
					bgR = defaultBg.r; bgG = defaultBg.g; bgB = defaultBg.b;
				} else if (cell.bg_r === 0 && cell.bg_g === 0 && cell.bg_b === 0) {
					bgR = defaultBg.r; bgG = defaultBg.g; bgB = defaultBg.b;
				} else {
					bgR = cell.bg_r / 255; bgG = cell.bg_g / 255; bgB = cell.bg_b / 255;
				}
			}

			const cellWidth = cell.width || 1;

			// BG instance
			bgData[bgIdx]     = c;
			bgData[bgIdx + 1] = row;
			bgData[bgIdx + 2] = cellWidth;
			bgData[bgIdx + 3] = bgR;
			bgData[bgIdx + 4] = bgG;
			bgData[bgIdx + 5] = bgB;
			bgIdx += BG_FLOATS_PER_INSTANCE;

			// FG instance (skip spaces / null codepoints)
			const cp = cell.codepoint;
			if (cp > 0x20) {
				const glyph = this._atlas.getGlyph(cp, cell.flags);
				if (glyph) {
					// Resolve FG color — inverse swaps sources
					if (isInverse) {
						if (cell.flags & FLAG_BG_DEFAULT) {
							fgR = defaultBg.r; fgG = defaultBg.g; fgB = defaultBg.b;
						} else if (cell.bg_r === 0 && cell.bg_g === 0 && cell.bg_b === 0) {
							fgR = defaultBg.r; fgG = defaultBg.g; fgB = defaultBg.b;
						} else {
							fgR = cell.bg_r / 255; fgG = cell.bg_g / 255; fgB = cell.bg_b / 255;
						}
					} else {
						if (cell.flags & FLAG_FG_DEFAULT) {
							fgR = defaultFg.r; fgG = defaultFg.g; fgB = defaultFg.b;
						} else if (cell.fg_r === 0 && cell.fg_g === 0 && cell.fg_b === 0) {
							fgR = defaultFg.r; fgG = defaultFg.g; fgB = defaultFg.b;
						} else {
							fgR = cell.fg_r / 255; fgG = cell.fg_g / 255; fgB = cell.fg_b / 255;
						}
					}

					fgData[fgIdx]     = c;
					fgData[fgIdx + 1] = row;
					fgData[fgIdx + 2] = glyph.u;
					fgData[fgIdx + 3] = glyph.v;
					fgData[fgIdx + 4] = glyph.w;
					fgData[fgIdx + 5] = glyph.h;
					fgData[fgIdx + 6] = fgR;
					fgData[fgIdx + 7] = fgG;
					fgData[fgIdx + 8] = fgB;
					fgIdx += FG_FLOATS_PER_INSTANCE;
				}
			}
		}

		return {
			bgWritten: (bgIdx - bgOffset) / BG_FLOATS_PER_INSTANCE,
			fgWritten: (fgIdx - fgOffset) / FG_FLOATS_PER_INSTANCE,
		};
	}

	/**
	 * Pack selection overlay instances for the current selection.
	 * @param {number} rows - total visible rows
	 * @param {number} cols - total visible cols
	 */
	_packSelection(rows, cols) {
		this._drawState.selCount = 0;
		if (!this._selectionManager) return;

		const sel = this._selectionManager.getSelection();
		if (!sel) return;

		const { startRow, startCol, endRow, endCol } = sel;
		const selData = this._selData;
		const sc = this._selectionColor;
		let idx = 0;

		for (let r = startRow; r <= endRow && r < rows; r++) {
			if (r < 0) continue;
			const lineStart = r === startRow ? startCol : 0;
			const lineEnd = r === endRow ? endCol : cols - 1;

			for (let c = lineStart; c <= lineEnd && c < cols; c++) {
				selData[idx]     = c;
				selData[idx + 1] = r;
				selData[idx + 2] = 1; // width
				selData[idx + 3] = sc.r;
				selData[idx + 4] = sc.g;
				selData[idx + 5] = sc.b;
				selData[idx + 6] = 0.5; // alpha
				idx += SEL_FLOATS_PER_INSTANCE;
			}
		}

		this._drawState.selCount = idx / SEL_FLOATS_PER_INSTANCE;
	}

	/**
	 * Pack cursor instance data based on current cursor state and style.
	 * @param {{ x: number, y: number, visible: boolean }} cursor
	 * @returns {boolean} true if cursor should be drawn
	 */
	_packCursor(cursor) {
		if (!cursor || !cursor.visible) return false;

		// Handle blink
		if (this._cursorBlink) {
			const now = performance.now();
			if (now - this._lastBlinkToggle >= BLINK_INTERVAL_MS) {
				this._cursorVisible = !this._cursorVisible;
				this._lastBlinkToggle = now;
			}
			if (!this._cursorVisible) return false;
		}

		const d = this._cursorData;
		const cc = this._cursorColor;

		d[0] = cursor.x; // col
		d[1] = cursor.y; // row

		switch (this._cursorStyle) {
			case "block":
				d[2] = 1.0;  // width (full cell)
				d[3] = 1.0;  // height (full cell)
				d[4] = cc.r;
				d[5] = cc.g;
				d[6] = cc.b;
				d[7] = 0.7;  // semi-transparent block
				break;
			case "underline":
				d[0] = cursor.x;
				d[1] = cursor.y + 0.85; // near bottom of cell
				d[2] = 1.0;
				d[3] = 0.15;
				d[4] = cc.r;
				d[5] = cc.g;
				d[6] = cc.b;
				d[7] = 1.0;
				break;
			case "bar":
				d[2] = 0.1;  // thin bar
				d[3] = 1.0;  // full height
				d[4] = cc.r;
				d[5] = cc.g;
				d[6] = cc.b;
				d[7] = 1.0;
				break;
			default:
				d[2] = 1.0;
				d[3] = 1.0;
				d[4] = cc.r;
				d[5] = cc.g;
				d[6] = cc.b;
				d[7] = 0.7;
		}

		return true;
	}

	// -----------------------------------------------------------------------
	// CanvasRenderer interface — render
	// -----------------------------------------------------------------------

	/**
	 * Main render entry point. Called by ghostty-web on each frame.
	 *
	 * @param {IRenderable} buffer
	 * @param {boolean} [forceAll=false]
	 * @param {number} [viewportY=0]
	 * @param {IScrollbackProvider} [scrollbackProvider]
	 * @param {number} [scrollbarOpacity=0]
	 */
	render(buffer, forceAll = false, viewportY = 0, scrollbackProvider = null, scrollbarOpacity = 0) {
		if (this._disposed || this._contextLost) return;

		const gl = this._gl;
		const ds = this._drawState;

		// Re-upload atlas texture if new glyphs were rasterized on demand
		if (this._atlas._dirty) {
			this._uploadAtlasTexture();
			this._atlas._dirty = false;
		}

		const dims = buffer.getDimensions();
		const cols = dims.cols;
		const rows = dims.rows;

		// Check if dimensions changed (can happen before explicit resize call)
		if (cols !== this._cols || rows !== this._rows) {
			this.resize(cols, rows);
		}

		const fullRedraw = forceAll
			|| this._needsFullPack
			|| (buffer.needsFullRedraw && buffer.needsFullRedraw());

		// -------------------------------------------------------------------
		// Pack instance data
		// -------------------------------------------------------------------

		if (fullRedraw) {
			ds.bgCount = 0;
			ds.fgCount = 0;
			let bgOffset = 0;
			let fgOffset = 0;

			for (let r = 0; r < rows; r++) {
				const line = this._getLine(buffer, r, viewportY, scrollbackProvider);
				if (!line) {
					// Empty row — fill with default bg
					for (let c = 0; c < cols; c++) {
						this._bgData[bgOffset]     = c;
						this._bgData[bgOffset + 1] = r;
						this._bgData[bgOffset + 2] = 1;
						this._bgData[bgOffset + 3] = this._bgColor.r;
						this._bgData[bgOffset + 4] = this._bgColor.g;
						this._bgData[bgOffset + 5] = this._bgColor.b;
						bgOffset += BG_FLOATS_PER_INSTANCE;
					}
					this._rowBgOffsets[r] = cols;
					this._rowFgOffsets[r] = 0;
					ds.bgCount += cols;
					continue;
				}

				this._rowBgOffsets[r] = bgOffset / BG_FLOATS_PER_INSTANCE;
				this._rowFgOffsets[r] = fgOffset / FG_FLOATS_PER_INSTANCE;

				const result = this._packRow(line, r, bgOffset, fgOffset);

				bgOffset += result.bgWritten * BG_FLOATS_PER_INSTANCE;
				fgOffset += result.fgWritten * FG_FLOATS_PER_INSTANCE;
				ds.bgCount += result.bgWritten;
				ds.fgCount += result.fgWritten;
			}

			// Full upload
			gl.bindBuffer(gl.ARRAY_BUFFER, ds.bgInstanceBuf);
			gl.bufferData(gl.ARRAY_BUFFER, this._bgData.subarray(0, ds.bgCount * BG_FLOATS_PER_INSTANCE), gl.DYNAMIC_DRAW);

			gl.bindBuffer(gl.ARRAY_BUFFER, ds.fgInstanceBuf);
			gl.bufferData(gl.ARRAY_BUFFER, this._fgData.subarray(0, ds.fgCount * FG_FLOATS_PER_INSTANCE), gl.DYNAMIC_DRAW);

			this._needsFullPack = false;
			ds.needsFullPack = false;
		} else {
			// Incremental: only update dirty rows
			let anyDirty = false;

			for (let r = 0; r < rows; r++) {
				if (!buffer.isRowDirty(r)) continue;
				anyDirty = true;

				const line = this._getLine(buffer, r, viewportY, scrollbackProvider);
				if (!line) continue;

				// Re-pack this row into a temporary section and overwrite
				// For simplicity in the incremental path, we track row offsets
				// and use bufferSubData.
				const bgStartInstance = r * cols; // worst case: cols instances per row
				const bgByteOffset = bgStartInstance * BG_FLOATS_PER_INSTANCE * 4;

				// Pack into a temp region at the row's position
				const tempBgOffset = bgStartInstance * BG_FLOATS_PER_INSTANCE;
				const tempFgOffset = this._rowFgOffsets[r] * FG_FLOATS_PER_INSTANCE;

				const result = this._packRow(line, r, tempBgOffset, tempFgOffset);

				// Upload the bg portion for this row
				gl.bindBuffer(gl.ARRAY_BUFFER, ds.bgInstanceBuf);
				gl.bufferSubData(
					gl.ARRAY_BUFFER,
					bgByteOffset,
					this._bgData.subarray(
						tempBgOffset,
						tempBgOffset + result.bgWritten * BG_FLOATS_PER_INSTANCE,
					),
				);

				// For fg, partial update is trickier since fg count varies.
				// Mark for full fg re-upload if any row is dirty.
			}

			if (anyDirty) {
				// Re-upload full fg buffer (fg packing is sparse, partial is complex)
				// This is still fast: just a buffer upload, no CPU re-pack of clean rows.
				this._repackAllFg(buffer, rows, viewportY, scrollbackProvider);
			}
		}

		// Pack selection
		this._packSelection(rows, cols);
		if (ds.selCount > 0) {
			gl.bindBuffer(gl.ARRAY_BUFFER, ds.selInstanceBuf);
			gl.bufferData(
				gl.ARRAY_BUFFER,
				this._selData.subarray(0, ds.selCount * SEL_FLOATS_PER_INSTANCE),
				gl.DYNAMIC_DRAW,
			);
		}

		// Pack cursor
		const cursor = buffer.getCursor();
		const drawCursor = this._packCursor(cursor);
		if (drawCursor) {
			gl.bindBuffer(gl.ARRAY_BUFFER, ds.cursorInstanceBuf);
			gl.bufferData(gl.ARRAY_BUFFER, this._cursorData, gl.DYNAMIC_DRAW);
		}

		// Clear dirty flags
		buffer.clearDirty();

		// -------------------------------------------------------------------
		// Draw — delegate to SharedGPUResources
		// -------------------------------------------------------------------

		this._sharedResources.drawTerminal(ds, {
			bgColor: this._bgColor,
			cols,
			rows,
			drawCursor,
		});
	}

	/**
	 * Get a line of cells, accounting for scrollback offset.
	 * @param {IRenderable} buffer
	 * @param {number} visualRow
	 * @param {number} viewportY
	 * @param {IScrollbackProvider | null} scrollbackProvider
	 * @returns {GhosttyCell[] | null}
	 */
	_getLine(buffer, visualRow, viewportY, scrollbackProvider) {
		if (viewportY !== 0 && scrollbackProvider) {
			const scrollbackOffset = viewportY + visualRow;
			if (scrollbackOffset < 0) {
				return scrollbackProvider.getScrollbackLine(-scrollbackOffset);
			}
		}
		return buffer.getLine(visualRow);
	}

	/**
	 * Re-pack all fg instances for a full fg buffer upload.
	 * Only re-reads lines from the buffer; does not touch bg data.
	 * @param {IRenderable} buffer
	 * @param {number} rows
	 * @param {number} viewportY
	 * @param {IScrollbackProvider | null} scrollbackProvider
	 */
	_repackAllFg(buffer, rows, viewportY, scrollbackProvider) {
		let fgOffset = 0;
		this._drawState.fgCount = 0;
		const defaultFg = this._fgColor;
		const defaultBg = this._bgColor;
		const fgData = this._fgData;
		let fgR, fgG, fgB;

		for (let r = 0; r < rows; r++) {
			const line = this._getLine(buffer, r, viewportY, scrollbackProvider);
			if (!line) continue;

			for (let c = 0; c < line.length; c++) {
				const cell = line[c];
				if (!cell) continue;

				const cp = cell.codepoint;
				if (cp <= 0x20) continue;

				const glyph = this._atlas.getGlyph(cp, cell.flags);
				if (!glyph) continue;

				const isInverse = (cell.flags & CellFlags.INVERSE) !== 0;
				// Resolve FG color — flag bits are authoritative (xterm adapter),
				// (0,0,0) sentinel is legacy fallback (ghostty path).
				if (isInverse) {
					if (cell.flags & FLAG_BG_DEFAULT) {
						fgR = defaultBg.r; fgG = defaultBg.g; fgB = defaultBg.b;
					} else if (cell.bg_r === 0 && cell.bg_g === 0 && cell.bg_b === 0) {
						fgR = defaultBg.r; fgG = defaultBg.g; fgB = defaultBg.b;
					} else {
						fgR = cell.bg_r / 255; fgG = cell.bg_g / 255; fgB = cell.bg_b / 255;
					}
				} else {
					if (cell.flags & FLAG_FG_DEFAULT) {
						fgR = defaultFg.r; fgG = defaultFg.g; fgB = defaultFg.b;
					} else if (cell.fg_r === 0 && cell.fg_g === 0 && cell.fg_b === 0) {
						fgR = defaultFg.r; fgG = defaultFg.g; fgB = defaultFg.b;
					} else {
						fgR = cell.fg_r / 255; fgG = cell.fg_g / 255; fgB = cell.fg_b / 255;
					}
				}

				fgData[fgOffset]     = c;
				fgData[fgOffset + 1] = r;
				fgData[fgOffset + 2] = glyph.u;
				fgData[fgOffset + 3] = glyph.v;
				fgData[fgOffset + 4] = glyph.w;
				fgData[fgOffset + 5] = glyph.h;
				fgData[fgOffset + 6] = fgR;
				fgData[fgOffset + 7] = fgG;
				fgData[fgOffset + 8] = fgB;
				fgOffset += FG_FLOATS_PER_INSTANCE;
				this._drawState.fgCount++;
			}
		}

		const gl = this._gl;
		gl.bindBuffer(gl.ARRAY_BUFFER, this._drawState.fgInstanceBuf);
		gl.bufferData(
			gl.ARRAY_BUFFER,
			fgData.subarray(0, this._drawState.fgCount * FG_FLOATS_PER_INSTANCE),
			gl.DYNAMIC_DRAW,
		);
	}

	// -----------------------------------------------------------------------
	// CanvasRenderer interface — resize
	// -----------------------------------------------------------------------

	/**
	 * Resize the renderer to a new grid dimension.
	 * @param {number} cols
	 * @param {number} rows
	 */
	resize(cols, rows) {
		if (cols === this._cols && rows === this._rows) return;

		this._cols = cols;
		this._rows = rows;
		this._allocateBuffers(cols, rows);
		this._updateCanvasSize();
	}

	// -----------------------------------------------------------------------
	// CanvasRenderer interface — theme and font
	// -----------------------------------------------------------------------

	/**
	 * Update the color theme.
	 * @param {Object} theme - ITheme with hex color properties
	 */
	setTheme(theme) {
		this._applyTheme(theme);
		this._needsFullPack = true;
	}

	/**
	 * Update the font size. Rebuilds the font atlas and resizes canvas.
	 * @param {number} size
	 */
	setFontSize(size) {
		if (size === this._fontSize) return;
		this._fontSize = size;
		this._rebuildAtlas();
	}

	/**
	 * Update the font family. Rebuilds the font atlas and resizes canvas.
	 * @param {string} family
	 */
	setFontFamily(family) {
		if (family === this._fontFamily) return;
		this._fontFamily = family;
		this._rebuildAtlas();
	}

	/**
	 * Rebuild the font atlas after font changes and re-upload to GPU.
	 */
	_rebuildAtlas() {
		this._atlas = new FontAtlas(this._fontSize, this._fontFamily, this._dpr, this._atlasOverrides);

		if (!this._contextLost) {
			this._uploadAtlasTexture();
		}

		this._updateCanvasSize();
		this._needsFullPack = true;
	}

	// -----------------------------------------------------------------------
	// CanvasRenderer interface — cursor
	// -----------------------------------------------------------------------

	/**
	 * Set the cursor rendering style.
	 * @param {'block' | 'underline' | 'bar'} style
	 */
	setCursorStyle(style) {
		this._cursorStyle = style;
	}

	/**
	 * Enable or disable cursor blinking.
	 * @param {boolean} enabled
	 */
	setCursorBlink(enabled) {
		this._cursorBlink = enabled;
		if (!enabled) {
			this._cursorVisible = true;
		}
		this._lastBlinkToggle = performance.now();
	}

	// -----------------------------------------------------------------------
	// CanvasRenderer interface — metrics and canvas access
	// -----------------------------------------------------------------------

	/**
	 * Return cell metrics for layout calculations.
	 * @returns {{ cellWidth: number, cellHeight: number }}
	 */
	getMetrics() {
		return {
			cellWidth: this._atlas.cellWidth / this._dpr,
			cellHeight: this._atlas.cellHeight / this._dpr,
		};
	}

	/**
	 * Return the underlying canvas element.
	 * @returns {HTMLCanvasElement}
	 */
	getCanvas() {
		return this._canvas;
	}

	// -----------------------------------------------------------------------
	// CanvasRenderer interface — selection and hyperlinks
	// -----------------------------------------------------------------------

	/**
	 * Set the selection manager for selection overlay rendering.
	 * @param {SelectionManager} manager
	 */
	setSelectionManager(manager) {
		this._selectionManager = manager;
	}

	/**
	 * Set the currently hovered hyperlink ID for visual feedback.
	 * @param {number} id
	 */
	setHoveredHyperlinkId(id) {
		this._hoveredHyperlinkId = id;
	}

	/**
	 * Set the hovered hyperlink range for underline decoration.
	 * @param {{ startRow: number, startCol: number, endRow: number, endCol: number } | null} range
	 */
	setHoveredLinkRange(range) {
		this._hoveredLinkRange = range;
	}

	// -----------------------------------------------------------------------
	// CanvasRenderer interface — clear and dispose
	// -----------------------------------------------------------------------

	/**
	 * Clear the terminal display to the background color.
	 */
	clear() {
		if (this._disposed || this._contextLost) return;

		const gl = this._gl;
		gl.clearColor(this._bgColor.r, this._bgColor.g, this._bgColor.b, 1.0);
		gl.clear(gl.COLOR_BUFFER_BIT);

		this._drawState.bgCount = 0;
		this._drawState.fgCount = 0;
		this._drawState.selCount = 0;
		this._needsFullPack = true;
	}

	/**
	 * Release all GPU resources. The renderer cannot be used after this.
	 */
	dispose() {
		if (this._disposed) return;
		this._disposed = true;

		if (this._canvas.removeEventListener) {
			this._canvas.removeEventListener("webglcontextlost", this._onContextLost);
			this._canvas.removeEventListener("webglcontextrestored", this._onContextRestored);
		}

		if (this._contextLost) return;

		// Dispose sub-objects
		if (this._drawState) {
			this._drawState.dispose();
		}
		if (this._sharedResources) {
			this._sharedResources.dispose();
		}

		// Release typed array aliases
		this._bgData = null;
		this._fgData = null;
		this._selData = null;
		this._cursorData = null;
	}
}
