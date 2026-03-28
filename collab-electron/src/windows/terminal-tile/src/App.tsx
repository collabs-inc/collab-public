import { useEffect, useState } from "react";
import { TerminalTab } from "@collab/components/Terminal";

/** Approximate terminal dimensions from the viewport before xterm mounts. */
function estimateTermSize(): { cols: number; rows: number } {
  const CHAR_WIDTH = 7.22; // Menlo 12px on macOS
  const CELL_HEIGHT = 17; // xterm line height at fontSize 12
  const w = document.documentElement.clientWidth;
  const h = document.documentElement.clientHeight;
  return {
    cols: Math.max(80, Math.floor(w / CHAR_WIDTH)),
    rows: Math.max(24, Math.floor(h / CELL_HEIGHT)),
  };
}

function App() {
  const [sessionId, setSessionId] = useState<string | null>(
    null,
  );
  const [exited, setExited] = useState(false);
  const [restored, setRestored] = useState(false);
  const [scrollbackData, setScrollbackData] =
    useState<string | null>(null);
  const [sessionMode, setSessionMode] =
    useState<"tmux" | "sidecar" | undefined>(undefined);
  const [cursorBlink, setCursorBlink] = useState(true);
  const [scrollback, setScrollback] = useState(200000);

  useEffect(() => {
    window.api.getPref("cursorBlink").then((val) => {
      if (typeof val === "boolean") setCursorBlink(val);
    }).catch(() => {});
    window.api.getPref("scrollback").then((val) => {
      if (typeof val === "number" && val >= 1000 && val <= 200000) setScrollback(val);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(
      window.location.search,
    );
    const existingSessionId = params.get("sessionId");
    const isRestored = params.get("restored") === "1";
    const cwd = params.get("cwd") || undefined;

    if (isRestored && existingSessionId) {
      setRestored(true);
      const { cols, rows } = estimateTermSize();

      window.api
        .ptyReconnect(existingSessionId, cols, rows)
        .then((result) => {
          if (result.scrollback) {
            setScrollbackData(result.scrollback);
          }
          if (result.mode) {
            setSessionMode(result.mode);
          }
          setSessionId(existingSessionId);
        })
        .catch(async () => {
          setRestored(false);
          const est = estimateTermSize();
          // Recover the original working directory from session
          // metadata so the fallback session opens in the right place.
          let fallbackCwd = cwd;
          if (!fallbackCwd && existingSessionId) {
            try {
              const meta = await window.api.ptyReadMeta(
                existingSessionId,
              );
              if (meta?.cwd) fallbackCwd = meta.cwd;
            } catch {
              // Metadata unavailable — fall through to default
            }
          }
          window.api
            .ptyCreate(fallbackCwd, est.cols, est.rows)
            .then((result) => {
              setSessionId(result.sessionId);
              window.api.notifyPtySessionId(
                result.sessionId,
              );
            })
            .catch(() => {
              setExited(true);
            });
        });

      return;
    }

    if (existingSessionId) {
      setSessionId(existingSessionId);
      return;
    }

    const { cols, rows } = estimateTermSize();
    window.api
      .ptyCreate(cwd, cols, rows)
      .then((result) => {
        setSessionId(result.sessionId);
        window.api.notifyPtySessionId(result.sessionId);
      })
      .catch(() => {
        setExited(true);
      });
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    const handleExit = (payload: {
      sessionId: string;
      exitCode: number;
    }) => {
      if (payload.sessionId === sessionId) {
        setExited(true);
      }
    };
    window.api.onPtyExit(handleExit);
    return () => window.api.offPtyExit(handleExit);
  }, [sessionId]);

  if (exited) {
    return (
      <div className="terminal-tile-exited">
        Session ended
      </div>
    );
  }

  if (!sessionId) {
    return (
      <div className="terminal-tile-loading">
        Connecting...
      </div>
    );
  }

  return (
    <TerminalTab
      sessionId={sessionId}
      visible={true}
      restored={restored}
      scrollbackData={scrollbackData}
      mode={sessionMode}
      cursorBlink={cursorBlink}
      scrollback={scrollback}
    />
  );
}

export default App;
