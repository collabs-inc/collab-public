const MAX_DIFF_CHARS = 100_000;
const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";
const MODEL = "claude-sonnet-4-20250514";

const SYSTEM_PROMPT = `You are a commit message generator. Analyze the provided git diff and write a concise, conventional commit message.

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

interface ApiResponse {
  content: Array<{ type: string; text: string }>;
  model: string;
}

interface ApiError {
  error?: { type: string; message: string };
}

export async function generateCommitMessage(
  apiKey: string,
  diff: string,
): Promise<{ message: string; model: string }> {
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
      system: SYSTEM_PROMPT,
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

  return { message: text.trim(), model: data.model };
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
