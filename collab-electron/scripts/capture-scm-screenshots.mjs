#!/usr/bin/env bun
/**
 * Capture SCM UI screenshots for docs/PR review.
 * Usage: bun scripts/capture-scm-screenshots.mjs
 */
import { spawn } from "node:child_process";
import { mkdir, access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const COLLAB_ELECTRON = resolve(__dirname, "..");
const REPO_ROOT = resolve(COLLAB_ELECTRON, "..");
const FIXTURES = join(REPO_ROOT, "fixtures/git");
const OUT_DIR = join(COLLAB_ELECTRON, "docs/screenshots/scm");
const BRIDGE_PORT = 9876;
const VITE_PORT = 5199;
const HARNESS_URL = `http://127.0.0.1:${VITE_PORT}`;

const workspaces = {
  worktree: join(FIXTURES, "dirty-worktree"),
  mergeConflict: join(FIXTURES, "merge-conflict"),
  rebaseTodo: join(FIXTURES, "rebase-todo"),
};

function run(cmd, args, opts = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, {
      stdio: "inherit",
      cwd: opts.cwd ?? COLLAB_ELECTRON,
      env: { ...process.env, ...opts.env },
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${cmd} ${args.join(" ")} exited ${code}`));
    });
  });
}

function spawnBg(cmd, args, opts = {}) {
  const child = spawn(cmd, args, {
    stdio: opts.stdio ?? "ignore",
    cwd: opts.cwd ?? COLLAB_ELECTRON,
    env: { ...process.env, ...opts.env },
    detached: false,
  });
  child.on("error", (err) => {
    console.error(`Failed to start ${cmd}:`, err.message);
  });
  return child;
}

async function waitForUrl(url, timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function ensurePlaywright() {
  try {
    await import("playwright");
  } catch {
    console.log("Installing playwright…");
    await run("bun", ["add", "-d", "playwright"], { cwd: COLLAB_ELECTRON });
    await run("bunx", ["playwright", "install", "chromium"], {
      cwd: COLLAB_ELECTRON,
    });
  }
}

/** @type {import('playwright').Page} */
async function openHarness(page, scene, workspace) {
  const url = `${HARNESS_URL}/?scene=${encodeURIComponent(scene)}&workspace=${encodeURIComponent(workspace)}`;
  await page.goto(url, { waitUntil: "domcontentloaded" });
  const readySelector =
    scene === "settings-git"
      ? "h2"
      : scene === "viewer-diff"
        ? ".diff-editor-root, .viewer-diff-scene"
        : ".scm-container";
  await page.waitForSelector(readySelector, { timeout: 30_000 });
  await page.waitForTimeout(800);
}

async function freePorts() {
  for (const port of [VITE_PORT, BRIDGE_PORT]) {
    try {
      const { execSync } = await import("node:child_process");
      const pids = execSync(`lsof -ti:${port} 2>/dev/null || true`, {
        encoding: "utf8",
      })
        .trim()
        .split("\n")
        .filter(Boolean);
      for (const pid of pids) {
        try {
          process.kill(Number(pid), "SIGTERM");
        } catch {
          /* already gone */
        }
      }
    } catch {
      /* lsof unavailable */
    }
  }
  await new Promise((r) => setTimeout(r, 300));
}

async function main() {
  await freePorts();
  console.log("Setting up git fixtures…");
  await run("bash", [join(FIXTURES, "setup-all.sh")], { cwd: REPO_ROOT });

  await mkdir(OUT_DIR, { recursive: true });
  await ensurePlaywright();

  const bridge = spawnBg("bun", [
    join(COLLAB_ELECTRON, "scripts/scm-screenshot-git-bridge.mjs"),
  ], {
    env: {
      SCM_SCREENSHOT_GIT_BRIDGE_PORT: String(BRIDGE_PORT),
    },
  });

  const vite = spawnBg(
    "bun",
    [
      "x",
      "vite",
      "--config",
      "scripts/scm-screenshot-harness.vite.config.ts",
    ],
    {
      env: {
        VITE_SCM_GIT_BRIDGE: `http://127.0.0.1:${BRIDGE_PORT}`,
      },
    },
  );

  const cleanup = () => {
    bridge.kill("SIGTERM");
    vite.kill("SIGTERM");
  };
  process.on("exit", cleanup);
  process.on("SIGINT", () => {
    cleanup();
    process.exit(130);
  });

  try {
    await waitForUrl(`${HARNESS_URL}/`);
    const { chromium } = await import("playwright");

    const browser = await chromium.launch({ headless: true });
    const created = [];

    const capture = async (filename, options) => {
      const outPath = join(OUT_DIR, filename);
      const page = await browser.newPage({
        viewport: options.viewport ?? { width: 380, height: 860 },
        deviceScaleFactor: 2,
      });
      try {
        await openHarness(page, options.scene, options.workspace);
        if (options.beforeShot) await options.beforeShot(page);
        if (options.fillCommit) {
          await page.fill(
            ".scm-commit-textarea",
            "Refactor source control panel layout",
          );
        }
        if (options.clip) {
          const el = page.locator(options.clip).first();
          await el.waitFor({ state: "visible", timeout: 10_000 });
          await el.screenshot({ path: outPath });
        } else {
          await page.screenshot({ path: outPath, fullPage: false });
        }
        await access(outPath);
        created.push(outPath);
        console.log(`  ✓ ${filename}`);
      } catch (err) {
        console.warn(`  ✗ ${filename}: ${err.message}`);
      } finally {
        await page.close();
      }
    };

    console.log("Capturing screenshots…");

    await capture("01-scm-overview.png", {
      scene: "scm",
      workspace: workspaces.worktree,
      viewport: { width: 380, height: 900 },
    });

    await capture("02-commit-box.png", {
      scene: "scm",
      workspace: workspaces.worktree,
      clip: ".scm-commit-box",
      fillCommit: true,
      viewport: { width: 380, height: 400 },
    });

    await capture("03-branch-picker.png", {
      scene: "scm",
      workspace: workspaces.worktree,
      viewport: { width: 380, height: 700 },
      beforeShot: async (page) => {
        await page.click(".scm-branch-trigger");
        await page.waitForSelector(".scm-branch-dropdown", {
          state: "visible",
        });
      },
    });

    await capture("04-sync-remotes.png", {
      scene: "scm",
      workspace: workspaces.worktree,
      viewport: { width: 380, height: 520 },
      beforeShot: async (page) => {
        await page.getByRole("button", { name: "Manage…" }).click();
        await page.waitForSelector(".scm-modal", { state: "visible" });
      },
    });

    await capture("05-merge-conflicts.png", {
      scene: "scm",
      workspace: workspaces.mergeConflict,
      viewport: { width: 380, height: 820 },
    });

    await capture("06-history.png", {
      scene: "scm",
      workspace: workspaces.worktree,
      viewport: { width: 380, height: 900 },
      beforeShot: async (page) => {
        await page.click(".scm-history-toggle");
        await page.waitForSelector(".scm-history-list", {
          state: "visible",
        });
        await page.locator(".scm-history-row").first().click();
      },
    });

    await capture("07-interactive-rebase.png", {
      scene: "scm",
      workspace: workspaces.rebaseTodo,
      viewport: { width: 380, height: 820 },
    });

    await capture("08-stash.png", {
      scene: "scm",
      workspace: workspaces.worktree,
      viewport: { width: 380, height: 520 },
      beforeShot: async (page) => {
        const header = page
          .locator(".scm-section-header")
          .filter({ hasText: "Stashes" });
        await header.click();
        await page.waitForSelector(".scm-stash-row", { state: "visible" });
      },
    });

    await capture("09-viewer-diff.png", {
      scene: "viewer-diff",
      workspace: workspaces.mergeConflict,
      viewport: { width: 960, height: 640 },
    });

    await capture("10-settings-git.png", {
      scene: "settings-git",
      workspace: workspaces.worktree,
      viewport: { width: 720, height: 520 },
    });

    await browser.close();

    console.log(`\nCreated ${created.length} image(s) in ${OUT_DIR}`);
    for (const p of created) console.log(p);
    return created;
  } finally {
    cleanup();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
