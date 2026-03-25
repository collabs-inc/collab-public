// Shim: force require("electron") to use Electron's built-in API.
// In dev mode, the npm "electron" package shadows the built-in module.
// Electron's c._load falls back to the built-in only when normal
// resolution FAILS. We make _resolveFilename throw for "electron"
// so the fallback kicks in.
;(function() {
  var Module = require("module");
  var origResolveFilename = Module._resolveFilename;
  Module._resolveFilename = function(request, parent, isMain, options) {
    if (request === "electron" || request.startsWith("electron/")) {
      var err = new Error("Cannot find module '" + request + "'");
      err.code = "MODULE_NOT_FOUND";
      throw err;
    }
    return origResolveFilename.apply(this, arguments);
  };
})();
