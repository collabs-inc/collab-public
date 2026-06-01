#!/usr/bin/env node
/**
 * Capture SCM UI screenshots via Playwright + Vite harness (headless).
 *
 * Usage (from collab-electron):
 *   bun scripts/scm-screenshots/collect-data.mjs
 *   node scripts/scm-screenshots/capture.mjs
 */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const depsDir = join(scriptDir, ".deps");
const require = createRequire(import.meta.url);

async function loadChromium() {
  let playwrightRoot = depsDir;
  if (!existsSync(join(depsDir, "node_modules/playwright"))) {
    console.log("Installing playwright in scripts/scm-screenshots/.deps …");
    execSync("npm install playwright@1.58.0 --omit=dev", {
      cwd: depsDir,
      stdio: "inherit",
      env: process.env,
    });
  }
  const pw = await import(
    require.resolve("playwright", { paths: [playwrightRoot] }),
  );
  const mod = pw.default ?? pw;
  if (!mod.chromium) {
    throw new Error("playwright.chromium not found after import");
  }
  return mod.chromium;
}

const harnessDir = join(scriptDir, "harness");
const outDir = join(scriptDir, "../../docs/screenshots/scm");
const port = 5199;
const baseUrl = `http://127.0.0.1:${port}`;

mkdirSync(outDir, { recursive: true });
mkdirSync(depsDir, { recursive: true });

console.log("Collecting fixture data from git repos …");
execSync("bun scripts/scm-screenshots/collect-data.mjs", {
  cwd: join(scriptDir, "../.."),
  stdio: "inherit",
});

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: "inherit",
      cwd: opts.cwd ?? harnessDir,
      env: { ...process.env, ...opts.env },
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`)),
    );
  });
}

async function waitForServer(url, attempts = 80) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Server not ready: ${url}`);
}

async function capture(page, filename, options = {}) {
  const outPath = join(outDir, filename);
  const root = page.locator("#screenshot-root");
  await root.waitFor({ state: "visible", timeout: 15000 });
  if (options.before) await options.before(page);
  await page.waitForTimeout(options.delay ?? 400);
  await root.screenshot({ path: outPath, animations: "disabled" });
  console.log(`  ${filename}`);
}

const electronRoot = join(scriptDir, "../..");
const viteBin = join(electronRoot, "node_modules/vite/bin/vite.js");
const vite = spawn(
  process.execPath,
  [viteBin, "--config", join(harnessDir, "vite.config.ts"), "--host", "127.0.0.1"],
  {
    cwd: harnessDir,
    stdio: "inherit",
    env: { ...process.env, FORCE_COLOR: "0" },
  },
);

try {
  await waitForServer(baseUrl);

  const chromium = await loadChromium();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 800, height: 960 },
    deviceScaleFactor: 2,
    colorScheme: "dark",
  });
  const page = await context.newPage();

  await page.goto(`${baseUrl}/?scenario=dirty-worktree`);
  await capture(page, "scm-overview.png");

  await page.goto(`${baseUrl}/?scenario=dirty-worktree`);
  await capture(page, "scm-commit-box.png", {
    before: async (p) => {
      const box = p.locator(".scm-commit-box");
      await box.scrollIntoViewIfNeeded();
    },
  });

  await page.goto(`${baseUrl}/?scenario=dirty-worktree`);
  await capture(page, "scm-branch-picker.png", {
    before: async (p) => {
      await p.locator(".scm-branch-trigger").click();
      await p.locator(".scm-branch-dropdown").waitFor({ state: "visible" });
    },
    delay: 300,
  });

  await page.goto(`${baseUrl}/?scenario=dirty-worktree`);
  await capture(page, "scm-sync-remote.png", {
    before: async (p) => {
      await p.locator(".scm-remote-trigger").click();
      await p.locator(".scm-remote-menu").waitFor({ state: "visible" });
    },
    delay: 300,
  });

  await page.goto(`${baseUrl}/?scenario=merge-conflict`);
  await capture(page, "scm-merge-conflict.png");

  await page.goto(`${baseUrl}/?scenario=rebase-todo`);
  await capture(page, "scm-interactive-rebase.png");

  await page.goto(`${baseUrl}/?scenario=dirty-worktree`);
  await capture(page, "scm-history.png", {
    before: async (p) => {
      await p.locator(".scm-history-toggle").click();
      await p.locator(".scm-history-list").waitFor({ state: "visible" });
    },
    delay: 300,
  });

  await page.goto(`${baseUrl}/?scenario=dirty-worktree`);
  await capture(page, "scm-stash.png", {
    before: async (p) => {
      await p.getByText("Stashes", { exact: true }).click();
      await p
        .locator(".scm-stash-row, .scm-stash-empty")
        .first()
        .waitFor({ state: "visible" });
    },
    delay: 300,
  });

  await page.goto(`${baseUrl}/?scenario=submodule`);
  await capture(page, "scm-submodules.png");

  await page.goto(`${baseUrl}/?view=monaco-diff`);
  await capture(page, "scm-monaco-diff.png", { delay: 1200 });

  await page.goto(`${baseUrl}/?view=settings-git`);
  await capture(page, "scm-settings-git.png");

  await browser.close();
  console.log(`\nScreenshots saved to ${outDir}`);
} finally {
  vite.kill("SIGTERM");
}
