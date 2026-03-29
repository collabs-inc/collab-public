import { useState, useEffect, useCallback, useRef } from "react";
import { TerminalTab } from "@collab/components/Terminal";
import "./styles/App.css";

function estimateTermSize(): { cols: number; rows: number } {
  const CHAR_WIDTH = 7.22;
  const CELL_HEIGHT = 17;
  const w = document.documentElement.clientWidth;
  const h = document.documentElement.clientHeight;
  return {
    cols: Math.max(80, Math.floor(w / CHAR_WIDTH)),
    rows: Math.max(24, Math.floor(h / CELL_HEIGHT)),
  };
}

interface Session {
  id: string;
  title: string;
  shellName: string;
}

function App() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [workspacePath, setWorkspacePath] = useState<string | null>(null);
  const [cursorBlink, setCursorBlink] = useState(true);
  const [scrollback, setScrollback] = useState(200000);
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;

  const createTab = useCallback(async (): Promise<Session> => {
    const config = await window.api.getConfig();
    const cwd =
      config?.workspaces?.[config?.active_workspace] || undefined;
    const { cols, rows } = estimateTermSize();
    const result = await window.api.ptyCreate(cwd, cols, rows);
    const shellName = result.shell.split("/").pop() || "shell";
    const session: Session = {
      id: result.sessionId,
      title: shellName,
      shellName,
    };
    setSessions((prev) => [...prev, session]);
    setActiveId(result.sessionId);
    return session;
  }, []);

  const closeTab = useCallback(
    async (id: string) => {
      await window.api.ptyKill(id);
      setSessions((prev) => {
        const next = prev.filter((s) => s.id !== id);
        if (activeId === id && next.length > 0) {
          setActiveId(next[next.length - 1].id);
        } else if (next.length === 0) {
          setActiveId(null);
        }
        return next;
      });
    },
    [activeId],
  );

  useEffect(() => {
    const handleExit = (payload: {
      sessionId: string;
      exitCode: number;
    }) => {
      setSessions((prev) => {
        const next = prev.filter(
          (s) => s.id !== payload.sessionId,
        );
        if (activeId === payload.sessionId && next.length > 0) {
          setActiveId(next[next.length - 1].id);
        } else if (next.length === 0) {
          setActiveId(null);
        }
        return next;
      });
    };
    window.api.onPtyExit(handleExit);
    return () => window.api.offPtyExit(handleExit);
  }, [activeId]);

  const pendingTab = useRef<Promise<Session> | null>(null);

  const ensureTab = useCallback(async (): Promise<Session> => {
    const id = activeIdRef.current;
    const found = id
      ? sessionsRef.current.find((s) => s.id === id)
      : null;
    if (found) return found;

    if (!pendingTab.current) {
      pendingTab.current = (async () => {
        const session = await createTab();
        await new Promise<void>((resolve) => {
          const onData = (p: {
            sessionId: string;
            data: string;
          }) => {
            if (p.sessionId === session.id) {
              window.api.offPtyData(onData);
              resolve();
            }
          };
          window.api.onPtyData(onData);
        });
        return session;
      })();
    }
    return pendingTab.current;
  }, [createTab]);

  useEffect(() => {
    if (activeId) pendingTab.current = null;
  }, [activeId]);

  useEffect(() => {
    window.api.getPref("cursorBlink").then((val) => {
      if (typeof val === "boolean") setCursorBlink(val);
    }).catch(() => {});
    window.api.getPref("scrollback").then((val) => {
      if (typeof val === "number" && val >= 1000 && val <= 200000) setScrollback(val);
    }).catch(() => {});
  }, []);

  const didInit = useRef(false);
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    ensureTab();
    window.api.getConfig().then((cfg) => {
      const wp = cfg?.workspaces?.[cfg?.active_workspace];
      if (wp) setWorkspacePath(wp);
    });
  }, [ensureTab]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.metaKey) return;

      if (e.key === "t") {
        e.preventDefault();
        createTab();
        return;
      }

      if (e.key === "w") {
        e.preventDefault();
        const id = activeIdRef.current;
        if (id) closeTab(id);
        return;
      }

      const num = parseInt(e.key, 10);
      if (num >= 1 && num <= 9) {
        e.preventDefault();
        const idx = num - 1;
        const target = sessionsRef.current[idx];
        if (target) setActiveId(target.id);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [createTab, closeTab]);

  const cdBusy = useRef(false);
  useEffect(() => {
    const handleCdTo = async (path: string) => {
      if (cdBusy.current) return;
      cdBusy.current = true;
      try {
        const session = await ensureTab();

        const escaped = path.replace(/'/g, "'\\''");
        const cmd = `cd '${escaped}'`;

        const fg = await window.api.ptyForegroundProcess(session.id);
        const isShellIdle = fg === session.shellName;

        const text = isShellIdle ? `${cmd}\r` : `!${cmd}\r`;
        for (const ch of text) {
          window.api.ptyWrite(session.id, ch);
          await new Promise((r) => setTimeout(r, 5));
        }
      } finally {
        cdBusy.current = false;
      }
    };
    window.api.onCdTo(handleCdTo);
    return () => window.api.offCdTo(handleCdTo);
  }, [ensureTab]);

  const lastRunMs = useRef(0);
  const handleRunInTerminal = useCallback(
    async (command: string) => {
      const now = Date.now();
      if (now - lastRunMs.current < 50) return;
      lastRunMs.current = now;

      const session = await createTab();

      const alive = () =>
        sessionsRef.current.some((s) => s.id === session.id);

      // Wait for shell to be ready, abort if tab is closed
      const ready = await new Promise<boolean>((resolve) => {
        const onData = (p: {
          sessionId: string;
          data: string;
        }) => {
          if (p.sessionId === session.id) {
            cleanup();
            resolve(true);
          }
        };
        const onExit = (p: {
          sessionId: string;
          exitCode: number;
        }) => {
          if (p.sessionId === session.id) {
            cleanup();
            resolve(false);
          }
        };
        const cleanup = () => {
          window.api.offPtyData(onData);
          window.api.offPtyExit(onExit);
        };
        window.api.onPtyData(onData);
        window.api.onPtyExit(onExit);
      });

      if (!ready) return;

      // Type command as-is, aborting if tab is closed mid-type
      const fullCmd = `${command}\r`;
      for (const ch of fullCmd) {
        if (!alive()) return;
        window.api.ptyWrite(session.id, ch);
        await new Promise((r) => setTimeout(r, 5));
      }
    },
    [createTab],
  );

  useEffect(() => {
    window.api.onRunInTerminal(handleRunInTerminal);
    return () => window.api.offRunInTerminal(handleRunInTerminal);
  }, [handleRunInTerminal]);

  useEffect(() => {
    return window.api.onFocusTab((ptySessionId: string) => {
      const found = sessionsRef.current.find(
        (s) => s.id === ptySessionId,
      );
      if (found) {
        setActiveId(found.id);
      }
    });
  }, []);

  return (
    <div className="terminal-app">
      <div className="tab-bar">
        {sessions.map((s) => (
          <div
            key={s.id}
            className={`tab ${s.id === activeId ? "active" : ""}`}
            onClick={() => setActiveId(s.id)}
          >
            <span className="tab-title">{s.title}</span>
            <button
              className="tab-close"
              onClick={(e) => {
                e.stopPropagation();
                closeTab(s.id);
              }}
            >
              &times;
            </button>
          </div>
        ))}
        <button className="tab-new" onClick={createTab}>
          +
        </button>
      </div>
      <div className="terminal-container">
        {sessions.map((s) => (
          <TerminalTab
            key={s.id}
            sessionId={s.id}
            visible={s.id === activeId}
            cursorBlink={cursorBlink}
            scrollback={scrollback}
          />
        ))}
      </div>
    </div>
  );
}

export default App;
