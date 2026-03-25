import { readdir, readFile } from "node:fs/promises";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import type { SyntaxNodeRef } from "@lezer/common";
import { parser as pythonParser } from "@lezer/python";
// dependency-cruiser is ESM-only; use dynamic import() for CJS compat.
type ICruiseOptions = any;
type IResolveOptions = any;
let _cruise: typeof import("dependency-cruiser").cruise | null = null;
let _extractTSConfig: any = null;

async function getCruise() {
  if (!_cruise) {
    const mod = await import("dependency-cruiser");
    _cruise = mod.cruise;
  }
  return _cruise;
}

async function getExtractTSConfig() {
  if (!_extractTSConfig) {
    const mod = await import("dependency-cruiser/config-utl/extract-ts-config");
    _extractTSConfig = mod.default;
  }
  return _extractTSConfig;
}
import { createFileFilter, type FileFilter } from "./file-filter";
import { shouldIncludeEntryWithContent } from "./files";

interface WorkspaceGraphNode {
  id: string;
  title: string;
  path: string;
  nodeType: "file" | "code";
  weight: number;
}

interface WorkspaceGraphLink {
  source: string;
  target: string;
  linkType: "wikilink" | "import";
}

interface WorkspaceGraphData {
  nodes: WorkspaceGraphNode[];
  links: WorkspaceGraphLink[];
}

const WIKILINK_PATTERN = /\[\[([^\]]+)\]\]/g;

const JS_TS_CODE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
]);
const PYTHON_CODE_EXTENSIONS = new Set([
  ".py",
  ".pyi",
]);
const CODE_EXTENSIONS = new Set([
  ...Array.from(JS_TS_CODE_EXTENSIONS),
  ...Array.from(PYTHON_CODE_EXTENSIONS),
]);
const EXTRA_IMPORT_SCAN_EXTENSIONS = [".css", ".json"];
const CONFIG_NAME_PATTERN =
  /^(?:ts|js)config(?:\.[^.]+)*\.json$/;
const CRUISE_IGNORE_PATTERN =
  "(^|/)(node_modules|dist|build|out)/";
const CONFIG_SEARCH_IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "out",
]);
const PYTHON_SEARCH_IGNORED_DIRS = new Set([
  ...Array.from(CONFIG_SEARCH_IGNORED_DIRS),
  "__pycache__",
  ".venv",
  "venv",
  "site-packages",
]);
const PYTHON_CONFIG_FILE_NAMES = new Set([
  "pyproject.toml",
  "setup.cfg",
  "setup.py",
]);
const CONFIG_NAME_PRIORITIES = new Map([
  ["tsconfig.web.json", 40],
  ["tsconfig.app.json", 30],
  ["tsconfig.node.json", 20],
  ["tsconfig.json", 10],
  ["jsconfig.json", 5],
]);

interface CollectedFile {
  id: string;
  title: string;
  path: string;
  content: string | null;
  nodeType: "file" | "code";
  analysisType: "markdown" | "code" | null;
}

interface ConfigCandidate {
  configPath: string;
  configDir: string;
  parsed: ReturnType<typeof extractTSConfig>;
  score: number;
}

interface DependencyCruiserContext {
  alias: Record<string, string>;
  tsConfigFileName?: string;
  tsConfig?: ReturnType<typeof extractTSConfig>;
}

type DependencyCruiserResolveOptions =
  Partial<IResolveOptions> & {
    tsConfig?: string;
  };

interface PythonRootCandidate {
  path: string;
  priority: number;
}

interface PythonModuleEntry {
  fileId: string;
  filePath: string;
  rootPath: string;
  moduleName: string;
  isPackageInit: boolean;
  isStub: boolean;
}

interface PythonFileInfo extends PythonModuleEntry {
  packageName: string;
}

interface PythonImportContext {
  fileInfoById: Map<string, PythonFileInfo>;
  moduleEntriesByName: Map<
    string,
    PythonModuleEntry[]
  >;
}

interface PythonImportStatement {
  kind: "import" | "from";
  moduleNames?: string[];
  moduleName?: string;
  relativeLevel?: number;
  importedNames?: string[];
}

export async function buildWorkspaceGraph(
  workspacePath: string,
  filter: FileFilter | null = null,
): Promise<WorkspaceGraphData> {
  const activeFilter =
    filter ?? await createFileFilter(workspacePath);
  const files = await collectFiles(
    workspacePath,
    workspacePath,
    activeFilter,
  );

  const mdFiles = files.filter(
    (
      f,
    ): f is CollectedFile & {
      analysisType: "markdown";
      content: string;
    } => f.analysisType === "markdown" && f.content !== null,
  );
  const codeFiles = files.filter(
    (
      f,
    ): f is CollectedFile & {
      analysisType: "code";
    } => f.analysisType === "code",
  );

  const nodes: WorkspaceGraphNode[] = files.map((f) => ({
    id: f.id,
    title: f.title,
    path: f.path,
    nodeType: f.nodeType,
    weight: f.content?.length ?? 0,
  }));

  const nodeIds = new Set(nodes.map((n) => n.id));
  const links: WorkspaceGraphLink[] = [];
  const seenLinks = new Set<string>();

  function addLink(
    source: string,
    target: string,
    linkType: "wikilink" | "import",
  ): void {
    if (!nodeIds.has(target)) return;
    if (target === source) return;
    const key = `${source}->${target}`;
    if (seenLinks.has(key)) return;
    seenLinks.add(key);
    links.push({ source, target, linkType });
  }

  // Wikilinks from markdown files
  const stemToId = new Map<string, string>();
  const ambiguousStems = new Set<string>();
  for (const file of mdFiles) {
    const stem = basename(file.id, extname(file.id));
    if (stemToId.has(stem)) {
      ambiguousStems.add(stem);
    } else {
      stemToId.set(stem, file.id);
    }
  }

  for (const file of mdFiles) {
    const matches = file.content.matchAll(WIKILINK_PATTERN);
    for (const match of matches) {
      const rawTarget = match[1];
      if (!rawTarget) continue;
      const target = rawTarget.trim();
      const targetId = stemToId.get(target);
      if (!targetId || ambiguousStems.has(target)) continue;
      addLink(file.id, targetId, "wikilink");
    }
  }

  // Imports from code files
  let importLinks: Array<{ source: string; target: string }> =
    [];
  try {
    importLinks = await buildCodeImportLinks(
      codeFiles,
      workspacePath,
      nodeIds,
    );
  } catch (error) {
    console.warn(
      "Failed to build code import links:",
      error,
    );
  }

  for (const link of importLinks) {
    addLink(link.source, link.target, "import");
  }

  return { nodes, links };
}

async function collectFiles(
  dirPath: string,
  rootPath: string,
  filter: FileFilter,
): Promise<CollectedFile[]> {
  let entries;
  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const results: CollectedFile[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }

    const fullPath = join(dirPath, entry.name);
    const relPath = relative(rootPath, fullPath);

    if (entry.isDirectory()) {
      if (!(await shouldIncludeEntryWithContent(dirPath, entry, filter, rootPath))) {
        continue;
      }
      const children = await collectFiles(fullPath, rootPath, filter);
      results.push(...children);
      continue;
    }

    if (!(await shouldIncludeEntryWithContent(dirPath, entry, filter, rootPath))) {
      continue;
    }

    const ext = extname(entry.name);
    const isMarkdown = ext === ".md";
    const isCode = CODE_EXTENSIONS.has(ext);
    const analysisType = isMarkdown
      ? ("markdown" as const)
      : isCode
        ? ("code" as const)
        : null;

    let title = entry.name;
    let content: string | null = null;

    if (isMarkdown) {
      try {
        content = await readFile(fullPath, "utf-8");
        const titleMatch = content.match(
          /^---\n[\s\S]*?title:\s*["']?(.+?)["']?\s*\n[\s\S]*?---/,
        );
        if (titleMatch?.[1]) {
          title = titleMatch[1];
        }
      } catch {
        // Keep the node but skip title/link extraction if the file isn't UTF-8 readable.
      }
    }

    results.push({
      id: relPath,
      title,
      path: fullPath,
      content,
      nodeType: isCode ? "code" : "file",
      analysisType,
    });
  }

  return results;
}

async function buildCodeImportLinks(
  codeFiles: Array<
    CollectedFile & {
      analysisType: "code";
    }
  >,
  workspacePath: string,
  nodeIds: Set<string>,
): Promise<Array<{ source: string; target: string }>> {
  if (codeFiles.length === 0) {
    return [];
  }

  const jsTsFiles = codeFiles.filter((file) =>
    JS_TS_CODE_EXTENSIONS.has(
      extname(file.path),
    ),
  );
  const pythonFiles = codeFiles.filter((file) =>
    PYTHON_CODE_EXTENSIONS.has(
      extname(file.path),
    ),
  );

  const results = await Promise.allSettled([
    buildJavaScriptTypeScriptImportLinks(
      jsTsFiles,
      workspacePath,
      nodeIds,
    ),
    buildPythonImportLinks(
      pythonFiles,
      workspacePath,
      nodeIds,
    ),
  ]);

  const links: Array<{
    source: string;
    target: string;
  }> = [];
  const [jsTsResult, pythonResult] = results;

  if (jsTsResult?.status === "fulfilled") {
    links.push(...jsTsResult.value);
  } else if (jsTsResult) {
    console.warn(
      "Failed to build JS/TS import links:",
      jsTsResult.reason,
    );
  }

  if (pythonResult?.status === "fulfilled") {
    links.push(...pythonResult.value);
  } else if (pythonResult) {
    console.warn(
      "Failed to build Python import links:",
      pythonResult.reason,
    );
  }

  return links;
}

async function buildJavaScriptTypeScriptImportLinks(
  codeFiles: Array<
    CollectedFile & {
      analysisType: "code";
    }
  >,
  workspacePath: string,
  nodeIds: Set<string>,
): Promise<Array<{ source: string; target: string }>> {
  if (codeFiles.length === 0) {
    return [];
  }

  const links: Array<{
    source: string;
    target: string;
  }> = [];
  const seenLinks = new Set<string>();
  const codeIds = new Set(
    codeFiles.map((file) => file.id),
  );
  const groups =
    await groupCodeFilesByCruiserContext(
      codeFiles,
      workspacePath,
    );

  for (const group of groups) {
    const cruiseOptions: ICruiseOptions = {
      baseDir: workspacePath,
      doNotFollow: CRUISE_IGNORE_PATTERN,
      exclude: CRUISE_IGNORE_PATTERN,
      tsPreCompilationDeps: true,
      extraExtensionsToScan:
        EXTRA_IMPORT_SCAN_EXTENSIONS,
    };
    if (group.context.tsConfigFileName) {
      cruiseOptions.tsConfig = {
        fileName: group.context.tsConfigFileName,
      };
    }

    const resolveOptions: DependencyCruiserResolveOptions = {
      extensions: [
        ...Array.from(CODE_EXTENSIONS),
        ...EXTRA_IMPORT_SCAN_EXTENSIONS,
      ],
      conditionNames: [
        "import",
        "module",
        "require",
        "default",
        "node",
        "browser",
      ],
      exportsFields: ["exports"],
      mainFields: ["module", "main"],
    };
    if (group.context.tsConfigFileName) {
      resolveOptions.tsConfig =
        group.context.tsConfigFileName;
    }
    if (
      Object.keys(group.context.alias).length > 0
    ) {
      resolveOptions.alias = group.context.alias;
    }

    const cruise = await getCruise();
    const reporterOutput = await cruise(
      group.files.map((file) => file.id),
      cruiseOptions,
      resolveOptions,
      group.context.tsConfig
        ? {
            tsConfig: group.context.tsConfig,
          }
        : undefined,
    );

    const cruiseResult = reporterOutput.output;
    if (typeof cruiseResult === "string") {
      continue;
    }

    for (const module of cruiseResult.modules) {
      const source = normalizeCruiserPath(
        module.source,
        workspacePath,
      );
      if (!source) {
        continue;
      }
      if (!codeIds.has(source)) {
        continue;
      }

      for (const dependency of module.dependencies) {
        if (dependency.couldNotResolve) {
          continue;
        }

        const target = normalizeCruiserPath(
          dependency.resolved,
          workspacePath,
        );
        if (
          !target ||
          !nodeIds.has(target) ||
          target === source
        ) {
          continue;
        }

        const key = `${source}->${target}`;
        if (seenLinks.has(key)) {
          continue;
        }
        seenLinks.add(key);
        links.push({ source, target });
      }
    }
  }

  return links;
}

async function buildPythonImportLinks(
  pythonFiles: Array<
    CollectedFile & {
      analysisType: "code";
    }
  >,
  workspacePath: string,
  nodeIds: Set<string>,
): Promise<Array<{ source: string; target: string }>> {
  if (pythonFiles.length === 0) {
    return [];
  }

  const context =
    await buildPythonImportContext(
      pythonFiles,
      workspacePath,
    );
  const links: Array<{
    source: string;
    target: string;
  }> = [];
  const seenLinks = new Set<string>();

  for (const file of pythonFiles) {
    const fileInfo = context.fileInfoById.get(
      file.id,
    );
    if (!fileInfo) {
      continue;
    }

    let content: string;
    try {
      content = await readFile(file.path, "utf-8");
    } catch {
      continue;
    }

    const statements =
      extractPythonImportStatements(content);
    for (const statement of statements) {
      const targets = resolvePythonImportTargets(
        statement,
        fileInfo,
        context,
      );
      for (const target of targets) {
        if (
          !nodeIds.has(target) ||
          target === file.id
        ) {
          continue;
        }

        const key = `${file.id}->${target}`;
        if (seenLinks.has(key)) {
          continue;
        }
        seenLinks.add(key);
        links.push({
          source: file.id,
          target,
        });
      }
    }
  }

  return links;
}

async function buildPythonImportContext(
  pythonFiles: Array<
    CollectedFile & {
      analysisType: "code";
    }
  >,
  workspacePath: string,
): Promise<PythonImportContext> {
  const roots = await listPythonRoots(
    workspacePath,
    pythonFiles,
  );
  const fileInfoById = new Map<
    string,
    PythonFileInfo
  >();
  const moduleEntriesByName = new Map<
    string,
    PythonModuleEntry[]
  >();

  for (const file of pythonFiles) {
    const fileInfo = createPythonFileInfo(
      file,
      roots,
    );
    if (!fileInfo) {
      continue;
    }

    fileInfoById.set(file.id, fileInfo);
    if (!fileInfo.moduleName) {
      continue;
    }

    const entries =
      moduleEntriesByName.get(
        fileInfo.moduleName,
      ) ?? [];
    entries.push(fileInfo);
    moduleEntriesByName.set(
      fileInfo.moduleName,
      entries,
    );
  }

  return {
    fileInfoById,
    moduleEntriesByName,
  };
}

async function listPythonRoots(
  workspacePath: string,
  pythonFiles: Array<
    CollectedFile & {
      analysisType: "code";
    }
  >,
): Promise<PythonRootCandidate[]> {
  const roots = new Map<string, number>();
  addPythonRootCandidate(
    roots,
    workspacePath,
    0,
  );

  for (const file of pythonFiles) {
    for (const dirPath of listAncestorPaths(
      file.path,
      workspacePath,
    )) {
      if (basename(dirPath) === "src") {
        addPythonRootCandidate(
          roots,
          dirPath,
          50,
        );
      }
    }
  }

  const configPaths =
    await listPythonConfigPaths(workspacePath);
  for (const configPath of configPaths) {
    const configDir = dirname(configPath);
    addPythonRootCandidate(
      roots,
      configDir,
      100,
    );

    try {
      const content = await readFile(
        configPath,
        "utf-8",
      );
      for (const rootPath of extractPythonPackageRoots(
        configDir,
        content,
      )) {
        addPythonRootCandidate(
          roots,
          rootPath,
          200,
        );
      }
    } catch {
      // Ignore unreadable package configs and fall back to workspace/src heuristics.
    }

    const srcPath = join(configDir, "src");
    if (
      pythonFiles.some((file) =>
        isPathWithinDirectory(
          file.path,
          srcPath,
        ),
      )
    ) {
      addPythonRootCandidate(
        roots,
        srcPath,
        150,
      );
    }
  }

  return Array.from(roots.entries())
    .map(([path, priority]) => ({
      path,
      priority,
    }))
    .sort(comparePythonRoots);
}

async function listPythonConfigPaths(
  workspacePath: string,
): Promise<string[]> {
  const configPaths: string[] = [];

  await collectPythonConfigPaths(
    workspacePath,
    configPaths,
  );

  return configPaths;
}

async function collectPythonConfigPaths(
  dirPath: string,
  configPaths: string[],
): Promise<void> {
  let entries;
  try {
    entries = await readdir(dirPath, {
      withFileTypes: true,
    });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (
        PYTHON_SEARCH_IGNORED_DIRS.has(
          entry.name,
        )
      ) {
        continue;
      }
      await collectPythonConfigPaths(
        fullPath,
        configPaths,
      );
      continue;
    }

    if (
      entry.isFile() &&
      PYTHON_CONFIG_FILE_NAMES.has(
        entry.name,
      )
    ) {
      configPaths.push(fullPath);
    }
  }
}

function addPythonRootCandidate(
  roots: Map<string, number>,
  path: string,
  priority: number,
): void {
  const existing = roots.get(path);
  if (
    existing === undefined ||
    priority > existing
  ) {
    roots.set(path, priority);
  }
}

function comparePythonRoots(
  a: PythonRootCandidate,
  b: PythonRootCandidate,
): number {
  return (
    b.priority - a.priority ||
    b.path.length - a.path.length
  );
}

function listAncestorPaths(
  filePath: string,
  workspacePath: string,
): string[] {
  const ancestors: string[] = [];
  let currentPath = dirname(filePath);

  while (
    isPathWithinDirectory(
      currentPath,
      workspacePath,
    )
  ) {
    ancestors.push(currentPath);
    if (currentPath === workspacePath) {
      break;
    }
    const parentPath = dirname(currentPath);
    if (parentPath === currentPath) {
      break;
    }
    currentPath = parentPath;
  }

  return ancestors;
}

function extractPythonPackageRoots(
  configDir: string,
  content: string,
): string[] {
  const roots = new Set<string>();
  const addRoot = (
    rawPath: string | undefined,
  ): void => {
    const candidate =
      normalizePythonRootPath(rawPath);
    if (!candidate) {
      return;
    }
    roots.add(resolve(configDir, candidate));
  };

  for (const match of content.matchAll(
    /\bfrom\s*=\s*["']([^"']+)["']/g,
  )) {
    addRoot(match[1]);
  }
  for (const match of content.matchAll(
    /\bwhere\s*=\s*["']([^"']+)["']/g,
  )) {
    addRoot(match[1]);
  }
  for (const match of content.matchAll(
    /\bwhere\s*=\s*\[([^\]]+)\]/g,
  )) {
    const arrayContent = match[1];
    if (!arrayContent) {
      continue;
    }
    for (const quotedPath of arrayContent.matchAll(
      /["']([^"']+)["']/g,
    )) {
      addRoot(quotedPath[1]);
    }
  }
  for (const match of content.matchAll(
    /\bfind(?:_namespace)?_packages\s*\(\s*where\s*=\s*["']([^"']+)["']/g,
  )) {
    addRoot(match[1]);
  }
  for (const match of content.matchAll(
    /\bpackage[-_]dir\s*=\s*\{([\s\S]*?)\}/g,
  )) {
    const objectContent = match[1];
    if (!objectContent) {
      continue;
    }
    for (const valueMatch of objectContent.matchAll(
      /["']{0,1}\s*["']{0,1}\s*[:=]\s*["']([^"']+)["']/g,
    )) {
      addRoot(valueMatch[1]);
    }
  }
  for (const match of content.matchAll(
    /\bpackage_dir\s*=\s*(?:\r?\n[ \t]+=\s*([^\n#]+))/g,
  )) {
    addRoot(match[1]);
  }

  return Array.from(roots);
}

function normalizePythonRootPath(
  rawPath: string | undefined,
): string | null {
  if (!rawPath) {
    return null;
  }

  const candidate = rawPath.trim();
  if (
    candidate.length === 0 ||
    candidate === "."
  ) {
    return null;
  }

  return candidate;
}

function createPythonFileInfo(
  file: CollectedFile & {
    analysisType: "code";
  },
  roots: PythonRootCandidate[],
): PythonFileInfo | null {
  const root = roots.find((candidate) =>
    isPathWithinDirectory(
      file.path,
      candidate.path,
    ),
  );
  if (!root) {
    return null;
  }

  const relativePath = relative(
    root.path,
    file.path,
  ).replaceAll("\\", "/");
  if (
    relativePath.length === 0 ||
    relativePath.startsWith("../") ||
    isAbsolute(relativePath)
  ) {
    return null;
  }

  const extension = extname(relativePath);
  const pathWithoutExtension =
    relativePath.slice(
      0,
      -extension.length,
    );
  const isPackageInit =
    basename(pathWithoutExtension) ===
    "__init__";
  const moduleName = (
    isPackageInit
      ? dirname(pathWithoutExtension)
      : pathWithoutExtension
  )
    .replaceAll("/", ".")
    .replace(/^\.$/, "");

  return {
    fileId: file.id,
    filePath: file.path,
    rootPath: root.path,
    moduleName,
    packageName: isPackageInit
      ? moduleName
      : getParentModuleName(moduleName),
    isPackageInit,
    isStub: extension === ".pyi",
  };
}

function getParentModuleName(
  moduleName: string,
): string {
  const lastDot = moduleName.lastIndexOf(".");
  return lastDot === -1
    ? ""
    : moduleName.slice(0, lastDot);
}

function extractPythonImportStatements(
  content: string,
): PythonImportStatement[] {
  const tree = pythonParser.parse(content);
  const statements: PythonImportStatement[] = [];

  tree.iterate({
    enter(node: SyntaxNodeRef) {
      if (node.name !== "ImportStatement") {
        return;
      }

      const statement = parsePythonImportStatement(
        content.slice(node.from, node.to),
      );
      if (statement) {
        statements.push(statement);
      }

      return false;
    },
  });

  return statements;
}

function parsePythonImportStatement(
  statementSource: string,
): PythonImportStatement | null {
  const compactSource = statementSource
    .replaceAll(/\\\r?\n/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim();

  if (
    compactSource.startsWith("import ")
  ) {
    const moduleNames = splitImportList(
      compactSource.slice("import ".length),
    );
    return moduleNames.length > 0
      ? {
          kind: "import",
          moduleNames,
        }
      : null;
  }

  if (
    !compactSource.startsWith("from ")
  ) {
    return null;
  }

  const match = compactSource.match(
    /^from\s+(.+?)\s+import\s+(.+)$/,
  );
  if (!match) {
    return null;
  }

  const moduleSpecifier = (match[1] ?? "").trim();
  const importedNames = splitImportList(
    (match[2] ?? "")
      .trim()
      .replace(/^\(\s*/, "")
      .replace(/\s*\)$/, ""),
  );
  const relativeLevel =
    moduleSpecifier.match(/^\.+/)?.[0]
      .length ?? 0;
  const moduleName =
    moduleSpecifier.slice(relativeLevel);

  return {
    kind: "from",
    moduleName,
    relativeLevel,
    importedNames,
  };
}

function splitImportList(
  importListSource: string,
): string[] {
  return importListSource
    .split(",")
    .map((entry) =>
      entry
        .trim()
        .replace(/\s+as\s+.+$/, ""),
    )
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function resolvePythonImportTargets(
  statement: PythonImportStatement,
  fileInfo: PythonFileInfo,
  context: PythonImportContext,
): string[] {
  const targets = new Set<string>();

  if (statement.kind === "import") {
    for (const moduleName of statement.moduleNames ?? []) {
      const target = resolvePythonModuleTarget(
        moduleName,
        fileInfo,
        context,
      );
      if (target) {
        targets.add(target);
      }
    }
    return Array.from(targets);
  }

  const resolvedBaseModule =
    resolvePythonFromBaseModule(
      statement,
      fileInfo,
    );
  if (resolvedBaseModule === null) {
    return [];
  }

  const baseTarget =
    resolvedBaseModule.length > 0
      ? resolvePythonModuleTarget(
          resolvedBaseModule,
          fileInfo,
          context,
        )
      : null;
  for (const importedName of statement.importedNames ?? []) {
    if (importedName === "*") {
      if (baseTarget) {
        targets.add(baseTarget);
      }
      continue;
    }

    const submoduleName =
      joinPythonModuleName(
        resolvedBaseModule,
        importedName,
      );
    const submoduleTarget =
      submoduleName.length > 0
        ? resolvePythonModuleTarget(
            submoduleName,
            fileInfo,
            context,
          )
        : null;
    if (submoduleTarget) {
      targets.add(submoduleTarget);
      continue;
    }
    if (baseTarget) {
      targets.add(baseTarget);
    }
  }

  return Array.from(targets);
}

function resolvePythonFromBaseModule(
  statement: PythonImportStatement,
  fileInfo: PythonFileInfo,
): string | null {
  const relativeLevel =
    statement.relativeLevel ?? 0;
  const moduleParts = splitPythonModuleName(
    statement.moduleName ?? "",
  );
  if (relativeLevel === 0) {
    return joinPythonModuleParts(moduleParts);
  }

  const packageParts = splitPythonModuleName(
    fileInfo.packageName,
  );
  const ascendCount = relativeLevel - 1;
  if (ascendCount > packageParts.length) {
    return null;
  }

  return joinPythonModuleParts([
    ...packageParts.slice(
      0,
      packageParts.length - ascendCount,
    ),
    ...moduleParts,
  ]);
}

function splitPythonModuleName(
  moduleName: string,
): string[] {
  return moduleName
    .split(".")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function joinPythonModuleName(
  baseModuleName: string,
  suffix: string,
): string {
  return joinPythonModuleParts([
    ...splitPythonModuleName(baseModuleName),
    ...splitPythonModuleName(suffix),
  ]);
}

function joinPythonModuleParts(
  parts: string[],
): string {
  return parts.join(".");
}

function resolvePythonModuleTarget(
  moduleName: string,
  sourceFile: PythonFileInfo,
  context: PythonImportContext,
): string | null {
  const entries =
    context.moduleEntriesByName.get(
      moduleName,
    );
  if (!entries || entries.length === 0) {
    return null;
  }

  const bestMatch = [...entries].sort((a, b) =>
    comparePythonModuleEntries(
      a,
      b,
      sourceFile,
    ),
  )[0];

  return bestMatch?.fileId ?? null;
}

function comparePythonModuleEntries(
  a: PythonModuleEntry,
  b: PythonModuleEntry,
  sourceFile: PythonFileInfo,
): number {
  return (
    Number(b.rootPath === sourceFile.rootPath) -
      Number(a.rootPath === sourceFile.rootPath) ||
    Number(a.isStub) - Number(b.isStub) ||
    Number(a.isPackageInit) -
      Number(b.isPackageInit) ||
    a.fileId.localeCompare(b.fileId)
  );
}

async function groupCodeFilesByCruiserContext(
  codeFiles: Array<
    CollectedFile & {
      analysisType: "code";
    }
  >,
  workspacePath: string,
): Promise<
  Array<{
    context: DependencyCruiserContext;
    files: Array<
      CollectedFile & {
        analysisType: "code";
      }
    >;
  }>
> {
  const candidates =
    await listConfigCandidates(workspacePath);
  const groups = new Map<
    string,
    {
      context: DependencyCruiserContext;
      files: Array<
        CollectedFile & {
          analysisType: "code";
        }
      >;
    }
  >();

  for (const file of codeFiles) {
    const context = getDependencyCruiserContext(
      file.path,
      candidates,
    );
    const key =
      context.tsConfigFileName ?? "__default__";
    const existing = groups.get(key);
    if (existing) {
      existing.files.push(file);
      continue;
    }
    groups.set(key, {
      context,
      files: [file],
    });
  }

  return Array.from(groups.values());
}

async function listConfigCandidates(
  workspacePath: string,
): Promise<ConfigCandidate[]> {
  const configPaths =
    await listTypeScriptConfigPaths(workspacePath);

  const extractTSConfig = await getExtractTSConfig();
  const results = configPaths
    .map((configPath) => {
      try {
        const parsed = extractTSConfig(configPath);
        return {
          configPath,
          configDir: dirname(configPath),
          parsed,
          score: scoreConfigCandidate(
            configPath,
            parsed,
          ),
        };
      } catch {
        return null;
      }
    })
    .filter(
      (
        candidate,
      ): candidate is ConfigCandidate =>
        candidate !== null,
    );
  return results
    .sort(compareConfigCandidates);
}

function getDependencyCruiserContext(
  filePath: string,
  candidates: ConfigCandidate[],
): DependencyCruiserContext {
  const relevantCandidates = candidates.filter(
    (candidate) =>
      isPathWithinDirectory(
        filePath,
        candidate.configDir,
      ),
  );
  const bestCandidate =
    relevantCandidates[0] ?? candidates[0];

  if (!bestCandidate) {
    return { alias: {} };
  }

  const alias: Record<string, string> = {};
  for (const candidate of relevantCandidates) {
    for (const [from, to] of extractAliasEntries(
      candidate.configPath,
      candidate.parsed,
    )) {
      if (!(from in alias)) {
        alias[from] = to;
      }
    }
  }

  return {
    alias,
    tsConfigFileName:
      bestCandidate.configPath,
    tsConfig: bestCandidate.parsed,
  };
}

async function listTypeScriptConfigPaths(
  workspacePath: string,
): Promise<string[]> {
  const configPaths: string[] = [];

  await collectTypeScriptConfigPaths(
    workspacePath,
    configPaths,
  );

  return configPaths;
}

async function collectTypeScriptConfigPaths(
  dirPath: string,
  configPaths: string[],
): Promise<void> {
  let entries;
  try {
    entries = await readdir(dirPath, {
      withFileTypes: true,
    });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (
        CONFIG_SEARCH_IGNORED_DIRS.has(
          entry.name,
        )
      ) {
        continue;
      }
      await collectTypeScriptConfigPaths(
        fullPath,
        configPaths,
      );
      continue;
    }

    if (
      entry.isFile() &&
      CONFIG_NAME_PATTERN.test(entry.name)
    ) {
      configPaths.push(fullPath);
    }
  }
}

function scoreConfigCandidate(
  configPath: string,
  parsed: ReturnType<typeof extractTSConfig>,
): number {
  const fileName = basename(configPath);
  const pathCount = Object.keys(
    parsed.options.paths ?? {},
  ).length;

  return (
    (CONFIG_NAME_PRIORITIES.get(fileName) ?? 0) +
    pathCount * 100 +
    (parsed.options.jsx !== undefined ? 10 : 0) +
    (parsed.options.baseUrl !== undefined ? 5 : 0)
  );
}

function extractAliasEntries(
  configPath: string,
  parsed: ReturnType<typeof extractTSConfig>,
): Array<[string, string]> {
  const paths = parsed.options.paths;
  if (!paths) {
    return [];
  }

  const configDir = dirname(configPath);
  const baseUrl =
    typeof parsed.options.baseUrl === "string"
      ? resolve(configDir, parsed.options.baseUrl)
      : configDir;

  return Object.entries(paths)
    .map(([key, values]) => {
      if (
        key.includes("*") ||
        values.length !== 1
      ) {
        return null;
      }

      const firstValue = values[0];
      if (
        !firstValue ||
        firstValue.includes("*")
      ) {
        return null;
      }

      return [
        key,
        resolve(
          baseUrl,
          firstValue,
        ),
      ] as [string, string];
    })
    .filter(
      (
        entry,
      ): entry is [string, string] => entry !== null,
    );
}

function compareConfigCandidates(
  a: ConfigCandidate,
  b: ConfigCandidate,
): number {
  return (
    b.score - a.score ||
    b.configDir.length - a.configDir.length
  );
}

function isPathWithinDirectory(
  filePath: string,
  dirPath: string,
): boolean {
  const relPath = relative(dirPath, filePath);

  return (
    relPath === "" ||
    (!relPath.startsWith("..") &&
      !isAbsolute(relPath))
  );
}

function normalizeCruiserPath(
  value: string | undefined,
  workspacePath?: string,
): string | null {
  if (!value) {
    return null;
  }

  let normalized = value
    .replaceAll("\\", "/")
    .replace(/^\.\/+/, "");
  if (workspacePath) {
    const resolvedPath = resolve(
      workspacePath,
      normalized,
    );
    const relativePath = relative(
      workspacePath,
      resolvedPath,
    ).replaceAll("\\", "/");
    if (
      relativePath !== "" &&
      !relativePath.startsWith("../") &&
      !isAbsolute(relativePath)
    ) {
      normalized = relativePath;
    }
  }

  return normalized.length > 0 ? normalized : null;
}
