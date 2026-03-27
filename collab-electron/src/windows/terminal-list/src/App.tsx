import { useEffect, useState } from "react";
import "./App.css";

interface TerminalEntry {
  sessionId: string;
  shell: string;
  cwd: string;
  foreground: string | null;
  tileId: string;
  label: string | null;
}

function shellBasename(shell: string): string {
  return shell.split("/").pop() || shell;
}

function isIdle(entry: TerminalEntry): boolean {
  if (!entry.foreground) return true;
  const base = shellBasename(entry.shell);
  return entry.foreground === base;
}

function App() {
  const [entries, setEntries] = useState<TerminalEntry[]>([]);
  const [focusedSessionId, setFocusedSessionId] =
    useState<string | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  function startRename(entry: TerminalEntry) {
    setEditingSessionId(entry.sessionId);
    setEditValue(entry.label || shellBasename(entry.shell));
  }

  function commitRename(sessionId: string) {
    const trimmed = editValue.trim();
    const entry = entries.find((e) => e.sessionId === sessionId);
    const shellName = entry ? shellBasename(entry.shell) : "";
    const label = trimmed && trimmed !== shellName ? trimmed : null;
    setEntries((prev) =>
      prev.map((e) =>
        e.sessionId === sessionId ? { ...e, label } : e,
      ),
    );
    setEditingSessionId(null);
    window.api.sendToHost("terminal-list:rename", { sessionId, label });
  }

  function cancelRename() {
    setEditingSessionId(null);
  }

  useEffect(() => {
    // Listen for messages from the shell renderer via webview.send()
    // These arrive on ipcRenderer.on() in the universal preload,
    // exposed via window.api.onTerminalListMessage.
    const cleanup = window.api.onTerminalListMessage(
      (channel: string, ...args: unknown[]) => {
        if (channel === "terminal-list:init") {
          const sessions = args[0] as TerminalEntry[];
          setEntries(sessions);
        } else if (channel === "terminal-list:add") {
          const entry = args[0] as TerminalEntry;
          setEntries((prev) => [...prev, entry]);
        } else if (channel === "terminal-list:remove") {
          const sessionId = args[0] as string;
          setEntries((prev) =>
            prev.filter((e) => e.sessionId !== sessionId),
          );
        } else if (channel === "terminal-list:focus") {
          const sessionId = args[0] as string | null;
          setFocusedSessionId(sessionId);
        } else if (channel === "pty-status-changed") {
          const payload = args[0] as {
            sessionId: string;
            foreground: string;
          };
          setEntries((prev) =>
            prev.map((e) =>
              e.sessionId === payload.sessionId
                ? { ...e, foreground: payload.foreground }
                : e,
            ),
          );
        } else if (channel === "pty-exit") {
          const payload = args[0] as { sessionId: string };
          setEntries((prev) =>
            prev.filter((e) => e.sessionId !== payload.sessionId),
          );
        }
      },
    );

    return cleanup;
  }, []);

  function peekTile(sessionId: string) {
    setFocusedSessionId(sessionId);
    window.api.sendToHost("terminal-list:peek-tile", sessionId);
  }

  function focusTile(sessionId: string) {
    window.api.sendToHost("terminal-list:focus-tile", sessionId);
  }

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (editingSessionId) return;

      if (e.key === "Escape") {
        e.preventDefault();
        window.api.sendToHost("terminal-list:blur");
        return;
      }

      if (e.key === "Enter" && focusedSessionId) {
        e.preventDefault();
        focusTile(focusedSessionId);
        return;
      }

      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      if (entries.length === 0) return;

      e.preventDefault();

      const dir = e.key === "ArrowUp" ? -1 : 1;
      const currentIdx = entries.findIndex(
        (entry) => entry.sessionId === focusedSessionId,
      );
      const nextIdx =
        currentIdx < 0
          ? 0
          : (currentIdx + dir + entries.length) % entries.length;

      peekTile(entries[nextIdx].sessionId);
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [entries, focusedSessionId, editingSessionId]);

  return (
    <div className="terminal-list">
      <div className="terminal-list-header">Terminals</div>
      {entries.map((entry) => {
        const idle = isIdle(entry);
        const focused = entry.sessionId === focusedSessionId;
        const stateClass = idle ? "idle" : "busy";
        const classes = [
          "terminal-entry",
          stateClass,
          focused ? "focused" : "",
        ]
          .filter(Boolean)
          .join(" ");

        const isEditing = editingSessionId === entry.sessionId;
        const displayName = entry.label || shellBasename(entry.shell);

        return (
          <div
            key={entry.sessionId}
            className={classes}
            onClick={() => peekTile(entry.sessionId)}
          >
            <div className={`status-dot ${stateClass}`} />
            <div className="entry-info">
              <div className="entry-top">
                {isEditing ? (
                  <input
                    className="rename-input"
                    value={editValue}
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename(entry.sessionId);
                      if (e.key === "Escape") cancelRename();
                    }}
                    onBlur={() => commitRename(entry.sessionId)}
                  />
                ) : (
                  <span
                    className="shell-name"
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      startRename(entry);
                    }}
                  >
                    {displayName}
                  </span>
                )}
                <span className="status-label">
                  {idle
                    ? "idle"
                    : entry.foreground || "running"}
                </span>
              </div>
              <div className="entry-cwd">
                {entry.cwd}
              </div>
            </div>
          </div>
        );
      })}
      {entries.length === 0 && (
        <div
          style={{
            padding: "12px",
            color: "var(--muted, #666)",
            fontSize: "11px",
          }}
        >
          No terminals open
        </div>
      )}
    </div>
  );
}

export default App;
