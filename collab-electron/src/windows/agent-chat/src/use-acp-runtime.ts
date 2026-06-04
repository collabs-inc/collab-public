import { useState, useEffect, useRef, useMemo } from "react";
import {
  useLocalRuntime,
  type ChatModelAdapter,
  type ChatModelRunResult,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import type { AcpUpdate } from "@collab/shared/window-api";

export type { AcpUpdate };

/**
 * ChatModelAdapter that bridges ACP IPC events into
 * assistant-ui's streaming protocol.
 */
function createAcpAdapter(
  sessionIdRef: React.RefObject<string | null>,
): ChatModelAdapter {
  return {
    async *run({ messages, abortSignal }) {
      const sessionId = sessionIdRef.current;
      if (!sessionId) {
        yield { content: [{ type: "text", text: "Not connected to agent" }] };
        return;
      }

      const lastMsg = messages[messages.length - 1];
      const textPart = lastMsg?.content.find(
        (c: any) => c.type === "text",
      );
      const text = textPart?.type === "text"
        ? (textPart as any).text
        : "";

      if (!text) return;

      // Track parts in arrival order so tool calls
      // appear interleaved with text, not all at the end
      type Part =
        | { type: "text"; text: string }
        | {
          type: "tool-call";
          toolCallId: string;
          toolName: string;
          argsText: string;
          args: Record<string, unknown>;
          result?: unknown;
        };
      const parts: Part[] = [];
      let version = 0;

      function lastTextPart(): Part | undefined {
        const last = parts[parts.length - 1];
        return last?.type === "text" ? last : undefined;
      }

      let resolveComplete: () => void;
      let rejectComplete: (err: Error) => void;
      const completionPromise = new Promise<void>(
        (res, rej) => {
          resolveComplete = res;
          rejectComplete = rej;
        },
      );

      const cleanups: Array<() => void> = [];

      cleanups.push(
        window.api.onAgentUpdate((params: AcpUpdate) => {
          const update = params.update;

          switch (update.sessionUpdate) {
            case "agent_message_chunk": {
              const chunk = update.content;
              const t = chunk && !Array.isArray(chunk)
                ? chunk.text
                : undefined;
              if (!t) break;
              const last = lastTextPart();
              if (last) {
                last.text += t;
              } else {
                parts.push({ type: "text", text: t });
              }
              version++;
              break;
            }
            case "tool_call": {
              parts.push({
                type: "tool-call",
                toolCallId:
                  update.toolCallId ?? `tc_${Date.now()}`,
                toolName: update.title ?? "tool",
                argsText: JSON.stringify(
                  update.rawInput ?? {},
                ),
                args:
                  (update.rawInput as Record<
                    string, unknown
                  >) ?? {},
              });
              version++;
              break;
            }
            case "tool_call_update": {
              const id = update.toolCallId;
              const tc = parts.find(
                (p) =>
                  p.type === "tool-call" &&
                  p.toolCallId === id,
              );
              if (tc && tc.type === "tool-call") {
                const raw = update.content;
                if (
                  Array.isArray(raw) && raw.length > 0
                ) {
                  const first = raw[0];
                  if (
                    first.type === "content" &&
                    first.content?.text
                  ) {
                    tc.result = first.content.text;
                  }
                }
                if (!tc.result && update.rawOutput) {
                  tc.result = update.rawOutput;
                }
                version++;
              }
              break;
            }
          }
        }),
      );

      cleanups.push(
        window.api.onAgentPromptComplete(() => {
          resolveComplete();
        }),
      );

      cleanups.push(
        window.api.onAgentPromptError((data) => {
          rejectComplete(new Error(data.error));
        }),
      );

      // Send the prompt
      window.api.agentPrompt(sessionId, text);

      // Yield parts in arrival order
      try {
        let lastVersion = 0;
        while (true) {
          if (abortSignal?.aborted) {
            window.api.agentCancel(sessionId);
            break;
          }

          const done = await Promise.race([
            completionPromise.then(() => true),
            new Promise<false>((r) =>
              setTimeout(() => r(false), 100),
            ),
          ]);

          if (version > lastVersion || done) {
            lastVersion = version;
            yield { content: [...parts] };
          }

          if (done) break;
        }
      } finally {
        for (const fn of cleanups) fn();
      }
    },
  };
}

export type ConnectResult = {
  sessionId: string;
  resumed: boolean;
  cachedMessages: unknown[];
};

export function useAcpRuntime(
  connectResult: ConnectResult,
) {
  const sessionIdRef = useRef<string | null>(
    connectResult.sessionId,
  );
  const [ready, setReady] = useState(
    !connectResult.resumed,
  );

  // Use cached messages as initial messages
  const initialMessages = useMemo(() => {
    if (!connectResult.cachedMessages?.length) {
      return undefined;
    }
    const msgs =
      connectResult.cachedMessages as ThreadMessageLike[];
    return msgs.length > 0 ? msgs : undefined;
  }, []);

  const adapter = createAcpAdapter(sessionIdRef);
  const runtime = useLocalRuntime(adapter, {
    initialMessages,
  });

  // Listen for session ready/failed
  useEffect(() => {
    if (ready) return;
    const cleanups: Array<() => void> = [];
    cleanups.push(
      window.api.onAgentSessionReady(() => {
        setReady(true);
      }),
    );
    cleanups.push(
      window.api.onAgentSessionFailed(() => {
        setReady(true);
      }),
    );
    return () => cleanups.forEach((fn) => fn());
  }, [ready]);

  // Save messages after each prompt completes
  useEffect(() => {
    const cleanup = window.api.onAgentPromptComplete(
      () => {
        const state = runtime.thread.getState();
        const msgs = state.messages.map((m: any) => ({
          role: m.role,
          content: m.content.map((p: any) => {
            if (p.type === "text") {
              return { type: "text", text: p.text };
            }
            if (p.type === "tool-call") {
              return {
                type: "tool-call",
                toolCallId: p.toolCallId,
                toolName: p.toolName,
                argsText: p.argsText ?? "",
                args: p.args,
                result: p.result,
              };
            }
            return p;
          }),
        }));
        window.api.agentSaveMessages(msgs);
      },
    );
    return cleanup;
  }, [runtime]);

  return { runtime, ready };
}
