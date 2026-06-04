import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "@collab/theme/styles.css";
import "@collab/components/SourceControl/SourceControl.css";
import { SourceControlView } from "@collab/components/SourceControl";
import { DiffEditorView } from "@collab/components/DiffEditorView";
import "@collab/components/DiffEditorView/DiffEditorView.css";
import { installMockApi, rpc } from "./mock-api";
import { GitSettingsPane } from "./GitSettingsPane";

document.documentElement.classList.add("dark");
document.documentElement.setAttribute("data-theme", "dark");

const params = new URLSearchParams(window.location.search);
const scene = params.get("scene") ?? "scm";
const workspacePath = params.get("workspace") ?? "";
document.body.dataset.scene = scene;

if (workspacePath) {
  installMockApi(workspacePath);
}

function ScmPanel() {
  return (
    <div className="scm-container" style={{ height: "100vh" }}>
      <SourceControlView
        workspacePath={workspacePath}
        isActive
        onSelectFile={() => {}}
      />
    </div>
  );
}

function ViewerDiffScene() {
  const [original, setOriginal] = useState("base\n");
  const [modified, setModified] = useState("base\n<<<<<<< HEAD\n");

  useEffect(() => {
    if (!workspacePath) return;
    void (async () => {
      try {
        const left = await rpc<string>(
          "gitShowFile",
          workspacePath,
          "HEAD",
          "base.txt",
        );
        const right = await rpc<string>(
          "gitDiff",
          workspacePath,
          "base.txt",
          false,
        );
        setOriginal(left || "base\n");
        setModified(right || left);
      } catch {
        setOriginal("base\n");
        setModified(
          "base\n<<<<<<< HEAD\nmain line\n=======\nfeature line\n>>>>>>> feature\n",
        );
      }
    })();
  }, []);

  const header = "base.txt (HEAD ↔ Working Tree)";

  return (
    <div
      className="viewer-diff-scene"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "var(--background)",
        color: "var(--foreground)",
      }}
    >
      <div
        style={{
          padding: "8px 12px",
          fontSize: 12,
          fontFamily: "IBM Plex Mono, monospace",
          borderBottom:
            "1px solid color-mix(in srgb, var(--border) 50%, transparent)",
        }}
      >
        {header}
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <DiffEditorView
          filePath="base.txt"
          original={original}
          modified={modified}
          theme="dark"
          readOnly
        />
      </div>
    </div>
  );
}

function App() {
  if (scene === "settings-git") {
    return <GitSettingsPane workspacePath={workspacePath} />;
  }
  if (scene === "viewer-diff") {
    return <ViewerDiffScene />;
  }
  return <ScmPanel />;
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Signal Playwright that async UI (git status) has settled.
declare global {
  interface Window {
    __scmHarnessReady?: boolean;
  }
}

window.__scmHarnessReady = false;
setTimeout(() => {
  window.__scmHarnessReady = true;
}, 1200);
