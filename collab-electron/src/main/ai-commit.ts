import { spawn } from "node:child_process";
import { agentDetected, type AgentId } from "./integrations";

const MAX_DIFF_CHARS = 100_000;

const COMMIT_PROMPT = `You are a commit message generator. Analyze the provided git diff and write a concise, conventional commit message.

Rules:
1. Use conventional commits format: type(scope): description
2. Types: feat, fix, refactor, docs, style, test, chore, perf, ci, build
3. The first line MUST be 72 characters or fewer
4. Focus on WHY the change was made, not WHAT changed (the diff shows what)
5. If the scope is obvious from the diff, include it; otherwise omit it
6. For complex changes, add a blank line then a brief body (2-3 bullet points max)
7. Do not wrap the message in markdown code fences or quotes
8. Do not include the diff in your response
9. If the diff is truncated, infer intent from the visible portion

Output ONLY the commit message text, nothing else.`;

function prepareDiff(rawDiff: string): string {
  if (rawDiff.length <= MAX_DIFF_CHARS) return rawDiff;

  const lines = rawDiff.split("\n");
  let charCount = 0;
  let cutLine = 0;

  for (let i = 0; i < lines.length; i++) {
    charCount += lines[i]!.length + 1;
    if (charCount > MAX_DIFF_CHARS) {
      cutLine = i;
      break;
    }
  }

  const truncated = lines.slice(0, cutLine).join("\n");
  return `${truncated}\n\n[TRUNCATED -- showing first ${cutLine} of ${lines.length} lines]`;
}

// -- Agent detection --

const AGENT_PRIORITY: AgentId[] = ["claude", "codex", "gemini"];

export function getAvailableAgent(): AgentId | null {
  for (const id of AGENT_PRIORITY) {
    if (agentDetected(id)) return id;
  }
  return null;
}

export function canGenerate(apiKey?: string): {
  available: boolean;
  agent?: string;
} {
  const agent = getAvailableAgent();
  if (agent) {
    const names: Record<AgentId, string> = {
      claude: "Claude Code",
      codex: "Codex CLI",
      gemini: "Gemini CLI",
    };
    return { available: true, agent: names[agent] };
  }
  if (typeof apiKey === "string" && apiKey.length > 0) {
    return { available: true, agent: "Anthropic API" };
  }
  return { available: false };
}

// -- CLI-based generation --

function runCliAgent(
  command: string,
  args: string[],
  stdinData: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("error", (err) => {
      reject(
        new Error(`Failed to run ${command}: ${err.message}`),
      );
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `${command} exited with code ${code}: ${stderr.slice(0, 500)}`,
          ),
        );
        return;
      }
      resolve(stdout.trim());
    });

    proc.stdin.write(stdinData);
    proc.stdin.end();
  });
}

export async function generateCommitMessageViaCli(
  agent: AgentId,
  diff: string,
): Promise<{ message: string; agent: string }> {
  const preparedDiff = prepareDiff(diff);
  const fullPrompt = `${COMMIT_PROMPT}\n\nHere is the git diff:\n\n${preparedDiff}`;

  let result: string;

  switch (agent) {
    case "claude":
      result = await runCliAgent("claude", ["-p"], fullPrompt);
      break;
    case "codex":
      result = await runCliAgent(
        "codex",
        ["--quiet"],
        fullPrompt,
      );
      break;
    case "gemini":
      result = await runCliAgent("gemini", [], fullPrompt);
      break;
  }

  // Clean up any markdown fences the CLI might add
  let message = result;
  if (message.startsWith("```") && message.endsWith("```")) {
    message = message.slice(3, -3).trim();
  }
  // Remove leading language identifier if present
  if (message.startsWith("```")) {
    const newlineIdx = message.indexOf("\n");
    message = message.slice(newlineIdx + 1).trim();
  }

  return { message, agent };
}

// -- API key fallback --

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";
const MODEL = "claude-sonnet-4-20250514";

interface ApiResponse {
  content: Array<{ type: string; text: string }>;
  model: string;
}

interface ApiError {
  error?: { type: string; message: string };
}

export async function generateCommitMessageViaApi(
  apiKey: string,
  diff: string,
): Promise<{ message: string; agent: string }> {
  const preparedDiff = prepareDiff(diff);

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": API_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 512,
      system: COMMIT_PROMPT,
      messages: [{ role: "user", content: preparedDiff }],
    }),
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as ApiError;
    const detail = body.error?.message ?? res.statusText;
    if (res.status === 401) {
      throw new Error(`Invalid API key: ${detail}`);
    }
    if (res.status === 429) {
      throw new Error(`Rate limit exceeded. Please try again shortly.`);
    }
    throw new Error(`API error (${res.status}): ${detail}`);
  }

  const data = (await res.json()) as ApiResponse;
  const text =
    data.content.find((c) => c.type === "text")?.text ?? "";

  return { message: text.trim(), agent: "Anthropic API" };
}

export async function validateApiKey(
  key: string,
): Promise<boolean> {
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": API_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1,
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
