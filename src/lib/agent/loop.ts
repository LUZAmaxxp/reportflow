// Agent loop — Slice 5 §5.3
// Grok-driven agentic tool-calling loop.
// Grok decides which tools to call and with what arguments.
// The loop executes each tool, appends results as `tool` messages, and loops
// until Grok produces a final text response (no more tool_calls).
// The final answer is then streamed as SSE tokens.

import { toolDispatch, type AgentContext } from "@/lib/mcp/index";
import { appendEvent } from "@/lib/agent/session-buffer";
import { streamGrokResponse } from "@/lib/agent/streaming";
import { AGENT_TOOLS } from "@/lib/agent/tools";
import { db } from "@/lib/db";
import { chatMessages } from "@/lib/db/schema/notifications";
import Redis from "ioredis";
import { eq, asc } from "drizzle-orm";
import { env } from "@/lib/env";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AgentLoopParams {
  session_id: string;
  user_message_id: string | null;
  mode: "normal" | "regenerate";
  report_id: string | null;
  observation_ids?: string[];
  derivation_result_ids?: string[];
  companyId: string;
  userId: string;
}

// OpenAI message shapes used for the tool-calling loop
type LlmMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: GrokToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

interface GrokToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface GrokNonStreamResponse {
  choices: Array<{
    message: {
      role: string;
      content: string | null;
      tool_calls?: GrokToolCall[];
    };
    finish_reason: string;
  }>;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function runAgentLoop(params: AgentLoopParams): Promise<void> {
  const ctx: AgentContext = {
    companyId: params.companyId,
    userId: params.userId,
    sessionId: params.session_id,
  };

  try {
    // Load message history
    const messageHistory = await db
      .select({
        role: chatMessages.role,
        type: chatMessages.type,
        content: chatMessages.content,
      })
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, params.session_id))
      .orderBy(asc(chatMessages.createdAt))
      .limit(40);

    const lastUserMsg = [...messageHistory]
      .reverse()
      .find((m) => m.type === "user_text");
    const userText = (lastUserMsg?.content as any)?.text ?? "";

    // Build conversation history (user/assistant turns only)
    const conversationHistory: LlmMessage[] = [];
    for (const msg of messageHistory) {
      if (msg.type === "user_text") {
        conversationHistory.push({ role: "user", content: (msg.content as any)?.text ?? "" });
      } else if (msg.type === "agent_text") {
        conversationHistory.push({ role: "assistant", content: (msg.content as any)?.text ?? "" });
      }
    }

    // Classify intent
    const intent = params.mode === "regenerate"
      ? "report"
      : await classifyIntent(userText, conversationHistory);

    const systemPrompt = intent === "report"
      ? REPORT_SYSTEM_PROMPT(params.report_id)
      : QA_SYSTEM_PROMPT;

    const messages: LlmMessage[] = [
      { role: "system", content: systemPrompt },
      ...conversationHistory,
    ];

    // Run the agentic tool-calling loop
    await runAgenticLoop(messages, ctx);

    await appendEvent(ctx.sessionId, { event_name: "done", payload: {} });
  } catch (err: any) {
    console.error("[agent-loop] Error:", err);
    const errorPayload = {
      message: err?.message ?? "An error occurred",
      retryable: !!(err?.code === "ECONNREFUSED" || err?.message?.includes("timeout")),
    };
    await appendEvent(ctx.sessionId, { event_name: "error", payload: errorPayload });
    await db.insert(chatMessages).values({
      sessionId: ctx.sessionId,
      role: "assistant",
      type: "error",
      content: errorPayload,
    });
    await appendEvent(ctx.sessionId, { event_name: "done", payload: {} });
  }
}

// ─── Agentic loop ─────────────────────────────────────────────────────────────

/**
 * Core agentic loop: calls Grok non-streaming with tools until no more tool_calls,
 * then makes a final streaming call to emit the answer to the user as tokens.
 * Grok is in full control of which tools to call and with what arguments.
 */
async function runAgenticLoop(
  messages: LlmMessage[],
  ctx: AgentContext,
  maxIterations = 12
): Promise<void> {
  let iterations = 0;
  // Carry html_snapshot_url across create_report → render_pdf → report_ready
  let latestHtmlSnapshotUrl: string | null = null;

  // Tool-calling phase — loop until Grok stops requesting tools
  while (iterations < maxIterations) {
    iterations++;

    const response = await callGrokNonStreaming(messages);
    const choice = response.choices[0];
    const assistantMessage = choice.message;

    // Append assistant message (may include tool_calls)
    messages.push({
      role: "assistant",
      content: assistantMessage.content ?? null,
      tool_calls: assistantMessage.tool_calls,
    });

    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      // Grok has no more tool calls — break to the final streaming pass
      break;
    }

    // Execute each tool call sequentially
    for (const toolCall of assistantMessage.tool_calls) {
      const name = toolCall.function.name;
      let input: unknown = {};

      try {
        input = JSON.parse(toolCall.function.arguments);
      } catch {
        // leave as empty object — tool will get {} and return a validation error
      }

      // Emit tool_call SSE event so the UI can show a progress step
      await emitToolCall(ctx, name, toolCallSummary(name));

      // Execute via MCP dispatcher
      const dispatchResult = await toolDispatch(name, input, ctx);
      const toolResultData = dispatchResult.result as any;

      // create_report returns html_snapshot_url — capture it for use in report_ready
      if (name === "create_report" && toolResultData?.html_snapshot_url) {
        latestHtmlSnapshotUrl = toolResultData.html_snapshot_url;
      }

      // propose_manual_observation — pause the loop and wait for user input via Redis pub/sub
      if (name === "propose_manual_observation" && toolResultData?.pending_id) {
        const pendingId = toolResultData.pending_id as string;
        const waitResult = await waitForPendingObservation(pendingId);
        // Inject the outcome back so Grok knows what happened
        const waitSummary =
          waitResult.status === "confirmed"
            ? `User confirmed the manual observation. observation_id=${waitResult.observation_id}`
            : waitResult.status === "skipped"
            ? "User skipped the manual observation. Continue without it."
            : "Manual observation timed out. Continue without it.";
        // Override the tool result content so the next Grok call sees the outcome
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify({ ...toolResultData, wait_result: waitResult, summary: waitSummary }),
        });
        continue; // skip the generic push below for this tool call
      }

      // render_pdf returns pdf_url — emit report_ready so the UI can show it
      if (name === "render_pdf" && toolResultData?.pdf_url) {
        const reportReadyPayload = {
          report_id: toolResultData.report_id ?? null,
          title: "Rapport ESG",
          // Use html_snapshot_url captured from create_report (render_pdf does not return it)
          html_snapshot_url: latestHtmlSnapshotUrl ?? "",
          pdf_url: toolResultData.pdf_url,
        };
        await appendEvent(ctx.sessionId, {
          event_name: "report_ready",
          payload: reportReadyPayload,
        });
        await db.insert(chatMessages).values({
          sessionId: ctx.sessionId,
          role: "assistant",
          type: "report_ready",
          content: reportReadyPayload,
        });
      }

      // Append tool result as a `tool` role message for the next Grok call
      const resultContent = dispatchResult.error
        ? `Error: ${dispatchResult.error}`
        : JSON.stringify(toolResultData ?? {});

      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: resultContent.slice(0, 8000), // guard against oversized results
      });
    }
  }

  // Final streaming pass — Grok produces the visible answer, streamed as tokens.
  // We pass the full accumulated message history (including all tool results) so
  // Grok can reference everything when writing the final response.
  await streamGrokResponse({
    sessionId: ctx.sessionId,
    messages: messages.map((m) => ({
      role: m.role,
      content: ("content" in m && m.content != null) ? String(m.content) : "",
    })),
    // No tools in the final pass — force a text-only answer
  });
}

// ─── Non-streaming Grok call (tool-calling rounds) ────────────────────────────

async function callGrokNonStreaming(messages: LlmMessage[]): Promise<GrokNonStreamResponse> {
  const response = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.XAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "grok-3-fast",
      messages,
      tools: AGENT_TOOLS,
      tool_choice: "auto",
      stream: false,
      temperature: 0.3,
      max_tokens: 4096,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Grok API error ${response.status}: ${text}`);
  }

  return response.json() as Promise<GrokNonStreamResponse>;
}

// ─── System prompts ───────────────────────────────────────────────────────────

const QA_SYSTEM_PROMPT =
  "Vous etes un assistant expert ESG/RSE. " +
  "\n\nREGLE ABSOLUE — AUCUNE HALLUCINATION:\n" +
  "- Toute information sur l'entreprise (chiffres, noms, dates, politiques, engagements, strategie, certifications, etc.) " +
  "DOIT provenir exclusivement des resultats des outils search_observations ou search_evidence.\n" +
  "- Chaque affirmation sur l'entreprise DOIT etre suivie de sa source entre crochets : " +
  "[obs:<observation_id>] pour une observation, [ev:<block_id>] pour un extrait documentaire.\n" +
  "- Si les outils ne retournent pas l'information demandee, repondez exactement : " +
  "'Je ne dispose pas de cette information dans les donnees disponibles.' " +
  "Ne devinez pas, n'inventez pas, n'extrapolez pas.\n" +
  "- N'utilisez jamais vos connaissances generales pour affirmer quoi que ce soit sur cette entreprise specifique.\n\n" +
  "OUTILS DISPONIBLES:\n" +
  "- search_observations : indicateurs chiffres approuves (emissions, energie, effectifs, etc.)\n" +
  "- search_evidence : extraits textuels des documents sources uploades\n\n" +
  "FORMAT : repondez en francais avec du markdown structure (pas de HTML brut).";

function REPORT_SYSTEM_PROMPT(sourceReportId: string | null): string {
  return (
    "Vous etes un assistant expert en reporting ESG/RSE. " +
    "Votre mission est de generer un rapport complet en HTML.\n\n" +
    "REGLE ABSOLUE — AUCUNE HALLUCINATION:\n" +
    "- Chaque donnee, affirmation, chiffre, date, nom, engagement ou information sur l'entreprise " +
    "dans le rapport DOIT provenir des resultats des outils (search_observations, search_evidence, compute_derivation).\n" +
    "- Chaque valeur doit etre annotee de sa source : data-obs-id=\"<observation_id>\" " +
    "ou data-ev-id=\"<block_id>\" sur l'element HTML correspondant.\n" +
    "- Si une section ne peut pas etre remplie avec des donnees reelles trouvees par les outils, " +
    "ecrivez explicitement : 'Donnee non disponible — aucune observation approuvee trouvee.' " +
    "Ne devinez pas, n'inventez pas, n'utilisez pas vos connaissances generales sur l'entreprise.\n\n" +
    "ETAPES ATTENDUES:\n" +
    "1. Appelez get_preferences pour recuperer les preferences de style.\n" +
    "2. Appelez get_categories pour connaitre le plan de classification.\n" +
    "3. Appelez search_observations (status: approved) pour collecter les donnees.\n" +
    "4. Appelez search_evidence pour enrichir avec des extraits documentaires.\n" +
    "5. Si plusieurs observations, appelez compute_derivation pour des totaux.\n" +
    "6. Redigez le rapport en HTML complet (<!DOCTYPE html>...</html>) en francais " +
    "en n'incluant QUE les donnees retournees par les outils.\n" +
    "7. Appelez create_report avec le HTML produit et les UUIDs des observations.\n" +
    "8. Appelez render_pdf avec le report_id retourne par create_report.\n" +
    "9. Repondez a l'utilisateur en indiquant que le rapport est pret.\n\n" +
    (sourceReportId ? "Il s'agit d'une regeneration du rapport source: " + sourceReportId + ".\n\n" : "") +
    "Produisez du HTML semantique propre avec des sections H2/H3 et tableaux. " +
    "Les sections sans donnees disponibles doivent le mentionner explicitement plutot qu'etre inventees."
  );
}

// ─── Intent classification ────────────────────────────────────────────────────

async function classifyIntent(
  userText: string,
  history: LlmMessage[]
): Promise<"report" | "chat"> {
  if (!userText.trim()) return "chat";

  try {
    const response = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.XAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "grok-3-fast",
        messages: [
          {
            role: "system",
            content:
              "You are an intent classifier. " +
              "Reply with exactly one word: 'report' if the user is explicitly requesting " +
              "a report, analysis, generation, or document to be produced. " +
              "Reply 'chat' for greetings, questions, clarifications, or general conversation. " +
              "Reply only with 'report' or 'chat', nothing else.",
          },
          ...history.slice(-4),
          { role: "user", content: userText },
        ],
        max_tokens: 5,
        temperature: 0,
        stream: false,
      }),
    });

    if (!response.ok) return "chat";
    const data = await response.json();
    const answer = (data?.choices?.[0]?.message?.content ?? "").trim().toLowerCase();
    return answer === "report" ? "report" : "chat";
  } catch {
    return "chat";
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function emitToolCall(
  ctx: AgentContext,
  toolName: string,
  summary: string
): Promise<void> {
  await appendEvent(ctx.sessionId, {
    event_name: "tool_call",
    payload: { tool_name: toolName, summary, details: {} },
  });
  await db.insert(chatMessages).values({
    sessionId: ctx.sessionId,
    role: "assistant",
    type: "agent_tool_call",
    content: { tool_name: toolName, summary, details: {} },
  });
}

function toolCallSummary(toolName: string): string {
  const summaries: Record<string, string> = {
    search_observations: "Recherche d'observations",
    search_evidence: "Recherche de preuves documentaires",
    get_categories: "Chargement des categories",
    get_preferences: "Chargement des preferences",
    compute_derivation: "Calcul des indicateurs derives",
    create_report: "Creation du rapport",
    render_pdf: "Generation du PDF",
    propose_manual_observation: "Proposition d'observation manuelle",
    merge_observations: "Fusion des observations",
    get_report_data: "Chargement des donnees du rapport",
  };
  return summaries[toolName] ?? ("Execution de " + toolName);
}

export async function waitForPendingObservation(
  pendingId: string,
  timeoutMs: number = 10 * 60 * 1000
): Promise<{ status: "confirmed" | "skipped" | "timeout"; observation_id?: string }> {
  const channel = "pending-obs:" + pendingId;
  const subClient = new Redis(env.REDIS_URL);

  try {
    return await Promise.race<{ status: "confirmed" | "skipped" | "timeout"; observation_id?: string }>([
      new Promise((resolve) => {
        subClient.subscribe(channel, () => {});
        subClient.on("message", (ch, msg) => {
          if (ch === channel) {
            try {
              const data = JSON.parse(msg);
              resolve({
                status: data.status === "confirmed" ? "confirmed" : data.status === "skipped" ? "skipped" : "timeout",
                observation_id: data.observation_id,
              });
            } catch {
              resolve({ status: "timeout" });
            }
          }
        });
      }),
      new Promise((resolve) => {
        setTimeout(() => resolve({ status: "timeout" }), timeoutMs);
      }),
    ]);
  } finally {
    subClient.unsubscribe(channel).catch(() => {});
    subClient.disconnect();
  }
}