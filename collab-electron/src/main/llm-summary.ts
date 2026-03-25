import Anthropic from "@anthropic-ai/sdk";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { app } from "electron";

interface SummaryContext {
  foreground?: string;
  shell?: string;
  cwd?: string;
  title?: string;
  otherTerminals?: Array<{
    foreground?: string;
    cwd?: string;
    summaryCompact?: string;
  }>;
}

interface SummaryResult {
  type: string;
  status: string;
  detailed: string[];
  reduced: string[];
  compact: string;
}

let client: Anthropic | null = null;
let available = false;

const cache = new Map<string, SummaryResult>();
const inflight = new Set<string>();
const MAX_CACHE = 200;
let consecutiveErrors = 0;
const MAX_CONSECUTIVE_ERRORS = 3;

const SYSTEM_PROMPT = `You summarize terminal activity for a zoomed-out canvas view.

You receive:
- Terminal output (last ~100 lines, may contain ANSI remnants)
- Foreground process, working directory, pane title
- Brief context about other open terminals

Produce a JSON object with:
- "status": one of "error", "warning", "success", "running", "info", "idle"
- "detailed": array of 4-6 short strings (shown at 50% zoom). First line is the headline. Include: what's happening, the goal/intent, key output, action items (prefixed with →).
- "reduced": array of 2-3 short strings (shown at 25% zoom). First is headline.
- "compact": single short string (badge, max 16 chars).

Guidelines:
- Focus on WHAT the user is trying to achieve, not raw process names.
- If an AI agent (Claude, Codex, Gemini, Copilot, Cursor, aider) is running, summarize the TASK it's working on and its current step.
- If a dev server is running, name the framework and port.
- If tests ran, summarize pass/fail counts and failing test names.
- If git operations happened, summarize the branch and changes.
- If idle, mention last command and working directory context.
- For action items, prefix with →.
- Be concise. No prose. Telegraph style.
- Headlines should be bold and descriptive (e.g. "Claude: fixing email dedup" not "claude").
- The detailed array should tell a story: headline → context → current activity → action items.

Return ONLY valid JSON, no markdown fences.`;

function contentHash(output: string): string {
  const lines = output
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 2)
    .slice(-25);
  return crypto.createHash("sha256").update(lines.join("\n")).digest("hex").slice(0, 16);
}

function loadEnvKey(): string | undefined {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  try {
    const appRoot = app.isPackaged
      ? path.dirname(app.getAppPath())
      : path.resolve(app.getAppPath());
    const envPath = path.join(appRoot, ".env");
    const content = fs.readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const m = line.match(/^\s*ANTHROPIC_API_KEY\s*=\s*(.+)\s*$/);
      if (m) return m[1].trim();
    }
  } catch { /* .env not found */ }
  return undefined;
}

export function initLlmSummary(): void {
  const key = loadEnvKey();
  if (!key) {
    console.warn("[llm-summary] ANTHROPIC_API_KEY not set, LLM summaries disabled");
    return;
  }
  try {
    client = new Anthropic({ apiKey: key });
    available = true;
    console.log("[llm-summary] initialized");
  } catch (err) {
    console.error("[llm-summary] failed to init:", err);
  }
}

export function isLlmAvailable(): boolean {
  return available;
}

export async function summarizeTerminal(
  sessionId: string,
  output: string,
  context: SummaryContext,
): Promise<SummaryResult | null> {
  if (!client || consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) return null;

  const hash = contentHash(output);
  const cacheKey = `${sessionId}:${hash}`;

  const cached = cache.get(cacheKey);
  if (cached) return cached;

  if (inflight.has(sessionId)) return null;
  inflight.add(sessionId);

  try {
    const otherCtx = (context.otherTerminals || [])
      .filter((t) => t.summaryCompact)
      .map((t) => `  - ${t.summaryCompact} (${t.cwd || "?"})`)
      .join("\n");

    const userMsg = [
      `Terminal output (last lines):`,
      "```",
      output.slice(-4000),
      "```",
      "",
      `Foreground process: ${context.foreground || "shell"}`,
      `Working directory: ${context.cwd || "unknown"}`,
      `Pane title: ${context.title || "none"}`,
      ...(otherCtx ? [`\nOther terminals:\n${otherCtx}`] : []),
    ].join("\n");

    const response = await client.messages.create({
      model: "claude-haiku-4-20250414",
      max_tokens: 300,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMsg }],
    });

    const text =
      response.content[0]?.type === "text" ? response.content[0].text : "";

    const parsed = JSON.parse(text) as SummaryResult;

    if (!parsed.detailed || !parsed.reduced || !parsed.compact) {
      return null;
    }

    consecutiveErrors = 0;

    if (cache.size > MAX_CACHE) {
      const first = cache.keys().next().value;
      if (first) cache.delete(first);
    }
    cache.set(cacheKey, parsed);

    return parsed;
  } catch (err) {
    consecutiveErrors++;
    if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      console.error("[llm-summary] too many errors, disabling LLM summaries");
      available = false;
    } else {
      console.error("[llm-summary] API error:", err);
    }
    return null;
  } finally {
    inflight.delete(sessionId);
  }
}
