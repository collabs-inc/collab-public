import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { initDarkMode } from "@collab/shared/dark-mode";
import "@collab/shared/styles/Theme.css";
import { SourceControlView } from "@collab/components/SourceControl";
import "@collab/components/SourceControl/SourceControl.css";
import { DiffEditorView } from "@collab/components/DiffEditorView";
import "@collab/components/DiffEditorView/DiffEditorView.css";
import "./screenshot.css";
import fixtureData from "./fixture-data.json";
import { installMockApi } from "./mock-api";
import { SettingsGitPane } from "./SettingsGitPane";
import type { FixtureData } from "./types";

initDarkMode();

const params = new URLSearchParams(window.location.search);
const view = params.get("view") ?? "scm";
const scenario = params.get("scenario") ?? "dirty-worktree";
const data = fixtureData as FixtureData;

function App() {
  if (view === "settings-git") {
    const cfg = data.settingsGit as FixtureData["settingsGit"];
    return (
      <div
        id="screenshot-root"
        className="screenshot-frame settings-frame"
      >
        <SettingsGitPane cfg={cfg} />
      </div>
    );
  }

  if (view === "monaco-diff") {
    const diff = data.monacoDiff;
    return (
      <div id="screenshot-root" className="screenshot-frame diff-frame">
        <div className="diff-header-bar">
          <span className="diff-title">{diff.filePath.split("/").pop()}</span>
          <span className="diff-refs">HEAD ↔ Working Tree</span>
        </div>
        <DiffEditorView
          filePath={diff.filePath}
          original={diff.original}
          modified={diff.modified}
          readOnly
          theme="dark"
        />
      </div>
    );
  }

  const payload = installMockApi(data, scenario);
  return (
    <div id="screenshot-root" className="screenshot-frame scm-frame">
      <SourceControlView
        workspacePath={payload.workspacePath}
        isActive
        onSelectFile={() => {}}
      />
    </div>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
