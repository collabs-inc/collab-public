/**
 * GPU Compositor -- single-canvas compositing pass
 *
 * Draws all terminal FBO textures as textured quads onto the default
 * framebuffer in one compositing pass (one draw call per terminal, same
 * program bound).  Replaces per-terminal blitToCanvas + transferToImageBitmap.
 *
 * The compositor does NOT own the GL context or any FBOs -- it only reads
 * terminal textures produced by SharedGLContext / WebGL2TerminalRenderer.
 *
 * @module gpu-compositor
 */

// ---------------------------------------------------------------------------
// Shader sources (WebGL2, #version 300 es)
// ---------------------------------------------------------------------------

const COMPOSITE_VERTEX_SRC = `#version 300 es
// Unit quad positions passed as attribute
in vec2 aPos;
uniform vec4 uRect;      // x, y, w, h in pixels
uniform vec2 uViewport;  // canvas size in pixels

out vec2 vTexCoord;

void main() {
  vec2 pixel = uRect.xy + aPos * uRect.zw;
  vec2 ndc = (pixel / uViewport) * 2.0 - 1.0;
  ndc.y = -ndc.y; // flip Y for screen coords
  gl_Position = vec4(ndc, 0.0, 1.0);
  vTexCoord = aPos;
  vTexCoord.y = 1.0 - vTexCoord.y; // flip for FBO texture orientation
}
`;

const COMPOSITE_FRAGMENT_SRC = `#version 300 es
precision mediump float;
uniform sampler2D uTexture;
in vec2 vTexCoord;
out vec4 fragColor;

void main() {
  fragColor = texture(uTexture, vTexCoord);
}
`;

// ---------------------------------------------------------------------------
// GL helpers (standalone -- no imports from gpu-terminal-renderer)
// ---------------------------------------------------------------------------

/**
 * Compile a single shader stage.
 * @param {WebGL2RenderingContext} gl
 * @param {GLenum} type  gl.VERTEX_SHADER or gl.FRAGMENT_SHADER
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
    throw new Error(`GPUCompositor: shader compile error: ${info}`);
  }
  return shader;
}

/**
 * Link a program from compiled vertex and fragment shaders.
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
    throw new Error(`GPUCompositor: program link error: ${info}`);
  }
  return program;
}

// ---------------------------------------------------------------------------
// GPUCompositor
// ---------------------------------------------------------------------------

export default class GPUCompositor {
  /**
   * @param {WebGL2RenderingContext} gl  The shared WebGL2 context.
   */
  constructor(gl) {
    this._gl = gl;

    // Compile compositing shader program
    const vs = compileShader(gl, gl.VERTEX_SHADER, COMPOSITE_VERTEX_SRC);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, COMPOSITE_FRAGMENT_SRC);
    this._program = linkProgram(gl, vs, fs);
    // Shaders can be freed after linking
    gl.deleteShader(vs);
    gl.deleteShader(fs);

    // Cache uniform locations
    this._uRect = gl.getUniformLocation(this._program, "uRect");
    this._uViewport = gl.getUniformLocation(this._program, "uViewport");
    this._uTexture = gl.getUniformLocation(this._program, "uTexture");

    // Create the unit-quad VAO
    this._quadVAO = this._createQuadVAO();
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Composite all terminal textures onto the default framebuffer.
   *
   * @param {{ texture: WebGLTexture, x: number, y: number, width: number, height: number }[]} terminals
   * @param {number} viewportWidth   Canvas width in pixels.
   * @param {number} viewportHeight  Canvas height in pixels.
   */
  compositeAll(terminals, viewportWidth, viewportHeight) {
    const gl = this._gl;

    // Draw to the default framebuffer (the canvas)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, viewportWidth, viewportHeight);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this._program);
    gl.bindVertexArray(this._quadVAO);
    gl.uniform2f(this._uViewport, viewportWidth, viewportHeight);

    for (let i = 0; i < terminals.length; i++) {
      const t = terminals[i];
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, t.texture);
      gl.uniform1i(this._uTexture, 0);
      gl.uniform4f(this._uRect, t.x, t.y, t.width, t.height);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    gl.bindVertexArray(null);
  }

  /**
   * Release all GPU resources owned by this compositor.
   */
  dispose() {
    const gl = this._gl;
    if (this._program) {
      gl.deleteProgram(this._program);
      this._program = null;
    }
    if (this._quadVAO) {
      gl.deleteVertexArray(this._quadVAO);
      this._quadVAO = null;
    }
    if (this._quadBuf) {
      gl.deleteBuffer(this._quadBuf);
      this._quadBuf = null;
    }
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /**
   * Create a unit-quad [0,1]^2 VAO as a triangle strip (4 vertices).
   * @returns {WebGLVertexArrayObject}
   */
  _createQuadVAO() {
    const gl = this._gl;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    const data = new Float32Array([
      0, 0,
      1, 0,
      0, 1,
      1, 1,
    ]);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);

    // aPos at location 0
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    gl.bindVertexArray(null);
    this._quadBuf = buf;
    return vao;
  }
}
