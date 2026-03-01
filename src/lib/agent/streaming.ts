// Agent streaming — Slice 5 §5.4
// Reads token chunks from Grok response stream, emits token SSE events,
// accumulates complete assistant text, writes one chat_message type=agent_text on completion.

import { appendEvent } from "@/lib/agent/session-buffer";
import { db } from "@/lib/db";
import { chatMessages } from "@/lib/db/schema/notifications";
import { env } from "@/lib/env";

interface StreamGrokOptions {
  sessionId: string;
  messages: Array<{ role: string; content: string }>;
  tools?: any[];
}

/**
 * Stream Grok tokens to SSE and persist final assistant message.
 * Returns the accumulated text and any tool calls.
 */
export async function streamGrokResponse(options: StreamGrokOptions): Promise<{
  text: string;
  toolCalls: Array<{ name: string; arguments: string }>;
}> {
  const { sessionId, messages, tools } = options;

  const requestBody: any = {
    model: "grok-3-fast",
    messages,
    stream: true,
  };

  if (tools && tools.length > 0) {
    requestBody.tools = tools;
    requestBody.tool_choice = "auto";
  }

  const response = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.XAI_API_KEY}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`Grok API error: ${response.status} ${errText}`);
  }

  if (!response.body) {
    throw new Error("Grok response has no body stream");
  }

  let accumulatedText = "";
  const toolCalls: Array<{ name: string; arguments: string }> = [];
  const toolCallBuffers: Map<number, { name: string; arguments: string }> = new Map();

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === "data: [DONE]") continue;
        if (!trimmed.startsWith("data: ")) continue;

        try {
          const json = JSON.parse(trimmed.slice(6));
          const delta = json.choices?.[0]?.delta;

          if (delta?.content) {
            accumulatedText += delta.content;
            await appendEvent(sessionId, {
              event_name: "token",
              payload: { delta: delta.content },
            });
          }

          // Handle tool calls
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              if (!toolCallBuffers.has(idx)) {
                toolCallBuffers.set(idx, { name: "", arguments: "" });
              }
              const buf = toolCallBuffers.get(idx)!;
              if (tc.function?.name) buf.name = tc.function.name;
              if (tc.function?.arguments) buf.arguments += tc.function.arguments;
            }
          }
        } catch {
          // Skip malformed SSE lines
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  // Finalize tool calls
  for (const [, buf] of toolCallBuffers) {
    toolCalls.push(buf);
  }

  // Persist assistant message if there's text
  if (accumulatedText) {
    await db.insert(chatMessages).values({
      sessionId,
      role: "assistant",
      type: "agent_text",
      content: { text: accumulatedText },
    });
  }

  return { text: accumulatedText, toolCalls };
}
