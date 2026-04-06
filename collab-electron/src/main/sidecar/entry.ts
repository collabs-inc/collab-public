// src/main/sidecar/entry.ts
import { SidecarServer } from "./server";
import {
  SIDECAR_SOCKET_PATH,
  SIDECAR_PID_PATH,
  SESSION_SOCKET_DIR,
} from "./protocol";

function main(): void {
  const args = process.argv.slice(2);
  const tokenIdx = args.indexOf("--token");
  const token = tokenIdx !== -1 ? args[tokenIdx + 1] : "";

  if (!token) {
    process.stderr.write("Error: --token is required\n");
    process.exit(1);
  }

  const server = new SidecarServer({
    controlSocketPath: SIDECAR_SOCKET_PATH,
    sessionSocketDir: SESSION_SOCKET_DIR,
    pidFilePath: SIDECAR_PID_PATH,
    token,
  });

  process.on("SIGTERM", () => {
    void server.shutdown().then(() => process.exit(0));
  });

  process.on("SIGINT", () => {
    void server.shutdown().then(() => process.exit(0));
  });

  void server.start().then(() => {
    // Sidecar is running. Do nothing — event loop keeps us alive.
  });
}

main();
