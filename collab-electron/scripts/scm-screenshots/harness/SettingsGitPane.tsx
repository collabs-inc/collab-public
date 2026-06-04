/** Minimal read-only Git settings pane for screenshots (matches settings window). */
export function SettingsGitPane({
  cfg,
}: {
  cfg: {
    userName: string;
    userEmail: string;
    credentialHelper: string;
    gpgSign: boolean;
  };
}) {
  return (
    <div className="settings-git-screenshot space-y-6 p-6">
      <div className="space-y-1">
        <h2 className="text-base font-semibold">Git</h2>
        <p className="text-sm text-muted-foreground">
          Read-only view of your system git configuration. Manage credentials
          with your OS credential manager or{" "}
          <code className="text-xs">git config</code> in a terminal.
        </p>
      </div>
      <dl className="space-y-3 text-sm font-mono">
        <div>
          <dt className="text-muted-foreground">user.name</dt>
          <dd>{cfg.userName || "—"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">user.email</dt>
          <dd>{cfg.userEmail || "—"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">credential.helper</dt>
          <dd>{cfg.credentialHelper || "—"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">commit.gpgsign</dt>
          <dd>{cfg.gpgSign ? "true" : "false"}</dd>
        </div>
      </dl>
    </div>
  );
}
