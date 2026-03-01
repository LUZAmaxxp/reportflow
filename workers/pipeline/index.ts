import "@/lib/env";
import { Worker } from "bullmq";
import { QUEUE_NAMES, QUEUE_TIMEOUT_MS } from "@/lib/constants";
import { processOcrJob } from "./jobs/ocr";
import { processEmbeddingJob } from "./jobs/embedding";
import { processExtractionJob } from "./jobs/extraction";
import { processAgentLoopJob } from "./jobs/agent-loop";
import { processPendingObsTimeoutJob } from "./jobs/pending-obs-timeout";
import { processSemanticConflictJob } from "./jobs/semanticConflict";
import { processCompanyDeletionJob } from "./jobs/company-deletion";
import { handleTerminalFailure } from "./dlq";
import { startHealthServer } from "./health";
import { stalePipelineSweep, STALE_PIPELINE_SCAN_EVERY_MS } from "./cron/stale-pipeline";
import { pendingObsTimeoutQueue } from "@/lib/queues";

const PENDING_OBS_SWEEP_EVERY_MS = 300_000; // 5 minutes

const connection = {
  url: process.env.REDIS_URL!,
  maxRetriesPerRequest: null, // Required by BullMQ for blocking commands
  enableTLSForSentinelMode: false,
};

async function main() {
  console.log("Pipeline worker boot", {
    queues: Object.values(QUEUE_NAMES),
  });

  // Register OCR worker
  const ocrWorker = new Worker(
    QUEUE_NAMES.OCR,
    async (job) => {
      await processOcrJob(job);
    },
    {
      connection,
      concurrency: 2,
      lockDuration: QUEUE_TIMEOUT_MS[QUEUE_NAMES.OCR],
    }
  );

  ocrWorker.on("failed", async (job, error) => {
    if (job && job.attemptsMade >= (job.opts.attempts ?? 3)) {
      await handleTerminalFailure(job, error, "ocr");
    }
  });

  // Register embedding worker
  const embeddingWorker = new Worker(
    QUEUE_NAMES.EMBEDDING,
    async (job) => {
      await processEmbeddingJob(job);
    },
    {
      connection,
      concurrency: 2,
      lockDuration: QUEUE_TIMEOUT_MS[QUEUE_NAMES.EMBEDDING],
    }
  );

  embeddingWorker.on("failed", async (job, error) => {
    if (job && job.attemptsMade >= (job.opts.attempts ?? 3)) {
      await handleTerminalFailure(job, error, "embedding");
    }
  });

  // Register extraction worker
  const extractionWorker = new Worker(
    QUEUE_NAMES.EXTRACTION,
    async (job) => {
      await processExtractionJob(job);
    },
    {
      connection,
      concurrency: 1,
      lockDuration: QUEUE_TIMEOUT_MS[QUEUE_NAMES.EXTRACTION],
    }
  );

  extractionWorker.on("failed", async (job, error) => {
    if (job && job.attemptsMade >= (job.opts.attempts ?? 2)) {
      await handleTerminalFailure(job, error, "extraction");
    }
  });

  // Register agent-loop worker (concurrency 2, no lockDuration — jobs run until done)
  const agentLoopWorker = new Worker(
    QUEUE_NAMES.AGENT_LOOP,
    async (job) => {
      await processAgentLoopJob(job);
    },
    {
      connection,
      concurrency: 2,
      lockDuration: 30_000,
      lockRenewTime: 15_000,
    }
  );

  agentLoopWorker.on("failed", async (job, error) => {
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
      console.error("[agent-loop] Terminal failure", { jobId: job.id, error: error.message });
    }
  });

  // Register semantic-conflict worker
  const semanticConflictWorker = new Worker(
    QUEUE_NAMES.SEMANTIC_CONFLICT,
    async (job) => {
      await processSemanticConflictJob(job);
    },
    {
      connection,
      concurrency: 2,
      lockDuration: QUEUE_TIMEOUT_MS[QUEUE_NAMES.SEMANTIC_CONFLICT],
    }
  );

  semanticConflictWorker.on("failed", async (job, error) => {
    if (job && job.attemptsMade >= (job.opts.attempts ?? 3)) {
      console.error("[semantic-conflict] Terminal failure", { jobId: job.id, error: error.message });
    }
  });

  // Register pending-obs-timeout worker (concurrency 1)
  const pendingObsTimeoutWorker = new Worker(
    QUEUE_NAMES.PENDING_OBS_TIMEOUT,
    async (job) => {
      await processPendingObsTimeoutJob(job);
    },
    {
      connection,
      concurrency: 1,
      lockDuration: 30_000,
    }
  );

  pendingObsTimeoutWorker.on("failed", async (job, error) => {
    if (job && job.attemptsMade >= (job.opts.attempts ?? 3)) {
      console.error("[pending-obs-timeout] Terminal failure", { jobId: job.id, error: error.message });
    }
  });

  // Register company-deletion worker (concurrency 1, long timeout)
  const companyDeletionWorker = new Worker(
    QUEUE_NAMES.COMPANY_DELETION,
    async (job) => {
      await processCompanyDeletionJob(job);
    },
    {
      connection,
      concurrency: 1,
      lockDuration: QUEUE_TIMEOUT_MS[QUEUE_NAMES.COMPANY_DELETION],
    }
  );

  companyDeletionWorker.on("failed", async (job, error) => {
    if (job && job.attemptsMade >= (job.opts.attempts ?? 2)) {
      console.error("[company-deletion] Terminal failure", { jobId: job?.id, error: error.message });
    }
  });

  // Schedule repeatable pending-obs sweep every 5 minutes
  await pendingObsTimeoutQueue.add(
    "repeatable_sweep",
    { mode: "repeatable_sweep" },
    {
      repeat: { every: PENDING_OBS_SWEEP_EVERY_MS },
      jobId: "pending-obs-sweep",
    }
  );

  // Start health server
  startHealthServer(3002);

  // Schedule stale pipeline sweep every 5 minutes
  // SPEC DEVIATION: stale-pipeline cron queue reuse — The stale-pipeline sweep is a setInterval cron rather than a dedicated BullMQ repeatable queue. In production this should be a dedicated cron queue.
  setInterval(async () => {
    try {
      await stalePipelineSweep();
    } catch (error) {
      console.error("Stale pipeline sweep failed:", error);
    }
  }, STALE_PIPELINE_SCAN_EVERY_MS);

  // Run initial sweep
  setTimeout(() => stalePipelineSweep().catch(console.error), 5000);

  console.log("Pipeline worker ready");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
