// workers/pipeline/jobs/pending-obs-timeout.ts
// BullMQ job handler for the 'pending-obs-timeout' queue.
// Handles two job types:
//   - repeatable_sweep: scans all expired pending rows and marks them timed_out
//   - delayed per-record: targets a single pending_id

import type { Job } from "bullmq";
import { workerDb } from "../db";
import { pendingManualObservations } from "@/lib/db/schema/observations";
import { eq, and, lt, sql } from "drizzle-orm";
import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL!;

export interface PendingObsTimeoutPayload {
  mode: "repeatable_sweep";
  pending_id?: undefined;
}

export interface PendingObsDelayedPayload {
  pending_id: string;
  fire_at: string; // ISO8601 — created_at + 10 min
  mode?: undefined;
}

export type PendingObsJobPayload = PendingObsTimeoutPayload | PendingObsDelayedPayload;

export async function processPendingObsTimeoutJob(job: Job<PendingObsJobPayload>): Promise<void> {
  const { data } = job;

  if (data.mode === "repeatable_sweep" || !data.pending_id) {
    await runSweep();
  } else {
    await runDelayedTimeout(data.pending_id);
  }
}

// ─── Repeatable safety sweep ─────────────────────────────────────────────────

async function runSweep(): Promise<void> {
  // Step 1: Query expired pending records
  const expired = await workerDb
    .select({
      pendingId: pendingManualObservations.pendingId,
    })
    .from(pendingManualObservations)
    .where(
      and(
        eq(pendingManualObservations.status, "pending"),
        lt(pendingManualObservations.expiresAt, sql`now()`)
      )
    );

  if (expired.length === 0) return;

  const redis = new Redis(REDIS_URL);
  try {
    let timedOutCount = 0;

    for (const row of expired) {
      // Step 2: Transition to timed_out
      const updated = await workerDb
        .update(pendingManualObservations)
        .set({ status: "timed_out" })
        .where(
          and(
            eq(pendingManualObservations.pendingId, row.pendingId),
            eq(pendingManualObservations.status, "pending") // guard race condition
          )
        )
        .returning({ pendingId: pendingManualObservations.pendingId });

      if (updated.length > 0) {
        // Step 3: Unblock waiting agent via Redis pub/sub
        await redis.publish(
          `pending-obs:${row.pendingId}`,
          JSON.stringify({ status: "timeout" })
        );
        timedOutCount++;
      }
    }

    // Step 4: Operational logging
    if (timedOutCount > 0) {
      console.log(`[pending-obs-sweep] Timed out ${timedOutCount} pending observation(s)`);
    }
  } finally {
    redis.disconnect();
  }
}

// ─── Per-record delayed timeout ───────────────────────────────────────────────

async function runDelayedTimeout(pendingId: string): Promise<void> {
  // Step 1: Load target row
  const [row] = await workerDb
    .select({
      pendingId: pendingManualObservations.pendingId,
      status: pendingManualObservations.status,
      expiresAt: pendingManualObservations.expiresAt,
    })
    .from(pendingManualObservations)
    .where(eq(pendingManualObservations.pendingId, pendingId))
    .limit(1);

  // If already in terminal state, no-op
  if (!row || row.status !== "pending") return;

  // Step 2: Apply timed_out if now >= expires_at
  const now = new Date();
  if (row.expiresAt > now) {
    // Not yet expired — skip (safety net; the repeatable sweep will catch it)
    return;
  }

  const updated = await workerDb
    .update(pendingManualObservations)
    .set({ status: "timed_out" })
    .where(
      and(
        eq(pendingManualObservations.pendingId, pendingId),
        eq(pendingManualObservations.status, "pending")
      )
    )
    .returning({ pendingId: pendingManualObservations.pendingId });

  if (updated.length === 0) return; // Already resolved by another process

  // Step 3: Publish unblock signal
  const redis = new Redis(REDIS_URL);
  try {
    await redis.publish(
      `pending-obs:${pendingId}`,
      JSON.stringify({ status: "timeout" })
    );
  } finally {
    redis.disconnect();
  }

  console.log(`[pending-obs-timeout] Timed out pending observation ${pendingId}`);
}
