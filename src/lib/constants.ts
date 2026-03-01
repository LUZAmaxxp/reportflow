export const LOW_CONFIDENCE_THRESHOLD = 0.70;

export const AUTH_JWT_SHAPE = {
  user_id: "string",
  company_id: "string",
  role: "admin | editor | viewer",
} as const;

export const QUEUE_NAMES = {
  OCR: "ocr-job",
  EMBEDDING: "embedding-job",
  EXTRACTION: "extraction-job",
  SEMANTIC_CONFLICT: "semantic-conflict-job",
  RENDER_PDF: "render-pdf-job",
  PENDING_OBS_TIMEOUT: "pending-obs-timeout",
  AGENT_LOOP: "agent-loop",
  COMPANY_DELETION: "company-deletion-job",
} as const;

export const QUEUE_TIMEOUT_MS = {
  ["ocr-job"]: 180000,
  ["embedding-job"]: 120000,
  ["extraction-job"]: 300000,
  ["semantic-conflict-job"]: 60000,
  ["render-pdf-job"]: 90000,
  ["pending-obs-timeout"]: 30000,
  // agent-loop is unlimited (0) — manual obs wait + pdf render = up to ~11 min per job
  ["agent-loop"]: 0,
  ["company-deletion-job"]: 600000,
} as const;

export const THREE_PROCESS_DEPLOYMENT = {
  app_port: 3000,
  pipeline_worker_health_port: 3002,
  pdf_worker_health_port: 3001,
} as const;

export const ESG_KEYWORD_BAG =
  "GES émissions scope CO2 énergie eau déchets employés formation accidents genre gouvernance conseil administrateurs fournisseurs achats responsable" as const;

export const PIPELINE_EVENTS_CHANNEL_PREFIX = "pipeline:events:" as const;

// Slice 6 named queue constants
export const QUEUE_OCR_JOB = QUEUE_NAMES.OCR;
export const QUEUE_EMBEDDING_JOB = QUEUE_NAMES.EMBEDDING;
export const QUEUE_EXTRACTION_JOB = QUEUE_NAMES.EXTRACTION;
export const QUEUE_SEMANTIC_CONFLICT_JOB = QUEUE_NAMES.SEMANTIC_CONFLICT;
export const QUEUE_RENDER_PDF_JOB = QUEUE_NAMES.RENDER_PDF;
export const QUEUE_PENDING_OBS_TIMEOUT = QUEUE_NAMES.PENDING_OBS_TIMEOUT;
export const QUEUE_COMPANY_DELETION_JOB = QUEUE_NAMES.COMPANY_DELETION;

// Slice 6 named timeout constants
export const TIMEOUT_OCR_JOB_MS = QUEUE_TIMEOUT_MS["ocr-job"];
export const TIMEOUT_EMBEDDING_JOB_MS = QUEUE_TIMEOUT_MS["embedding-job"];
export const TIMEOUT_EXTRACTION_JOB_MS = QUEUE_TIMEOUT_MS["extraction-job"];
export const TIMEOUT_SEMANTIC_CONFLICT_JOB_MS = QUEUE_TIMEOUT_MS["semantic-conflict-job"];
export const TIMEOUT_RENDER_PDF_JOB_MS = QUEUE_TIMEOUT_MS["render-pdf-job"];
export const TIMEOUT_PENDING_OBS_TIMEOUT_MS = QUEUE_TIMEOUT_MS["pending-obs-timeout"];
