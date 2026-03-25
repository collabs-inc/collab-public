/**
 * Electron API shim for Windows.
 *
 * On Windows, require("electron") resolves to the npm package which
 * returns the binary path instead of the Electron API. This shim
 * temporarily hides the npm package so Electron's built-in module
 * resolver can provide the real API.
 */
"use strict";

const Module = require("module");
const path = require("path");

// Find and remove the npm electron package from the resolver
const electronPkgDir = path.join(__dirname, "../../node_modules/electron");
const electronPkgIndex = path.join(electronPkgDir, "index.js");

// Patch _resolveFilename to skip the npm electron package
const origResolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, isMain, options) {
  if (request === "electron") {
    // Skip - let Electron's c._load handle it by throwing MODULE_NOT_FOUND
    const err = new Error(`Cannot find module 'electron'`);
    err.code = "MODULE_NOT_FOUND";
    throw err;
  }
  return origResolve.call(this, request, parent, isMain, options);
};

// Now require("electron") should be handled by Electron's interceptor
let electronAPI;
try {
  electronAPI = Module._load("electron", module, false);
} catch (e) {
  // If that still fails, the Electron interceptor isn't working.
  // Restore original resolver and re-throw.
  Module._resolveFilename = origResolve;
  throw new Error(
    "Failed to load Electron built-in module. " +
    "Electron's module interceptor may not be active. " +
    "Original error: " + e.message
  );
}

// Restore original resolver
Module._resolveFilename = origResolve;

module.exports = electronAPI;
