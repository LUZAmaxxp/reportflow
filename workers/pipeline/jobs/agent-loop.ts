// workers/pipeline/jobs/agent-loop.ts
// BullMQ job handler for the 'agent-loop' queue.
// Deserializes job payload, loads companyId/userId from chat_session,
// then delegates to the shared runAgentLoop orchestration logic.

import type { Job } from "bullmq";
import { workerDb } from "../db";
import { chatSessions } from "@/lib/db/schema/notifications";
import { eq } from "drizzle-orm";
import { runAgentLoop } from "@/lib/agent/loop";

export interface AgentLoopJobPayload {
  session_id: string;
  user_message_id: string | null;
  mode: "normal" | "regenerate";
  report_id: string | null;
  observation_ids?: string[];
  derivation_result_ids?: string[];
}

export async function processAgentLoopJob(job: Job<AgentLoopJobPayload>): Promise<void> {
  const {
    session_id,
    user_message_id,
    mode,
    report_id,
    observation_ids,
    derivation_result_ids,
  } = job.data;

  // Step 1: Load chat_session to derive companyId and userId
  // (ownership enforcement via plan §5.17)
  const [session] = await workerDb
    .select({
      userId: chatSessions.userId,
      companyId: chatSessions.companyId,
    })
    .from(chatSessions)
    .where(eq(chatSessions.sessionId, session_id))
    .limit(1);

  if (!session) {
    throw new Error(`[agent-loop] chat_session not found: ${session_id}`);
  }

  // Step 2–5: Run the full agent orchestration
  await runAgentLoop({
    session_id,
    user_message_id,
    mode,
    report_id,
    observation_ids,
    derivation_result_ids,
    companyId: session.companyId,
    userId: session.userId,
  });
}
