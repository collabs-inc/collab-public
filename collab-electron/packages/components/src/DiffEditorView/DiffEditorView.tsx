import { useEffect, useRef } from "react";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import "./DiffEditorView.css";

self.MonacoEnvironment = {
  getWorker() {
    return new editorWorker();
  },
};

function languageFromPath(filePath: string): string {
  const ext = filePath.slice(filePath.lastIndexOf(".") + 1).toLowerCase();
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    json: "json",
    py: "python",
    md: "markdown",
    css: "css",
    html: "html",
    yaml: "yaml",
    yml: "yaml",
    sh: "shell",
  };
  return map[ext] ?? "plaintext";
}

export interface DiffEditorViewProps {
  filePath: string;
  original: string;
  modified: string;
  readOnly?: boolean;
  theme?: "light" | "dark";
  onStageHunk?: (patch: string) => void;
  hunks?: Array<{ index: number; header: string; patch: string }>;
}

export function DiffEditorView({
  filePath,
  original,
  modified,
  readOnly = true,
  theme = "dark",
  onStageHunk,
  hunks,
}: DiffEditorViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const lang = languageFromPath(filePath);
    const originalModel = monaco.editor.createModel(
      original,
      lang,
      monaco.Uri.parse(`git-diff-original://${filePath}`),
    );
    const modifiedModel = monaco.editor.createModel(
      modified,
      lang,
      monaco.Uri.parse(`git-diff-modified://${filePath}`),
    );

    const diffEditor = monaco.editor.createDiffEditor(containerRef.current, {
      readOnly,
      renderSideBySide: true,
      automaticLayout: true,
      theme: theme === "dark" ? "vs-dark" : "vs",
      originalEditable: false,
    });
    diffEditor.setModel({ original: originalModel, modified: modifiedModel });
    editorRef.current = diffEditor;

    return () => {
      diffEditor.dispose();
      originalModel.dispose();
      modifiedModel.dispose();
      editorRef.current = null;
    };
  }, [filePath, original, modified, readOnly, theme]);

  return (
    <div className="diff-editor-root">
      {hunks && hunks.length > 0 && onStageHunk && (
        <div className="diff-editor-hunks">
          {hunks.map((hunk) => (
            <button
              key={hunk.index}
              type="button"
              className="diff-editor-hunk-btn"
              onClick={() => onStageHunk(hunk.patch)}
              title="Stage this hunk"
            >
              Stage hunk {hunk.index + 1}
            </button>
          ))}
        </div>
      )}
      <div ref={containerRef} className="diff-editor-container" />
    </div>
  );
}
