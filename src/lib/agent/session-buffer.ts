import { redis } from "@/lib/redis";
import Redis from "ioredis";
import { env } from "@/lib/env";

// Slice 5 §5.4 — Redis Streams-backed per-session replay buffer

export const CHAT_SSE_STREAM_MAXLEN = 200;
export const CHAT_SSE_STREAM_TTL_SECONDS = 60;

// Shared subscriber client for blocking reads — avoids creating/destroying
// a connection per readNewEvents call in the tight SSE loop.
let _blockingClient: Redis | null = null;
function getBlockingClient(): Redis {
  if (!_blockingClient || _blockingClient.status === "end") {
    _blockingClient = new Redis(env.REDIS_URL);
  }
  return _blockingClient;
}

export type TokenEvent = { event_name: "token"; payload: { delta: string } };
export type ToolCallEvent = { event_name: "tool_call"; payload: { tool_name: string; summary: string; details?: Record<string, unknown> } };
export type ManualObsRequestEvent = { event_name: "manual_obs_request"; payload: { pending_id: string; prefilled: { label: string; normalized_key: string; value: string; unit: string | null; period_start: string | null; period_end: string | null } } };
export type ReportReadyEvent = { event_name: "report_ready"; payload: { report_id: string; title: string; html_snapshot_url: string; pdf_url: string | null } };
export type ErrorEvent = { event_name: "error"; payload: { message: string; retryable: boolean } };
export type DoneEvent = { event_name: "done"; payload: Record<string, never> };
export type ChatSseEvent = TokenEvent | ToolCallEvent | ManualObsRequestEvent | ReportReadyEvent | ErrorEvent | DoneEvent;

function streamKey(sessionId: string): string {
  return `sse:chat:${sessionId}`;
}

/**
 * Append an SSE event to the session's Redis Stream.
 * Returns the stream entry ID.
 */
export async function appendEvent(
  sessionId: string,
  event: ChatSseEvent
): Promise<string> {
  const key = streamKey(sessionId);
  const id = await redis.xadd(
    key,
    "MAXLEN",
    "~",
    String(CHAT_SSE_STREAM_MAXLEN),
    "*",
    "event_name",
    event.event_name,
    "payload",
    JSON.stringify(event.payload)
  );

  // Set TTL after done event for cleanup
  if (event.event_name === "done") {
    await redis.expire(key, CHAT_SSE_STREAM_TTL_SECONDS);
  }

  return id!;
}

/**
 * Replay events from a given Last-Event-ID (exclusive).
 * Returns array of [streamId, eventName, payload] tuples.
 */
export async function replayEvents(
  sessionId: string,
  lastEventId?: string
): Promise<Array<{ id: string; event_name: string; payload: string }>> {
  const key = streamKey(sessionId);
  const start = lastEventId ? incrementStreamId(lastEventId) : "0-0";
  const entries = await redis.xrange(key, start, "+");

  return entries.map(([id, fields]) => {
    const fieldMap = parseFields(fields);
    return {
      id,
      event_name: fieldMap.event_name ?? "unknown",
      payload: fieldMap.payload ?? "{}",
    };
  });
}

/**
 * Block-read new events from stream for SSE forwarding.
 * Returns null on timeout, or array of events.
 */
export async function readNewEvents(
  sessionId: string,
  lastId: string,
  blockMs: number = 5000,
  countLimit: number = 10
): Promise<Array<{ id: string; event_name: string; payload: string }> | null> {
  // Use a shared dedicated client for blocking reads
  const client = getBlockingClient();
  try {
    const key = streamKey(sessionId);
    const result = await client.xread(
      "COUNT",
      countLimit,
      "BLOCK",
      blockMs,
      "STREAMS",
      key,
      lastId
    );

    if (!result) return null;

    const entries: Array<{ id: string; event_name: string; payload: string }> = [];
    for (const [, streamEntries] of result) {
      for (const [id, fields] of streamEntries) {
        const fieldMap = parseFields(fields);
        entries.push({
          id,
          event_name: fieldMap.event_name ?? "unknown",
          payload: fieldMap.payload ?? "{}",
        });
      }
    }

    return entries.length > 0 ? entries : null;
  } catch (err) {
    // On connection error, reset the shared client so next call re-creates it
    _blockingClient = null;
    throw err;
  }
}

function incrementStreamId(id: string): string {
  const [ts, seq] = id.split("-");
  const nextSeq = parseInt(seq ?? "0", 10) + 1;
  return `${ts}-${nextSeq}`;
}

function parseFields(fields: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (let i = 0; i < fields.length; i += 2) {
    map[fields[i]] = fields[i + 1];
  }
  return map;
}
