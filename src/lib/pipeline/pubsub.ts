import { redis } from "@/lib/redis";
import type { PipelineEvent } from "@/lib/pipeline/events";

let eventCounter = 0;

export function nextEventId(): number {
  return ++eventCounter;
}

export async function publishPipelineEvent(
  companyId: string,
  event: PipelineEvent
): Promise<void> {
  const channel = `pipeline:events:${companyId}`;
  await redis.publish(channel, JSON.stringify(event));
}
