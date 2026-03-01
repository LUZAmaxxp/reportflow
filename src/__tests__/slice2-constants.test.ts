import { describe, it, expect, vi } from "vitest";
import { QUEUE_NAMES, QUEUE_TIMEOUT_MS, LOW_CONFIDENCE_THRESHOLD } from "@/lib/constants";
import {
  PIPELINE_SSE_HEARTBEAT_MS,
  PIPELINE_REPLAY_TTL_MS,
  PIPELINE_REPLAY_MAX_EVENTS,
} from "@/lib/pipeline/events";

describe("Pipeline SSE constants", () => {
  it("heartbeat interval is 30 seconds", () => {
    expect(PIPELINE_SSE_HEARTBEAT_MS).toBe(30000);
  });

  it("replay TTL is 60 seconds", () => {
    expect(PIPELINE_REPLAY_TTL_MS).toBe(60000);
  });

  it("replay max events is 200", () => {
    expect(PIPELINE_REPLAY_MAX_EVENTS).toBe(200);
  });
});

describe("Queue contracts", () => {
  it("defines all 6 queue names", () => {
    expect(QUEUE_NAMES.OCR).toBe("ocr-job");
    expect(QUEUE_NAMES.EMBEDDING).toBe("embedding-job");
    expect(QUEUE_NAMES.EXTRACTION).toBe("extraction-job");
    expect(QUEUE_NAMES.SEMANTIC_CONFLICT).toBe("semantic-conflict-job");
    expect(QUEUE_NAMES.RENDER_PDF).toBe("render-pdf-job");
    expect(QUEUE_NAMES.PENDING_OBS_TIMEOUT).toBe("pending-obs-timeout");
  });

  it("OCR timeout is 180000ms (3 minutes)", () => {
    expect(QUEUE_TIMEOUT_MS[QUEUE_NAMES.OCR]).toBe(180000);
  });

  it("Embedding timeout is 120000ms (2 minutes)", () => {
    expect(QUEUE_TIMEOUT_MS[QUEUE_NAMES.EMBEDDING]).toBe(120000);
  });

  it("Extraction timeout is 300000ms (5 minutes)", () => {
    expect(QUEUE_TIMEOUT_MS[QUEUE_NAMES.EXTRACTION]).toBe(300000);
  });

  it("Semantic conflict timeout is 60000ms (1 minute)", () => {
    expect(QUEUE_TIMEOUT_MS[QUEUE_NAMES.SEMANTIC_CONFLICT]).toBe(60000);
  });

  it("Render PDF timeout is 90000ms (1.5 minutes)", () => {
    expect(QUEUE_TIMEOUT_MS[QUEUE_NAMES.RENDER_PDF]).toBe(90000);
  });

  it("Pending obs timeout is 30000ms (30 seconds)", () => {
    expect(QUEUE_TIMEOUT_MS[QUEUE_NAMES.PENDING_OBS_TIMEOUT]).toBe(30000);
  });
});

describe("Shared constants", () => {
  it("LOW_CONFIDENCE_THRESHOLD is 0.70", () => {
    expect(LOW_CONFIDENCE_THRESHOLD).toBe(0.70);
  });
});
