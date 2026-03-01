import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { withTenant } from "@/lib/db/rls";
import { chatSessions } from "@/lib/db/schema/notifications";
import { eq, and } from "drizzle-orm";
import { replayEvents, readNewEvents } from "@/lib/agent/session-buffer";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/chat/sessions/{id}/stream — SSE endpoint with Redis Streams replay.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.user_id) {
    return new Response(
      JSON.stringify({ code: "unauthorized", message: "Authentication required" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  const { id } = await params;

  if (!UUID_RE.test(id)) {
    return new Response(
      JSON.stringify({ code: "session_not_found", message: "Session not found" }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    );
  }

  const { user_id, company_id } = session.user;

  // Verify session ownership
  const owned = await withTenant(db, company_id, async (tx) => {
    const [row] = await tx
      .select({ sessionId: chatSessions.sessionId })
      .from(chatSessions)
      .where(
        and(
          eq(chatSessions.sessionId, id),
          eq(chatSessions.userId, user_id)
        )
      )
      .limit(1);
    return !!row;
  });

  if (!owned) {
    return new Response(
      JSON.stringify({ code: "session_not_found", message: "Session not found or not owned" }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    );
  }

  const lastEventId = req.headers.get("Last-Event-ID") ?? undefined;

  const encoder = new TextEncoder();
  let aborted = false;

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (id: string, eventName: string, payload: string) => {
        const frame = `id: ${id}\nevent: ${eventName}\ndata: ${payload}\n\n`;
        controller.enqueue(encoder.encode(frame));
      };

      try {
        // Replay missed events
        const replayed = await replayEvents(id, lastEventId);
        let lastId = lastEventId ?? "0-0";

        for (const evt of replayed) {
          if (aborted) return;
          sendEvent(evt.id, evt.event_name, evt.payload);
          lastId = evt.id;

          // If the replayed event is done, close the stream
          if (evt.event_name === "done") {
            controller.close();
            return;
          }
        }

        // Subscribe to new events via XREAD BLOCK
        while (!aborted) {
          const events = await readNewEvents(id, lastId, 5000, 10);

          if (aborted) break;

          if (!events) {
            // Send heartbeat comment to keep connection alive
            controller.enqueue(encoder.encode(": heartbeat\n\n"));
            continue;
          }

          for (const evt of events) {
            if (aborted) return;
            sendEvent(evt.id, evt.event_name, evt.payload);
            lastId = evt.id;

            if (evt.event_name === "done") {
              controller.close();
              return;
            }
          }
        }
      } catch (err) {
        if (!aborted) {
          console.error("[SSE stream] Error:", err);
          try {
            controller.close();
          } catch {
            // already closed
          }
        }
      }
    },
    cancel() {
      aborted = true;
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
