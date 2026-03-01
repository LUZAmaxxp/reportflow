// MCP tool: get_preferences — Slice 5
// Load mem0 preferences with degraded timeout mode.
// Input { user_id, client_id? } output { preferences }.

import { env } from "@/lib/env";
import type { AgentContext } from "@/lib/mcp/index";

interface GetPreferencesInput {
  user_id: string;
  client_id?: string;
}

export async function getPreferences(
  input: GetPreferencesInput,
  ctx: AgentContext
): Promise<{ preferences: Record<string, unknown> }> {
  const scopeKey = [ctx.companyId, input.user_id, input.client_id]
    .filter(Boolean)
    .join(":");

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000); // 3s timeout

    const response = await fetch("https://api.mem0.ai/v1/memories/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Token ${env.MEM0_API_KEY}`,
      },
      body: JSON.stringify({
        query: "style preferences report formatting",
        user_id: scopeKey,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(`[get_preferences] mem0 returned ${response.status}, falling back to empty`);
      return { preferences: {} };
    }

    const data = await response.json();

    // Extract preferences from mem0 response
    const preferences: Record<string, unknown> = {};
    if (Array.isArray(data.results)) {
      for (const mem of data.results) {
        if (mem.metadata) {
          Object.assign(preferences, mem.metadata);
        }
      }
    } else if (Array.isArray(data)) {
      for (const mem of data) {
        if (mem.memory) {
          preferences[mem.id ?? "general"] = mem.memory;
        }
      }
    }

    return { preferences };
  } catch (err: any) {
    // On timeout or error, return empty and continue
    console.warn(`[get_preferences] mem0 read failed: ${err.message}`);
    return { preferences: {} };
  }
}
