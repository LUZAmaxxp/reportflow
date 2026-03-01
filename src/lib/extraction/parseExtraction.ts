import { z } from "zod";

/**
 * Zod schema and parser for Grok extraction response.
 * Validates label, normalized_key regex, value, evidence_block_ids, confidence_score, etc.
 */

export type UUIDv7String = string;
export type NonEmptyUuidv7Array = { 0: UUIDv7String } & UUIDv7String[];

export interface ParsedObservation {
  label: string;
  normalized_key: string;
  value: string;
  numeric_value: number | null;
  unit: string | null;
  data_type: "numeric" | "percentage" | "text" | "boolean";
  time_behavior: "periodic" | "point_in_time" | "none";
  period_start: string | null;
  period_end: string | null;
  evidence_block_ids: NonEmptyUuidv7Array;
  confidence_score: number;
}

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const normalizedKeyRegex = /^[a-z][a-z0-9_]{0,99}$/;
const isoDateRegex = /^\d{4}-\d{2}-\d{2}$/;

const parsedObservationSchema = z
  .object({
    label: z.string().min(1).max(200),
    normalized_key: z.string().regex(normalizedKeyRegex, "normalized_key must match ^[a-z][a-z0-9_]{0,99}$"),
    value: z.string().min(1),
    numeric_value: z.number().nullable().default(null),
    unit: z.string().nullable().default(null),
    data_type: z.enum(["numeric", "percentage", "text", "boolean"]),
    time_behavior: z.enum(["periodic", "point_in_time", "none"]),
    period_start: z.string().regex(isoDateRegex).nullable().default(null),
    period_end: z.string().regex(isoDateRegex).nullable().default(null),
    evidence_block_ids: z
      .array(z.string().regex(uuidRegex, "evidence_block_id must be a valid UUID"))
      .min(1, "evidence_block_ids must be non-empty") as unknown as z.ZodType<NonEmptyUuidv7Array>,
    confidence_score: z.number().min(0).max(1),
  })
  .refine(
    (data) => {
      if (data.period_start && data.period_end) {
        return data.period_end >= data.period_start;
      }
      return true;
    },
    { message: "period_end must be >= period_start when both provided" }
  )
  .refine(
    (data) => {
      // Cross-field guard: numeric or percentage data_type requires numeric_value to be non-null
      if (data.data_type === "numeric" || data.data_type === "percentage") {
        return data.numeric_value !== null;
      }
      return true;
    },
    { message: "data_type numeric or percentage requires numeric_value to be non-null" }
  );

const extractionResponseSchema = z.array(parsedObservationSchema);

/**
 * Validates Grok extraction response against ParsedObservation[] Zod schema.
 * Returns validated ParsedObservation[] or throws on schema validation failure.
 */
export function parseExtractionResponse(raw: unknown): ParsedObservation[] {
  const result = extractionResponseSchema.safeParse(raw);
  if (!result.success) {
    throw new ExtractionParseError(
      `Extraction response validation failed: ${result.error.message}`,
      result.error
    );
  }
  return result.data as ParsedObservation[];
}

export class ExtractionParseError extends Error {
  constructor(
    message: string,
    public readonly zodError: z.ZodError
  ) {
    super(message);
    this.name = "ExtractionParseError";
  }
}
