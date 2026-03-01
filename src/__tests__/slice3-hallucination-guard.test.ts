import { describe, it, expect } from "vitest";
import { validateBlockIds } from "@/lib/extraction/hallucinationGuard";
import type { ParsedObservation } from "@/lib/extraction/parseExtraction";

function makeObs(overrides: Partial<ParsedObservation> = {}): ParsedObservation {
  return {
    label: "Test observation",
    normalized_key: "test_key",
    value: "100",
    numeric_value: 100,
    unit: "tCO2e",
    data_type: "numeric",
    time_behavior: "periodic",
    period_start: "2023-01-01",
    period_end: "2023-12-31",
    evidence_block_ids: ["aaaaaaaa-1111-1111-1111-111111111111"] as any,
    confidence_score: 0.9,
    ...overrides,
  };
}

describe("HallucinationGuard", () => {
  const knownIds = new Set([
    "aaaaaaaa-1111-1111-1111-111111111111",
    "bbbbbbbb-2222-2222-2222-222222222222",
    "cccccccc-3333-3333-3333-333333333333",
  ]);

  it("passes observation when all block IDs are known", () => {
    const obs = makeObs({
      evidence_block_ids: [
        "aaaaaaaa-1111-1111-1111-111111111111",
        "bbbbbbbb-2222-2222-2222-222222222222",
      ] as any,
    });

    const result = validateBlockIds([obs], knownIds);
    expect(result.valid).toHaveLength(1);
    expect(result.skippedCount).toBe(0);
    expect(result.skippedDetails).toHaveLength(0);
  });

  it("rejects observation when any block ID is unknown", () => {
    const obs = makeObs({
      evidence_block_ids: [
        "aaaaaaaa-1111-1111-1111-111111111111",
        "dddddddd-4444-4444-4444-444444444444",
      ] as any,
    });

    const result = validateBlockIds([obs], knownIds);
    expect(result.valid).toHaveLength(0);
    expect(result.skippedCount).toBe(1);
    expect(result.skippedDetails[0].normalizedKey).toBe("test_key");
    expect(result.skippedDetails[0].invalidBlockIds).toContain(
      "dddddddd-4444-4444-4444-444444444444"
    );
  });

  it("rejects observation when ALL block IDs are unknown", () => {
    const obs = makeObs({
      evidence_block_ids: [
        "dddddddd-4444-4444-4444-444444444444",
        "eeeeeeee-5555-5555-5555-555555555555",
      ] as any,
    });

    const result = validateBlockIds([obs], knownIds);
    expect(result.valid).toHaveLength(0);
    expect(result.skippedCount).toBe(1);
    expect(result.skippedDetails[0].invalidBlockIds).toHaveLength(2);
  });

  it("filters mixed valid/invalid observations correctly", () => {
    const validObs = makeObs({
      normalized_key: "valid_obs",
      evidence_block_ids: ["aaaaaaaa-1111-1111-1111-111111111111"] as any,
    });
    const invalidObs = makeObs({
      normalized_key: "invalid_obs",
      evidence_block_ids: ["ffffffff-9999-9999-9999-999999999999"] as any,
    });

    const result = validateBlockIds([validObs, invalidObs], knownIds);
    expect(result.valid).toHaveLength(1);
    expect(result.valid[0].normalized_key).toBe("valid_obs");
    expect(result.skippedCount).toBe(1);
    expect(result.skippedDetails[0].normalizedKey).toBe("invalid_obs");
  });

  it("handles empty observations array", () => {
    const result = validateBlockIds([], knownIds);
    expect(result.valid).toHaveLength(0);
    expect(result.skippedCount).toBe(0);
  });

  it("handles empty known block ID set", () => {
    const obs = makeObs();
    const result = validateBlockIds([obs], new Set());
    expect(result.valid).toHaveLength(0);
    expect(result.skippedCount).toBe(1);
  });
});
