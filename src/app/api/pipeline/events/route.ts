import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { PIPELINE_SSE_HEARTBEAT_MS, PIPELINE_REPLAY_TTL_MS, PIPELINE_REPLAY_MAX_EVENTS } from "@/lib/pipeline/events";
import type { PipelineEvent } from "@/lib/pipeline/events";
import { nextEventId } from "@/lib/pipeline/pubsub";

// In-memory per-company replay buffer
const replayBuffers = new Map<string, { events: Array<{ id: number; payload: string; timestamp: number }> }>();

function getReplayBuffer(companyId: string) {
  let buf = replayBuffers.get(companyId);
  if (!buf) {
    buf = { events: [] };
    replayBuffers.set(companyId, buf);
  }
  return buf;
}

function addToReplayBuffer(companyId: string, event: PipelineEvent) {
  const buf = getReplayBuffer(companyId);
  const now = Date.now();
  // Prune expired events
  buf.events = buf.events.filter((e) => now - e.timestamp < PIPELINE_REPLAY_TTL_MS);
  // Add new event
  buf.events.push({ id: event.id, payload: JSON.stringify(event), timestamp: now });
  // Enforce max
  if (buf.events.length > PIPELINE_REPLAY_MAX_EVENTS) {
    buf.events = buf.events.slice(-PIPELINE_REPLAY_MAX_EVENTS);
  }
}

function getReplayEvents(companyId: string, lastEventId: number): string[] {
  const buf = getReplayBuffer(companyId);
  const now = Date.now();
  return buf.events
    .filter((e) => e.id > lastEventId && now - e.timestamp < PIPELINE_REPLAY_TTL_MS)
    .map((e) => e.payload);
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.user_id) {
    return new Response(JSON.stringify({ code: "unauthorized", message: "Authentication required" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { company_id } = session.user;
  if (!company_id) {
    return new Response(JSON.stringify({ code: "forbidden", message: "Session-company mismatch" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const channel = `pipeline:events:${company_id}`;

  const lastEventIdHeader = req.headers.get("Last-Event-ID");
  const lastEventId = lastEventIdHeader ? parseInt(lastEventIdHeader, 10) || 0 : 0;

  const encoder = new TextEncoder();
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  // Create a dedicated subscriber Redis connection for this SSE connection
  const Redis = (await import("ioredis")).default;
  const { env } = await import("@/lib/env");
  const subscriber = new Redis(env.REDIS_URL);

  const stream = new ReadableStream({
    start(controller) {
      // Replay missed events
      if (lastEventId > 0) {
        const missed = getReplayEvents(company_id, lastEventId);
        for (const payload of missed) {
          const parsed = JSON.parse(payload);
          controller.enqueue(
            encoder.encode(`id: ${parsed.id}\nevent: ${parsed.type}\ndata: ${payload}\n\n`)
          );
        }
      }

      // Subscribe to Redis channel
      subscriber.subscribe(channel).catch((err) => {
        console.error("SSE subscribe error", err);
      });

      subscriber.on("message", (_ch: string, message: string) => {
        if (closed) return;
        try {
          const event: PipelineEvent = JSON.parse(message);
          // Add to replay buffer
          addToReplayBuffer(company_id, event);
          controller.enqueue(
            encoder.encode(`id: ${event.id}\nevent: ${event.type}\ndata: ${message}\n\n`)
          );
        } catch (err) {
          console.error("SSE message parse error", err);
        }
      });

      // Heartbeat
      heartbeatTimer = setInterval(() => {
        if (closed) return;
        const heartbeat: PipelineEvent = {
          id: nextEventId(),
          type: "heartbeat",
          timestamp: new Date().toISOString(),
        };
        try {
          controller.enqueue(
            encoder.encode(`id: ${heartbeat.id}\nevent: heartbeat\ndata: ${JSON.stringify(heartbeat)}\n\n`)
          );
        } catch {
          // Stream may be closed
        }
      }, PIPELINE_SSE_HEARTBEAT_MS);
    },
    cancel() {
      closed = true;
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      subscriber.unsubscribe(channel).catch(() => {});
      subscriber.disconnect();
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
