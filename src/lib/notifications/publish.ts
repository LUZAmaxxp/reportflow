import { sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { db } from "@/lib/db";
import { redis } from "@/lib/redis";
import { notifications } from "@/lib/db/schema/notifications";
import { PIPELINE_EVENTS_CHANNEL_PREFIX } from "@/lib/constants";
import { nextEventId } from "@/lib/pipeline/pubsub";

interface PublishNotificationInput {
  type: "conflict_detected" | "conflict_resolved" | "pipeline_done" | "report_ready";
  payload: Record<string, unknown>;
  userId?: string | null;
}

/**
 * Notification persistence + Redis pub/sub fan-out to existing pipeline SSE channel.
 * Guarantee DB insert occurs before publish.
 * Accepts optional dbOverride for use from worker processes with their own DB pool.
 */
export async function publishNotification(
  companyId: string,
  input: PublishNotificationInput,
  dbOverride?: typeof db
): Promise<{ notificationId: string }> {
  const notificationId = uuidv7();
  const dbInstance = dbOverride ?? db;

  // Insert notification into DB (enum now has all required values)
  await dbInstance.insert(notifications).values({
    notificationId,
    companyId,
    userId: input.userId ?? null,
    type: input.type,
    payload: input.payload,
    read: false,
  });

  // Compute unreadCount after insert
  const unreadResult = await dbInstance.execute(
    sql`SELECT COUNT(*)::int as count FROM notification
        WHERE company_id = ${companyId} AND read = false`
  );
  const unreadCount = (unreadResult.rows?.[0] as any)?.count ?? 0;

  // Publish JSON event to Redis channel
  const channel = `${PIPELINE_EVENTS_CHANNEL_PREFIX}${companyId}`;
  const event = {
    id: nextEventId(),
    type: "notification" as const,
    notificationId,
    notificationType: input.type,
    payload: input.payload,
    unreadCount,
    timestamp: new Date().toISOString(),
  };
  await redis.publish(channel, JSON.stringify(event));

  // TODO: verify - notification SSE event is delivered within 2 seconds of Notification insert
  return { notificationId };
}
