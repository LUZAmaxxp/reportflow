import { describe, it, expect } from "vitest";
import { parseExtractionResponse } from "@/lib/extraction/parseExtraction";

const VALID_UUID = "aaaaaaaa-1111-1111-1111-111111111111";

function makeValidObs(overrides: Record<string, unknown> = {}) {
  return {
    label: "Émissions de CO2",
    normalized_key: "co2_emissions",
    value: "1500 tCO2e",
    numeric_value: 1500,
    unit: "tCO2e",
    data_type: "numeric",
    time_behavior: "periodic",
    period_start: "2023-01-01",
    period_end: "2023-12-31",
    evidence_block_ids: [VALID_UUID],
    confidence_score: 0.85,
    ...overrides,
  };
}

describe("parseExtractionResponse", () => {
  it("parses a valid observation array", () => {
    const result = parseExtractionResponse([makeValidObs()]);
    expect(result).toHaveLength(1);
    expect(result[0].normalized_key).toBe("co2_emissions");
  });

  it("parses multiple valid observations", () => {
    const result = parseExtractionResponse([
      makeValidObs({ normalized_key: "a_metric" }),
      makeValidObs({ normalized_key: "b_metric" }),
    ]);
    expect(result).toHaveLength(2);
  });

  it("rejects label longer than 200 characters", () => {
    expect(() =>
      parseExtractionResponse([makeValidObs({ label: "x".repeat(201) })])
    ).toThrow();
  });

  it("rejects invalid normalized_key format", () => {
    expect(() =>
      parseExtractionResponse([makeValidObs({ normalized_key: "123_invalid" })])
    ).toThrow();
  });

  it("rejects normalized_key starting with uppercase", () => {
    expect(() =>
      parseExtractionResponse([makeValidObs({ normalized_key: "Invalid_key" })])
    ).toThrow();
  });

  it("rejects empty evidence_block_ids", () => {
    expect(() =>
      parseExtractionResponse([makeValidObs({ evidence_block_ids: [] })])
    ).toThrow();
  });

  it("rejects evidence_block_ids with invalid UUIDs", () => {
    expect(() =>
      parseExtractionResponse([makeValidObs({ evidence_block_ids: ["not-a-uuid"] })])
    ).toThrow();
  });

  it("rejects confidence_score outside 0..1", () => {
    expect(() =>
      parseExtractionResponse([makeValidObs({ confidence_score: 1.5 })])
    ).toThrow();
    expect(() =>
      parseExtractionResponse([makeValidObs({ confidence_score: -0.1 })])
    ).toThrow();
  });

  it("rejects numeric data_type without numeric_value", () => {
    expect(() =>
      parseExtractionResponse([
        makeValidObs({ data_type: "numeric", numeric_value: null }),
      ])
    ).toThrow();
  });

  it("rejects percentage data_type without numeric_value", () => {
    expect(() =>
      parseExtractionResponse([
        makeValidObs({ data_type: "percentage", numeric_value: null }),
      ])
    ).toThrow();
  });

  it("allows text data_type without numeric_value", () => {
    const result = parseExtractionResponse([
      makeValidObs({ data_type: "text", numeric_value: null }),
    ]);
    expect(result).toHaveLength(1);
  });

  it("rejects period_end before period_start", () => {
    expect(() =>
      parseExtractionResponse([
        makeValidObs({ period_start: "2024-01-01", period_end: "2023-01-01" }),
      ])
    ).toThrow();
  });

  it("validates period date format", () => {
    expect(() =>
      parseExtractionResponse([makeValidObs({ period_start: "not-a-date" })])
    ).toThrow();
  });

  it("allows null periods", () => {
    const result = parseExtractionResponse([
      makeValidObs({ period_start: null, period_end: null }),
    ]);
    expect(result).toHaveLength(1);
  });

  it("rejects non-array input", () => {
    expect(() => parseExtractionResponse({ label: "test" })).toThrow();
    expect(() => parseExtractionResponse("not array")).toThrow();
  });

  it("allows empty array", () => {
    const result = parseExtractionResponse([]);
    expect(result).toHaveLength(0);
  });
});
