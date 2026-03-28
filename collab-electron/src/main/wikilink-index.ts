import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, extname, join, relative } from "node:path";

const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;

interface FilenameIndex {
  byStem: Map<string, string[]>;
  outgoing: Map<string, Set<string>>;
  incoming: Map<string, Set<string>>;
}

let workspacePath = "";
const index: FilenameIndex = {
  byStem: new Map(),
  outgoing: new Map(),
  incoming: new Map(),
};

const suppressedPaths = new Set<string>();

const pendingUpdates = new Set<string>();
const recentlyDeleted = new Set<string>();
let batchTimer: ReturnType<typeof setTimeout> | null = null;

export function suppressNextUpdate(path: string): void {
  suppressedPaths.add(path);
}

function stemOf(filePath: string): string {
  return basename(filePath, extname(filePath)).toLowerCase();
}

function targetToStem(target: string): string {
  const parts = target.split("/");
  return parts[parts.length - 1].toLowerCase();
}

function extractWikilinks(content: string): string[] {
  const targets: string[] = [];
  let match: RegExpExecArray | null;
  WIKILINK_RE.lastIndex = 0;
  while ((match = WIKILINK_RE.exec(content)) !== null) {
    targets.push(match[1].trim());
  }
  return targets;
}

async function collectMdFiles(
  dirPath: string,
): Promise<string[]> {
  const files: string[] = [];
  let entries;
  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") {
        continue;
      }
      const sub = await collectMdFiles(fullPath);
      files.push(...sub);
    } else if (entry.name.endsWith(".md")) {
      files.push(fullPath);
    }
  }
  return files;
}

function addToStemIndex(filePath: string): void {
  const stem = stemOf(filePath);
  const existing = index.byStem.get(stem);
  if (existing) {
    if (!existing.includes(filePath)) {
      existing.push(filePath);
      existing.sort((a, b) => a.length - b.length);
    }
  } else {
    index.byStem.set(stem, [filePath]);
  }
}

function removeFromStemIndex(filePath: string): void {
  const stem = stemOf(filePath);
  const existing = index.byStem.get(stem);
  if (!existing) return;
  const filtered = existing.filter((p) => p !== filePath);
  if (filtered.length === 0) {
    index.byStem.delete(stem);
  } else {
    index.byStem.set(stem, filtered);
  }
}

function updateLinkMaps(
  filePath: string,
  targets: string[],
): void {
  const oldTargets = index.outgoing.get(filePath);
  if (oldTargets) {
    for (const t of oldTargets) {
      const stem = targetToStem(t);
      const incoming = index.incoming.get(stem);
      if (incoming) {
        incoming.delete(filePath);
        if (incoming.size === 0) index.incoming.delete(stem);
      }
    }
  }

  if (targets.length === 0) {
    index.outgoing.delete(filePath);
    return;
  }

  const targetSet = new Set(targets.map((t) => t.toLowerCase()));
  index.outgoing.set(filePath, targetSet);

  for (const t of targetSet) {
    const stem = targetToStem(t);
    let incoming = index.incoming.get(stem);
    if (!incoming) {
      incoming = new Set();
      index.incoming.set(stem, incoming);
    }
    incoming.add(filePath);
  }
}

export async function buildIndex(
  wsPath: string,
): Promise<void> {
  workspacePath = wsPath;
  index.byStem.clear();
  index.outgoing.clear();
  index.incoming.clear();

  const files = await collectMdFiles(wsPath);

  for (const filePath of files) {
    addToStemIndex(filePath);
  }

  for (const filePath of files) {
    try {
      const content = await readFile(filePath, "utf-8");
      const targets = extractWikilinks(content);
      updateLinkMaps(filePath, targets);
    } catch {
      // Skip unreadable files
    }
  }
}

export async function updateFile(
  filePath: string,
): Promise<void> {
  if (!filePath.endsWith(".md")) return;
  if (suppressedPaths.delete(filePath)) return;

  addToStemIndex(filePath);

  try {
    const content = await readFile(filePath, "utf-8");
    const targets = extractWikilinks(content);
    updateLinkMaps(filePath, targets);
  } catch {
    updateLinkMaps(filePath, []);
  }
}

export function removeFile(filePath: string): void {
  if (suppressedPaths.delete(filePath)) return;
  recentlyDeleted.add(filePath);
  pendingUpdates.delete(filePath);
  removeFromStemIndex(filePath);
  updateLinkMaps(filePath, []);
}

export async function batchUpdate(paths: string[]): Promise<void> {
  for (const p of paths) pendingUpdates.add(p);

  if (batchTimer) clearTimeout(batchTimer);
  batchTimer = setTimeout(() => flushUpdates(), 500);
}

async function flushUpdates(): Promise<void> {
  const paths = Array.from(pendingUpdates).filter(p => !recentlyDeleted.has(p));
  pendingUpdates.clear();
  recentlyDeleted.clear();
  batchTimer = null;

  for (let i = 0; i < paths.length; i += 20) {
    const chunk = paths.slice(i, i + 20);
    const results = await Promise.allSettled(
      chunk.map(p => updateFile(p))
    );

    for (let j = 0; j < results.length; j++) {
      if (results[j].status === "rejected") {
        console.warn(`Wikilink index update failed for ${chunk[j]}:`, (results[j] as PromiseRejectedResult).reason);
      }
    }
  }
}

export function resolve(
  target: string,
): string | null {
  const lower = target.toLowerCase();

  // Try exact stem match first
  const paths = index.byStem.get(lower);
  if (paths && paths.length > 0) {
    return paths[0];
  }

  // Try suffix match for paths like "archive/cool-article"
  if (lower.includes("/")) {
    const suffix = lower.replace(/^\/+/, "");
    for (const [, filePaths] of index.byStem) {
      for (const fp of filePaths) {
        const rel = relative(workspacePath, fp)
          .toLowerCase()
          .replace(/\.md$/, "");
        if (rel === suffix || rel.endsWith(`/${suffix}`)) {
          return fp;
        }
      }
    }
  }

  return null;
}

export interface WikilinkSuggestion {
  stem: string;
  path: string;
  ambiguous: boolean;
}

export function suggest(
  partial: string,
): WikilinkSuggestion[] {
  if (partial.length === 0) {
    const all: Array<WikilinkSuggestion & { rank: number }> = [];
    for (const [stem, paths] of index.byStem) {
      const ambiguous = paths.length > 1;
      for (const p of paths) {
        all.push({ stem, path: p, ambiguous, rank: 0 });
      }
    }
    all.sort((a, b) => a.stem.localeCompare(b.stem));
    return all
      .slice(0, 20)
      .map(({ stem, path, ambiguous }) => ({
        stem,
        path,
        ambiguous,
      }));
  }

  const lower = partial.toLowerCase();
  const results: Array<WikilinkSuggestion & { rank: number }> =
    [];

  for (const [stem, paths] of index.byStem) {
    if (paths.length === 0) continue;
    let rank = -1;
    if (stem.startsWith(lower)) {
      rank = 0;
    } else if (stem.includes(lower)) {
      rank = 1;
    }
    if (rank >= 0) {
      const ambiguous = paths.length > 1;
      for (const p of paths) {
        results.push({ stem, path: p, ambiguous, rank });
      }
    }
  }

  results.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    return a.stem.localeCompare(b.stem);
  });

  return results
    .slice(0, 20)
    .map(({ stem, path, ambiguous }) => ({
      stem,
      path,
      ambiguous,
    }));
}

function extractContext(
  content: string,
  target: string,
): string {
  const lower = target.toLowerCase();
  const re = new RegExp(
    `\\[\\[[^\\]]*${escapeRegExp(lower)}[^\\]]*\\]\\]`,
    "i",
  );
  const match = re.exec(content);
  if (!match) return "";

  const idx = match.index;
  const matchLen = match[0].length;
  const start = Math.max(0, idx - 80);
  const end = Math.min(content.length, idx + matchLen + 80);
  let snippet = content.slice(start, end).trim();

  if (start > 0) snippet = `...${snippet}`;
  if (end < content.length) snippet = `${snippet}...`;

  return snippet;
}

export async function backlinksWithContext(
  filePath: string,
): Promise<Array<{ path: string; context: string }>> {
  const stem = stemOf(filePath);
  const sources = index.incoming.get(stem);
  if (!sources || sources.size === 0) return [];

  const results: Array<{ path: string; context: string }> = [];
  for (const sourcePath of sources) {
    try {
      const content = await readFile(sourcePath, "utf-8");
      const context = extractContext(content, stem);
      results.push({ path: sourcePath, context });
    } catch {
      results.push({ path: sourcePath, context: "" });
    }
  }
  return results;
}

export async function handleRename(
  oldPath: string,
  newPath: string,
): Promise<string[]> {
  const oldStem = stemOf(oldPath);
  const newStem = stemOf(newPath);

  // Update the stem index
  removeFromStemIndex(oldPath);
  addToStemIndex(newPath);

  // Transfer outgoing links from old path to new path
  const oldOutgoing = index.outgoing.get(oldPath);
  if (oldOutgoing) {
    index.outgoing.delete(oldPath);
    index.outgoing.set(newPath, oldOutgoing);
    for (const t of oldOutgoing) {
      const inc = index.incoming.get(t);
      if (inc) {
        inc.delete(oldPath);
        inc.add(newPath);
      }
    }
  }

  if (oldStem === newStem) return [];

  // Find all files that link to the old stem and update them
  const sources = index.incoming.get(oldStem);
  if (!sources || sources.size === 0) return [];

  const updatedFiles: string[] = [];
  const pattern = new RegExp(
    `\\[\\[([^\\]]*\\/)?${escapeRegExp(oldStem)}\\]\\]`,
    "gi",
  );
  const newStemDisplay = basename(newPath, extname(newPath));

  for (const sourcePath of sources) {
    try {
      const content = await readFile(sourcePath, "utf-8");
      const updated = content.replace(
        pattern,
        (_match, prefix?: string) =>
          prefix
            ? `[[${prefix}${newStemDisplay}]]`
            : `[[${newStemDisplay}]]`,
      );
      if (updated !== content) {
        suppressNextUpdate(sourcePath);
        await writeFile(sourcePath, updated, "utf-8");
        updatedFiles.push(sourcePath);
        // Re-index this file's outgoing links
        const targets = extractWikilinks(updated);
        updateLinkMaps(sourcePath, targets);
      }
    } catch {
      // Skip files that can't be read/written
    }
  }

  // Move all backlinks from old stem to new stem
  index.incoming.delete(oldStem);
  const newIncoming =
    index.incoming.get(newStem) ?? new Set<string>();
  for (const f of sources) {
    newIncoming.add(f);
  }
  index.incoming.set(newStem, newIncoming);

  return updatedFiles;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
