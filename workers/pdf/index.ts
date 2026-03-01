// PDF Worker entry — Slice 5
// BullMQ consumer for render-pdf-job queue, health endpoint on port 3003,
// and graceful shutdown.

// SPEC DEVIATION: PDF worker listens on internal port 3003 while PDF_WORKER_URL uses port 3001.
// Docker-compose maps host port 3001 to container port 3003 (ports: 3001:3003).

import { Worker } from "bullmq";
import { processRenderJob } from "./jobs/render";
import { pool } from "./pool";
import { startHealthServer, stopHealthServer } from "./health";

const QUEUE_NAME = "render-pdf-job";
const RENDER_PDF_TIMEOUT_MS = 90000;

const connection = {
  url: process.env.REDIS_URL!,
  maxRetriesPerRequest: null,
  enableTLSForSentinelMode: false,
};

async function main() {
  console.log("[pdf-worker] Boot", { queue: QUEUE_NAME });

  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      await processRenderJob(job);
    },
    {
      connection,
      concurrency: 3,
      lockDuration: RENDER_PDF_TIMEOUT_MS,
    }
  );

  worker.on("failed", (job, error) => {
    console.error(`[pdf-worker] Job ${job?.id} failed:`, error.message);
  });

  worker.on("completed", (job) => {
    console.log(`[pdf-worker] Job ${job.id} completed`);
  });

  // Health endpoint on port 3003
  startHealthServer(3003);

  // Graceful shutdown
  const shutdown = async () => {
    console.log("[pdf-worker] Shutting down...");
    await worker.close();
    await pool.shutdown();
    stopHealthServer();
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  console.log("[pdf-worker] Ready");
}

main().catch((error) => {
  console.error("[pdf-worker] Fatal:", error);
  process.exit(1);
});
