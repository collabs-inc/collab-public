import { describe, test, expect, beforeEach } from "bun:test";
import { sessionStart, fileTouched, sessionEnd, getSession, setWorkspacePath } from "./agent-activity";

describe("agent-activity ring buffer", () => {
  const SESSION_ID = "test-session";

  beforeEach(() => {
    sessionEnd({ session_id: SESSION_ID });
    setWorkspacePath("/tmp");
  });

  test("interactions are capped at 1000 entries", () => {
    sessionStart({ session_id: SESSION_ID, cwd: "/tmp" });

    for (let i = 0; i < 1100; i++) {
      fileTouched({
        session_id: SESSION_ID,
        tool_name: "Write",
        file_path: `/tmp/file-${i}.ts`,
      });
    }

    const session = getSession(SESSION_ID);
    expect(session).toBeDefined();
    expect(session!.interactions.length).toBeLessThanOrEqual(1000);
    expect(session!.interactions[session!.interactions.length - 1].filePath).toBe("file-1099.ts");
  });

  test("interactions under 1000 are not truncated", () => {
    sessionStart({ session_id: SESSION_ID, cwd: "/tmp" });

    for (let i = 0; i < 500; i++) {
      fileTouched({
        session_id: SESSION_ID,
        tool_name: "Read",
        file_path: `/tmp/file-${i}.ts`,
      });
    }

    const session = getSession(SESSION_ID);
    expect(session).toBeDefined();
    expect(session!.interactions.length).toBe(500);
  });
});
