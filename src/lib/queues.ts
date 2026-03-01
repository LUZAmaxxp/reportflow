import { Queue } from "bullmq";
import { env } from "@/lib/env";
import { QUEUE_NAMES, QUEUE_TIMEOUT_MS } from "@/lib/constants";

const sharedDefaults = {
  removeOnComplete: { count: 500 },
  removeOnFail: { count: 1000 },
};

const connection = {
  url: env.REDIS_URL,
  maxRetriesPerRequest: null, // Required by BullMQ for blocking commands
  enableTLSForSentinelMode: false,
};

export const ocrQueue = new Queue(QUEUE_NAMES.OCR, {
  connection,
  defaultJobOptions: { ...sharedDefaults },
});

export const embeddingQueue = new Queue(QUEUE_NAMES.EMBEDDING, {
  connection,
  defaultJobOptions: { ...sharedDefaults },
});

export const extractionQueue = new Queue(QUEUE_NAMES.EXTRACTION, {
  connection,
  defaultJobOptions: { ...sharedDefaults },
});

export const semanticConflictQueue = new Queue(QUEUE_NAMES.SEMANTIC_CONFLICT, {
  connection,
  defaultJobOptions: {
    ...sharedDefaults,
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
  },
});

export const renderPdfQueue = new Queue(QUEUE_NAMES.RENDER_PDF, {
  connection,
  defaultJobOptions: {
    ...sharedDefaults,
    attempts: 2,
  },
});

export const pendingObsTimeoutQueue = new Queue(QUEUE_NAMES.PENDING_OBS_TIMEOUT, {
  connection,
  defaultJobOptions: {
    ...sharedDefaults,
    attempts: 3,
  },
});

export const agentLoopQueue = new Queue(QUEUE_NAMES.AGENT_LOOP, {
  connection,
  defaultJobOptions: {
    ...sharedDefaults,
    attempts: 1,
    // timeout is enforced at Worker level via lockDuration — agent-loop is unlimited (0)
  },
});

export const companyDeletionQueue = new Queue(QUEUE_NAMES.COMPANY_DELETION, {
  connection,
  defaultJobOptions: {
    ...sharedDefaults,
    attempts: 2,
  },
});

// Re-export timeout map so workers can use it as lockDuration
export { QUEUE_TIMEOUT_MS };
