import { describe, it, expect } from "vitest";
import type { PipelineEvent } from "@/lib/pipeline/events";
import {
  PIPELINE_SSE_HEARTBEAT_MS,
  PIPELINE_REPLAY_TTL_MS,
  PIPELINE_REPLAY_MAX_EVENTS,
} from "@/lib/pipeline/events";

describe("Pipeline event types", () => {
  it("pipeline_stage_changed event conforms to type", () => {
    const event: PipelineEvent = {
      id: 1,
      type: "pipeline_stage_changed",
      documentVersionId: "dvid-1",
      documentId: "did-1",
      pipelineStatus: "ocr_processing",
      timestamp: new Date().toISOString(),
    };
    expect(event.type).toBe("pipeline_stage_changed");
    expect(event.pipelineStatus).toBe("ocr_processing");
  });

  it("pipeline_failed event includes stage and error", () => {
    const event: PipelineEvent = {
      id: 2,
      type: "pipeline_failed",
      documentVersionId: "dvid-1",
      documentId: "did-1",
      stage: "ocr",
      error: "PaddleOCR timeout",
      timestamp: new Date().toISOString(),
    };
    expect(event.type).toBe("pipeline_failed");
    expect(event.stage).toBe("ocr");
    expect(event.error).toBe("PaddleOCR timeout");
  });

  it("extraction_complete event includes observationCount", () => {
    const event: PipelineEvent = {
      id: 3,
      type: "extraction_complete",
      documentVersionId: "dvid-1",
      documentId: "did-1",
      observationCount: 14,
      timestamp: new Date().toISOString(),
    };
    expect(event.type).toBe("extraction_complete");
    expect(event.observationCount).toBe(14);
  });

  it("heartbeat event has only id, type, and timestamp", () => {
    const event: PipelineEvent = {
      id: 4,
      type: "heartbeat",
      timestamp: new Date().toISOString(),
    };
    expect(event.type).toBe("heartbeat");
    expect(Object.keys(event)).toEqual(["id", "type", "timestamp"]);
  });

  it("pipeline_stage_changed accepts all valid statuses", () => {
    const validStatuses = [
      "uploaded", "ocr_processing", "ocr_done", "embedding",
      "embedded", "extracting", "review_ready", "failed",
    ] as const;

    for (const status of validStatuses) {
      const event: PipelineEvent = {
        id: 1,
        type: "pipeline_stage_changed",
        documentVersionId: "dvid-1",
        documentId: "did-1",
        pipelineStatus: status,
        timestamp: new Date().toISOString(),
      };
      expect(event.pipelineStatus).toBe(status);
    }
  });

  it("pipeline_failed accepts all valid stages", () => {
    const validStages = ["ocr", "embedding", "extraction"] as const;
    for (const stage of validStages) {
      const event: PipelineEvent = {
        id: 1,
        type: "pipeline_failed",
        documentVersionId: "dvid-1",
        documentId: "did-1",
        stage,
        error: "test error",
        timestamp: new Date().toISOString(),
      };
      expect(event.stage).toBe(stage);
    }
  });
});

describe("Pipeline SSE constants", () => {
  it("PIPELINE_SSE_HEARTBEAT_MS is 30 seconds", () => {
    expect(PIPELINE_SSE_HEARTBEAT_MS).toBe(30000);
  });

  it("PIPELINE_REPLAY_TTL_MS is 60 seconds", () => {
    expect(PIPELINE_REPLAY_TTL_MS).toBe(60000);
  });

  it("PIPELINE_REPLAY_MAX_EVENTS is 200", () => {
    expect(PIPELINE_REPLAY_MAX_EVENTS).toBe(200);
  });
});
