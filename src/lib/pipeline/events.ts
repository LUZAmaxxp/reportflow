export const PIPELINE_SSE_HEARTBEAT_MS = 30000;
export const PIPELINE_REPLAY_TTL_MS = 60000;
export const PIPELINE_REPLAY_MAX_EVENTS = 200;

export type PipelineEvent =
  | {
      id: number;
      type: "pipeline_stage_changed";
      documentVersionId: string;
      documentId: string;
      pipelineStatus:
        | "uploaded"
        | "ocr_processing"
        | "ocr_done"
        | "embedding"
        | "embedded"
        | "extracting"
        | "review_ready"
        | "failed";
      timestamp: string;
    }
  | {
      id: number;
      type: "pipeline_failed";
      documentVersionId: string;
      documentId: string;
      stage: "ocr" | "embedding" | "extraction";
      error: string;
      timestamp: string;
    }
  | {
      id: number;
      type: "extraction_complete";
      documentVersionId: string;
      documentId: string;
      observationCount: number;
      warning?: string;
      timestamp: string;
    }
  | {
      id: number;
      type: "observation_approved";
      observationId: string;
      documentId: string;
      companyId: string;
      timestamp: string;
    }
  | {
      id: number;
      type: "heartbeat";
      timestamp: string;
    }
  | ConflictDetectedEvent
  | NotificationEvent;

export interface ConflictDetectedEvent {
  id: number;
  type: "conflict_detected";
  conflictId: string;
  normalizedKey: string;
  matchMethod: "exact" | "semantic";
  timestamp: string;
}

export interface NotificationEvent {
  id: number;
  type: "notification";
  notificationId: string;
  notificationType: "conflict_detected" | "conflict_resolved" | "pipeline_done" | "report_ready";
  payload: Record<string, unknown>;
  unreadCount: number;
  timestamp: string;
}

// Slice 3 named event interfaces for type-safe consumption
export interface PipelineEventObservationApproved {
  type: "observation_approved";
  observationId: string;
  documentId: string;
  companyId: string;
  timestamp: string;
}

export interface PipelineEventStageChanged {
  type: "pipeline_stage_changed";
  documentVersionId: string;
  documentId: string;
  pipelineStatus: string;
  timestamp: string;
}

export interface PipelineEventExtractionComplete {
  type: "extraction_complete";
  documentVersionId: string;
  documentId: string;
  observationCount: number;
  warning?: string;
  timestamp: string;
}
