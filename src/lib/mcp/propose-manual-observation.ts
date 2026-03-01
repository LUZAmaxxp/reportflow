// MCP tool: propose_manual_observation — Slice 5 §5.8
// Creates pending manual observation and notifies UI via SSE.

import { db } from "@/lib/db";
import { withTenant } from "@/lib/db/rls";
import { pendingManualObservations } from "@/lib/db/schema/observations";
import { appendEvent } from "@/lib/agent/session-buffer";
import { pendingObsTimeoutQueue } from "@/lib/queues";
import type { AgentContext } from "@/lib/mcp/index";

// SPEC DEVIATION: MANUAL_OBS_EXPIRY_MINUTES — 10 minutes pending manual observation terminal timeout window
export const MANUAL_OBS_EXPIRY_MINUTES = 10;

interface ProposeManualObservationInput {
  label: string;
  normalized_key: string;
  value: string;
  unit?: string | null;
  period_start?: string | null;
  period_end?: string | null;
}

export async function proposeManualObservation(
  input: ProposeManualObservationInput,
  ctx: AgentContext
): Promise<{ pending_id: string }> {
  const expiresAt = new Date(Date.now() + MANUAL_OBS_EXPIRY_MINUTES * 60 * 1000);

  const prefilled = {
    label: input.label,
    normalized_key: input.normalized_key,
    value: input.value,
    unit: input.unit ?? null,
    period_start: input.period_start ?? null,
    period_end: input.period_end ?? null,
  };

  const result = await withTenant(db, ctx.companyId, async (tx) => {
    const [row] = await tx
      .insert(pendingManualObservations)
      .values({
        companyId: ctx.companyId,
        sessionId: ctx.sessionId,
        status: "pending",
        prefilled: prefilled as any,
        expiresAt,
      })
      .returning({
        pending_id: pendingManualObservations.pendingId,
      });

    return row;
  });

  // Emit SSE event for manual_obs_request
  await appendEvent(ctx.sessionId, {
    event_name: "manual_obs_request",
    payload: {
      pending_id: result.pending_id,
      prefilled,
    },
  });

  // Schedule delayed timeout job
  await pendingObsTimeoutQueue.add(
    "pending_observation_delayed_timeout_per_record",
    { pending_id: result.pending_id },
    {
      delay: MANUAL_OBS_EXPIRY_MINUTES * 60 * 1000,
      attempts: 3,
      removeOnComplete: true,
    }
  );

  return { pending_id: result.pending_id };
}
