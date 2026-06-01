import { useEffect, useState } from "react";
import { rpc } from "./mock-api";

interface GitConfig {
  userName: string;
  userEmail: string;
  credentialHelper: string;
  gpgSign: boolean;
}

/** Mirrors Settings → Git pane for screenshots. */
export function GitSettingsPane({
  workspacePath,
}: {
  workspacePath: string;
}) {
  const [cfg, setCfg] = useState<GitConfig | null>(null);

  useEffect(() => {
    if (!workspacePath) return;
    void rpc<GitConfig>("gitConfigDisplay", workspacePath).then(setCfg);
  }, [workspacePath]);

  return (
    <div
      style={{
        fontFamily: "var(--font-sans)",
        background: "var(--background)",
        color: "var(--foreground)",
        height: "100%",
      }}
    >
      <div style={{ padding: 24 }}>
        <div style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 4px" }}>
            Git
          </h2>
          <p
            style={{
              fontSize: 14,
              color: "var(--muted-foreground)",
              margin: 0,
              lineHeight: 1.5,
            }}
          >
            Read-only view of your system git configuration. Manage credentials
            with your OS credential manager or{" "}
            <code style={{ fontSize: 12 }}>git config</code> in a terminal.
          </p>
        </div>
        {cfg ? (
          <dl
            style={{
              fontSize: 14,
              fontFamily: "var(--font-mono), 'IBM Plex Mono', monospace",
            }}
          >
            <div style={{ marginBottom: 12 }}>
              <dt style={{ color: "var(--muted-foreground)", marginBottom: 2 }}>
                user.name
              </dt>
              <dd style={{ margin: 0 }}>{cfg.userName || "—"}</dd>
            </div>
            <div style={{ marginBottom: 12 }}>
              <dt style={{ color: "var(--muted-foreground)", marginBottom: 2 }}>
                user.email
              </dt>
              <dd style={{ margin: 0 }}>{cfg.userEmail || "—"}</dd>
            </div>
            <div style={{ marginBottom: 12 }}>
              <dt style={{ color: "var(--muted-foreground)", marginBottom: 2 }}>
                credential.helper
              </dt>
              <dd style={{ margin: 0 }}>{cfg.credentialHelper || "—"}</dd>
            </div>
            <div>
              <dt style={{ color: "var(--muted-foreground)", marginBottom: 2 }}>
                commit.gpgsign
              </dt>
              <dd style={{ margin: 0 }}>{cfg.gpgSign ? "true" : "false"}</dd>
            </div>
          </dl>
        ) : (
          <p style={{ fontSize: 14, color: "var(--muted-foreground)" }}>
            Loading…
          </p>
        )}
      </div>
    </div>
  );
}
